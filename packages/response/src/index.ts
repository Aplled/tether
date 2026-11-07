import { createHash } from "node:crypto";
import {
  EvidenceSchema,
  type Evidence,
  type Proposal,
} from "../../contracts/src/index.ts";
import type { CanonicalStore } from "../../storage/src/index.ts";
import type { ContinuityService } from "../../workflows/src/index.ts";
import type { ActionIntent, PolicyEngine } from "../../policy/src/index.ts";
import type {
  DemoBroker,
  IndependentObserver,
} from "../../../apps/demo-broker/src/index.ts";

export class ResponseCoordinatorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ResponseCoordinatorError";
  }
}

export interface ResponseCoordinatorOptions {
  store: CanonicalStore;
  workflows: ContinuityService;
  policy: PolicyEngine;
  policyVersion: number;
  recoveryVersion: number;
  projectionActorId: string;
  clock?: () => Date;
}

export class ResponseCoordinator {
  readonly #store: CanonicalStore;
  readonly #workflows: ContinuityService;
  readonly #policy: PolicyEngine;
  readonly #policyVersion: number;
  readonly #recoveryVersion: number;
  readonly #projectionActorId: string;
  readonly #clock: () => Date;

  constructor(options: ResponseCoordinatorOptions) {
    this.#store = options.store;
    this.#workflows = options.workflows;
    this.#policy = options.policy;
    this.#policyVersion = options.policyVersion;
    this.#recoveryVersion = options.recoveryVersion;
    this.#projectionActorId = options.projectionActorId;
    this.#clock = options.clock ?? (() => new Date());
  }

  prepareAction(input: {
    organizationId: string;
    incidentId: string;
    proposalId: string;
    authenticatedRequesterId: string;
    targetGeneration: string;
  }): ActionIntent {
    const proposal = this.#currentProposal(
      input.organizationId,
      input.incidentId,
      input.proposalId,
    );
    const graphVersion = this.#currentGraphVersion(input.organizationId);
    if (proposal.snapshotRevision !== graphVersion)
      throw new ResponseCoordinatorError(
        "STALE_PROPOSAL_GRAPH",
        "proposal graph snapshot is no longer current",
      );
    this.#validateProposalEvidence(proposal);
    const sourceProposal = {
      id: proposal.id,
      digest: proposalDigest(proposal),
      contextDigest: this.#contextDigest(proposal),
    };
    return this.#policy.proposeAction(
      {
        organizationId: proposal.organizationId,
        incidentId: proposal.incidentId,
        operation: "stop_demo_scheduler",
        target: {
          identity: "pantry-demo-scheduler",
          generation: input.targetGeneration,
        },
        parameters: {},
        mode: "live",
        graphVersion,
        policyVersion: this.#policyVersion,
        recoveryVersion: this.#recoveryVersion,
        sourceProposal,
      },
      input.authenticatedRequesterId,
    );
  }

  async executePreparedAction(
    input: { actionId: string; authenticatedExecutorId: string },
    broker: DemoBroker,
    observer: IndependentObserver,
  ) {
    const action = this.#policy.getAction(input.actionId);
    if (!action)
      throw new ResponseCoordinatorError(
        "ACTION_NOT_FOUND",
        "prepared action is absent",
      );
    return this.#policy.executeApproved(
      action.actionId,
      input.authenticatedExecutorId,
      broker,
      observer,
      {
        beforeDispatch: () => {
          const proposal = this.#currentProposal(
            action.organizationId,
            action.incidentId,
            action.sourceProposal.id,
          );
          if (
            proposalDigest(proposal) !== action.sourceProposal.digest ||
            this.#contextDigest(proposal) !==
              action.sourceProposal.contextDigest
          )
            throw new ResponseCoordinatorError(
              "RESPONSE_CONTEXT_CHANGED",
              "proposal or response context changed after approval",
            );
          if (
            this.#currentGraphVersion(action.organizationId) !==
            action.graphVersion
          )
            throw new ResponseCoordinatorError(
              "STALE_PROPOSAL_GRAPH",
              "graph changed after approval",
            );
          this.#validateProposalEvidence(proposal);
          if (broker.generation !== action.target.generation)
            throw new ResponseCoordinatorError(
              "TARGET_GENERATION_CHANGED",
              "broker target generation changed",
            );
        },
      },
    );
  }

  async projectVerifiedOutcome(
    input: { organizationId: string; incidentId: string; proposalId: string },
    hooks?: {
      beforeDomainWrite?: () => void | Promise<void>;
      afterContainmentWrite?: () => void | Promise<void>;
    },
  ): Promise<Evidence> {
    const proposal = this.#loadProposal(
      input.organizationId,
      input.incidentId,
      input.proposalId,
    );
    const action = this.#policy.getActionForProposal(
      input.organizationId,
      input.incidentId,
      input.proposalId,
    );
    if (!action || action.sourceProposal.digest !== proposalDigest(proposal))
      throw new ResponseCoordinatorError(
        "ACTION_BINDING_MISSING",
        "no exact policy action is bound to the stored proposal",
      );
    if (
      action.mode !== "live" ||
      action.operation !== "stop_demo_scheduler" ||
      action.target.identity !== "pantry-demo-scheduler"
    )
      throw new ResponseCoordinatorError(
        "ACTION_NOT_PROJECTABLE",
        "only the fixed live containment action can be projected",
      );
    const currentTarget = this.#policy.getCurrentTarget();
    if (
      !currentTarget.enabled ||
      currentTarget.organizationId !== action.organizationId ||
      currentTarget.identity !== action.target.identity ||
      currentTarget.generation !== action.target.generation
    )
      throw new ResponseCoordinatorError(
        "CURRENT_TARGET_MISMATCH",
        "verified outcome does not describe the current enabled target generation",
      );
    const approval = this.#policy.getApproval(action.actionId);
    const execution = approval?.executionId
      ? this.#policy.getExecution(approval.executionId)
      : null;
    if (
      !execution ||
      execution.actionId !== action.actionId ||
      execution.state !== "verified" ||
      execution.mode !== "live"
    )
      throw new ResponseCoordinatorError(
        "EXECUTION_NOT_VERIFIED",
        "bound live execution is absent or not verified",
      );
    const receipt = execution.brokerReceipt,
      verification = execution.verification;
    if (
      !receipt ||
      receipt.executionId !== execution.executionId ||
      !["effect_applied", "already_stopped"].includes(receipt.status) ||
      receipt.targetGeneration !== action.target.generation ||
      verification?.result !== "verified" ||
      verification.schedulerReachable !== false ||
      verification.controlReachable !== true ||
      verification.brokerProcessState !== "stopped"
    )
      throw new ResponseCoordinatorError(
        "VERIFICATION_FACTS_INVALID",
        "broker and independent observer facts do not verify the exact target",
      );
    const observedMs = Date.parse(verification.observedAt),
      receiptMs = Date.parse(receipt.observedAt),
      now = this.#clock().getTime();
    if (
      !Number.isFinite(observedMs) ||
      !Number.isFinite(receiptMs) ||
      receiptMs > observedMs + 30_000 ||
      observedMs > now + 30_000 ||
      now - observedMs > 15 * 60_000
    )
      throw new ResponseCoordinatorError(
        "VERIFICATION_STALE",
        "independent verification is stale or future-dated",
      );
    const common = {
      schemaVersion: 1 as const,
      organizationId: action.organizationId,
      incidentId: action.incidentId,
      source:
        "trusted response coordinator from policy execution and independent observer",
      kind: "verification" as const,
      executionId: execution.executionId,
      targetGeneration: action.target.generation,
      verificationFacts: {
        result: verification.result,
        schedulerReachable: verification.schedulerReachable,
        controlReachable: verification.controlReachable,
        brokerProcessState: verification.brokerProcessState,
      },
      observedAt: verification.observedAt,
      receivedAt: verification.observedAt,
      verification: "verified" as const,
      availability: "unsatisfied" as const,
      freshness: "fresh" as const,
      revision: 1,
    };
    const evidence = EvidenceSchema.parse({
      ...common,
      id: `containment_${execution.executionId}`,
      subjectNodeId: "pantry-demo-scheduler",
      source:
        "trusted response coordinator from policy execution and independent observer",
      fact: `Fixed live stop ${action.actionId} reached desired state; broker=${receipt.status}; proposal=${proposal.id}.`,
      securityTrust: "unknown",
    });
    if (hooks?.beforeDomainWrite) await hooks.beforeDomainWrite();
    const containment = this.#recordProjection(evidence);
    if (hooks?.afterContainmentWrite) await hooks.afterContainmentWrite();
    // This mapping is fixed inside the trusted coordinator. Neither callers nor proposal text can select a graph node.
    const graphState = EvidenceSchema.parse({
      ...common,
      id: `graph_state_${execution.executionId}`,
      subjectNodeId: "scheduler",
      fact: `Canonical scheduler graph node is unavailable after verified fixed-target stop ${action.actionId}.`,
      securityTrust: "unknown",
    });
    this.#recordProjection(graphState);
    return containment;
  }

  #recordProjection(evidence: Evidence): Evidence {
    const existing = this.#store.get(
      evidence.organizationId,
      evidence.incidentId,
      "evidence",
      evidence.id,
    )?.value;
    if (existing) {
      if (stable(existing) !== stable(evidence))
        throw new ResponseCoordinatorError(
          "EVIDENCE_COLLISION",
          "execution evidence ID has conflicting content",
        );
      return existing;
    }
    try {
      return this.#workflows.recordEvidence(evidence, this.#projectionActorId);
    } catch (error) {
      const raced = this.#store.get(
        evidence.organizationId,
        evidence.incidentId,
        "evidence",
        evidence.id,
      )?.value;
      if (raced && stable(raced) === stable(evidence)) return raced;
      throw error;
    }
  }

  #loadProposal(
    organizationId: string,
    incidentId: string,
    proposalId: string,
  ): Proposal {
    const proposal = this.#store.get(
      organizationId,
      incidentId,
      "proposal",
      proposalId,
    )?.value;
    if (!proposal)
      throw new ResponseCoordinatorError(
        "PROPOSAL_NOT_FOUND",
        "proposal is absent or outside scope",
      );
    return proposal;
  }
  #currentProposal(
    organizationId: string,
    incidentId: string,
    proposalId: string,
  ): Proposal {
    const proposal = this.#loadProposal(organizationId, incidentId, proposalId);
    const incident = this.#store.get(
      organizationId,
      incidentId,
      "incident",
      incidentId,
    )?.value;
    if (!incident || incident.status !== "open")
      throw new ResponseCoordinatorError(
        "INCIDENT_NOT_OPEN",
        "proposal incident is not currently open",
      );
    if (proposal.verificationPlanId !== "verification_scheduler_stop")
      throw new ResponseCoordinatorError(
        "VERIFICATION_PLAN_NOT_ALLOWLISTED",
        "proposal verification plan is not the fixed independent observer plan",
      );
    if (
      proposal.status !== "proposed" ||
      Date.parse(proposal.expiresAt) <= this.#clock().getTime()
    )
      throw new ResponseCoordinatorError(
        "PROPOSAL_EXPIRED",
        "stored proposal is no longer executable",
      );
    const fallback = this.#store.get(
      organizationId,
      incidentId,
      "fallback",
      proposal.fallbackPlanId,
    )?.value;
    if (!fallback || fallback.status !== "draft")
      throw new ResponseCoordinatorError(
        "FALLBACK_NOT_FOUND",
        "proposal fallback is absent or outside scope",
      );
    return proposal;
  }
  #currentGraphVersion(organizationId: string): number {
    return (
      this.#store
        .list(organizationId, null, "node")
        .reduce((sum, row) => sum + row.value.revision, 0) +
      this.#store
        .list(organizationId, null, "dependency_group")
        .reduce((sum, row) => sum + row.value.revision, 0)
    );
  }
  #validateProposalEvidence(proposal: Proposal): void {
    const now = this.#clock().getTime();
    for (const id of proposal.evidenceIds) {
      const evidence = this.#store.get(
        proposal.organizationId,
        proposal.incidentId,
        "evidence",
        id,
      )?.value;
      const observed = evidence ? Date.parse(evidence.observedAt) : NaN,
        received = evidence ? Date.parse(evidence.receivedAt) : NaN;
      if (
        !evidence ||
        evidence.verification === "disputed" ||
        evidence.freshness !== "fresh" ||
        !Number.isFinite(observed) ||
        !Number.isFinite(received) ||
        observed > now + 30_000 ||
        received > now + 30_000 ||
        now - observed > 15 * 60_000 ||
        now - received > 15 * 60_000
      )
        throw new ResponseCoordinatorError(
          "PROPOSAL_EVIDENCE_STALE",
          "proposal evidence is absent, disputed, or stale",
        );
    }
  }
  #contextDigest(proposal: Proposal): string {
    const context = {
      proposal,
      incident:
        this.#store.get(
          proposal.organizationId,
          proposal.incidentId,
          "incident",
          proposal.incidentId,
        )?.value ?? null,
      fallback:
        this.#store.get(
          proposal.organizationId,
          proposal.incidentId,
          "fallback",
          proposal.fallbackPlanId,
        )?.value ?? null,
      nodes: this.#store
        .list(proposal.organizationId, null, "node")
        .map((row) => row.value),
      dependencyGroups: this.#store
        .list(proposal.organizationId, null, "dependency_group")
        .map((row) => row.value),
      evidence: this.#store
        .list(proposal.organizationId, proposal.incidentId, "evidence")
        .map((row) => row.value),
      responseTasks: this.#store
        .list(proposal.organizationId, proposal.incidentId, "task")
        .map((row) => row.value),
    };
    return createHash("sha256").update(stable(context)).digest("hex");
  }
}

export function proposalDigest(proposal: Proposal): string {
  return createHash("sha256").update(stable(proposal)).digest("hex");
}
function stable(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(",")}}`;
}
