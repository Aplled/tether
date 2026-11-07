import type {
  Actor,
  DependencyGroup,
  Evidence,
  FallbackPlan,
  GraphNode,
  Incident,
  ResponseTask,
} from "../../packages/contracts/src/index.ts";
import { EvidenceSchema } from "../../packages/contracts/src/index.ts";
import { CanonicalStore } from "../../packages/storage/src/index.ts";
import { ContinuityService } from "../../packages/workflows/src/index.ts";

const at = "2026-11-07T08:00:00.000Z";
export const pantryOrganizationId = "org_pantry_demo";
export const otherOrganizationId = "org_other_demo";
export const pantryIncidentId = "incident_scheduler_suspicion";

export const pantryActors: Actor[] = [
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "actor_commander",
    kind: "human",
    displayName: "Morgan Commander",
    roles: ["incident_commander"],
    revision: 1,
  },
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "actor_verifier",
    kind: "human",
    displayName: "Riley Verifier",
    roles: ["verifier"],
    revision: 1,
  },
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "actor_volunteer",
    kind: "human",
    displayName: "Casey Volunteer",
    roles: ["task_owner"],
    revision: 1,
  },
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "actor_agent",
    kind: "agent",
    displayName: "Bounded Planner",
    roles: ["proposal_author"],
    revision: 1,
  },
  {
    schemaVersion: 1,
    organizationId: otherOrganizationId,
    id: "actor_other",
    kind: "human",
    displayName: "Other Org User",
    roles: ["incident_commander"],
    revision: 1,
  },
];

export const pantryNodes: GraphNode[] = [
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "scheduler",
    kind: "service",
    name: "Demo scheduler",
    criticality: "high",
    revision: 1,
  },
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "backup_roster",
    kind: "resource",
    name: "Sanitized backup roster",
    criticality: "high",
    revision: 1,
  },
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "phone_tree",
    kind: "procedure",
    name: "Volunteer phone tree",
    criticality: "medium",
    revision: 1,
  },
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "distribution",
    kind: "operation",
    name: "Pantry distribution",
    criticality: "critical",
    revision: 1,
  },
];

export const pantryDependencies: DependencyGroup[] = [
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "distribution_schedule_source",
    dependentNodeId: "distribution",
    mode: "ANY",
    requirements: [
      { nodeId: "scheduler", optional: false },
      { nodeId: "backup_roster", optional: false },
    ],
    revision: 1,
  },
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    id: "distribution_communications",
    dependentNodeId: "distribution",
    mode: "ALL",
    requirements: [{ nodeId: "phone_tree", optional: true }],
    revision: 1,
  },
];

export const pantryIncident: Incident = {
  schemaVersion: 1,
  organizationId: pantryOrganizationId,
  id: pantryIncidentId,
  title: "Injected suspicious scheduler observation",
  status: "open",
  affectedNodeIds: ["scheduler"],
  evidenceIds: [],
  commanderActorId: "actor_commander",
  revision: 1,
  createdAt: at,
  updatedAt: at,
};

export const pantryFallback: FallbackPlan = {
  schemaVersion: 1,
  organizationId: pantryOrganizationId,
  incidentId: pantryIncidentId,
  id: "fallback_backup_roster",
  name: "Backup roster and phone check-in",
  fallbackNodeId: "backup_roster",
  prerequisiteTaskIds: ["task_roster", "task_checkin"],
  status: "draft",
  revision: 1,
};

export const pantryTasks: ResponseTask[] = [
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    incidentId: pantryIncidentId,
    id: "task_roster",
    fallbackPlanId: pantryFallback.id,
    title: "Verify sanitized backup roster is available",
    ownerActorId: "actor_volunteer",
    prerequisiteTaskIds: [],
    acceptanceEvidenceIds: [],
    state: "pending",
    revision: 1,
    createdAt: at,
    updatedAt: at,
  },
  {
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    incidentId: pantryIncidentId,
    id: "task_checkin",
    fallbackPlanId: pantryFallback.id,
    title: "Verify volunteer check-in procedure",
    ownerActorId: "actor_volunteer",
    prerequisiteTaskIds: [],
    acceptanceEvidenceIds: [],
    state: "pending",
    revision: 1,
    createdAt: at,
    updatedAt: at,
  },
];

export function trustedEvidence(
  id: string,
  kind: Evidence["kind"],
  subjectNodeId: string,
  fact: string,
  executionId?: string,
): Evidence {
  return EvidenceSchema.parse({
    schemaVersion: 1,
    organizationId: pantryOrganizationId,
    incidentId: pantryIncidentId,
    id,
    subjectNodeId,
    source: "fictional independent demo verifier",
    kind,
    fact,
    observedAt: at,
    receivedAt: at,
    verification: kind === "observation" ? "unverified" : "verified",
    securityTrust: kind === "observation" ? "unknown" : "trusted",
    freshness: "fresh",
    revision: 1,
    ...(executionId ? { executionId } : {}),
  });
}

export function seedPantryScenario(
  store: CanonicalStore,
  clock: () => Date = () => new Date(at),
): ContinuityService {
  const service = new ContinuityService(store, clock);
  for (const actor of pantryActors) {
    const existing = store.list(actor.organizationId, null, "actor");
    service.provisionActor(
      actor,
      existing.length === 0 ? undefined : existing[0]!.value.id,
    );
  }
  for (const node of pantryNodes) service.registerNode(node, "actor_commander");
  for (const dependency of pantryDependencies)
    service.registerDependencyGroup(dependency, "actor_commander");
  service.openIncident(pantryIncident, "actor_commander");
  service.createFallback(pantryFallback, "actor_commander");
  for (const task of pantryTasks) service.createTask(task, "actor_commander");
  return service;
}
