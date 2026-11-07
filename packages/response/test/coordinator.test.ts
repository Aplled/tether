import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DemoBroker,
  IndependentObserver,
} from "../../../apps/demo-broker/src/index.ts";
import {
  pantryFallback,
  pantryIncidentId,
  pantryOrganizationId,
  seedPantryScenario,
  trustedEvidence,
} from "../../../fixtures/pantry/index.ts";
import { PolicyEngine, type AuthoritySeed } from "../../policy/src/index.ts";
import { CanonicalStore } from "../../storage/src/index.ts";
import { ContinuityService } from "../../workflows/src/index.ts";
import {
  proposalDigest,
  ResponseCoordinator,
  ResponseCoordinatorError,
} from "../src/index.ts";

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "response-coordinator-"));
  const domainPath = join(dir, "domain.db"),
    policyPath = join(dir, "policy.db"),
    brokerPath = join(dir, "broker.db");
  const clock = () => new Date();
  const store = new CanonicalStore(domainPath),
    workflows = seedPantryScenario(store, clock);
  const now = new Date().toISOString();
  const observation = {
    ...trustedEvidence(
      "evidence_response_proposal",
      "observation",
      "scheduler",
      "Synthetic suspicious scheduler behavior",
    ),
    observedAt: now,
    receivedAt: now,
  };
  workflows.recordEvidence(observation, "actor_verifier");
  const graphVersion =
    store
      .list(pantryOrganizationId, null, "node")
      .reduce((sum, row) => sum + row.value.revision, 0) +
    store
      .list(pantryOrganizationId, null, "dependency_group")
      .reduce((sum, row) => sum + row.value.revision, 0);
  const proposal = {
    schemaVersion: 1 as const,
    organizationId: pantryOrganizationId,
    incidentId: pantryIncidentId,
    id: "proposal_coordinated_stop",
    authorActorId: "actor_agent",
    snapshotRevision: graphVersion,
    evidenceIds: [observation.id],
    assumptions: ["Synthetic observation is not proof of compromise"],
    actionType: "stop_demo_scheduler" as const,
    targetId: "pantry-demo-scheduler" as const,
    parameters: {},
    expectedOperationalEffects: [
      "Fixed disposable scheduler becomes unreachable",
    ],
    fallbackPlanId: pantryFallback.id,
    verificationPlanId: "verification_scheduler_stop",
    status: "proposed" as const,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    revision: 1,
    createdAt: now,
  };
  workflows.submitProposal(proposal, "actor_agent");
  const broker = await DemoBroker.start({
    dbPath: brokerPath,
    schedulerPort: 0,
    controlPort: 0,
  });
  const observer = new IndependentObserver({
    schedulerHealthUrl: broker.schedulerHealthUrl,
    controlHealthUrl: broker.controlHealthUrl,
    expectedToken: broker.fixtureToken,
    readBrokerState: () => broker.readProcessState(),
  });
  const seed: AuthoritySeed = {
    principals: [
      {
        id: "policy-agent",
        kind: "agent",
        organizationId: pantryOrganizationId,
        roles: ["participant"],
      },
      {
        id: "policy-commander",
        kind: "human",
        organizationId: pantryOrganizationId,
        roles: ["incident_commander"],
      },
      {
        id: "policy-executor",
        kind: "service",
        organizationId: pantryOrganizationId,
        roles: ["execution_service"],
      },
    ],
    incidents: [
      {
        id: pantryIncidentId,
        organizationId: pantryOrganizationId,
        commanderPrincipalId: "policy-commander",
        revision: 1,
        open: true,
      },
    ],
    target: {
      identity: "pantry-demo-scheduler",
      generation: broker.generation,
      organizationId: pantryOrganizationId,
      enabled: true,
    },
    graphVersion,
    policyVersion: 1,
    recoveryVersion: 1,
  };
  const policy = new PolicyEngine({ dbPath: policyPath, seed });
  const coordinator = new ResponseCoordinator({
    store,
    workflows,
    policy,
    policyVersion: 1,
    recoveryVersion: 1,
    projectionActorId: "actor_verifier",
    clock,
  });
  return {
    dir,
    domainPath,
    policyPath,
    seed,
    store,
    workflows,
    policy,
    broker,
    observer,
    proposal,
    coordinator,
    cleanup: async () => {
      try {
        policy.close();
      } catch {}
      try {
        store.close();
      } catch {}
      await broker.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("stored proposal binds one exact policy action and conflicting retry is rejected", async () => {
  const f = await setup();
  try {
    const input = {
      organizationId: pantryOrganizationId,
      incidentId: pantryIncidentId,
      proposalId: f.proposal.id,
      authenticatedRequesterId: "policy-agent",
      targetGeneration: f.broker.generation,
    };
    const first = f.coordinator.prepareAction(input),
      retry = f.coordinator.prepareAction(input);
    assert.equal(retry.actionId, first.actionId);
    assert.equal(retry.canonicalDigest, first.canonicalDigest);
    assert.equal(first.sourceProposal.id, f.proposal.id);
    assert.equal(first.sourceProposal.digest.length, 64);
    assert.throws(
      () =>
        f.policy.proposeAction(
          {
            organizationId: first.organizationId,
            incidentId: first.incidentId,
            operation: first.operation,
            target: first.target,
            parameters: {},
            mode: "simulation",
            graphVersion: first.graphVersion,
            policyVersion: first.policyVersion,
            recoveryVersion: first.recoveryVersion,
            sourceProposal: first.sourceProposal,
          },
          "policy-agent",
        ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "PROPOSAL_BINDING_CONFLICT",
    );
  } finally {
    await f.cleanup();
  }
});

test("verified live outcome projects once after crash without redispatch", async () => {
  const f = await setup();
  let reopenedStore: CanonicalStore | undefined;
  let reopenedPolicy: PolicyEngine | undefined;
  try {
    const scope = {
      organizationId: pantryOrganizationId,
      incidentId: pantryIncidentId,
      proposalId: f.proposal.id,
    };
    const action = f.coordinator.prepareAction({
      ...scope,
      authenticatedRequesterId: "policy-agent",
      targetGeneration: f.broker.generation,
    });
    f.policy.approveAction(action.actionId, "policy-commander", {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const execution = await f.coordinator.executePreparedAction(
      { actionId: action.actionId, authenticatedExecutorId: "policy-executor" },
      f.broker,
      f.observer,
    );
    assert.equal(execution.state, "verified");
    const attemptId = execution.brokerReceipt!.attemptId;
    await assert.rejects(
      () =>
        f.coordinator.projectVerifiedOutcome(scope, {
          beforeDomainWrite: () => {
            throw new Error("projection crash");
          },
        }),
      /projection crash/,
    );
    assert.equal(
      f.store
        .list(pantryOrganizationId, pantryIncidentId, "evidence")
        .filter((row) => row.value.executionId === execution.executionId)
        .length,
      0,
    );
    f.store.close();
    f.policy.close();
    reopenedStore = new CanonicalStore(f.domainPath);
    reopenedPolicy = new PolicyEngine({ dbPath: f.policyPath });
    const reopenedWorkflows = new ContinuityService(reopenedStore);
    const restarted = new ResponseCoordinator({
      store: reopenedStore,
      workflows: reopenedWorkflows,
      policy: reopenedPolicy,
      policyVersion: 1,
      recoveryVersion: 1,
      projectionActorId: "actor_verifier",
    });
    const projected = await restarted.projectVerifiedOutcome(scope);
    const retry = await restarted.projectVerifiedOutcome(scope);
    assert.equal(retry.id, projected.id);
    assert.equal(projected.executionId, execution.executionId);
    assert.equal(projected.securityTrust, "unknown");
    assert.equal(projected.targetGeneration, f.broker.generation);
    assert.deepEqual(projected.verificationFacts, {
      result: "verified",
      schedulerReachable: false,
      controlReachable: true,
      brokerProcessState: "stopped",
    });
    const evidenceEvents = reopenedStore
      .listEvents(pantryOrganizationId, pantryIncidentId)
      .filter(
        (event) =>
          event.aggregateType === "evidence" &&
          event.aggregateId === projected.id,
      );
    assert.equal(evidenceEvents.length, 1);
    const graphEvidence = reopenedStore.get(
      pantryOrganizationId,
      pantryIncidentId,
      "evidence",
      `graph_state_${execution.executionId}`,
    )?.value;
    assert.equal(graphEvidence?.subjectNodeId, "scheduler");
    assert.equal(graphEvidence?.securityTrust, "unknown");
    assert.equal(
      reopenedWorkflows.analyzeIncident(
        pantryOrganizationId,
        pantryIncidentId,
        "actor_verifier",
      ).evaluations.scheduler?.availability,
      "unsatisfied",
    );
    const fallbackObservedAt = new Date().toISOString();
    for (const [id, node] of [
      ["evidence_backup_ready", "backup_roster"],
      ["evidence_phone_ready", "phone_tree"],
    ] as const) {
      reopenedWorkflows.recordEvidence(
        {
          ...trustedEvidence(
            id,
            "verification",
            node,
            "Verified fallback dependency ready",
          ),
          observedAt: fallbackObservedAt,
          receivedAt: fallbackObservedAt,
          availability: "satisfied",
        },
        "actor_verifier",
      );
    }
    assert.equal(
      reopenedWorkflows.analyzeIncident(
        pantryOrganizationId,
        pantryIncidentId,
        "actor_verifier",
      ).evaluations.distribution?.availability,
      "satisfied",
    );
    assert.equal(
      (await f.broker.lookup(execution.executionId))?.attemptId,
      attemptId,
    );
  } finally {
    reopenedPolicy?.close();
    reopenedStore?.close();
    await f.cleanup();
  }
});

test("partial projection crash recovers missing graph evidence without duplicating containment", async () => {
  const f = await setup();
  let reopenedStore: CanonicalStore | undefined;
  let reopenedPolicy: PolicyEngine | undefined;
  try {
    const scope = {
      organizationId: pantryOrganizationId,
      incidentId: pantryIncidentId,
      proposalId: f.proposal.id,
    };
    const action = f.coordinator.prepareAction({
      ...scope,
      authenticatedRequesterId: "policy-agent",
      targetGeneration: f.broker.generation,
    });
    f.policy.approveAction(action.actionId, "policy-commander", {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const execution = await f.coordinator.executePreparedAction(
      { actionId: action.actionId, authenticatedExecutorId: "policy-executor" },
      f.broker,
      f.observer,
    );
    await assert.rejects(
      () =>
        f.coordinator.projectVerifiedOutcome(scope, {
          afterContainmentWrite: () => {
            throw new Error("partial projection crash");
          },
        }),
      /partial projection crash/,
    );
    assert.ok(
      f.store.get(
        pantryOrganizationId,
        pantryIncidentId,
        "evidence",
        `containment_${execution.executionId}`,
      ),
    );
    assert.equal(
      f.store.get(
        pantryOrganizationId,
        pantryIncidentId,
        "evidence",
        `graph_state_${execution.executionId}`,
      ),
      undefined,
    );
    f.store.close();
    f.policy.close();
    reopenedStore = new CanonicalStore(f.domainPath);
    reopenedPolicy = new PolicyEngine({ dbPath: f.policyPath });
    const restarted = new ResponseCoordinator({
      store: reopenedStore,
      workflows: new ContinuityService(reopenedStore),
      policy: reopenedPolicy,
      policyVersion: 1,
      recoveryVersion: 1,
      projectionActorId: "actor_verifier",
    });
    await restarted.projectVerifiedOutcome(scope);
    assert.ok(
      reopenedStore.get(
        pantryOrganizationId,
        pantryIncidentId,
        "evidence",
        `graph_state_${execution.executionId}`,
      ),
    );
    assert.equal(
      reopenedStore
        .listEvents(pantryOrganizationId, pantryIncidentId)
        .filter(
          (event) =>
            event.aggregateType === "evidence" &&
            event.aggregateId === `containment_${execution.executionId}`,
        ).length,
      1,
    );
    assert.equal(
      (await f.broker.lookup(execution.executionId))?.attemptId,
      execution.brokerReceipt?.attemptId,
    );
  } finally {
    reopenedPolicy?.close();
    reopenedStore?.close();
    await f.cleanup();
  }
});

test("an actual simulation execution cannot become containment evidence", async () => {
  const f = await setup();
  try {
    const scope = {
      organizationId: pantryOrganizationId,
      incidentId: pantryIncidentId,
      proposalId: f.proposal.id,
    };
    const action = f.policy.proposeAction(
      {
        organizationId: pantryOrganizationId,
        incidentId: pantryIncidentId,
        operation: "stop_demo_scheduler",
        target: {
          identity: "pantry-demo-scheduler",
          generation: f.broker.generation,
        },
        parameters: {},
        mode: "simulation",
        graphVersion: f.seed.graphVersion,
        policyVersion: 1,
        recoveryVersion: 1,
        sourceProposal: {
          id: f.proposal.id,
          digest: proposalDigest(f.proposal),
          contextDigest: "a".repeat(64),
        },
      },
      "policy-agent",
    );
    f.policy.approveAction(action.actionId, "policy-commander", {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(
      (
        await f.policy.executeApproved(
          action.actionId,
          "policy-executor",
          f.broker,
          f.observer,
        )
      ).mode,
      "simulation",
    );
    await assert.rejects(
      () => f.coordinator.projectVerifiedOutcome(scope),
      (error: unknown) =>
        error instanceof ResponseCoordinatorError &&
        error.code === "ACTION_NOT_PROJECTABLE",
    );
    assert.equal(f.broker.processState, "running");
  } finally {
    await f.cleanup();
  }
});

test("a live effect with unavailable observer becomes outcome_unknown and cannot project", async () => {
  const f = await setup();
  try {
    const scope = {
      organizationId: pantryOrganizationId,
      incidentId: pantryIncidentId,
      proposalId: f.proposal.id,
    };
    const action = f.coordinator.prepareAction({
      ...scope,
      authenticatedRequesterId: "policy-agent",
      targetGeneration: f.broker.generation,
    });
    f.policy.approveAction(action.actionId, "policy-commander", {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const unavailableObserver = new IndependentObserver({
      schedulerHealthUrl: f.broker.schedulerHealthUrl,
      controlHealthUrl: f.broker.controlHealthUrl,
      expectedToken: "wrong-token",
      readBrokerState: () => f.broker.readProcessState(),
    });
    const execution = await f.coordinator.executePreparedAction(
      { actionId: action.actionId, authenticatedExecutorId: "policy-executor" },
      f.broker,
      unavailableObserver,
    );
    assert.equal(execution.state, "outcome_unknown");
    await assert.rejects(
      () => f.coordinator.projectVerifiedOutcome(scope),
      (error: unknown) =>
        error instanceof ResponseCoordinatorError &&
        error.code === "EXECUTION_NOT_VERIFIED",
    );
    assert.equal(
      f.store
        .list(pantryOrganizationId, pantryIncidentId, "evidence")
        .filter((row) => row.value.executionId).length,
      0,
    );
  } finally {
    await f.cleanup();
  }
});

test("new incident evidence after approval invalidates context before dispatch", async () => {
  const f = await setup();
  try {
    const scope = {
      organizationId: pantryOrganizationId,
      incidentId: pantryIncidentId,
      proposalId: f.proposal.id,
    };
    const action = f.coordinator.prepareAction({
      ...scope,
      authenticatedRequesterId: "policy-agent",
      targetGeneration: f.broker.generation,
    });
    f.policy.approveAction(action.actionId, "policy-commander", {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const now = new Date().toISOString();
    f.workflows.recordEvidence(
      {
        ...trustedEvidence(
          "evidence_new_context",
          "observation",
          "scheduler",
          "New contradictory context before dispatch",
        ),
        observedAt: now,
        receivedAt: now,
        securityTrust: "untrusted",
      },
      "actor_verifier",
    );
    await assert.rejects(
      () =>
        f.coordinator.executePreparedAction(
          {
            actionId: action.actionId,
            authenticatedExecutorId: "policy-executor",
          },
          f.broker,
          f.observer,
        ),
      (error: unknown) =>
        error instanceof ResponseCoordinatorError &&
        error.code === "RESPONSE_CONTEXT_CHANGED",
    );
    assert.equal(f.broker.processState, "running");
    const executionId = f.policy.getApproval(action.actionId)!.executionId!;
    assert.equal(f.policy.getExecution(executionId)?.state, "failed");
  } finally {
    await f.cleanup();
  }
});

test("old verified generation cannot project after current target replacement", async () => {
  const f = await setup();
  let replacementPolicy: PolicyEngine | undefined;
  try {
    const scope = {
      organizationId: pantryOrganizationId,
      incidentId: pantryIncidentId,
      proposalId: f.proposal.id,
    };
    const action = f.coordinator.prepareAction({
      ...scope,
      authenticatedRequesterId: "policy-agent",
      targetGeneration: f.broker.generation,
    });
    f.policy.approveAction(action.actionId, "policy-commander", {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(
      (
        await f.coordinator.executePreparedAction(
          {
            actionId: action.actionId,
            authenticatedExecutorId: "policy-executor",
          },
          f.broker,
          f.observer,
        )
      ).state,
      "verified",
    );
    f.policy.close();
    const changed = structuredClone(f.seed);
    changed.target.generation = "replacement-generation";
    replacementPolicy = new PolicyEngine({
      dbPath: f.policyPath,
      seed: changed,
    });
    const restarted = new ResponseCoordinator({
      store: f.store,
      workflows: f.workflows,
      policy: replacementPolicy,
      policyVersion: 1,
      recoveryVersion: 1,
      projectionActorId: "actor_verifier",
    });
    await assert.rejects(
      () => restarted.projectVerifiedOutcome(scope),
      (error: unknown) =>
        error instanceof ResponseCoordinatorError &&
        error.code === "CURRENT_TARGET_MISMATCH",
    );
    assert.equal(
      f.store
        .list(pantryOrganizationId, pantryIncidentId, "evidence")
        .filter((row) => row.value.executionId).length,
      0,
    );
  } finally {
    replacementPolicy?.close();
    await f.cleanup();
  }
});
