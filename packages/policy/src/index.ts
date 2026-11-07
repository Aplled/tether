import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  BrokerDispatch,
  BrokerReceipt,
  DemoBroker,
  IndependentObserver,
  VerificationResult,
} from "../../../apps/demo-broker/src/index.ts";

export type PrincipalKind = "human" | "agent" | "service";
export type AuthorityRole =
  "participant" | "incident_commander" | "execution_service";
export type ActionMode = "live" | "simulation";
export type ExecutionState =
  | "reserved"
  | "dispatching"
  | "awaiting_verification"
  | "verified"
  | "failed"
  | "outcome_unknown";

export interface AuthoritySeed {
  principals: Array<{
    id: string;
    kind: PrincipalKind;
    organizationId: string;
    roles: AuthorityRole[];
    revoked?: boolean;
  }>;
  incidents: Array<{
    id: string;
    organizationId: string;
    commanderPrincipalId: string;
    revision: number;
    open: boolean;
  }>;
  target: {
    identity: "pantry-demo-scheduler";
    generation: string;
    organizationId: string;
    enabled: boolean;
  };
  graphVersion: number;
  policyVersion: number;
  recoveryVersion: number;
}

export interface ProposeActionInput {
  organizationId: string;
  incidentId: string;
  operation: "stop_demo_scheduler";
  target: { identity: "pantry-demo-scheduler"; generation: string };
  parameters: Record<string, never>;
  mode: ActionMode;
  graphVersion: number;
  policyVersion: number;
  recoveryVersion: number;
  sourceProposal: { id: string; digest: string; contextDigest: string };
}

export interface ActionIntent extends ProposeActionInput {
  actionId: string;
  requesterPrincipalId: string;
  nonce: string;
  createdAt: string;
  canonicalDigest: string;
}

export interface Approval {
  approvalId: string;
  actionId: string;
  approverPrincipalId: string;
  approvedDigest: string;
  expiresAt: string;
  state: "approved" | "reserved" | "revoked" | "expired";
  executionId: string | null;
}

export interface Execution {
  executionId: string;
  actionId: string;
  state: ExecutionState;
  mode: ActionMode;
  brokerReceipt: BrokerReceipt | null;
  verification: VerificationResult | null;
  createdAt: string;
  updatedAt: string;
  reason?: string;
}

export class PolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PolicyError";
  }
}

export class PolicyEngine {
  readonly #db: DatabaseSync;

  constructor(input: { dbPath: string; seed?: AuthoritySeed }) {
    this.#db = new DatabaseSync(input.dbPath);
    this.#migrate();
    if (input.seed) this.#seed(input.seed);
  }

  close(): void {
    this.#db.close();
  }

  proposeAction(
    input: ProposeActionInput,
    authenticatedPrincipalId: string,
  ): ActionIntent {
    if (!isRecord(input))
      throw new PolicyError(
        "INVALID_ACTION",
        "action intent must be an object",
      );
    rejectKeys(
      input as any,
      [
        "organizationId",
        "incidentId",
        "operation",
        "target",
        "parameters",
        "mode",
        "graphVersion",
        "policyVersion",
        "recoveryVersion",
        "sourceProposal",
      ],
      "action intent",
    );
    if (
      !isBoundedId(input.organizationId) ||
      !isBoundedId(input.incidentId) ||
      !isRecord(input.target) ||
      !isRecord(input.parameters) ||
      !isRecord(input.sourceProposal)
    )
      throw new PolicyError(
        "INVALID_ACTION",
        "organization, incident, target, and parameters are invalid",
      );
    rejectKeys(input.target as any, ["identity", "generation"], "target");
    rejectKeys(
      input.sourceProposal as any,
      ["id", "digest", "contextDigest"],
      "source proposal",
    );
    rejectUnknownKeys(input.parameters, "parameters");
    if (
      !isBoundedId(input.target.generation) ||
      !isBoundedId(input.sourceProposal.id) ||
      !/^[a-f0-9]{64}$/.test(input.sourceProposal.digest) ||
      !/^[a-f0-9]{64}$/.test(input.sourceProposal.contextDigest) ||
      ![input.graphVersion, input.policyVersion, input.recoveryVersion].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      throw new PolicyError(
        "INVALID_ACTION",
        "target generation and versions are invalid",
      );
    if (input.mode !== "live" && input.mode !== "simulation")
      throw new PolicyError("INVALID_MODE", "mode must be live or simulation");
    if (
      input.operation !== "stop_demo_scheduler" ||
      input.target.identity !== "pantry-demo-scheduler"
    ) {
      throw new PolicyError(
        "ACTION_NOT_ALLOWLISTED",
        "action or target is not allowlisted",
      );
    }
    const principal = this.#principal(authenticatedPrincipalId);
    this.#assertScope(principal, input.organizationId);
    if (
      !hasRole(principal, "participant") &&
      principal.kind !== "agent" &&
      !hasRole(principal, "incident_commander")
    ) {
      throw new PolicyError(
        "PROPOSAL_FORBIDDEN",
        "principal cannot propose containment",
      );
    }
    const incident = this.#incident(input.incidentId, input.organizationId);
    if (!incident.open)
      throw new PolicyError("INCIDENT_CLOSED", "incident is not open");
    const authority = this.#authority();
    this.#assertVersions(input, authority);
    if (
      authority.target_organization_id !== input.organizationId ||
      !authority.target_enabled ||
      input.target.generation !== authority.target_generation
    ) {
      throw new PolicyError("TARGET_STALE", "target generation is not current");
    }
    const existing = this.#db
      .prepare(
        "SELECT * FROM actions WHERE organization_id=? AND incident_id=? AND proposal_id=?",
      )
      .get(
        input.organizationId,
        input.incidentId,
        input.sourceProposal.id,
      ) as any;
    if (existing) {
      if (!actionMatchesInput(existing, input, authenticatedPrincipalId))
        throw this.#denial(
          "PROPOSAL_BINDING_CONFLICT",
          "stored proposal is already bound to a different exact action",
          authenticatedPrincipalId,
          existing.action_id,
        );
      return rowToAction(existing);
    }
    const material = {
      actionId: randomUUID(),
      organizationId: input.organizationId,
      incidentId: input.incidentId,
      requesterPrincipalId: authenticatedPrincipalId,
      operation: input.operation,
      target: input.target,
      parameters: {},
      mode: input.mode,
      graphVersion: input.graphVersion,
      policyVersion: input.policyVersion,
      recoveryVersion: input.recoveryVersion,
      sourceProposal: input.sourceProposal,
      nonce: randomBytes(32).toString("base64url"),
      createdAt: new Date().toISOString(),
    };
    const canonicalDigest = digest(material);
    this.#db
      .prepare(
        `INSERT INTO actions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        material.actionId,
        material.organizationId,
        material.incidentId,
        material.requesterPrincipalId,
        material.operation,
        material.target.identity,
        material.target.generation,
        "{}",
        material.mode,
        material.graphVersion,
        material.policyVersion,
        material.recoveryVersion,
        material.sourceProposal.id,
        material.sourceProposal.digest,
        material.sourceProposal.contextDigest,
        material.nonce,
        material.createdAt,
        canonicalDigest,
      );
    return {
      ...input,
      actionId: material.actionId,
      requesterPrincipalId: authenticatedPrincipalId,
      nonce: material.nonce,
      createdAt: material.createdAt,
      canonicalDigest,
    };
  }

  approveAction(
    actionId: string,
    authenticatedApproverId: string,
    input: { expiresAt: string },
  ): Approval {
    if (!isRecord(input))
      throw new PolicyError(
        "INVALID_EXPIRY",
        "approval input must be an object",
      );
    rejectKeys(input as any, ["expiresAt"], "approval");
    const action = this.#action(actionId);
    const approver = this.#principal(authenticatedApproverId);
    this.#assertScope(approver, action.organization_id);
    const incident = this.#incident(action.incident_id, action.organization_id);
    const authority = this.#authority();
    this.#assertVersions(
      {
        graphVersion: action.graph_version,
        policyVersion: action.policy_version,
        recoveryVersion: action.recovery_version,
      },
      authority,
    );
    if (
      authority.target_organization_id !== action.organization_id ||
      authority.target_generation !== action.target_generation ||
      !authority.target_enabled
    )
      throw this.#denial(
        "TARGET_STALE",
        "target is no longer current for this organization",
        authenticatedApproverId,
        actionId,
      );
    if (action.canonical_digest !== digest(actionMaterial(action)))
      throw this.#denial(
        "ACTION_DIGEST_MISMATCH",
        "stored action no longer matches immutable digest",
        authenticatedApproverId,
        actionId,
      );
    if (
      !hasRole(approver, "incident_commander") ||
      incident.commander_principal_id !== authenticatedApproverId
    ) {
      throw this.#denial(
        "APPROVAL_FORBIDDEN",
        "only the current incident commander may approve",
        authenticatedApproverId,
        actionId,
      );
    }
    if (approver.id === action.requester_principal_id)
      throw new PolicyError(
        "SELF_APPROVAL_FORBIDDEN",
        "requester cannot approve own action",
      );
    const expiresMs = Date.parse(input.expiresAt);
    if (
      !Number.isFinite(expiresMs) ||
      expiresMs <= Date.now() ||
      expiresMs > Date.now() + 15 * 60_000
    ) {
      throw new PolicyError(
        "INVALID_EXPIRY",
        "approval expiry must be within the next 15 minutes",
      );
    }
    const approvalId = randomUUID();
    const approvedDigest = digest({
      actionDigest: action.canonical_digest,
      expiresAt: input.expiresAt,
    });
    try {
      this.#db
        .prepare(
          "INSERT INTO approvals VALUES (?, ?, ?, ?, ?, 'approved', NULL)",
        )
        .run(
          approvalId,
          actionId,
          authenticatedApproverId,
          approvedDigest,
          input.expiresAt,
        );
    } catch {
      throw new PolicyError(
        "ALREADY_APPROVED",
        "action already has an approval",
      );
    }
    this.#audit(authenticatedApproverId, actionId, "approval_created");
    return this.getApproval(actionId)!;
  }

  revokeApproval(actionId: string, authenticatedApproverId: string): void {
    const approval = this.getApproval(actionId);
    if (
      !approval ||
      approval.approverPrincipalId !== authenticatedApproverId ||
      approval.state !== "approved"
    ) {
      throw new PolicyError(
        "REVOCATION_FORBIDDEN",
        "approval cannot be revoked by this principal or in this state",
      );
    }
    this.#principal(authenticatedApproverId);
    this.#db
      .prepare("UPDATE approvals SET state='revoked' WHERE action_id=?")
      .run(actionId);
  }

  async executeApproved(
    actionId: string,
    authenticatedExecutorId: string,
    broker: DemoBroker,
    observer: IndependentObserver,
    hooks?: {
      afterReserve?: (executionId: string) => void | Promise<void>;
      beforeDispatch?: () => void | Promise<void>;
    },
  ): Promise<Execution> {
    const executor = this.#principal(authenticatedExecutorId);
    if (
      !hasRole(executor, "execution_service") ||
      executor.kind !== "service"
    ) {
      throw this.#denial(
        "EXECUTION_FORBIDDEN",
        "only the authenticated execution service may execute",
        authenticatedExecutorId,
        actionId,
      );
    }
    const action = this.#action(actionId);
    this.#assertScope(executor, action.organization_id);
    const executionId = this.#reserve(actionId);
    if (hooks?.afterReserve) await hooks.afterReserve(executionId);
    if (action.mode === "simulation") {
      this.#updateExecution(
        executionId,
        "verified",
        null,
        null,
        "simulation: no external effect dispatched",
      );
      return this.getExecution(executionId)!;
    }
    try {
      if (hooks?.beforeDispatch) await hooks.beforeDispatch();
      const currentExecutor = this.#principal(authenticatedExecutorId);
      if (
        !hasRole(currentExecutor, "execution_service") ||
        currentExecutor.kind !== "service"
      )
        throw new PolicyError(
          "EXECUTION_AUTHORITY_CHANGED",
          "executor authority changed",
        );
      this.#recheckBeforeDispatch(actionId, broker);
    } catch (error) {
      this.#updateExecution(
        executionId,
        "failed",
        null,
        null,
        `pre-dispatch recheck failed: ${errorMessage(error)}`,
      );
      throw error;
    }
    this.#updateExecution(executionId, "dispatching");
    let receipt: BrokerReceipt;
    try {
      const request: BrokerDispatch = {
        executionId,
        actionId,
        operation: "stop_demo_scheduler",
        target: {
          identity: "pantry-demo-scheduler",
          generation: action.target_generation,
        },
        authorization: broker.dispatchAuthorization,
      };
      receipt = await broker.dispatch(request);
    } catch (error) {
      this.#updateExecution(
        executionId,
        "outcome_unknown",
        null,
        null,
        errorMessage(error),
      );
      return this.getExecution(executionId)!;
    }
    if (receipt.status === "rejected") {
      this.#updateExecution(
        executionId,
        "failed",
        receipt,
        null,
        receipt.reason,
      );
      return this.getExecution(executionId)!;
    }
    if (receipt.status === "outcome_unknown") {
      this.#updateExecution(
        executionId,
        "outcome_unknown",
        receipt,
        null,
        receipt.reason,
      );
      return this.getExecution(executionId)!;
    }
    this.#updateExecution(executionId, "awaiting_verification", receipt);
    return this.#verify(executionId, observer);
  }

  async reconcileExecution(
    executionId: string,
    broker: DemoBroker,
    observer: IndependentObserver,
  ): Promise<Execution> {
    const execution = this.getExecution(executionId);
    if (!execution)
      throw new PolicyError("EXECUTION_NOT_FOUND", "execution not found");
    if (execution.state === "verified" || execution.state === "failed")
      return execution;
    const receipt = await broker.lookup(executionId);
    if (!receipt || receipt.status === "outcome_unknown") {
      this.#updateExecution(
        executionId,
        "outcome_unknown",
        receipt,
        null,
        "broker outcome unavailable; no redispatch permitted",
      );
      return this.getExecution(executionId)!;
    }
    this.#updateExecution(executionId, "awaiting_verification", receipt);
    return this.#verify(executionId, observer);
  }

  getApproval(actionId: string): Approval | null {
    const row = this.#db
      .prepare("SELECT * FROM approvals WHERE action_id=?")
      .get(actionId) as any;
    return row
      ? {
          approvalId: row.approval_id,
          actionId: row.action_id,
          approverPrincipalId: row.approver_principal_id,
          approvedDigest: row.approved_digest,
          expiresAt: row.expires_at,
          state: row.state,
          executionId: row.execution_id,
        }
      : null;
  }

  getAction(actionId: string): ActionIntent | null {
    const row = this.#db
      .prepare("SELECT * FROM actions WHERE action_id=?")
      .get(actionId) as any;
    return row ? rowToAction(row) : null;
  }

  getActionForProposal(
    organizationId: string,
    incidentId: string,
    proposalId: string,
  ): ActionIntent | null {
    const row = this.#db
      .prepare(
        "SELECT * FROM actions WHERE organization_id=? AND incident_id=? AND proposal_id=?",
      )
      .get(organizationId, incidentId, proposalId) as any;
    return row ? rowToAction(row) : null;
  }

  getCurrentTarget(): {
    identity: "pantry-demo-scheduler";
    generation: string;
    organizationId: string;
    enabled: boolean;
  } {
    const row = this.#authority();
    return {
      identity: row.target_identity,
      generation: row.target_generation,
      organizationId: row.target_organization_id,
      enabled: row.target_enabled === 1,
    };
  }

  getExecution(executionId: string): Execution | null {
    const row = this.#db
      .prepare("SELECT * FROM executions WHERE execution_id=?")
      .get(executionId) as any;
    return row
      ? {
          executionId: row.execution_id,
          actionId: row.action_id,
          state: row.state,
          mode: row.mode,
          brokerReceipt: parse(row.broker_receipt),
          verification: parse(row.verification),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          ...(row.reason ? { reason: row.reason } : {}),
        }
      : null;
  }

  #reserve(actionId: string): string {
    const action = this.#action(actionId);
    const approval = this.getApproval(actionId);
    if (!approval || approval.state !== "approved")
      throw new PolicyError(
        "APPROVAL_UNAVAILABLE",
        "current unused approval required",
      );
    this.#recheckAuthority(action, approval);
    const executionId = randomUUID();
    const now = new Date().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const claimed = this.#db
        .prepare(
          "UPDATE approvals SET state='reserved', execution_id=? WHERE action_id=? AND state='approved'",
        )
        .run(executionId, actionId);
      if (claimed.changes !== 1)
        throw new PolicyError("APPROVAL_REPLAY", "approval already consumed");
      this.#db
        .prepare(
          "INSERT INTO executions VALUES (?, ?, 'reserved', ?, ?, NULL, NULL, ?, ?, NULL)",
        )
        .run(
          executionId,
          actionId,
          action.mode,
          `${action.target_identity}:${action.target_generation}`,
          now,
          now,
        );
      this.#db.exec("COMMIT");
      return executionId;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      if (
        !(error instanceof PolicyError) &&
        /one_active_execution_per_target|UNIQUE constraint failed: executions\.target_key/.test(
          errorMessage(error),
        )
      )
        throw this.#denial(
          "TARGET_BUSY",
          "another execution for this target requires reconciliation",
          "execution-service",
          actionId,
        );
      throw error;
    }
  }

  #recheckBeforeDispatch(actionId: string, broker: DemoBroker): void {
    const action = this.#action(actionId);
    const approval = this.getApproval(actionId)!;
    this.#recheckAuthority(action, approval, true);
    if (
      broker.targetIdentity !== action.target_identity ||
      broker.generation !== action.target_generation
    ) {
      throw new PolicyError(
        "BROKER_TARGET_SWAP",
        "broker target generation differs from approved action",
      );
    }
  }

  #recheckAuthority(action: any, approval: Approval, reserved = false): void {
    if (
      (reserved && approval.state !== "reserved") ||
      (!reserved && approval.state !== "approved")
    )
      throw new PolicyError(
        "APPROVAL_UNAVAILABLE",
        "approval state is not executable",
      );
    if (Date.parse(approval.expiresAt) <= Date.now()) {
      if (!reserved)
        this.#db
          .prepare(
            "UPDATE approvals SET state='expired' WHERE action_id=? AND state='approved'",
          )
          .run(action.action_id);
      throw new PolicyError(
        "APPROVAL_EXPIRED",
        "approval expired before dispatch",
      );
    }
    const requester = this.#principal(action.requester_principal_id);
    const approver = this.#principal(approval.approverPrincipalId);
    const incident = this.#incident(action.incident_id, action.organization_id);
    const authority = this.#authority();
    this.#assertScope(requester, action.organization_id);
    this.#assertScope(approver, action.organization_id);
    if (
      !hasRole(approver, "incident_commander") ||
      incident.commander_principal_id !== approver.id ||
      !incident.open
    )
      throw new PolicyError(
        "AUTHORITY_CHANGED",
        "commander authority or incident precondition changed",
      );
    this.#assertVersions(
      {
        graphVersion: action.graph_version,
        policyVersion: action.policy_version,
        recoveryVersion: action.recovery_version,
      },
      authority,
    );
    if (
      authority.target_organization_id !== action.organization_id ||
      !authority.target_enabled ||
      authority.target_generation !== action.target_generation
    )
      throw new PolicyError("TARGET_STALE", "target generation changed");
    if (action.canonical_digest !== digest(actionMaterial(action)))
      throw new PolicyError(
        "ACTION_DIGEST_MISMATCH",
        "stored action no longer matches immutable digest",
      );
    if (
      approval.approvedDigest !==
      digest({
        actionDigest: action.canonical_digest,
        expiresAt: approval.expiresAt,
      })
    )
      throw new PolicyError(
        "APPROVAL_DIGEST_MISMATCH",
        "approval no longer binds exact action",
      );
  }

  async #verify(
    executionId: string,
    observer: IndependentObserver,
  ): Promise<Execution> {
    let verification: VerificationResult;
    try {
      verification = await observer.verifyStopped();
    } catch (error) {
      this.#updateExecution(
        executionId,
        "outcome_unknown",
        undefined,
        null,
        `observer failed: ${errorMessage(error)}`,
      );
      return this.getExecution(executionId)!;
    }
    this.#updateExecution(
      executionId,
      verification.result,
      undefined,
      verification,
      verification.reason,
    );
    return this.getExecution(executionId)!;
  }

  #updateExecution(
    id: string,
    state: ExecutionState,
    receipt?: BrokerReceipt | null,
    verification?: VerificationResult | null,
    reason?: string,
  ): void {
    const current = this.getExecution(id);
    if (!current)
      throw new PolicyError("EXECUTION_NOT_FOUND", "execution not found");
    this.#db
      .prepare(
        "UPDATE executions SET state=?, broker_receipt=?, verification=?, updated_at=?, reason=? WHERE execution_id=?",
      )
      .run(
        state,
        JSON.stringify(receipt === undefined ? current.brokerReceipt : receipt),
        JSON.stringify(
          verification === undefined ? current.verification : verification,
        ),
        new Date().toISOString(),
        reason ?? null,
        id,
      );
  }

  #principal(id: string): any {
    const row = this.#db
      .prepare("SELECT * FROM principals WHERE id=?")
      .get(id) as any;
    if (!row || row.revoked)
      throw new PolicyError(
        "UNAUTHENTICATED_OR_REVOKED",
        "authenticated principal is unknown or revoked",
      );
    return row;
  }
  #incident(id: string, org: string): any {
    const row = this.#db
      .prepare("SELECT * FROM incidents WHERE id=? AND organization_id=?")
      .get(id, org) as any;
    if (!row)
      throw new PolicyError(
        "INCIDENT_SCOPE_MISMATCH",
        "incident is absent from organization scope",
      );
    return row;
  }
  #action(id: string): any {
    const row = this.#db
      .prepare("SELECT * FROM actions WHERE action_id=?")
      .get(id) as any;
    if (!row) throw new PolicyError("ACTION_NOT_FOUND", "action not found");
    return row;
  }
  #authority(): any {
    return this.#db
      .prepare("SELECT * FROM authority_state WHERE singleton=1")
      .get() as any;
  }
  #assertScope(principal: any, org: string): void {
    if (principal.organization_id !== org)
      throw new PolicyError(
        "ORGANIZATION_SCOPE_MISMATCH",
        "principal organization mismatch",
      );
  }
  #assertVersions(input: any, authority: any): void {
    if (
      input.graphVersion !== authority.graph_version ||
      input.policyVersion !== authority.policy_version ||
      input.recoveryVersion !== authority.recovery_version
    )
      throw new PolicyError(
        "STALE_VERSION",
        "graph, policy, or recovery version is stale",
      );
  }
  #audit(
    actorId: string,
    actionId: string | null,
    event: string,
    reasonCode?: string,
  ): void {
    this.#db
      .prepare("INSERT INTO policy_audit VALUES(?,?,?,?,?,?)")
      .run(
        randomUUID(),
        actorId,
        actionId,
        event,
        reasonCode ?? null,
        new Date().toISOString(),
      );
  }
  #denial(
    code: string,
    message: string,
    actorId: string,
    actionId: string | null,
  ): PolicyError {
    this.#audit(actorId, actionId, "denied", code);
    return new PolicyError(code, message);
  }
  listAudit(): Array<{
    actorId: string;
    actionId: string | null;
    event: string;
    reasonCode: string | null;
    occurredAt: string;
  }> {
    return (
      this.#db
        .prepare("SELECT * FROM policy_audit ORDER BY occurred_at, id")
        .all() as any[]
    ).map((row) => ({
      actorId: row.actor_id,
      actionId: row.action_id,
      event: row.event,
      reasonCode: row.reason_code,
      occurredAt: row.occurred_at,
    }));
  }

  #seed(seed: AuthoritySeed): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const p = this.#db.prepare(
        "INSERT OR REPLACE INTO principals VALUES (?, ?, ?, ?, ?)",
      );
      for (const item of seed.principals)
        p.run(
          item.id,
          item.kind,
          item.organizationId,
          JSON.stringify(item.roles),
          item.revoked ? 1 : 0,
        );
      const i = this.#db.prepare(
        "INSERT OR REPLACE INTO incidents VALUES (?, ?, ?, ?, ?)",
      );
      for (const item of seed.incidents)
        i.run(
          item.id,
          item.organizationId,
          item.commanderPrincipalId,
          item.revision,
          item.open ? 1 : 0,
        );
      this.#db
        .prepare(
          "INSERT OR REPLACE INTO authority_state VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          seed.target.identity,
          seed.target.generation,
          seed.target.organizationId,
          seed.target.enabled ? 1 : 0,
          seed.graphVersion,
          seed.policyVersion,
          seed.recoveryVersion,
        );
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #migrate(): void {
    this.#db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY, kind TEXT NOT NULL, organization_id TEXT NOT NULL, roles TEXT NOT NULL, revoked INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, commander_principal_id TEXT NOT NULL, revision INTEGER NOT NULL, open INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS authority_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), target_identity TEXT NOT NULL, target_generation TEXT NOT NULL, target_organization_id TEXT NOT NULL, target_enabled INTEGER NOT NULL, graph_version INTEGER NOT NULL, policy_version INTEGER NOT NULL, recovery_version INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS actions(action_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, incident_id TEXT NOT NULL, requester_principal_id TEXT NOT NULL, operation TEXT NOT NULL, target_identity TEXT NOT NULL, target_generation TEXT NOT NULL, parameters_json TEXT NOT NULL, mode TEXT NOT NULL, graph_version INTEGER NOT NULL, policy_version INTEGER NOT NULL, recovery_version INTEGER NOT NULL, proposal_id TEXT NOT NULL, proposal_digest TEXT NOT NULL, context_digest TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, canonical_digest TEXT NOT NULL, UNIQUE(organization_id,incident_id,proposal_id)) STRICT;
    CREATE TABLE IF NOT EXISTS approvals(approval_id TEXT PRIMARY KEY, action_id TEXT NOT NULL UNIQUE REFERENCES actions(action_id), approver_principal_id TEXT NOT NULL, approved_digest TEXT NOT NULL, expires_at TEXT NOT NULL, state TEXT NOT NULL, execution_id TEXT UNIQUE) STRICT;
    CREATE TABLE IF NOT EXISTS executions(execution_id TEXT PRIMARY KEY, action_id TEXT NOT NULL UNIQUE REFERENCES actions(action_id), state TEXT NOT NULL, mode TEXT NOT NULL, target_key TEXT NOT NULL, broker_receipt TEXT, verification TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reason TEXT) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_execution_per_target ON executions(target_key) WHERE state IN ('reserved','dispatching','awaiting_verification','outcome_unknown');
    CREATE TABLE IF NOT EXISTS policy_audit(id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action_id TEXT, event TEXT NOT NULL, reason_code TEXT, occurred_at TEXT NOT NULL) STRICT;
  `);
  }
}

function hasRole(principal: any, role: AuthorityRole): boolean {
  return (JSON.parse(principal.roles) as string[]).includes(role);
}
function rejectUnknownKeys(value: object, label: string): void {
  if (Object.keys(value).length)
    throw new PolicyError("INVALID_PARAMETERS", `${label} must be empty`);
}
function rejectKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new PolicyError(
      "UNKNOWN_FIELD",
      `${label} contains an unknown field`,
    );
}
function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}
function stable(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}
function parse(value: string | null): any {
  return value === null ? null : JSON.parse(value);
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}
function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}
function actionMaterial(row: any): unknown {
  return {
    actionId: row.action_id,
    organizationId: row.organization_id,
    incidentId: row.incident_id,
    requesterPrincipalId: row.requester_principal_id,
    operation: row.operation,
    target: {
      identity: row.target_identity,
      generation: row.target_generation,
    },
    parameters: JSON.parse(row.parameters_json),
    mode: row.mode,
    graphVersion: row.graph_version,
    policyVersion: row.policy_version,
    recoveryVersion: row.recovery_version,
    sourceProposal: {
      id: row.proposal_id,
      digest: row.proposal_digest,
      contextDigest: row.context_digest,
    },
    nonce: row.nonce,
    createdAt: row.created_at,
  };
}
function rowToAction(row: any): ActionIntent {
  return {
    actionId: row.action_id,
    organizationId: row.organization_id,
    incidentId: row.incident_id,
    requesterPrincipalId: row.requester_principal_id,
    operation: row.operation,
    target: {
      identity: row.target_identity,
      generation: row.target_generation,
    },
    parameters: JSON.parse(row.parameters_json),
    mode: row.mode,
    graphVersion: row.graph_version,
    policyVersion: row.policy_version,
    recoveryVersion: row.recovery_version,
    sourceProposal: {
      id: row.proposal_id,
      digest: row.proposal_digest,
      contextDigest: row.context_digest,
    },
    nonce: row.nonce,
    createdAt: row.created_at,
    canonicalDigest: row.canonical_digest,
  };
}
function actionMatchesInput(
  row: any,
  input: ProposeActionInput,
  requester: string,
): boolean {
  return (
    row.organization_id === input.organizationId &&
    row.incident_id === input.incidentId &&
    row.requester_principal_id === requester &&
    row.operation === input.operation &&
    row.target_identity === input.target.identity &&
    row.target_generation === input.target.generation &&
    row.parameters_json === JSON.stringify(input.parameters) &&
    row.mode === input.mode &&
    row.graph_version === input.graphVersion &&
    row.policy_version === input.policyVersion &&
    row.recovery_version === input.recoveryVersion &&
    row.proposal_digest === input.sourceProposal.digest &&
    row.context_digest === input.sourceProposal.contextDigest
  );
}
