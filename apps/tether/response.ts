import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { AuthContext, MembershipSnapshot } from "./permissions.ts";

export const RETRY_TARGET_IDENTITY = "northstar-retry-api" as const;
export const DISABLE_RETRY_ROUTE = "disable_cross_tenant_retry" as const;

export interface IncidentAuthorityState {
  id: string;
  organizationId: string;
  open: boolean;
  semanticRevision: number;
  evidenceRevision: number;
  policyRevision: number;
  commanderEmployeeId: string;
}

export interface ResponseAction {
  actionId: string;
  organizationId: string;
  incidentId: string;
  requesterEmployeeId: string;
  operation: typeof DISABLE_RETRY_ROUTE;
  target: { identity: typeof RETRY_TARGET_IDENTITY; generation: string };
  semanticRevision: number;
  evidenceRevision: number;
  policyRevision: number;
  sourceProposal: { id: string; digest: string; contextDigest: string };
  canonicalDigest: string;
  createdAt: string;
}

export interface ResponseExecution {
  executionId: string;
  actionId: string;
  state: "verified" | "failed" | "outcome_unknown";
  observedAt: string;
  routeDisabled: boolean | null;
  controlReachable: boolean | null;
  fallbackReady: boolean | null;
  reason?: string;
}

export interface ResponseExecutionReservation {
  executionId: string;
  actionId: string;
  state: "reserved";
  observedAt: string;
}

export class ResponseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ResponseError";
  }
}

export class RetryServiceTarget {
  readonly generation = randomUUID();
  readonly targetIdentity = RETRY_TARGET_IDENTITY;
  readonly controlToken = randomBytes(24).toString("base64url");
  readonly dispatchAuthorization = randomBytes(32).toString("base64url");
  readonly serviceUrl: string;
  readonly controlUrl: string;
  #child: ChildProcess;
  #control: Server;
  #disabled = false;
  #sequence = 0;
  #pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  private constructor(
    child: ChildProcess,
    control: Server,
    servicePort: number,
    controlPort: number,
  ) {
    this.#child = child;
    this.#control = control;
    this.serviceUrl = `http://127.0.0.1:${servicePort}`;
    this.controlUrl = `http://127.0.0.1:${controlPort}`;
    child.on("message", (message: any) => this.#onMessage(message));
  }

  static async start(): Promise<RetryServiceTarget> {
    const worker = fileURLToPath(
      new URL("../../fixtures/northstar/retry-service.ts", import.meta.url),
    );
    const child = fork(worker, ["--retry-worker"], {
      execArgv: [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const servicePort = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("retry worker startup timeout")),
        3_000,
      );
      child.once("error", reject);
      child.once("message", (message: any) => {
        if (message?.type === "ready") {
          clearTimeout(timer);
          resolve(message.port);
        }
      });
    });
    let target: RetryServiceTarget;
    const control = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        response.end(
          JSON.stringify({ healthy: true, token: target.controlToken }),
        );
      } else response.writeHead(404).end();
    });
    await listen(control);
    const address = control.address();
    if (!address || typeof address === "string")
      throw new Error("control address unavailable");
    target = new RetryServiceTarget(child, control, servicePort, address.port);
    return target;
  }

  get disabled(): boolean {
    return this.#disabled;
  }

  async inspectActualState(): Promise<{
    identity: typeof RETRY_TARGET_IDENTITY;
    generation: string;
    processRunning: boolean;
    retryRouteEnabled: boolean | null;
  }> {
    try {
      const response = await fetch(`${this.serviceUrl}/health`, {
        signal: AbortSignal.timeout(500),
      });
      const body = (await response.json()) as any;
      return {
        identity: RETRY_TARGET_IDENTITY,
        generation: this.generation,
        processRunning: response.ok && body.healthy === true,
        retryRouteEnabled:
          typeof body.retryRouteEnabled === "boolean"
            ? body.retryRouteEnabled
            : null,
      };
    } catch {
      return {
        identity: RETRY_TARGET_IDENTITY,
        generation: this.generation,
        processRunning: false,
        retryRouteEnabled: null,
      };
    }
  }

  async dispatch(input: {
    executionId: string;
    actionId: string;
    operation: typeof DISABLE_RETRY_ROUTE;
    target: { identity: typeof RETRY_TARGET_IDENTITY; generation: string };
    authorization: string;
  }): Promise<{
    status: "effect_applied" | "already_disabled" | "rejected";
    reason?: string;
  }> {
    if (!constantEqual(input.authorization, this.dispatchAuthorization))
      return { status: "rejected", reason: "invalid broker authorization" };
    if (
      input.operation !== DISABLE_RETRY_ROUTE ||
      input.target.identity !== RETRY_TARGET_IDENTITY ||
      input.target.generation !== this.generation
    )
      return {
        status: "rejected",
        reason: "action or target binding mismatch",
      };
    if (this.#disabled) return { status: "already_disabled" };
    const result = await this.#request("disable", {
      executionId: input.executionId,
      actionId: input.actionId,
    });
    if (result?.disabled === true) {
      this.#disabled = true;
      return { status: "effect_applied" };
    }
    return {
      status: "rejected",
      reason: "retry worker did not acknowledge disable",
    };
  }

  async close(): Promise<void> {
    try {
      await this.#request("close", {});
    } catch {}
    await new Promise<void>((resolve) => this.#control.close(() => resolve()));
    if (this.#child.exitCode === null) this.#child.kill("SIGTERM");
  }

  #request(type: string, value: unknown): Promise<any> {
    const requestId = `${process.pid}:${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error("retry worker IPC timeout"));
      }, 2_000);
      this.#pending.set(requestId, { resolve, reject, timer });
      this.#child.send?.({ type, requestId, value });
    });
  }

  #onMessage(message: any): void {
    const pending = this.#pending.get(message?.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(message.requestId);
    message.ok
      ? pending.resolve(message.value)
      : pending.reject(new Error(String(message.error ?? "worker error")));
  }
}

export class RetryServiceObserver {
  readonly target: RetryServiceTarget;
  constructor(target: RetryServiceTarget) {
    this.target = target;
  }
  async verifyDisabled(): Promise<
    Omit<ResponseExecution, "executionId" | "actionId">
  > {
    const [routeDisabled, controlReachable, fallbackReady] = await Promise.all([
      fetch(`${this.target.serviceUrl}/api/v1/jobs/job-tenant-b/retry`, {
        method: "POST",
        headers: { authorization: "Bearer tenant-a" },
        signal: AbortSignal.timeout(500),
      })
        .then((response) => response.status === 503)
        .catch(() => null),
      fetch(`${this.target.controlUrl}/health`, {
        signal: AbortSignal.timeout(500),
      })
        .then(
          async (response) =>
            response.ok &&
            ((await response.json()) as any).token === this.target.controlToken,
        )
        .catch(() => null),
      Promise.all([
        fetch(
          `${this.target.serviceUrl}/fallback/api/v1/jobs/job-tenant-b/retry`,
          {
            method: "POST",
            headers: { authorization: "Bearer tenant-a" },
            signal: AbortSignal.timeout(500),
          },
        ),
        fetch(
          `${this.target.serviceUrl}/fallback/api/v1/jobs/job-tenant-a/retry`,
          {
            method: "POST",
            headers: { authorization: "Bearer tenant-a" },
            signal: AbortSignal.timeout(500),
          },
        ),
      ])
        .then(([crossTenant, sameTenant]) => {
          return crossTenant.status === 403 && sameTenant.status === 202;
        })
        .catch(() => null),
    ]);
    const observedAt = new Date().toISOString();
    if (
      routeDisabled === true &&
      controlReachable === true &&
      fallbackReady === true
    )
      return {
        state: "verified",
        observedAt,
        routeDisabled,
        controlReachable,
        fallbackReady,
      };
    if (routeDisabled === false)
      return {
        state: "failed",
        observedAt,
        routeDisabled,
        controlReachable,
        fallbackReady,
        reason: "retry route remains enabled",
      };
    return {
      state: "outcome_unknown",
      observedAt,
      routeDisabled,
      controlReachable,
      fallbackReady,
      reason: "independent control or fallback evidence unavailable",
    };
  }

  async verifyFallback(): Promise<{
    verified: boolean;
    crossTenantDenied: boolean | null;
    sameTenantAccepted: boolean | null;
    observedAt: string;
  }> {
    const [crossTenantDenied, sameTenantAccepted] = await Promise.all([
      fetch(
        `${this.target.serviceUrl}/fallback/api/v1/jobs/job-tenant-b/retry`,
        {
          method: "POST",
          headers: { authorization: "Bearer tenant-a" },
          signal: AbortSignal.timeout(500),
        },
      )
        .then((response) => response.status === 403)
        .catch(() => null),
      fetch(
        `${this.target.serviceUrl}/fallback/api/v1/jobs/job-tenant-a/retry`,
        {
          method: "POST",
          headers: { authorization: "Bearer tenant-a" },
          signal: AbortSignal.timeout(500),
        },
      )
        .then((response) => response.status === 202)
        .catch(() => null),
    ]);
    return {
      verified: crossTenantDenied === true && sameTenantAccepted === true,
      crossTenantDenied,
      sameTenantAccepted,
      observedAt: new Date().toISOString(),
    };
  }

  async verifyResolution(): Promise<{
    verified: boolean;
    containmentVerified: boolean;
    fallbackVerified: boolean;
    observedAt: string;
  }> {
    const [containment, fallback] = await Promise.all([
      this.verifyDisabled(),
      this.verifyFallback(),
    ]);
    return {
      verified: containment.state === "verified" && fallback.verified,
      containmentVerified: containment.state === "verified",
      fallbackVerified: fallback.verified,
      observedAt: new Date().toISOString(),
    };
  }
}

export class ResponseAuthority {
  readonly #db: DatabaseSync;
  readonly options: {
    dbPath: string;
    incidentLookup: (incidentId: string) => IncidentAuthorityState | undefined;
    membershipLookup: (employeeId: string) => MembershipSnapshot | undefined;
    approvalGrantLookup: (employeeId: string, incidentId: string) => boolean;
    clock?: () => Date;
  };
  constructor(options: {
    dbPath: string;
    incidentLookup: (incidentId: string) => IncidentAuthorityState | undefined;
    membershipLookup: (employeeId: string) => MembershipSnapshot | undefined;
    approvalGrantLookup: (employeeId: string, incidentId: string) => boolean;
    clock?: () => Date;
  }) {
    this.options = options;
    this.#db = new DatabaseSync(options.dbPath);
    this.#db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS response_actions(action_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL, digest TEXT NOT NULL, approved_by TEXT, approved_at TEXT, approval_expires_at TEXT, executed_at TEXT);
      CREATE TABLE IF NOT EXISTS response_executions(execution_id TEXT PRIMARY KEY, action_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
    `);
  }
  close(): void {
    this.#db.close();
  }

  listActions(): ResponseAction[] {
    return (
      this.#db
        .prepare("SELECT body FROM response_actions ORDER BY rowid")
        .all() as Array<{ body: string }>
    ).map((row) => JSON.parse(row.body) as ResponseAction);
  }

  getExecution(
    actionId: string,
  ): ResponseExecution | ResponseExecutionReservation | null {
    const row = this.#db
      .prepare("SELECT body FROM response_executions WHERE action_id=?")
      .get(actionId) as { body: string } | undefined;
    return row
      ? (JSON.parse(row.body) as
          ResponseExecution | ResponseExecutionReservation)
      : null;
  }

  prepare(input: {
    context: AuthContext;
    incidentId: string;
    sourceProposal: { id: string; digest: string; contextDigest: string };
    targetGeneration: string;
    semanticRevision: number;
    evidenceRevision: number;
    policyRevision: number;
  }): ResponseAction {
    const membership = this.#membership(input.context);
    if (
      !new Set(["senior_manager", "engineer", "data_science_manager"]).has(
        membership.role,
      )
    )
      throw new ResponseError(
        "PROPOSAL_FORBIDDEN",
        "membership cannot propose response actions",
      );
    const incident = this.#incident(
      input.incidentId,
      membership.organizationId,
    );
    this.#assertRevisions(incident, input);
    if (
      !isDigest(input.sourceProposal.digest) ||
      !isDigest(input.sourceProposal.contextDigest) ||
      !bounded(input.sourceProposal.id) ||
      !bounded(input.targetGeneration)
    )
      throw new ResponseError(
        "INVALID_PROPOSAL",
        "proposal binding is invalid",
      );
    const existing = this.#db
      .prepare("SELECT body FROM response_actions WHERE proposal_id=?")
      .get(input.sourceProposal.id) as any;
    const material = {
      actionId: randomUUID(),
      organizationId: incident.organizationId,
      incidentId: incident.id,
      requesterEmployeeId: membership.employeeId,
      operation: DISABLE_RETRY_ROUTE,
      target: {
        identity: RETRY_TARGET_IDENTITY,
        generation: input.targetGeneration,
      },
      semanticRevision: input.semanticRevision,
      evidenceRevision: input.evidenceRevision,
      policyRevision: input.policyRevision,
      sourceProposal: input.sourceProposal,
      createdAt: (this.options.clock ?? (() => new Date()))().toISOString(),
    };
    if (existing) {
      const action = JSON.parse(existing.body) as ResponseAction;
      const comparison = {
        ...material,
        actionId: action.actionId,
        createdAt: action.createdAt,
      };
      if (digest(comparison) !== action.canonicalDigest)
        throw new ResponseError(
          "PROPOSAL_BINDING_CONFLICT",
          "proposal is already bound to another action",
        );
      return action;
    }
    const action: ResponseAction = {
      ...material,
      canonicalDigest: digest(material),
    };
    this.#db
      .prepare(
        "INSERT INTO response_actions(action_id,proposal_id,body,digest) VALUES (?,?,?,?)",
      )
      .run(
        action.actionId,
        action.sourceProposal.id,
        JSON.stringify(action),
        action.canonicalDigest,
      );
    return action;
  }

  approve(input: {
    context: AuthContext;
    actionId: string;
    approvedDigest: string;
    expiresAt: string;
  }): void {
    const membership = this.#membership(input.context);
    const row = this.#actionRow(input.actionId);
    const action = JSON.parse(row.body) as ResponseAction;
    const incident = this.#incident(
      action.incidentId,
      membership.organizationId,
    );
    if (
      incident.commanderEmployeeId !== membership.employeeId ||
      membership.role !== "senior_manager"
    )
      throw new ResponseError(
        "APPROVAL_FORBIDDEN",
        "current incident commander approval is required",
      );
    if (!this.options.approvalGrantLookup(membership.employeeId, incident.id))
      throw new ResponseError(
        "APPROVAL_GRANT_REQUIRED",
        "current explicit incident approval grant is required",
      );
    this.#assertActionCurrent(action, incident);
    if (!constantEqual(input.approvedDigest, action.canonicalDigest))
      throw new ResponseError(
        "APPROVAL_DIGEST_MISMATCH",
        "approval does not match exact action",
      );
    const expires = new Date(input.expiresAt);
    const now = (this.options.clock ?? (() => new Date()))();
    if (
      !Number.isFinite(expires.getTime()) ||
      expires <= now ||
      expires.getTime() - now.getTime() > 15 * 60_000
    )
      throw new ResponseError(
        "APPROVAL_EXPIRY_INVALID",
        "approval expiry is invalid",
      );
    this.#db
      .prepare(
        "UPDATE response_actions SET approved_by=?,approved_at=?,approval_expires_at=? WHERE action_id=?",
      )
      .run(
        membership.employeeId,
        now.toISOString(),
        expires.toISOString(),
        action.actionId,
      );
  }

  async executeApproved(
    actionId: string,
    target: RetryServiceTarget,
    observer: RetryServiceObserver,
  ): Promise<ResponseExecution> {
    const row = this.#actionRow(actionId);
    const action = JSON.parse(row.body) as ResponseAction;
    const incident = this.#incident(action.incidentId, action.organizationId);
    this.#assertActionCurrent(action, incident);
    const commander = this.options.membershipLookup(
      incident.commanderEmployeeId,
    );
    if (
      !row.approved_by ||
      row.approved_by !== incident.commanderEmployeeId ||
      !commander?.active ||
      commander.role !== "senior_manager" ||
      !this.options.approvalGrantLookup(commander.employeeId, incident.id)
    )
      throw new ResponseError(
        "APPROVAL_STALE",
        "current commander approval is absent or revoked",
      );
    if (
      new Date(row.approval_expires_at).getTime() <=
      (this.options.clock ?? (() => new Date()))().getTime()
    )
      throw new ResponseError("APPROVAL_EXPIRED", "approval expired");
    if (action.target.generation !== target.generation)
      throw new ResponseError("TARGET_STALE", "target generation changed");
    const prior = this.#db
      .prepare("SELECT body FROM response_executions WHERE action_id=?")
      .get(actionId) as any;
    if (prior) {
      const body = JSON.parse(prior.body);
      if (body.state === "reserved")
        throw new ResponseError(
          "EXECUTION_IN_PROGRESS",
          "action execution is already reserved",
        );
      return body;
    }
    const executionId = randomUUID();
    const reserved = {
      executionId,
      actionId,
      state: "reserved",
      observedAt: (this.options.clock ?? (() => new Date()))().toISOString(),
    };
    try {
      this.#db
        .prepare("INSERT INTO response_executions VALUES (?,?,?)")
        .run(executionId, actionId, JSON.stringify(reserved));
    } catch (error: any) {
      if (String(error?.message).includes("UNIQUE"))
        throw new ResponseError(
          "EXECUTION_IN_PROGRESS",
          "action execution is already reserved",
        );
      throw error;
    }
    const receipt = await target.dispatch({
      executionId,
      actionId,
      operation: action.operation,
      target: action.target,
      authorization: target.dispatchAuthorization,
    });
    const observed =
      receipt.status === "rejected"
        ? {
            state: "failed" as const,
            observedAt: new Date().toISOString(),
            routeDisabled: false,
            controlReachable: null,
            fallbackReady: null,
            ...(receipt.reason ? { reason: receipt.reason } : {}),
          }
        : await observer.verifyDisabled();
    const execution: ResponseExecution = { executionId, actionId, ...observed };
    this.#db
      .prepare("UPDATE response_executions SET body=? WHERE execution_id=?")
      .run(JSON.stringify(execution), executionId);
    this.#db
      .prepare("UPDATE response_actions SET executed_at=? WHERE action_id=?")
      .run(execution.observedAt, actionId);
    return execution;
  }

  #membership(context: AuthContext): MembershipSnapshot {
    const current = this.options.membershipLookup(context.employeeId);
    if (!current?.active)
      throw new ResponseError("MEMBERSHIP_INACTIVE", "membership is inactive");
    if (
      current.organizationId !== context.organizationId ||
      current.role !== context.role ||
      current.policyRevision !== context.policyRevision
    )
      throw new ResponseError(
        "STALE_AUTH_CONTEXT",
        "authenticated membership is stale",
      );
    return current;
  }
  #incident(id: string, organizationId: string): IncidentAuthorityState {
    const incident = this.options.incidentLookup(id);
    if (!incident || incident.organizationId !== organizationId)
      throw new ResponseError(
        "INCIDENT_SCOPE_DENIED",
        "incident is unavailable",
      );
    if (!incident.open)
      throw new ResponseError("INCIDENT_CLOSED", "incident is closed");
    return incident;
  }
  #assertRevisions(
    incident: IncidentAuthorityState,
    input: {
      semanticRevision: number;
      evidenceRevision: number;
      policyRevision: number;
    },
  ): void {
    if (
      incident.semanticRevision !== input.semanticRevision ||
      incident.evidenceRevision !== input.evidenceRevision ||
      incident.policyRevision !== input.policyRevision
    )
      throw new ResponseError(
        "STALE_PROPOSAL",
        "proposal revisions are not current",
      );
  }
  #assertActionCurrent(
    action: ResponseAction,
    incident: IncidentAuthorityState,
  ): void {
    this.#assertRevisions(incident, action);
  }
  #actionRow(id: string): any {
    const row = this.#db
      .prepare("SELECT * FROM response_actions WHERE action_id=?")
      .get(id);
    if (!row)
      throw new ResponseError("ACTION_NOT_FOUND", "action does not exist");
    return row;
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function isDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
function bounded(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}
function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
}
