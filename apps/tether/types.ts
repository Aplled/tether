export type MemberId = string;
export type NodeId = string;
export type IncidentId = string;

export type Availability =
  "available" | "focused" | "meeting" | "away" | "off_hours" | "on_call";

export type WorkInterval = {
  weekday: number;
  start: string;
  end: string;
};

export type Member = {
  id: MemberId;
  name: string;
  email: string;
  departmentId: string;
  team: string;
  jobFamily: string;
  level: string;
  title: string;
  roleTemplate:
    | "senior_manager"
    | "engineer"
    | "data_science_manager"
    | "marketing"
    | "member";
  managerId?: MemberId;
  active: boolean;
  loginProvisioned: boolean;
  timezone: string;
  workingHours: WorkInterval[];
  availability: Availability;
  availabilityUntil?: string;
  leave?: { startsAt: string; endsAt: string; reason: string };
  notifications: {
    routineInHours: boolean;
    afterHours: boolean;
    channels: Array<"in_app" | "email">;
    severities: Array<"low" | "medium" | "high" | "critical">;
  };
  onCallWindows: Array<{ startsAt: string; endsAt: string; accepted: boolean }>;
  revision: number;
};

export type CompanyNodeKind =
  | "service"
  | "component"
  | "workflow"
  | "dataset"
  | "resource"
  | "team"
  | "person";

export type CompanyNode = {
  id: NodeId;
  name: string;
  kind: CompanyNodeKind;
  description: string;
  regionId: string;
  ownerId?: MemberId;
  criticality: "low" | "medium" | "high" | "critical";
  status: "healthy" | "degraded" | "unknown";
  x: number;
  y: number;
  semanticRevision: number;
  layoutRevision: number;
};

export type CompanyEdge = {
  id: string;
  sourceId: NodeId;
  targetId: NodeId;
  kind:
    | "depends_on"
    | "authorizes"
    | "feeds"
    | "stores_in"
    | "operated_by"
    | "delivers_to";
  label: string;
  optional: boolean;
  revision: number;
};

export type RepositoryReference = {
  id: string;
  nodeId: NodeId;
  repository: "local:hackutd";
  revision: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
  revisionNumber: number;
};

export type Region = { id: string; name: string; nodeIds: NodeId[] };

export type Incident = {
  id: IncidentId;
  title: string;
  observation: string;
  priority?: "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged" | "investigating" | "verified" | "resolved";
  regionId: string;
  nodeIds: NodeId[];
  memberIds: MemberId[];
  commanderId: MemberId;
  evidenceRevision: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type IncidentTask = {
  id: string;
  incidentId: IncidentId;
  title: string;
  ownerId: MemberId;
  nodeIds: NodeId[];
  status: "assigned" | "acknowledged" | "investigating" | "blocked" | "done";
  revision: number;
};

export type Message = {
  id: string;
  incidentId: IncidentId;
  nodeId?: NodeId;
  taskId?: string;
  authorId: MemberId;
  text: string;
  sequence: number;
  idempotencyKey: string;
  createdAt: string;
};

export type Notification = {
  id: string;
  memberId: MemberId;
  incidentId?: IncidentId;
  kind: "assignment" | "mention" | "escalation" | "minimal_notice";
  text: string;
  read: boolean;
  createdAt: string;
};

export type ResourceGrant = {
  id: string;
  memberId: MemberId;
  resourceType: "organization" | "region" | "node" | "repository" | "incident";
  resourceId: string;
  // Explicit incident sharing is effective only inside current incident membership and scope.
  incidentId?: IncidentId;
  capabilities: string[];
  revision: number;
};
export type Delegation = {
  id: string;
  fromId: MemberId;
  toId: MemberId;
  startsAt: string;
  endsAt: string;
  capabilities: string[];
  resourceIds: string[];
  revision: number;
};

export type Workspace = {
  id: string;
  name: string;
  nodeIds: NodeId[];
  memberIds: MemberId[];
  createdBy: MemberId;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type ConversationMessage = {
  id: string;
  scope: "company" | "workspace";
  workspaceId?: string;
  authorId: MemberId;
  text: string;
  sequence: number;
  createdAt: string;
};

export type CompanyState = {
  organization: {
    id: "northstar";
    name: "Northstar Compute";
    semanticRevision: number;
  };
  departments: Array<{ id: string; name: string }>;
  members: Member[];
  nodes: CompanyNode[];
  edges: CompanyEdge[];
  regions: Region[];
  repositories: RepositoryReference[];
  incidents: Incident[];
  workspaces: Workspace[];
  conversations: ConversationMessage[];
  tasks: IncidentTask[];
  messages: Message[];
  notifications: Notification[];
  grants: ResourceGrant[];
  delegations: Delegation[];
  eventCursor: number;
};

export type CompanyEvent = {
  cursor: number;
  kind: string;
  resourceType: string;
  resourceId: string;
  memberIds: MemberId[];
  createdAt: string;
};
