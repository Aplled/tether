import {
  ActorSchema,
  EvidenceSchema,
  FallbackPlanSchema,
  DependencyGroupSchema,
  IncidentSchema,
  NodeSchema,
  ProposalSchema,
  ResponseTaskSchema,
  newId,
  type Actor,
  type DomainEvent,
  type Evidence,
  type FallbackPlan,
  type DependencyGroup,
  type GraphNode,
  type Incident,
  type Proposal,
  type ResponseTask,
} from "../../contracts/src/index.ts";
import {
  evaluateGraph,
  simulateGraph,
  type BaseNodeState,
  type GraphEvaluation,
} from "../../graph-core/src/index.ts";
import { CanonicalStore } from "../../storage/src/index.ts";

export class WorkflowError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type Clock = () => Date;

function iso(clock: Clock): string {
  return clock().toISOString();
}

export class ContinuityService {
  readonly store: CanonicalStore;
  readonly clock: Clock;

  constructor(store: CanonicalStore, clock: Clock = () => new Date()) {
    this.store = store;
    this.clock = clock;
  }

  static readonly evidenceMaxAgeMs = 15 * 60 * 1_000;
  static readonly futureClockSkewMs = 30 * 1_000;

  #actor(organizationId: string, actorId: string): Actor {
    const record = this.store.get(organizationId, null, "actor", actorId);
    if (!record)
      throw new WorkflowError(
        "unauthenticated_actor",
        `Actor ${actorId} is not provisioned in organization`,
      );
    return record.value;
  }

  #requireRole(actor: Actor, roles: string[]): void {
    if (
      actor.kind !== "human" &&
      roles.some((role) => role === "incident_commander" || role === "verifier")
    ) {
      throw new WorkflowError(
        "human_role_required",
        "Privileged evidence and workflow roles require a human actor",
      );
    }
    if (!roles.some((role) => actor.roles.includes(role))) {
      throw new WorkflowError(
        "role_required",
        `Requires one of: ${roles.join(",")}`,
      );
    }
  }

  #incident(organizationId: string, incidentId: string): Incident {
    const record = this.store.get(
      organizationId,
      incidentId,
      "incident",
      incidentId,
    );
    if (!record)
      throw new WorkflowError(
        "incident_not_found",
        "Incident is absent or out of scope",
      );
    return record.value;
  }

  #requireIncidentCommander(actor: Actor, incidentId: string): Incident {
    const incident = this.#incident(actor.organizationId, incidentId);
    if (
      actor.kind !== "human" ||
      actor.id !== incident.commanderActorId ||
      !actor.roles.includes("incident_commander")
    ) {
      throw new WorkflowError(
        "assigned_commander_required",
        "The assigned human incident commander is required",
      );
    }
    return incident;
  }

  #requireVerifierOrAssignedCommander(actor: Actor, incidentId: string): void {
    if (actor.kind !== "human")
      throw new WorkflowError(
        "human_role_required",
        "Trusted verification requires a human actor",
      );
    if (actor.roles.includes("verifier")) return;
    this.#requireIncidentCommander(actor, incidentId);
  }

  #isFreshEvidence(evidence: Evidence): boolean {
    if (evidence.freshness !== "fresh") return false;
    const now = this.clock().getTime();
    const observedAt = Date.parse(evidence.observedAt);
    const receivedAt = Date.parse(evidence.receivedAt);
    return (
      observedAt <= now + ContinuityService.futureClockSkewMs &&
      receivedAt <= now + ContinuityService.futureClockSkewMs &&
      observedAt <= receivedAt + ContinuityService.futureClockSkewMs &&
      now - observedAt <= ContinuityService.evidenceMaxAgeMs &&
      now - receivedAt <= ContinuityService.evidenceMaxAgeMs
    );
  }

  #event(
    record: {
      organizationId: string;
      incidentId?: string;
      id: string;
      revision: number;
    },
    aggregateType: DomainEvent["aggregateType"],
    eventType: string,
    payload: Record<string, unknown> = {},
  ): DomainEvent {
    if (!record.incidentId)
      throw new WorkflowError(
        "incident_scope_required",
        "Mutation must be incident-scoped",
      );
    return {
      schemaVersion: 1,
      id: newId("event"),
      organizationId: record.organizationId,
      incidentId: record.incidentId,
      aggregateType,
      aggregateId: record.id,
      aggregateRevision: record.revision,
      eventType,
      payload,
      occurredAt: iso(this.clock),
    };
  }

  #globalEvent(
    record: { organizationId: string; id: string; revision: number },
    aggregateType: DomainEvent["aggregateType"],
    eventType: string,
  ): DomainEvent {
    return {
      schemaVersion: 1,
      id: newId("event"),
      organizationId: record.organizationId,
      incidentId: `configuration:${record.organizationId}`,
      aggregateType,
      aggregateId: record.id,
      aggregateRevision: record.revision,
      eventType,
      payload: {},
      occurredAt: iso(this.clock),
    };
  }

  provisionActor(actorInput: Actor, authenticatedActorId?: string): Actor {
    const actor = ActorSchema.parse(actorInput);
    const existingActors = this.store.list(actor.organizationId, null, "actor");
    if (existingActors.length === 0) {
      if (
        actor.kind !== "human" ||
        !actor.roles.includes("incident_commander")
      ) {
        throw new WorkflowError(
          "invalid_bootstrap_actor",
          "The first organization actor must be a human incident commander",
        );
      }
    } else {
      if (!authenticatedActorId)
        throw new WorkflowError(
          "provisioning_authority_required",
          "An existing commander must authorize actor provisioning",
        );
      const authenticated = this.#actor(
        actor.organizationId,
        authenticatedActorId,
      );
      this.#requireRole(authenticated, ["incident_commander"]);
    }
    const existing = this.store.get(
      actor.organizationId,
      null,
      "actor",
      actor.id,
    );
    this.store.save(
      { recordType: "actor", value: actor },
      {
        expectedRevision: existing?.value.revision ?? null,
        event: {
          schemaVersion: 1,
          id: newId("event"),
          organizationId: actor.organizationId,
          incidentId: `configuration:${actor.organizationId}`,
          aggregateType: "actor",
          aggregateId: actor.id,
          aggregateRevision: actor.revision,
          eventType: "ActorProvisioned",
          payload: {},
          occurredAt: iso(this.clock),
        },
      },
    );
    return actor;
  }

  registerNode(nodeInput: GraphNode, authenticatedActorId: string): GraphNode {
    const node = NodeSchema.parse(nodeInput);
    const actor = this.#actor(node.organizationId, authenticatedActorId);
    this.#requireRole(actor, ["incident_commander"]);
    const existing = this.store.get(node.organizationId, null, "node", node.id);
    this.store.save(
      { recordType: "node", value: node },
      {
        expectedRevision: existing?.value.revision ?? null,
        event: this.#globalEvent(
          node,
          "node",
          existing ? "GraphNodeUpdated" : "GraphNodeCreated",
        ),
      },
    );
    return node;
  }

  registerDependencyGroup(
    groupInput: DependencyGroup,
    authenticatedActorId: string,
  ): DependencyGroup {
    const group = DependencyGroupSchema.parse(groupInput);
    const actor = this.#actor(group.organizationId, authenticatedActorId);
    this.#requireRole(actor, ["incident_commander"]);
    if (
      !this.store.get(group.organizationId, null, "node", group.dependentNodeId)
    ) {
      throw new WorkflowError(
        "dependent_node_not_found",
        "Dependency target is absent or out of scope",
      );
    }
    for (const requirement of group.requirements) {
      if (
        !this.store.get(group.organizationId, null, "node", requirement.nodeId)
      ) {
        throw new WorkflowError(
          "requirement_node_not_found",
          `Requirement ${requirement.nodeId} is absent or out of scope`,
        );
      }
    }
    const existing = this.store.get(
      group.organizationId,
      null,
      "dependency_group",
      group.id,
    );
    this.store.save(
      { recordType: "dependency_group", value: group },
      {
        expectedRevision: existing?.value.revision ?? null,
        event: this.#globalEvent(
          group,
          "dependency_group",
          existing ? "DependencyGroupUpdated" : "DependencyGroupCreated",
        ),
      },
    );
    return group;
  }

  #graphInput(organizationId: string, incidentId: string) {
    if (!this.store.get(organizationId, incidentId, "incident", incidentId)) {
      throw new WorkflowError(
        "incident_not_found",
        "Incident is absent or out of scope",
      );
    }
    const nodes = this.store
      .list(organizationId, null, "node")
      .map((record) => record.value);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const baseStates: Record<string, BaseNodeState> = {};
    const receivedAtByNode = new Map<string, string>();
    for (const record of this.store.list(
      organizationId,
      incidentId,
      "evidence",
    )) {
      const evidence = record.value;
      if (!nodeIds.has(evidence.subjectNodeId)) continue;
      const priorReceivedAt = receivedAtByNode.get(evidence.subjectNodeId);
      if (priorReceivedAt && priorReceivedAt > evidence.receivedAt) continue;
      baseStates[evidence.subjectNodeId] = {
        availability: evidence.availability ?? "unknown",
        securityTrust: evidence.securityTrust,
        freshness: this.#isFreshEvidence(evidence)
          ? "fresh"
          : evidence.freshness === "unknown"
            ? "unknown"
            : "stale",
        reason: evidence.fact,
      };
      receivedAtByNode.set(evidence.subjectNodeId, evidence.receivedAt);
    }
    return {
      organizationId,
      nodes,
      dependencyGroups: this.store
        .list(organizationId, null, "dependency_group")
        .map((record) => record.value),
      baseStates,
    };
  }

  analyzeIncident(
    organizationId: string,
    incidentId: string,
    authenticatedActorId: string,
  ): GraphEvaluation {
    this.#actor(organizationId, authenticatedActorId);
    return evaluateGraph(this.#graphInput(organizationId, incidentId));
  }

  simulateIncident(
    organizationId: string,
    incidentId: string,
    authenticatedActorId: string,
    overrides: Readonly<Record<string, BaseNodeState>>,
  ): GraphEvaluation {
    this.#actor(organizationId, authenticatedActorId);
    return simulateGraph(
      this.#graphInput(organizationId, incidentId),
      overrides,
    );
  }

  openIncident(
    incidentInput: Incident,
    authenticatedActorId: string,
  ): Incident {
    const incident = IncidentSchema.parse(incidentInput);
    const actor = this.#actor(incident.organizationId, authenticatedActorId);
    this.#requireRole(actor, ["incident_commander"]);
    if (
      incident.commanderActorId !== actor.id ||
      incident.status !== "open" ||
      incident.revision !== 1
    ) {
      throw new WorkflowError(
        "invalid_incident_open",
        "Commander, initial status, or revision is invalid",
      );
    }
    this.store.save(
      { recordType: "incident", value: incident },
      {
        expectedRevision: null,
        event: this.#event(
          { ...incident, incidentId: incident.id },
          "incident",
          "IncidentOpened",
        ),
      },
    );
    return incident;
  }

  recordEvidence(
    evidenceInput: Evidence,
    authenticatedActorId: string,
  ): Evidence {
    const evidence = EvidenceSchema.parse(evidenceInput);
    const actor = this.#actor(evidence.organizationId, authenticatedActorId);
    this.#incident(evidence.organizationId, evidence.incidentId);
    const assertsTrustedFact =
      evidence.verification === "verified" ||
      evidence.securityTrust === "trusted" ||
      evidence.freshness === "fresh";
    if (assertsTrustedFact)
      this.#requireVerifierOrAssignedCommander(actor, evidence.incidentId);
    if (evidence.freshness === "fresh" && !this.#isFreshEvidence(evidence)) {
      throw new WorkflowError(
        "invalid_freshness",
        "Fresh evidence timestamp is stale or too far in the future",
      );
    }
    if (actor.kind === "agent" && evidence.verification !== "unverified") {
      throw new WorkflowError(
        "agent_cannot_verify",
        "Agent evidence cannot be accepted as verified",
      );
    }
    this.store.save(
      { recordType: "evidence", value: evidence },
      {
        expectedRevision: null,
        event: this.#event(evidence, "evidence", "EvidenceRecorded", {
          authenticatedActorId: actor.id,
        }),
      },
    );
    return evidence;
  }

  createFallback(
    planInput: FallbackPlan,
    authenticatedActorId: string,
  ): FallbackPlan {
    const plan = FallbackPlanSchema.parse(planInput);
    const actor = this.#actor(plan.organizationId, authenticatedActorId);
    this.#requireIncidentCommander(actor, plan.incidentId);
    if (
      plan.status !== "draft" ||
      plan.revision !== 1 ||
      plan.approvedAt ||
      plan.containmentVerificationEvidenceId
    ) {
      throw new WorkflowError(
        "invalid_initial_fallback",
        "Fallback must begin as an unapproved draft",
      );
    }
    this.store.save(
      { recordType: "fallback", value: plan },
      {
        expectedRevision: null,
        event: this.#event(plan, "fallback", "FallbackCreated"),
      },
    );
    return plan;
  }

  createTask(
    taskInput: ResponseTask,
    authenticatedActorId: string,
  ): ResponseTask {
    const task = ResponseTaskSchema.parse(taskInput);
    const actor = this.#actor(task.organizationId, authenticatedActorId);
    this.#requireIncidentCommander(actor, task.incidentId);
    if (
      task.state !== "pending" ||
      task.revision !== 1 ||
      task.acceptanceEvidenceIds.length !== 0
    ) {
      throw new WorkflowError(
        "invalid_initial_task",
        "Task must begin pending without acceptance evidence",
      );
    }
    const plan = this.store.get(
      task.organizationId,
      task.incidentId,
      "fallback",
      task.fallbackPlanId,
    );
    if (!plan)
      throw new WorkflowError(
        "fallback_not_found",
        "Task fallback is absent or out of scope",
      );
    for (const prerequisiteId of task.prerequisiteTaskIds) {
      if (
        !this.store.get(
          task.organizationId,
          task.incidentId,
          "task",
          prerequisiteId,
        )
      ) {
        throw new WorkflowError(
          "prerequisite_not_found",
          `Task prerequisite ${prerequisiteId} is absent or out of scope`,
        );
      }
    }
    this.store.save(
      { recordType: "task", value: task },
      {
        expectedRevision: null,
        event: this.#event(task, "task", "ResponseTaskCreated"),
      },
    );
    return task;
  }

  transitionTask(
    organizationId: string,
    incidentId: string,
    taskId: string,
    nextState: ResponseTask["state"],
    authenticatedActorId: string,
    expectedRevision: number,
    evidenceIds: string[] = [],
  ): ResponseTask {
    const actor = this.#actor(organizationId, authenticatedActorId);
    const record = this.store.get(organizationId, incidentId, "task", taskId);
    if (!record)
      throw new WorkflowError(
        "task_not_found",
        "Task is absent or out of scope",
      );
    const task = record.value;
    if (task.revision !== expectedRevision)
      throw new WorkflowError("revision_conflict", "Task revision is stale");
    const allowed: Record<ResponseTask["state"], ResponseTask["state"][]> = {
      pending: ["in_progress"],
      in_progress: ["completed"],
      completed: ["verified"],
      verified: [],
    };
    if (!allowed[task.state].includes(nextState))
      throw new WorkflowError(
        "invalid_task_transition",
        `${task.state} -> ${nextState}`,
      );
    if (
      actor.id !== task.ownerActorId &&
      !actor.roles.includes("incident_commander") &&
      !actor.roles.includes("verifier")
    ) {
      throw new WorkflowError(
        "task_actor_forbidden",
        "Only owner, commander, or verifier may transition task",
      );
    }
    for (const prerequisiteId of task.prerequisiteTaskIds) {
      const prerequisite = this.store.get(
        organizationId,
        incidentId,
        "task",
        prerequisiteId,
      );
      if (!prerequisite || prerequisite.value.state !== "verified") {
        throw new WorkflowError(
          "task_prerequisite_unverified",
          `Prerequisite ${prerequisiteId} is not verified`,
        );
      }
    }
    if (
      (nextState === "completed" || nextState === "verified") &&
      evidenceIds.length === 0
    ) {
      throw new WorkflowError(
        "acceptance_evidence_required",
        "Completion requires persisted evidence",
      );
    }
    const evidence = evidenceIds.map((id) => {
      const item = this.store.get(organizationId, incidentId, "evidence", id);
      if (!item)
        throw new WorkflowError(
          "evidence_not_found",
          `Evidence ${id} is absent or out of scope`,
        );
      return item.value;
    });
    if (
      nextState === "completed" &&
      !evidence.every(
        (item) =>
          item.kind === "task_acceptance" && item.subjectNodeId === task.id,
      )
    ) {
      throw new WorkflowError(
        "task_evidence_subject_mismatch",
        "Completion evidence must be task acceptance bound to this task",
      );
    }
    if (nextState === "verified") {
      this.#requireVerifierOrAssignedCommander(actor, incidentId);
      if (
        !evidence.every(
          (item) =>
            item.kind === "task_acceptance" &&
            item.subjectNodeId === task.id &&
            item.verification === "verified" &&
            item.securityTrust === "trusted" &&
            this.#isFreshEvidence(item),
        )
      ) {
        throw new WorkflowError(
          "trusted_task_verification_required",
          "Verified tasks require fresh trusted task-acceptance evidence",
        );
      }
    }
    const updated = ResponseTaskSchema.parse({
      ...task,
      state: nextState,
      acceptanceEvidenceIds: [
        ...new Set([...task.acceptanceEvidenceIds, ...evidenceIds]),
      ],
      revision: task.revision + 1,
      updatedAt: iso(this.clock),
    });
    this.store.save(
      { recordType: "task", value: updated },
      {
        expectedRevision,
        event: this.#event(
          updated,
          "task",
          `ResponseTask${nextState[0]!.toUpperCase()}${nextState.slice(1)}`,
        ),
      },
    );
    return updated;
  }

  approveFallback(
    organizationId: string,
    incidentId: string,
    fallbackPlanId: string,
    containmentEvidenceId: string,
    authenticatedActorId: string,
    expectedRevision: number,
  ): FallbackPlan {
    const actor = this.#actor(organizationId, authenticatedActorId);
    this.#requireIncidentCommander(actor, incidentId);
    const record = this.store.get(
      organizationId,
      incidentId,
      "fallback",
      fallbackPlanId,
    );
    if (
      !record ||
      record.value.revision !== expectedRevision ||
      record.value.status !== "draft"
    ) {
      throw new WorkflowError(
        "fallback_not_approvable",
        "Fallback is missing, stale, or not draft",
      );
    }
    const evidence = this.store.get(
      organizationId,
      incidentId,
      "evidence",
      containmentEvidenceId,
    )?.value;
    if (
      !evidence ||
      evidence.kind !== "verification" ||
      evidence.subjectNodeId !== "pantry-demo-scheduler" ||
      !evidence.executionId ||
      !evidence.targetGeneration ||
      evidence.verificationFacts?.result !== "verified" ||
      evidence.verificationFacts.schedulerReachable !== false ||
      evidence.verificationFacts.controlReachable !== true ||
      evidence.verificationFacts.brokerProcessState !== "stopped" ||
      evidence.verification !== "verified" ||
      !this.#isFreshEvidence(evidence)
    ) {
      throw new WorkflowError(
        "verified_containment_required",
        "Fresh exact containment verification is required",
      );
    }
    const updated = FallbackPlanSchema.parse({
      ...record.value,
      status: "approved",
      containmentVerificationEvidenceId: containmentEvidenceId,
      approvedAt: iso(this.clock),
      revision: expectedRevision + 1,
    });
    this.store.save(
      { recordType: "fallback", value: updated },
      {
        expectedRevision,
        event: this.#event(updated, "fallback", "FallbackApproved"),
      },
    );
    return updated;
  }

  markRunningOnFallback(
    organizationId: string,
    incidentId: string,
    fallbackPlanId: string,
    authenticatedActorId: string,
    expectedIncidentRevision: number,
    expectedFallbackRevision: number,
  ): Incident {
    const actor = this.#actor(organizationId, authenticatedActorId);
    this.#requireIncidentCommander(actor, incidentId);
    const incidentRecord = this.store.get(
      organizationId,
      incidentId,
      "incident",
      incidentId,
    );
    const fallbackRecord = this.store.get(
      organizationId,
      incidentId,
      "fallback",
      fallbackPlanId,
    );
    if (
      !incidentRecord ||
      incidentRecord.value.revision !== expectedIncidentRevision
    )
      throw new WorkflowError(
        "incident_revision_conflict",
        "Incident missing or stale",
      );
    if (
      !fallbackRecord ||
      fallbackRecord.value.revision !== expectedFallbackRevision ||
      fallbackRecord.value.status !== "approved"
    ) {
      throw new WorkflowError(
        "fallback_not_approved",
        "Fallback missing, stale, or unapproved",
      );
    }
    const fallback = fallbackRecord.value;
    const containment = fallback.containmentVerificationEvidenceId
      ? this.store.get(
          organizationId,
          incidentId,
          "evidence",
          fallback.containmentVerificationEvidenceId,
        )?.value
      : undefined;
    if (
      !containment ||
      containment.kind !== "verification" ||
      containment.subjectNodeId !== "pantry-demo-scheduler" ||
      !containment.executionId ||
      !containment.targetGeneration ||
      containment.verificationFacts?.result !== "verified" ||
      containment.verificationFacts.schedulerReachable !== false ||
      containment.verificationFacts.controlReachable !== true ||
      containment.verificationFacts.brokerProcessState !== "stopped" ||
      containment.verification !== "verified" ||
      !this.#isFreshEvidence(containment)
    ) {
      throw new WorkflowError(
        "containment_no_longer_valid",
        "Containment verification is absent or invalid",
      );
    }
    for (const taskId of fallback.prerequisiteTaskIds) {
      const task = this.store.get(
        organizationId,
        incidentId,
        "task",
        taskId,
      )?.value;
      if (
        !task ||
        task.fallbackPlanId !== fallback.id ||
        task.state !== "verified"
      ) {
        throw new WorkflowError(
          "fallback_task_unverified",
          `Required fallback task ${taskId} is not verified`,
        );
      }
      const accepted = task.acceptanceEvidenceIds.some((id) => {
        const item = this.store.get(
          organizationId,
          incidentId,
          "evidence",
          id,
        )?.value;
        return (
          item?.kind === "task_acceptance" &&
          item.subjectNodeId === task.id &&
          item.verification === "verified" &&
          item.securityTrust === "trusted" &&
          this.#isFreshEvidence(item)
        );
      });
      if (!accepted)
        throw new WorkflowError(
          "fallback_task_evidence_invalid",
          `Task ${taskId} lacks trusted acceptance evidence`,
        );
    }
    const fallbackAvailability = this.store
      .list(organizationId, incidentId, "evidence")
      .map((record) => record.value)
      .find(
        (item) =>
          item.subjectNodeId === fallback.fallbackNodeId &&
          item.kind === "verification" &&
          item.availability === "satisfied" &&
          item.verification === "verified" &&
          item.securityTrust === "trusted" &&
          this.#isFreshEvidence(item),
      );
    if (!fallbackAvailability) {
      throw new WorkflowError(
        "fallback_availability_unverified",
        `Fallback node ${fallback.fallbackNodeId} lacks fresh trusted availability evidence`,
      );
    }
    const updatedFallback = FallbackPlanSchema.parse({
      ...fallback,
      status: "verified",
      revision: fallback.revision + 1,
    });
    const incident = IncidentSchema.parse({
      ...incidentRecord.value,
      status: "running_on_fallback",
      revision: incidentRecord.value.revision + 1,
      updatedAt: iso(this.clock),
    });
    this.store.saveMany([
      {
        record: { recordType: "fallback", value: updatedFallback },
        options: {
          expectedRevision: fallback.revision,
          event: this.#event(updatedFallback, "fallback", "FallbackVerified"),
        },
      },
      {
        record: { recordType: "incident", value: incident },
        options: {
          expectedRevision: incidentRecord.value.revision,
          event: this.#event(
            { ...incident, incidentId: incident.id },
            "incident",
            "IncidentRunningOnFallback",
            { fallbackPlanId },
          ),
        },
      },
    ]);
    return incident;
  }

  submitProposal(
    proposalInput: Proposal,
    authenticatedActorId: string,
  ): Proposal {
    const proposal = ProposalSchema.parse(proposalInput);
    const actor = this.#actor(proposal.organizationId, authenticatedActorId);
    if (
      proposal.authorActorId !== actor.id ||
      proposal.status !== "proposed" ||
      proposal.revision !== 1
    ) {
      throw new WorkflowError(
        "invalid_proposal_author",
        "Authenticated actor must be proposal author",
      );
    }
    if (
      !this.store.get(
        proposal.organizationId,
        proposal.incidentId,
        "incident",
        proposal.incidentId,
      )
    ) {
      throw new WorkflowError(
        "incident_not_found",
        "Proposal incident is absent or out of scope",
      );
    }
    const graphRevision =
      this.store
        .list(proposal.organizationId, null, "node")
        .reduce((sum, r) => sum + r.value.revision, 0) +
      this.store
        .list(proposal.organizationId, null, "dependency_group")
        .reduce((sum, r) => sum + r.value.revision, 0);
    if (proposal.snapshotRevision !== graphRevision || graphRevision < 1) {
      throw new WorkflowError(
        "stale_snapshot",
        `Current graph revision is ${graphRevision}`,
      );
    }
    for (const evidenceId of proposal.evidenceIds) {
      const evidence = this.store.get(
        proposal.organizationId,
        proposal.incidentId,
        "evidence",
        evidenceId,
      )?.value;
      if (
        !evidence ||
        !this.#isFreshEvidence(evidence) ||
        evidence.verification === "disputed"
      ) {
        throw new WorkflowError(
          "invalid_proposal_evidence",
          `Evidence ${evidenceId} is absent, stale, or disputed`,
        );
      }
    }
    if (
      !this.store.get(
        proposal.organizationId,
        proposal.incidentId,
        "fallback",
        proposal.fallbackPlanId,
      )
    ) {
      throw new WorkflowError(
        "fallback_not_found",
        "Proposal fallback is absent or out of scope",
      );
    }
    if (new Date(proposal.expiresAt).getTime() <= this.clock().getTime())
      throw new WorkflowError(
        "proposal_expired",
        "Proposal is already expired",
      );
    this.store.save(
      { recordType: "proposal", value: proposal },
      {
        expectedRevision: null,
        event: this.#event(proposal, "proposal", "ResponseProposalSubmitted", {
          authenticatedActorId: actor.id,
        }),
      },
    );
    return proposal;
  }
}
