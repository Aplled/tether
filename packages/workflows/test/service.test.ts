import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  otherOrganizationId,
  pantryActors,
  pantryFallback,
  pantryIncident,
  pantryIncidentId,
  pantryOrganizationId,
  pantryDependencies,
  pantryNodes,
  pantryTasks,
  trustedEvidence,
} from "../../../fixtures/pantry/index.ts";
import { CanonicalStore } from "../../storage/src/index.ts";
import { ContinuityService, WorkflowError } from "../src/index.ts";

const fixedClock = () => new Date("2026-11-07T08:00:00.000Z");

function setup(path = ":memory:") {
  const store = new CanonicalStore(path);
  const service = new ContinuityService(store, fixedClock);
  for (const actor of pantryActors) {
    const existing = store.list(actor.organizationId, null, "actor");
    service.provisionActor(
      actor,
      existing.length === 0 ? undefined : existing[0]!.value.id,
    );
  }
  service.openIncident(pantryIncident, "actor_commander");
  service.createFallback(pantryFallback, "actor_commander");
  for (const task of pantryTasks) service.createTask(task, "actor_commander");
  return { store, service };
}

test("running_on_fallback requires approved containment and every actual task verification, surviving restart", () => {
  const path = join(mkdtempSync(join(tmpdir(), "workflow-")), "workflow.db");
  let { store, service } = setup(path);
  for (const node of pantryNodes) service.registerNode(node, "actor_commander");
  for (const group of pantryDependencies)
    service.registerDependencyGroup(group, "actor_commander");
  const containment = {
    ...trustedEvidence(
      "evidence_containment",
      "verification",
      "pantry-demo-scheduler",
      "Demo scheduler process is stopped and observer control is healthy",
      "execution_demo_stop",
    ),
    securityTrust: "unknown" as const,
    targetGeneration: "generation_demo",
    verificationFacts: {
      result: "verified" as const,
      schedulerReachable: false,
      controlReachable: true,
      brokerProcessState: "stopped" as const,
    },
  };
  service.recordEvidence(containment, "actor_verifier");
  service.approveFallback(
    pantryOrganizationId,
    pantryIncidentId,
    pantryFallback.id,
    containment.id,
    "actor_commander",
    1,
  );

  assert.throws(
    () =>
      service.markRunningOnFallback(
        pantryOrganizationId,
        pantryIncidentId,
        pantryFallback.id,
        "actor_commander",
        1,
        2,
      ),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "fallback_task_unverified",
  );

  for (const [index, task] of pantryTasks.entries()) {
    const evidence = trustedEvidence(
      `evidence_task_${index}`,
      "task_acceptance",
      task.id,
      `${task.title} independently checked`,
    );
    service.recordEvidence(evidence, "actor_verifier");
    service.transitionTask(
      pantryOrganizationId,
      pantryIncidentId,
      task.id,
      "in_progress",
      "actor_volunteer",
      1,
    );
    service.transitionTask(
      pantryOrganizationId,
      pantryIncidentId,
      task.id,
      "completed",
      "actor_volunteer",
      2,
      [evidence.id],
    );
    service.transitionTask(
      pantryOrganizationId,
      pantryIncidentId,
      task.id,
      "verified",
      "actor_verifier",
      3,
      [evidence.id],
    );
  }
  service.recordEvidence(
    {
      ...trustedEvidence(
        "evidence_backup_roster_active",
        "verification",
        "backup_roster",
        "Backup roster is available for distribution",
      ),
      availability: "satisfied",
    },
    "actor_verifier",
  );
  store.close();

  store = new CanonicalStore(path);
  service = new ContinuityService(store, fixedClock);
  const incident = service.markRunningOnFallback(
    pantryOrganizationId,
    pantryIncidentId,
    pantryFallback.id,
    "actor_commander",
    1,
    2,
  );
  assert.equal(incident.status, "running_on_fallback");
  assert.equal(
    store.get(
      pantryOrganizationId,
      pantryIncidentId,
      "fallback",
      pantryFallback.id,
    )?.value.status,
    "verified",
  );
  assert.equal(
    service.analyzeIncident(
      pantryOrganizationId,
      pantryIncidentId,
      "actor_agent",
    ).evaluations.distribution?.availability,
    "satisfied",
  );
  assert.ok(
    store
      .listEvents(pantryOrganizationId, pantryIncidentId)
      .some((event) => event.eventType === "IncidentRunningOnFallback"),
  );
  store.close();
});

test("caller claims and cross-organization actors cannot create trusted workflow facts", () => {
  const { store, service } = setup();
  const claimed = trustedEvidence(
    "evidence_forged",
    "verification",
    "scheduler",
    "Self-reported containment",
  );
  assert.throws(
    () => service.recordEvidence(claimed, "actor_agent"),
    (error: unknown) =>
      error instanceof WorkflowError && error.code === "human_role_required",
  );
  assert.throws(
    () => service.recordEvidence(claimed, "actor_other"),
    (error: unknown) =>
      error instanceof WorkflowError && error.code === "unauthenticated_actor",
  );
  assert.equal(
    store.get(otherOrganizationId, pantryIncidentId, "evidence", claimed.id),
    undefined,
  );
  assert.throws(
    () =>
      service.provisionActor({
        schemaVersion: 1,
        organizationId: pantryOrganizationId,
        id: "actor_forged",
        kind: "human",
        displayName: "Forged Commander",
        roles: ["incident_commander"],
        revision: 1,
      }),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "provisioning_authority_required",
  );
  store.close();
});

test("strict schemas reject extra authority fields", () => {
  const { store, service } = setup();
  const claimed = {
    ...trustedEvidence("evidence_extra", "verification", "scheduler", "Claim"),
    authenticatedActorId: "actor_verifier",
  };
  assert.throws(
    () => service.recordEvidence(claimed, "actor_verifier"),
    /Unrecognized key/,
  );
  store.close();
});

test("application service evaluates persisted evidence and simulation cannot mutate canonical state", () => {
  const { store, service } = setup();
  for (const node of pantryNodes) service.registerNode(node, "actor_commander");
  for (const group of pantryDependencies)
    service.registerDependencyGroup(group, "actor_commander");
  const schedulerDown = {
    ...trustedEvidence(
      "evidence_scheduler_down",
      "observation",
      "scheduler",
      "Scheduler health probe is unavailable",
    ),
    availability: "unsatisfied" as const,
  };
  const backupReady = {
    ...trustedEvidence(
      "evidence_backup_ready",
      "verification",
      "backup_roster",
      "Sanitized backup roster verified available",
    ),
    availability: "satisfied" as const,
  };
  service.recordEvidence(schedulerDown, "actor_verifier");
  service.recordEvidence(backupReady, "actor_verifier");
  const beforeEvents = store.listEvents(
    pantryOrganizationId,
    pantryIncidentId,
  ).length;
  const analysis = service.analyzeIncident(
    pantryOrganizationId,
    pantryIncidentId,
    "actor_agent",
  );
  assert.equal(analysis.evaluations.distribution?.availability, "satisfied");
  assert.equal(analysis.evaluations.scheduler?.securityTrust, "unknown");
  const simulated = service.simulateIncident(
    pantryOrganizationId,
    pantryIncidentId,
    "actor_agent",
    {
      backup_roster: {
        availability: "unsatisfied",
        securityTrust: "trusted",
        freshness: "fresh",
        reason: "isolated simulation",
      },
    },
  );
  assert.equal(simulated.evaluations.distribution?.availability, "unsatisfied");
  assert.equal(
    service.analyzeIncident(
      pantryOrganizationId,
      pantryIncidentId,
      "actor_agent",
    ).evaluations.distribution?.availability,
    "satisfied",
  );
  assert.equal(
    store.listEvents(pantryOrganizationId, pantryIncidentId).length,
    beforeEvents,
  );
  store.close();
});

test("proposal submission binds authenticated author, current graph revision, and scoped fresh evidence", () => {
  const { store, service } = setup();
  for (const node of pantryNodes) service.registerNode(node, "actor_commander");
  for (const group of pantryDependencies)
    service.registerDependencyGroup(group, "actor_commander");
  const evidence = trustedEvidence(
    "evidence_proposal",
    "observation",
    "scheduler",
    "Injected suspicious scheduler observation",
  );
  service.recordEvidence(evidence, "actor_verifier");
  const baseProposal = {
    schemaVersion: 1 as const,
    organizationId: pantryOrganizationId,
    incidentId: pantryIncidentId,
    id: "proposal_stop_scheduler",
    authorActorId: "actor_agent",
    snapshotRevision: 6,
    evidenceIds: [evidence.id],
    assumptions: ["Observation is suspicious, not proof of compromise"],
    actionType: "stop_demo_scheduler" as const,
    targetId: "pantry-demo-scheduler" as const,
    parameters: {},
    expectedOperationalEffects: [
      "Disposable demo scheduler becomes unavailable",
    ],
    fallbackPlanId: pantryFallback.id,
    verificationPlanId: "verify_scheduler_stopped",
    status: "proposed" as const,
    expiresAt: "2026-11-07T08:05:00.000Z",
    revision: 1,
    createdAt: "2026-11-07T08:00:00.000Z",
  };
  assert.equal(
    service.submitProposal(baseProposal, "actor_agent").id,
    baseProposal.id,
  );
  assert.throws(
    () =>
      service.submitProposal(
        { ...baseProposal, id: "proposal_stale", snapshotRevision: 5 },
        "actor_agent",
      ),
    (error: unknown) =>
      error instanceof WorkflowError && error.code === "stale_snapshot",
  );
  assert.throws(
    () =>
      service.submitProposal(
        {
          ...baseProposal,
          id: "proposal_wrong_author",
          authorActorId: "actor_other",
        },
        "actor_agent",
      ),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "invalid_proposal_author",
  );
  store.close();
});

test("assigned commander, subject binding, and derived evidence age fail closed", () => {
  const { store, service } = setup();
  service.provisionActor(
    {
      schemaVersion: 1,
      organizationId: pantryOrganizationId,
      id: "actor_second_commander",
      kind: "human",
      displayName: "Unassigned Commander",
      roles: ["incident_commander"],
      revision: 1,
    },
    "actor_commander",
  );
  const proseOnlyContainment = trustedEvidence(
    "evidence_prose_only_containment",
    "verification",
    "pantry-demo-scheduler",
    "Claims stopped without structured observer facts",
    "execution_prose_only",
  );
  service.recordEvidence(proseOnlyContainment, "actor_verifier");
  assert.throws(
    () =>
      service.approveFallback(
        pantryOrganizationId,
        pantryIncidentId,
        pantryFallback.id,
        proseOnlyContainment.id,
        "actor_commander",
        1,
      ),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "verified_containment_required",
  );
  const containment = {
    ...trustedEvidence(
      "evidence_limited_containment",
      "verification",
      "pantry-demo-scheduler",
      "Process stopped",
      "execution_limited",
    ),
    securityTrust: "unknown" as const,
    targetGeneration: "generation_limited",
    verificationFacts: {
      result: "verified" as const,
      schedulerReachable: false,
      controlReachable: true,
      brokerProcessState: "stopped" as const,
    },
  };
  service.recordEvidence(containment, "actor_verifier");
  assert.throws(
    () =>
      service.approveFallback(
        pantryOrganizationId,
        pantryIncidentId,
        pantryFallback.id,
        containment.id,
        "actor_second_commander",
        1,
      ),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "assigned_commander_required",
  );
  const rosterEvidence = trustedEvidence(
    "evidence_roster_only",
    "task_acceptance",
    "task_roster",
    "Roster checked",
  );
  service.recordEvidence(rosterEvidence, "actor_verifier");
  service.transitionTask(
    pantryOrganizationId,
    pantryIncidentId,
    "task_checkin",
    "in_progress",
    "actor_volunteer",
    1,
  );
  assert.throws(
    () =>
      service.transitionTask(
        pantryOrganizationId,
        pantryIncidentId,
        "task_checkin",
        "completed",
        "actor_volunteer",
        2,
        [rosterEvidence.id],
      ),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "task_evidence_subject_mismatch",
  );
  const lateService = new ContinuityService(
    store,
    () => new Date("2026-11-07T08:16:00.001Z"),
  );
  assert.throws(
    () =>
      lateService.approveFallback(
        pantryOrganizationId,
        pantryIncidentId,
        pantryFallback.id,
        containment.id,
        "actor_commander",
        1,
      ),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "verified_containment_required",
  );
  store.close();
});
