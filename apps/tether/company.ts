import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  evaluateGraph,
  type GraphEvaluation,
} from "../../packages/graph-core/src/index.ts";
import type {
  DependencyGroup,
  GraphNode,
} from "../../packages/contracts/src/index.ts";
import {
  departments,
  seedEdges,
  seedGrants,
  seedMembers,
  seedNodes,
  seedRepositories,
} from "./seed.ts";
import type {
  CompanyEdge,
  CompanyEvent,
  CompanyNode,
  CompanyState,
  Delegation,
  Incident,
  IncidentTask,
  Member,
  Message,
  Notification,
  RepositoryReference,
  ResourceGrant,
} from "./types.ts";
import type {
  Capability,
  MembershipSnapshot,
  ResourceGrant as PermissionGrant,
  ResourceKind,
  TetherRole,
} from "./permissions.ts";

export class CompanyError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type RecordKind =
  | "member"
  | "node"
  | "edge"
  | "repository"
  | "incident"
  | "task"
  | "message"
  | "notification"
  | "grant"
  | "delegation";

function now(): string {
  return new Date().toISOString();
}
function clean(value: unknown, name: string, max = 500): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new CompanyError("invalid_input", `${name} is invalid`);
  return value.trim();
}
function parse<T>(text: string): T {
  return JSON.parse(text) as T;
}

export class TetherCompanyStore {
  readonly #db: DatabaseSync;
  readonly #listeners = new Set<(event: CompanyEvent) => void>();

  constructor(path = ":memory:") {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#db = new DatabaseSync(path);
    this.#db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL",
    );
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS tether_records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS tether_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tether_events(cursor INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,resource_type TEXT NOT NULL,resource_id TEXT NOT NULL,member_ids TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS message_dedup(incident_id TEXT NOT NULL,author_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(incident_id,author_id,idempotency_key));
      CREATE TABLE IF NOT EXISTS incident_dedup(creator_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,incident_id TEXT NOT NULL,PRIMARY KEY(creator_id,idempotency_key));
      CREATE INDEX IF NOT EXISTS tether_events_resource_idx ON tether_events(resource_type,resource_id,cursor);
    `);
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO tether_meta(key,value) VALUES('semantic_revision',1)",
      )
      .run();
    if (
      (
        this.#db
          .prepare("SELECT COUNT(*) AS count FROM tether_records")
          .get() as { count: number }
      ).count === 0
    )
      this.#seed();
    this.#migrateMemberRoles();
    this.#migrateSeedRepositories();
  }

  close(): void {
    this.#db.close();
  }
  subscribe(listener: (event: CompanyEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  eventsAfter(cursor: number, limit = 200): CompanyEvent[] {
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new CompanyError(
        "invalid_cursor",
        "cursor must be a nonnegative integer",
      );
    return (
      this.#db
        .prepare(
          "SELECT cursor,kind,resource_type,resource_id,member_ids,created_at FROM tether_events WHERE cursor>? ORDER BY cursor LIMIT ?",
        )
        .all(cursor, Math.min(Math.max(limit, 1), 200)) as Array<
        Record<string, unknown>
      >
    ).map((r) => ({
      cursor: Number(r.cursor),
      kind: String(r.kind),
      resourceType: String(r.resource_type),
      resourceId: String(r.resource_id),
      memberIds: parse<string[]>(String(r.member_ids)),
      createdAt: String(r.created_at),
    }));
  }
  recipientCursor(memberId: string): number {
    return (
      this.#db
        .prepare("SELECT member_ids FROM tether_events ORDER BY cursor")
        .all() as Array<{ member_ids: string }>
    ).reduce(
      (count, row) =>
        parse<string[]>(row.member_ids).includes(memberId) ? count + 1 : count,
      0,
    );
  }

  #seed(): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const member of seedMembers())
        this.#put("member", member.id, member, member.revision);
      for (const node of seedNodes())
        this.#put("node", node.id, node, node.semanticRevision);
      for (const edge of seedEdges())
        this.#put("edge", edge.id, edge, edge.revision);
      for (const repository of seedRepositories)
        this.#put(
          "repository",
          repository.id,
          repository,
          repository.revisionNumber,
        );
      for (const grant of seedGrants)
        this.#put("grant", grant.id, grant, grant.revision);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  #migrateMemberRoles(): void {
    for (const member of this.#list<Member>("member")) {
      if (member.roleTemplate) continue;
      const roleTemplate: Member["roleTemplate"] =
        member.id === "employee-ava"
          ? "senior_manager"
          : member.id === "employee-noah"
            ? "engineer"
            : member.id === "employee-priya"
              ? "data_science_manager"
              : member.id === "employee-elena"
                ? "marketing"
                : "member";
      this.#put(
        "member",
        member.id,
        { ...member, roleTemplate },
        member.revision,
      );
    }
  }
  #migrateSeedRepositories(): void {
    for (const repository of seedRepositories)
      if (
        !this.#get("repository", repository.id) &&
        this.#get("node", repository.nodeId)
      )
        this.#put(
          "repository",
          repository.id,
          repository,
          repository.revisionNumber,
        );
  }

  #put(kind: RecordKind, id: string, value: unknown, revision: number): void {
    this.#db
      .prepare(
        "INSERT INTO tether_records(kind,id,json,revision) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json,revision=excluded.revision",
      )
      .run(kind, id, JSON.stringify(value), revision);
  }
  #get<T>(kind: RecordKind, id: string): T | undefined {
    const row = this.#db
      .prepare("SELECT json FROM tether_records WHERE kind=? AND id=?")
      .get(kind, id) as { json: string } | undefined;
    return row ? parse<T>(row.json) : undefined;
  }
  #list<T>(kind: RecordKind): T[] {
    return (
      this.#db
        .prepare("SELECT json FROM tether_records WHERE kind=? ORDER BY id")
        .all(kind) as Array<{ json: string }>
    ).map((r) => parse<T>(r.json));
  }
  #semanticRevision(): number {
    return Number(
      (
        this.#db
          .prepare(
            "SELECT value FROM tether_meta WHERE key='semantic_revision'",
          )
          .get() as { value: number }
      ).value,
    );
  }
  #bumpSemantic(): number {
    this.#db
      .prepare(
        "UPDATE tether_meta SET value=value+1 WHERE key='semantic_revision'",
      )
      .run();
    return this.#semanticRevision();
  }
  #emit(
    kind: string,
    resourceType: string,
    resourceId: string,
    memberIds: string[],
  ): CompanyEvent {
    const createdAt = now();
    const result = this.#db
      .prepare(
        "INSERT INTO tether_events(kind,resource_type,resource_id,member_ids,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        kind,
        resourceType,
        resourceId,
        JSON.stringify([...new Set(memberIds)]),
        createdAt,
      );
    const event = {
      cursor: Number(result.lastInsertRowid),
      kind,
      resourceType,
      resourceId,
      memberIds: [...new Set(memberIds)],
      createdAt,
    };
    queueMicrotask(() => {
      for (const listener of this.#listeners) listener(event);
    });
    return event;
  }
  #transaction<T>(action: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const value = action();
      this.#db.exec("COMMIT");
      return value;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  member(id: string): Member | undefined {
    return this.#get<Member>("member", id);
  }
  grantsFor(id: string): ResourceGrant[] {
    return this.#list<ResourceGrant>("grant").filter((g) => g.memberId === id);
  }
  membershipSnapshot(id: string): MembershipSnapshot | undefined {
    const member = this.member(id);
    if (!member) return undefined;
    const role: TetherRole = member.roleTemplate;
    return {
      employeeId: member.id,
      organizationId: "northstar",
      role,
      active: member.active,
      policyRevision: member.revision,
      departmentId: member.departmentId,
      titleTemplateId: `${member.jobFamily}:${member.level}`,
    };
  }
  permissionGrants(
    id: string,
    resource?: { kind: ResourceKind; id: string },
    capability?: Capability,
  ): PermissionGrant[] {
    const membership = this.membershipSnapshot(id);
    if (!membership) return [];
    const stored = this.grantsFor(id),
      organizationAdmin = stored.some(
        (grant) =>
          grant.resourceType === "organization" &&
          grant.resourceId === "northstar" &&
          grant.capabilities.includes("admin"),
      ),
      jobPlatform = stored.some(
        (grant) =>
          grant.resourceType === "region" &&
          grant.resourceId === "job-platform" &&
          grant.capabilities.includes("graph:read"),
      ),
      training = stored.some(
        (grant) =>
          grant.resourceType === "region" &&
          grant.resourceId === "training" &&
          grant.capabilities.includes("graph:read"),
      ),
      marketing = stored.some(
        (grant) =>
          grant.resourceType === "region" &&
          grant.resourceId === "marketing" &&
          grant.capabilities.includes("graph:read"),
      );
    const resources: Array<{
      kind: ResourceKind;
      id: string;
      capabilities: Capability[];
    }> = [];
    if (membership.role === "senior_manager" && organizationAdmin)
      resources.push({
        kind: "organization",
        id: "northstar",
        capabilities: [
          "organization:admin",
          "directory:read",
          "directory:write",
          "graph:read",
          "graph:write",
          "incident:create",
          "incident:read",
          "incident:participate",
          "incident:assign",
          "repository:read",
          "task:read",
          "task:write",
          "notice:read",
        ],
      });
    const nodeAccess = (node: CompanyNode) =>
      organizationAdmin ||
      (node.ownerId === id && (jobPlatform || training)) ||
      (jobPlatform &&
        [
          "job-api",
          "tenant-auth",
          "retry-route",
          "retry-queue",
          "scheduler",
        ].includes(node.id)) ||
      (training &&
        [
          "dataset-upload",
          "dataset-validation",
          "training-catalog",
          "training-dispatch",
          "scheduler",
          "dfw-worker-pool",
          "queue-priority",
        ].includes(node.id)) ||
      (marketing && node.id === "status-page");
    for (const node of this.#list<CompanyNode>("node"))
      if (nodeAccess(node))
        resources.push({
          kind: "node",
          id: node.id,
          capabilities: [
            "graph:read",
            ...((organizationAdmin || node.ownerId === id) &&
            (jobPlatform || training || organizationAdmin)
              ? ["graph:write" as Capability]
              : []),
          ],
        });
    for (const repo of this.#list<RepositoryReference>("repository")) {
      const node = this.#get<CompanyNode>("node", repo.nodeId);
      if (
        node &&
        nodeAccess(node) &&
        (organizationAdmin || node.ownerId === id)
      )
        resources.push({
          kind: "repository",
          id: repo.id,
          capabilities: ["repository:read"],
        });
    }
    for (const incident of this.#list<Incident>("incident"))
      if (incident.memberIds.includes(id)) {
        resources.push({
          kind: "incident",
          id: incident.id,
          capabilities: [
            "incident:read",
            "incident:participate",
            ...(incident.commanderId === id
              ? [
                  "incident:assign" as Capability,
                  "incident:approve" as Capability,
                ]
              : []),
          ],
        });
        resources.push({
          kind: "workspace",
          id: incident.id,
          capabilities: ["incident:read", "incident:participate"],
        });
      }
    for (const task of this.#list<IncidentTask>("task")) {
      const incident = this.#get<Incident>("incident", task.incidentId);
      if (incident?.memberIds.includes(id))
        resources.push({
          kind: "task",
          id: task.id,
          capabilities: [
            "task:read",
            ...(task.ownerId === id || incident.commanderId === id
              ? ["task:write" as Capability]
              : []),
          ],
        });
    }
    for (const notice of this.#list<Notification>("notification"))
      if (notice.memberId === id && notice.kind === "minimal_notice")
        resources.push({
          kind: "notice",
          id: notice.id,
          capabilities: ["notice:read"],
        });
    return resources
      .filter(
        (entry) =>
          (!resource ||
            (entry.kind === resource.kind && entry.id === resource.id)) &&
          (!capability || entry.capabilities.includes(capability)),
      )
      .map((entry, index) => ({
        id: `effective-${id}-${entry.kind}-${entry.id}-${index}`,
        organizationId: "northstar",
        employeeId: id,
        resourceKind: entry.kind,
        resourceId: entry.id,
        capabilities: entry.capabilities,
        policyRevision: membership.policyRevision,
      }));
  }
  allState(): CompanyState {
    const nodes = this.#list<CompanyNode>("node");
    const cursor = Number(
      (
        this.#db
          .prepare(
            "SELECT COALESCE(MAX(cursor),0) AS cursor FROM tether_events",
          )
          .get() as { cursor: number }
      ).cursor,
    );
    return {
      organization: {
        id: "northstar",
        name: "Northstar Compute",
        semanticRevision: this.#semanticRevision(),
      },
      departments: departments.map(([id, name]) => ({ id, name })),
      members: this.#list("member"),
      nodes,
      edges: this.#list("edge"),
      regions: [
        {
          id: "global",
          name: "Global",
          nodeIds: nodes
            .filter((n) => n.regionId === "global")
            .map((n) => n.id),
        },
        {
          id: "dfw",
          name: "Dallas–Fort Worth",
          nodeIds: nodes.filter((n) => n.regionId === "dfw").map((n) => n.id),
        },
        {
          id: "iad",
          name: "Northern Virginia",
          nodeIds: nodes.filter((n) => n.regionId === "iad").map((n) => n.id),
        },
      ],
      repositories: this.#list("repository"),
      incidents: this.#list("incident"),
      tasks: this.#list("task"),
      messages: this.#list<Message>("message").sort(
        (a, b) => a.sequence - b.sequence,
      ),
      notifications: this.#list("notification"),
      grants: this.#list("grant"),
      delegations: this.#list("delegation"),
      eventCursor: cursor,
    };
  }

  addMember(input: Omit<Member, "revision">): Member {
    if (this.#get("member", input.id))
      throw new CompanyError("duplicate", "member already exists", 409);
    const member = {
      ...input,
      id: clean(input.id, "id", 100),
      name: clean(input.name, "name", 120),
      email: clean(input.email, "email", 200),
      loginProvisioned: false,
      revision: 1,
    };
    this.#transaction(() => {
      this.#put("member", member.id, member, 1);
      this.#emit("member.created", "member", member.id, ["employee-ava"]);
    });
    return member;
  }
  updateMember(
    id: string,
    expectedRevision: number,
    patch: Partial<
      Pick<
        Member,
        | "name"
        | "departmentId"
        | "team"
        | "jobFamily"
        | "level"
        | "title"
        | "roleTemplate"
        | "managerId"
        | "active"
        | "timezone"
        | "workingHours"
        | "availability"
        | "availabilityUntil"
        | "leave"
        | "notifications"
        | "onCallWindows"
      >
    >,
  ): Member {
    const current = this.#get<Member>("member", id);
    if (!current) throw new CompanyError("not_found", "member not found", 404);
    if (current.revision !== expectedRevision)
      throw new CompanyError(
        "revision_conflict",
        "member changed since it was loaded",
        409,
      );
    if (patch.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: patch.timezone }).format();
      } catch {
        throw new CompanyError(
          "invalid_timezone",
          "timezone must be an IANA timezone",
        );
      }
    }
    if (
      patch.roleTemplate &&
      ![
        "senior_manager",
        "engineer",
        "data_science_manager",
        "marketing",
        "member",
      ].includes(patch.roleTemplate)
    )
      throw new CompanyError(
        "invalid_role_template",
        "role template is invalid",
      );
    if (
      patch.workingHours &&
      (patch.workingHours.length > 14 ||
        patch.workingHours.some(
          (item) =>
            !Number.isInteger(item.weekday) ||
            item.weekday < 0 ||
            item.weekday > 6 ||
            !/^\d{2}:\d{2}$/.test(item.start) ||
            !/^\d{2}:\d{2}$/.test(item.end),
        ))
    )
      throw new CompanyError("invalid_hours", "working hours are invalid");
    const updated = {
      ...current,
      ...patch,
      id,
      email: current.email,
      loginProvisioned: current.loginProvisioned,
      revision: current.revision + 1,
    };
    this.#transaction(() => {
      this.#put("member", id, updated, updated.revision);
      this.#emit("member.updated", "member", id, [id, "employee-ava"]);
    });
    return updated;
  }

  createNode(
    input: Omit<CompanyNode, "semanticRevision" | "layoutRevision">,
  ): CompanyNode {
    const id = clean(input.id, "id", 100);
    if (this.#get("node", id))
      throw new CompanyError("duplicate", "node already exists", 409);
    if (
      ![
        "service",
        "component",
        "workflow",
        "dataset",
        "resource",
        "team",
        "person",
      ].includes(input.kind) ||
      !["low", "medium", "high", "critical"].includes(input.criticality)
    )
      throw new CompanyError(
        "invalid_input",
        "node kind or criticality is invalid",
      );
    const node = {
      ...input,
      id,
      name: clean(input.name, "name", 160),
      description: clean(input.description, "description", 1000),
      semanticRevision: 1,
      layoutRevision: 1,
    };
    this.#transaction(() => {
      this.#put("node", id, node, 1);
      this.#bumpSemantic();
      this.#emit("node.created", "node", id, this.#visibleMembersForNode(node));
    });
    return node;
  }
  updateNode(
    id: string,
    expectedSemanticRevision: number,
    patch: Partial<
      Omit<
        CompanyNode,
        "id" | "x" | "y" | "semanticRevision" | "layoutRevision"
      >
    >,
  ): CompanyNode {
    const current = this.#get<CompanyNode>("node", id);
    if (!current) throw new CompanyError("not_found", "node not found", 404);
    if (current.semanticRevision !== expectedSemanticRevision)
      throw new CompanyError(
        "revision_conflict",
        "node semantics changed since it was loaded",
        409,
      );
    const updated = {
      ...current,
      ...patch,
      id,
      x: current.x,
      y: current.y,
      semanticRevision: current.semanticRevision + 1,
      layoutRevision: current.layoutRevision,
    };
    this.#transaction(() => {
      this.#put("node", id, updated, updated.semanticRevision);
      this.#bumpSemantic();
      this.#emit(
        "node.updated",
        "node",
        id,
        this.#visibleMembersForNode(updated),
      );
    });
    return updated;
  }
  updateNodeLayout(
    id: string,
    expectedLayoutRevision: number,
    x: number,
    y: number,
  ): CompanyNode {
    const current = this.#get<CompanyNode>("node", id);
    if (!current) throw new CompanyError("not_found", "node not found", 404);
    if (current.layoutRevision !== expectedLayoutRevision)
      throw new CompanyError(
        "revision_conflict",
        "node layout changed since it was loaded",
        409,
      );
    if (
      ![x, y].every(Number.isFinite) ||
      Math.abs(x) > 1_000_000 ||
      Math.abs(y) > 1_000_000
    )
      throw new CompanyError("invalid_input", "coordinates are outside bounds");
    const updated = {
      ...current,
      x,
      y,
      layoutRevision: current.layoutRevision + 1,
    };
    this.#transaction(() => {
      this.#put("node", id, updated, updated.semanticRevision);
      this.#emit(
        "node.layout",
        "node",
        id,
        this.#visibleMembersForNode(updated),
      );
    });
    return updated;
  }
  deleteNode(id: string, expectedSemanticRevision: number): void {
    const current = this.#get<CompanyNode>("node", id);
    if (!current) throw new CompanyError("not_found", "node not found", 404);
    if (current.semanticRevision !== expectedSemanticRevision)
      throw new CompanyError(
        "revision_conflict",
        "node semantics changed since it was loaded",
        409,
      );
    if (
      this.#list<CompanyEdge>("edge").some(
        (edge) => edge.sourceId === id || edge.targetId === id,
      )
    )
      throw new CompanyError(
        "node_in_use",
        "remove connected dependency edges before deleting the node",
        409,
      );
    this.#transaction(() => {
      this.#db
        .prepare("DELETE FROM tether_records WHERE kind='node' AND id=?")
        .run(id);
      this.#bumpSemantic();
      this.#emit(
        "node.deleted",
        "node",
        id,
        this.#visibleMembersForNode(current),
      );
    });
  }
  createEdge(input: Omit<CompanyEdge, "revision">): CompanyEdge {
    if (this.#get("edge", input.id))
      throw new CompanyError("duplicate", "edge already exists", 409);
    if (
      !this.#get("node", input.sourceId) ||
      !this.#get("node", input.targetId)
    )
      throw new CompanyError(
        "invalid_reference",
        "edge endpoint does not exist",
      );
    const edge = {
      ...input,
      id: clean(input.id, "id", 140),
      label: clean(input.label, "label", 120),
      revision: 1,
    };
    this.#transaction(() => {
      this.#put("edge", edge.id, edge, 1);
      this.#bumpSemantic();
      this.#emit("edge.created", "edge", edge.id, [
        "employee-ava",
        "employee-noah",
        "employee-priya",
      ]);
    });
    return edge;
  }
  deleteEdge(id: string, expectedRevision: number): void {
    const edge = this.#get<CompanyEdge>("edge", id);
    if (!edge) throw new CompanyError("not_found", "edge not found", 404);
    if (edge.revision !== expectedRevision)
      throw new CompanyError(
        "revision_conflict",
        "edge changed since it was loaded",
        409,
      );
    this.#transaction(() => {
      this.#db
        .prepare("DELETE FROM tether_records WHERE kind='edge' AND id=?")
        .run(id);
      this.#bumpSemantic();
      this.#emit("edge.deleted", "edge", id, [
        "employee-ava",
        "employee-noah",
        "employee-priya",
      ]);
    });
  }

  impact(
    overrides: Record<string, "satisfied" | "unsatisfied" | "unknown"> = {},
  ): GraphEvaluation {
    const state = this.allState();
    return this.#evaluateImpact(state.nodes, state.edges, overrides);
  }
  impactScoped(
    nodeIds: Iterable<string>,
    overrides: Record<string, "satisfied" | "unsatisfied" | "unknown"> = {},
  ): GraphEvaluation {
    const allowed = new Set(nodeIds),
      state = this.allState();
    return this.#evaluateImpact(
      state.nodes.filter((node) => allowed.has(node.id)),
      state.edges.filter(
        (edge) => allowed.has(edge.sourceId) && allowed.has(edge.targetId),
      ),
      Object.fromEntries(
        Object.entries(overrides).filter(([id]) => allowed.has(id)),
      ),
    );
  }
  #evaluateImpact(
    companyNodes: CompanyNode[],
    companyEdges: CompanyEdge[],
    overrides: Record<string, "satisfied" | "unsatisfied" | "unknown">,
  ): GraphEvaluation {
    const nodes: GraphNode[] = companyNodes.map((node) => ({
      schemaVersion: 1,
      organizationId: "northstar",
      id: node.id,
      kind:
        node.kind === "person"
          ? "person"
          : node.kind === "workflow"
            ? "operation"
            : node.kind === "resource" ||
                node.kind === "dataset" ||
                node.kind === "team"
              ? "resource"
              : "service",
      name: node.name,
      criticality: node.criticality,
      revision: node.semanticRevision,
    }));
    const groups: DependencyGroup[] = companyEdges
      .filter(
        (e) =>
          e.kind === "depends_on" ||
          e.kind === "feeds" ||
          e.kind === "stores_in" ||
          e.kind === "authorizes",
      )
      .map((edge) => ({
        schemaVersion: 1,
        organizationId: "northstar",
        id: edge.id,
        dependentNodeId: edge.targetId,
        mode: "ALL",
        requirements: [{ nodeId: edge.sourceId, optional: edge.optional }],
        revision: edge.revision,
      }));
    const baseStates = Object.fromEntries(
      companyNodes
        .filter(
          (node) =>
            Object.hasOwn(overrides, node.id) ||
            !companyEdges.some((edge) => edge.targetId === node.id),
        )
        .map((node) => [
          node.id,
          {
            availability:
              overrides[node.id] ??
              (node.status === "healthy"
                ? "satisfied"
                : node.status === "degraded"
                  ? "unsatisfied"
                  : "unknown"),
            securityTrust: "trusted" as const,
            freshness: "fresh" as const,
            reason: Object.hasOwn(overrides, node.id)
              ? "incident observation"
              : "observed healthy",
          },
        ]),
    );
    return evaluateGraph({
      organizationId: "northstar",
      nodes,
      dependencyGroups: groups,
      baseStates,
    });
  }

  createIncident(input: {
    title: string;
    observation: string;
    regionId: string;
    nodeIds: string[];
    memberIds: string[];
    commanderId: string;
    idempotencyKey?: string;
  }): Incident {
    if (input.idempotencyKey) {
      const prior = this.#db
        .prepare(
          "SELECT incident_id FROM incident_dedup WHERE creator_id=? AND idempotency_key=?",
        )
        .get(input.commanderId, input.idempotencyKey) as
        { incident_id: string } | undefined;
      if (prior) return this.#get<Incident>("incident", prior.incident_id)!;
    }
    const uniqueNodes = [...new Set(input.nodeIds)];
    if (
      !uniqueNodes.length ||
      uniqueNodes.length > 50 ||
      uniqueNodes.some((id) => !this.#get("node", id))
    )
      throw new CompanyError("invalid_scope", "incident nodes are invalid");
    const uniqueMembers = [...new Set([input.commanderId, ...input.memberIds])];
    if (uniqueMembers.some((id) => !this.#get<Member>("member", id)?.active))
      throw new CompanyError("invalid_scope", "incident member is invalid");
    const timestamp = now();
    const incident: Incident = {
      id: `incident-${randomUUID()}`,
      title: clean(input.title, "title", 180),
      observation: clean(input.observation, "observation", 2000),
      status: "open",
      regionId: input.regionId,
      nodeIds: uniqueNodes,
      memberIds: uniqueMembers,
      commanderId: input.commanderId,
      evidenceRevision: 1,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#transaction(() => {
      this.#put("incident", incident.id, incident, 1);
      if (input.idempotencyKey)
        this.#db
          .prepare("INSERT INTO incident_dedup VALUES(?,?,?)")
          .run(input.commanderId, input.idempotencyKey, incident.id);
      this.#emit("incident.created", "incident", incident.id, uniqueMembers);
      this.#minimalNotice(incident);
    });
    return incident;
  }
  updateIncident(
    id: string,
    expectedRevision: number,
    patch: Partial<
      Pick<
        Incident,
        | "title"
        | "observation"
        | "status"
        | "memberIds"
        | "commanderId"
        | "nodeIds"
      >
    >,
  ): Incident {
    const current = this.#get<Incident>("incident", id);
    if (!current)
      throw new CompanyError("not_found", "incident not found", 404);
    if (current.revision !== expectedRevision)
      throw new CompanyError(
        "revision_conflict",
        "incident changed since it was loaded",
        409,
      );
    const memberIds = patch.memberIds
        ? [...new Set(patch.memberIds)]
        : current.memberIds,
      nodeIds = patch.nodeIds ? [...new Set(patch.nodeIds)] : current.nodeIds;
    if (
      !memberIds.includes(patch.commanderId ?? current.commanderId) ||
      memberIds.some((memberId) => !this.member(memberId)?.active) ||
      nodeIds.some((nodeId) => !this.#get("node", nodeId))
    )
      throw new CompanyError(
        "invalid_scope",
        "incident workspace scope is invalid",
      );
    const updated = {
      ...current,
      ...patch,
      memberIds,
      nodeIds,
      revision: current.revision + 1,
      evidenceRevision:
        patch.observation && patch.observation !== current.observation
          ? current.evidenceRevision + 1
          : current.evidenceRevision,
      updatedAt: now(),
    };
    this.#transaction(() => {
      this.#put("incident", id, updated, updated.revision);
      this.#bumpSemantic();
      this.#emit("incident.updated", "incident", id, [
        ...new Set([...current.memberIds, ...memberIds]),
      ]);
    });
    return updated;
  }
  resolveIncident(
    id: string,
    expectedRevision: number,
    evidence: string,
  ): Incident {
    const current = this.#get<Incident>("incident", id);
    if (!current)
      throw new CompanyError("not_found", "incident not found", 404);
    if (current.revision !== expectedRevision)
      throw new CompanyError(
        "revision_conflict",
        "incident changed since verification",
        409,
      );
    if (current.status === "resolved") return current;
    const observation = `${current.observation}\n\nResolution evidence: ${clean(evidence, "evidence", 500)}`,
      updated = {
        ...current,
        status: "resolved" as const,
        observation,
        evidenceRevision: current.evidenceRevision + 1,
        revision: current.revision + 1,
        updatedAt: now(),
      };
    this.#transaction(() => {
      this.#put("incident", id, updated, updated.revision);
      this.#bumpSemantic();
      this.#notification(
        "employee-elena",
        id,
        "minimal_notice",
        "The compute scheduling incident is resolved. Normal collaboration can resume.",
      );
      this.#emit("incident.resolved", "incident", id, [
        ...new Set([...current.memberIds, "employee-elena"]),
      ]);
    });
    return updated;
  }
  createTask(
    input: Omit<IncidentTask, "id" | "revision" | "status">,
  ): IncidentTask {
    const incident = this.#get<Incident>("incident", input.incidentId);
    if (!incident || !incident.memberIds.includes(input.ownerId))
      throw new CompanyError(
        "invalid_scope",
        "task owner is not an incident member",
      );
    const task: IncidentTask = {
      ...input,
      id: `task-${randomUUID()}`,
      title: clean(input.title, "title", 300),
      status: "assigned",
      revision: 1,
    };
    this.#transaction(() => {
      this.#put("task", task.id, task, 1);
      this.#notification(
        task.ownerId,
        task.incidentId,
        "assignment",
        `Assigned: ${task.title}`,
      );
      this.#emit("task.created", "task", task.id, incident.memberIds);
    });
    return task;
  }
  updateTask(
    id: string,
    expectedRevision: number,
    change:
      | IncidentTask["status"]
      | Partial<Pick<IncidentTask, "status" | "ownerId" | "title">>,
  ): IncidentTask {
    const task = this.#get<IncidentTask>("task", id);
    if (!task) throw new CompanyError("not_found", "task not found", 404);
    if (task.revision !== expectedRevision)
      throw new CompanyError(
        "revision_conflict",
        "task changed since it was loaded",
        409,
      );
    const patch = typeof change === "string" ? { status: change } : change;
    const incident = this.#get<Incident>("incident", task.incidentId)!;
    if (patch.ownerId && !incident.memberIds.includes(patch.ownerId))
      throw new CompanyError(
        "invalid_scope",
        "task owner is not an incident member",
      );
    const updated = {
      ...task,
      ...patch,
      ...(patch.title ? { title: clean(patch.title, "title", 300) } : {}),
      revision: task.revision + 1,
    };
    this.#transaction(() => {
      this.#put("task", id, updated, updated.revision);
      this.#emit("task.updated", "task", id, incident.memberIds);
    });
    return updated;
  }
  postMessage(input: {
    incidentId: string;
    nodeId?: string;
    taskId?: string;
    authorId: string;
    text: string;
    idempotencyKey: string;
  }): Message {
    const incident = this.#get<Incident>("incident", input.incidentId);
    if (!incident || !incident.memberIds.includes(input.authorId))
      throw new CompanyError("forbidden", "not an incident member", 403);
    if (input.nodeId && !incident.nodeIds.includes(input.nodeId))
      throw new CompanyError("invalid_scope", "node is not in incident scope");
    if (
      input.taskId &&
      this.#get<IncidentTask>("task", input.taskId)?.incidentId !== incident.id
    )
      throw new CompanyError("invalid_scope", "task is not in incident scope");
    const key = clean(input.idempotencyKey, "idempotencyKey", 120);
    const prior = this.#db
      .prepare(
        "SELECT message_id FROM message_dedup WHERE incident_id=? AND author_id=? AND idempotency_key=?",
      )
      .get(input.incidentId, input.authorId, key) as
      { message_id: string } | undefined;
    if (prior) return this.#get<Message>("message", prior.message_id)!;
    const sequence = Number(
      (
        this.#db
          .prepare(
            "SELECT COALESCE(MAX(CAST(json_extract(json,'$.sequence') AS INTEGER)),0)+1 AS sequence FROM tether_records WHERE kind='message' AND json_extract(json,'$.incidentId')=?",
          )
          .get(input.incidentId) as { sequence: number }
      ).sequence,
    );
    const message: Message = {
      id: `message-${randomUUID()}`,
      incidentId: input.incidentId,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      authorId: input.authorId,
      text: clean(input.text, "message", 4000),
      sequence,
      idempotencyKey: key,
      createdAt: now(),
    };
    this.#transaction(() => {
      this.#put("message", message.id, message, sequence);
      this.#db
        .prepare("INSERT INTO message_dedup VALUES(?,?,?,?)")
        .run(input.incidentId, input.authorId, key, message.id);
      this.#emit("message.created", "message", message.id, incident.memberIds);
    });
    return message;
  }

  addRepositoryReference(
    input: Omit<RepositoryReference, "id" | "revisionNumber">,
  ): RepositoryReference {
    if (!this.#get("node", input.nodeId))
      throw new CompanyError("invalid_reference", "node not found");
    if (
      input.repository !== "local:hackutd" ||
      !/^(?:apps|packages|fixtures|integration-tests)\/[A-Za-z0-9._/-]+$/.test(
        input.path,
      ) ||
      input.path.includes("..") ||
      !/^(?:WORKTREE|[a-f0-9]{7,40})$/.test(input.revision)
    )
      throw new CompanyError(
        "invalid_source",
        "source reference is outside the configured repository",
      );
    const ref: RepositoryReference = {
      ...input,
      id: `repo-${randomUUID()}`,
      revisionNumber: 1,
    };
    this.#transaction(() => {
      this.#put("repository", ref.id, ref, 1);
      this.#bumpSemantic();
      this.#emit(
        "repository.created",
        "repository",
        ref.id,
        this.#visibleMembersForNode(
          this.#get<CompanyNode>("node", ref.nodeId)!,
        ),
      );
    });
    return ref;
  }
  readNotification(id: string, memberId: string): Notification {
    const current = this.#get<Notification>("notification", id);
    if (!current || current.memberId !== memberId)
      throw new CompanyError("not_found", "notification not found", 404);
    const updated = { ...current, read: true };
    this.#transaction(() => {
      this.#put("notification", id, updated, 1);
      this.#emit("notification.read", "notification", id, [memberId]);
    });
    return updated;
  }
  saveDelegation(
    input: Omit<Delegation, "revision"> & { revision?: number },
  ): Delegation {
    if (
      !this.member(input.fromId)?.active ||
      !this.member(input.toId)?.active ||
      input.fromId === input.toId ||
      new Date(input.startsAt) >= new Date(input.endsAt) ||
      input.capabilities.some(
        (capability) =>
          capability !== "incident:approve" && capability !== "incident:assign",
      )
    )
      throw new CompanyError("invalid_delegation", "delegation is invalid");
    const existing = this.#get<Delegation>("delegation", input.id),
      delegation = { ...input, revision: (existing?.revision ?? 0) + 1 };
    this.#transaction(() => {
      this.#put("delegation", delegation.id, delegation, delegation.revision);
      this.#bumpSemantic();
      this.#emit("delegation.saved", "delegation", delegation.id, [
        input.fromId,
        input.toId,
        "employee-ava",
      ]);
    });
    return delegation;
  }

  #visibleMembersForNode(node: CompanyNode): string[] {
    if (node.regionId === "dfw")
      return ["employee-ava", "employee-noah", "employee-priya"];
    if (node.ownerId === "employee-elena")
      return ["employee-ava", "employee-elena"];
    return ["employee-ava", "employee-noah", "employee-priya"];
  }
  #notification(
    memberId: string,
    incidentId: string | undefined,
    kind: Notification["kind"],
    text: string,
  ): Notification {
    const notification: Notification = {
      id: `notification-${randomUUID()}`,
      memberId,
      ...(incidentId ? { incidentId } : {}),
      kind,
      text,
      read: false,
      createdAt: now(),
    };
    this.#put("notification", notification.id, notification, 1);
    return notification;
  }
  #minimalNotice(incident: Incident): void {
    const names = incident.memberIds
      .map((id) => this.#get<Member>("member", id)?.name)
      .filter(Boolean);
    this.#notification(
      "employee-elena",
      incident.id,
      "minimal_notice",
      `Engineering is investigating a compute scheduling issue. Please avoid interrupting ${names.join(", ")} while they respond. Updates will appear here.`,
    );
    this.#emit("notice.created", "notification", incident.id, [
      "employee-elena",
    ]);
  }
}
