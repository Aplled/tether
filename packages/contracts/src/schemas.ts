import { z } from "zod";
import { IdSchema } from "./ids.ts";

export const SchemaVersion = z.literal(1);
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
const ScopeSchema = z
  .object({ schemaVersion: SchemaVersion, organizationId: IdSchema })
  .strict();
const IncidentScopeSchema = ScopeSchema.extend({ incidentId: IdSchema });

export const ActorSchema = ScopeSchema.extend({
  id: IdSchema,
  kind: z.enum(["human", "agent", "device", "service"]),
  displayName: z.string().min(1).max(160),
  roles: z.array(z.string().min(1).max(80)).max(32),
  revision: z.number().int().nonnegative(),
}).strict();
export type Actor = z.infer<typeof ActorSchema>;

export const EvidenceSchema = IncidentScopeSchema.extend({
  id: IdSchema,
  subjectNodeId: IdSchema,
  source: z.string().min(1).max(200),
  kind: z.enum([
    "observation",
    "verification",
    "task_acceptance",
    "broker_receipt",
  ]),
  executionId: IdSchema.optional(),
  targetGeneration: IdSchema.optional(),
  verificationFacts: z
    .object({
      result: z.enum(["verified", "failed", "outcome_unknown"]),
      schedulerReachable: z.boolean(),
      controlReachable: z.boolean(),
      brokerProcessState: z.enum(["running", "stopped", "unknown"]),
    })
    .strict()
    .optional(),
  fact: z.string().min(1).max(2_000),
  observedAt: IsoDateTimeSchema,
  receivedAt: IsoDateTimeSchema,
  verification: z.enum(["unverified", "verified", "disputed"]),
  availability: z.enum(["satisfied", "unsatisfied", "unknown"]).optional(),
  securityTrust: z.enum(["trusted", "untrusted", "unknown"]),
  freshness: z.enum(["fresh", "stale", "unknown"]),
  revision: z.number().int().positive(),
}).strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const NodeSchema = ScopeSchema.extend({
  id: IdSchema,
  kind: z.enum(["service", "operation", "procedure", "person", "resource"]),
  name: z.string().min(1).max(200),
  ownerActorId: IdSchema.optional(),
  criticality: z.enum(["low", "medium", "high", "critical"]),
  revision: z.number().int().positive(),
}).strict();
export type GraphNode = z.infer<typeof NodeSchema>;

export const DependencyRequirementSchema = z
  .object({
    nodeId: IdSchema,
    optional: z.boolean().default(false),
  })
  .strict();
export const DependencyGroupSchema = ScopeSchema.extend({
  id: IdSchema,
  dependentNodeId: IdSchema,
  mode: z.enum(["ALL", "ANY"]),
  requirements: z.array(DependencyRequirementSchema).min(1).max(64),
  revision: z.number().int().positive(),
}).strict();
export type DependencyGroup = z.infer<typeof DependencyGroupSchema>;

export const IncidentSchema = ScopeSchema.extend({
  id: IdSchema,
  title: z.string().min(1).max(240),
  status: z.enum([
    "open",
    "contained",
    "running_on_fallback",
    "recovering",
    "closed",
  ]),
  affectedNodeIds: z.array(IdSchema).max(128),
  evidenceIds: z.array(IdSchema).max(512),
  commanderActorId: IdSchema,
  revision: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();
export type Incident = z.infer<typeof IncidentSchema>;

export const ProposalSchema = IncidentScopeSchema.extend({
  id: IdSchema,
  authorActorId: IdSchema,
  snapshotRevision: z.number().int().positive(),
  evidenceIds: z.array(IdSchema).min(1).max(128),
  assumptions: z.array(z.string().max(500)).max(32),
  actionType: z.literal("stop_demo_scheduler"),
  targetId: z.literal("pantry-demo-scheduler"),
  parameters: z.object({}).strict(),
  expectedOperationalEffects: z
    .array(z.string().min(1).max(500))
    .min(1)
    .max(32),
  fallbackPlanId: IdSchema,
  verificationPlanId: IdSchema,
  status: z.enum(["proposed", "approved", "rejected", "expired"]),
  expiresAt: IsoDateTimeSchema,
  revision: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
}).strict();
export type Proposal = z.infer<typeof ProposalSchema>;

export const TaskStateSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "verified",
]);
export const ResponseTaskSchema = IncidentScopeSchema.extend({
  id: IdSchema,
  fallbackPlanId: IdSchema,
  title: z.string().min(1).max(240),
  ownerActorId: IdSchema,
  prerequisiteTaskIds: z.array(IdSchema).max(32),
  acceptanceEvidenceIds: z.array(IdSchema).max(64),
  state: TaskStateSchema,
  revision: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();
export type ResponseTask = z.infer<typeof ResponseTaskSchema>;

export const FallbackPlanSchema = IncidentScopeSchema.extend({
  id: IdSchema,
  name: z.string().min(1).max(240),
  fallbackNodeId: IdSchema,
  prerequisiteTaskIds: z.array(IdSchema).min(1).max(32),
  containmentVerificationEvidenceId: IdSchema.optional(),
  approvedAt: IsoDateTimeSchema.optional(),
  status: z.enum(["draft", "approved", "active", "verified"]),
  revision: z.number().int().positive(),
}).strict();
export type FallbackPlan = z.infer<typeof FallbackPlanSchema>;

export const DomainEventSchema = IncidentScopeSchema.extend({
  id: IdSchema,
  aggregateType: z.enum([
    "actor",
    "node",
    "dependency_group",
    "incident",
    "proposal",
    "task",
    "fallback",
    "evidence",
  ]),
  aggregateId: IdSchema,
  aggregateRevision: z.number().int().positive(),
  eventType: z.string().min(1).max(120),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: IsoDateTimeSchema,
}).strict();
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const OutboxEntrySchema = z
  .object({
    event: DomainEventSchema,
    deliveredAt: IsoDateTimeSchema.nullable(),
    attempts: z.number().int().nonnegative(),
  })
  .strict();
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>;

export type DependencyState = "satisfied" | "unsatisfied" | "unknown";
export type TrustState = "trusted" | "untrusted" | "unknown";
export type FreshnessState = "fresh" | "stale" | "unknown";

export type NodeEvaluation = {
  nodeId: string;
  availability: DependencyState;
  securityTrust: TrustState;
  freshness: FreshnessState;
  degraded: boolean;
  reasons: string[];
  paths: string[][];
};

export const StoredRecordSchema = z.discriminatedUnion("recordType", [
  z.object({ recordType: z.literal("actor"), value: ActorSchema }),
  z.object({ recordType: z.literal("node"), value: NodeSchema }),
  z.object({
    recordType: z.literal("dependency_group"),
    value: DependencyGroupSchema,
  }),
  z.object({ recordType: z.literal("incident"), value: IncidentSchema }),
  z.object({ recordType: z.literal("proposal"), value: ProposalSchema }),
  z.object({ recordType: z.literal("task"), value: ResponseTaskSchema }),
  z.object({ recordType: z.literal("fallback"), value: FallbackPlanSchema }),
  z.object({ recordType: z.literal("evidence"), value: EvidenceSchema }),
]);
export type StoredRecord = z.infer<typeof StoredRecordSchema>;
export type StoredRecordType = StoredRecord["recordType"];
