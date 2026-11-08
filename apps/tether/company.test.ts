import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompanyError, TetherCompanyStore } from "./company.ts";

test("seeds a durable 100-person canonical company graph with isolated revisions", () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "tether-company-")),
    "company.sqlite",
  );
  const first = new TetherCompanyStore(path);
  const state = first.allState();
  assert.equal(state.members.length, 100);
  assert.ok(state.nodes.length >= 30 && state.nodes.length <= 50);
  assert.equal(state.organization.semanticRevision, 1);
  const moved = first.updateNodeLayout("job-api", 1, 711, 412);
  assert.equal(moved.layoutRevision, 2);
  assert.equal(first.allState().organization.semanticRevision, 1);
  const edited = first.updateNode("job-api", 1, {
    description: "Accepts bounded customer GPU workload requests",
  });
  assert.equal(edited.semanticRevision, 2);
  assert.equal(first.allState().organization.semanticRevision, 2);
  first.close();
  const restarted = new TetherCompanyStore(path);
  assert.equal(
    restarted.allState().nodes.find((n) => n.id === "job-api")?.x,
    711,
  );
  assert.equal(restarted.allState().members.length, 100);
  restarted.close();
});

test("canonical graph edits and internal observations drive deterministic impact", () => {
  const store = new TetherCompanyStore();
  const baseline = store.impact();
  assert.equal(
    baseline.evaluations["customer-dashboard"]?.availability,
    "satisfied",
  );
  assert.equal(
    store.impact({ "retry-route": "unsatisfied" }).evaluations[
      "customer-dashboard"
    ]?.availability,
    "unsatisfied",
  );
  store.createNode({
    id: "manual-release-gate",
    name: "Manual Release Gate",
    kind: "component",
    description: "Approval gate",
    regionId: "global",
    criticality: "high",
    status: "healthy",
    x: 1,
    y: 1,
  });
  store.createEdge({
    id: "edge-manual-dashboard",
    sourceId: "manual-release-gate",
    targetId: "customer-dashboard",
    kind: "depends_on",
    label: "requires release",
    optional: false,
  });
  assert.equal(
    store.impact({ "manual-release-gate": "unsatisfied" }).evaluations[
      "customer-dashboard"
    ]?.availability,
    "unsatisfied",
  );
  store.close();
});

test("scoped impact is induced before evaluation and cannot reveal hidden dependencies", () => {
  const store = new TetherCompanyStore();
  store.createNode({
    id: "private-control-plane",
    name: "Private control plane",
    kind: "component",
    description: "Restricted dependency",
    regionId: "global",
    criticality: "high",
    status: "degraded",
    x: 1,
    y: 1,
  });
  store.createNode({
    id: "shared-status-surface",
    name: "Shared status surface",
    kind: "service",
    description: "Visible status",
    regionId: "global",
    criticality: "medium",
    status: "healthy",
    x: 2,
    y: 2,
  });
  store.createEdge({
    id: "edge-private-shared",
    sourceId: "private-control-plane",
    targetId: "shared-status-surface",
    kind: "depends_on",
    label: "private dependency",
    optional: false,
  });
  const before = store.impactScoped(["shared-status-surface"]),
    after = store.impactScoped(["shared-status-surface"], {
      "private-control-plane": "unsatisfied",
    });
  assert.deepEqual(after, before);
  assert.equal(JSON.stringify(after).includes("private-control-plane"), false);
  assert.equal(JSON.stringify(after).includes("private dependency"), false);
  store.close();
});

test("messages are idempotent and node/task parents stay inside the incident", () => {
  const store = new TetherCompanyStore();
  const incident = store.createIncident({
    title: "Retry delays",
    observation: "Customer jobs are delayed; cause unknown.",
    regionId: "dfw",
    nodeIds: ["retry-route", "retry-queue"],
    memberIds: ["employee-noah"],
    commanderId: "employee-ava",
  });
  const input = {
    incidentId: incident.id,
    authorId: "employee-noah",
    text: "Investigating the retry path.",
    idempotencyKey: "client-message-1",
  };
  const one = store.postMessage(input),
    two = store.postMessage(input);
  assert.equal(one.id, two.id);
  assert.throws(
    () =>
      store.postMessage({
        ...input,
        idempotencyKey: "client-message-2",
        nodeId: "results-storage",
      }),
    (error: unknown) =>
      error instanceof CompanyError && error.code === "invalid_scope",
  );
  store.close();
});

test("verified resolution persists evidence and emits a minimal resolution notice", () => {
  const store = new TetherCompanyStore();
  const events: string[] = [];
  store.subscribe((event) => events.push(event.kind));
  const incident = store.createIncident({
    title: "Retry delays",
    observation: "Customer jobs are delayed.",
    regionId: "dfw",
    nodeIds: ["retry-route"],
    memberIds: ["employee-noah"],
    commanderId: "employee-ava",
  });
  const resolved = store.resolveIncident(
    incident.id,
    incident.revision,
    "Containment and fallback were independently verified.",
  );
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.evidenceRevision, incident.evidenceRevision + 1);
  assert.match(resolved.observation, /independently verified/);
  const notice = store
    .allState()
    .notifications.find(
      (item) =>
        item.incidentId === incident.id && item.text.includes("is resolved"),
    );
  assert.equal(notice?.memberId, "employee-elena");
  return new Promise<void>((done) =>
    queueMicrotask(() => {
      assert.ok(events.includes("incident.resolved"));
      store.close();
      done();
    }),
  );
});

test("normal workspaces and conversations persist independently with current membership and dedup", () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "tether-workspace-")),
    "company.sqlite",
  );
  let store = new TetherCompanyStore(path);
  const workspace = store.createWorkspace({
    name: "Training planning",
    nodeIds: ["training-catalog"],
    memberIds: ["employee-priya"],
    createdBy: "employee-ava",
  });
  assert.equal(store.allState().incidents.length, 0);
  const message = store.postConversation({
    scope: "workspace",
    workspaceId: workspace.id,
    authorId: "employee-priya",
    text: "Review dataset readiness",
    idempotencyKey: "one",
  });
  assert.equal(
    store.postConversation({
      scope: "workspace",
      workspaceId: workspace.id,
      authorId: "employee-priya",
      text: "Duplicate",
      idempotencyKey: "one",
    }).id,
    message.id,
  );
  assert.throws(
    () =>
      store.postConversation({
        scope: "workspace",
        workspaceId: workspace.id,
        authorId: "employee-elena",
        text: "No access",
        idempotencyKey: "two",
      }),
    /workspace access/,
  );
  const companyMessage = store.postConversation({
    scope: "company",
    authorId: "employee-elena",
    text: "Company update",
    idempotencyKey: "one",
  });
  assert.ok(companyMessage.sequence > message.sequence);
  store.close();
  store = new TetherCompanyStore(path);
  assert.equal(
    store.allState().workspaces.find((item) => item.id === workspace.id)?.name,
    "Training planning",
  );
  assert.equal(store.allState().conversations.length, 2);
  const changed = store.updateWorkspace(workspace.id, 1, { memberIds: [] });
  assert.throws(
    () => store.updateWorkspace(workspace.id, 1, { name: "stale" }),
    /changed/,
  );
  assert.throws(
    () =>
      store.postConversation({
        scope: "workspace",
        workspaceId: workspace.id,
        authorId: "employee-priya",
        text: "Lost access",
        idempotencyKey: "one",
      }),
    /workspace access/,
  );
  store.deleteWorkspace(workspace.id, changed.revision);
  assert.equal(store.allState().conversations.length, 1);
  store.close();
});

test("incident priority persists and cannot bypass verified resolution", () => {
  const store = new TetherCompanyStore();
  const incident = store.createIncident({
    title: "Retry issue",
    observation: "Unexpected retry",
    priority: "critical",
    regionId: "global",
    nodeIds: ["retry-route"],
    memberIds: ["employee-noah"],
    commanderId: "employee-ava",
  });
  assert.equal(incident.priority, "critical");
  assert.equal(
    store.updateIncident(incident.id, 1, { priority: "low" }).priority,
    "low",
  );
  assert.throws(
    () => store.updateIncident(incident.id, 2, { status: "resolved" }),
    /verification|verified/,
  );
  assert.throws(
    () => store.updateIncident(incident.id, 2, { priority: "urgent" as any }),
    /priority/,
  );
  store.close();
});

test("repository deletion survives restart and links update with revision checks", () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "tether-repository-")),
    "company.sqlite",
  );
  let store = new TetherCompanyStore(path);
  const ref = store.allState().repositories[0]!;
  const updated = store.addRepositoryReference({
    ...ref,
    path: "apps/tether/seed.ts",
    revision: "WORKTREE",
  });
  assert.equal(updated.id, ref.id);
  assert.equal(updated.revisionNumber, ref.revisionNumber + 1);
  assert.throws(
    () =>
      store.addRepositoryReference({ ...ref, path: "apps/tether/types.ts" }),
    /changed/,
  );
  store.deleteRepositoryReference(ref.id, updated.revisionNumber);
  store.close();
  store = new TetherCompanyStore(path);
  assert.equal(
    store.allState().repositories.some((item) => item.id === ref.id),
    false,
  );
  store.close();
});

test("layout batch is atomic, scoped, and does not change graph semantics", () => {
  const store = new TetherCompanyStore();
  const before = store.allState();
  const node = before.nodes[0]!;
  assert.throws(
    () =>
      store.updateNodeLayouts(
        [
          { id: node.id, x: 5, y: 5, layoutRevision: node.layoutRevision },
          { id: "missing", x: 0, y: 0, layoutRevision: 1 },
        ],
        new Set([node.id, "missing"]),
      ),
    /scope/,
  );
  assert.equal(
    store.allState().nodes.find((item) => item.id === node.id)?.layoutRevision,
    node.layoutRevision,
  );
  store.updateNodeLayouts(
    [{ id: node.id, x: 5, y: 5, layoutRevision: node.layoutRevision }],
    new Set([node.id]),
  );
  assert.equal(
    store.allState().organization.semanticRevision,
    before.organization.semanticRevision,
  );
  store.close();
});

test("broad grants require both current administrator role and stored organization grant", () => {
  const store = new TetherCompanyStore();
  assert.equal(store.isOrganizationAdmin("employee-ava"), true);
  const workspace = store.createWorkspace({
    name: "Restricted workspace",
    nodeIds: ["training-catalog"],
    memberIds: ["employee-priya"],
    createdBy: "employee-ava",
  });
  const ava = store.member("employee-ava")!;
  store.updateMember(ava.id, ava.revision, { roleTemplate: "engineer" });
  assert.equal(store.isOrganizationAdmin(ava.id), false);
  assert.deepEqual(
    store.permissionGrants(
      ava.id,
      { kind: "node", id: "training-catalog" },
      "graph:write",
    ),
    [],
  );
  assert.deepEqual(
    store.permissionGrants(
      ava.id,
      { kind: "node", id: "training-catalog" },
      "graph:read",
    ),
    [],
  );
  assert.throws(
    () =>
      store.postConversation({
        scope: "workspace",
        workspaceId: workspace.id,
        authorId: ava.id,
        text: "Demoted access",
        idempotencyKey: "demoted",
      }),
    /access/,
  );
  const elena = store.member("employee-elena")!;
  store.updateMember(elena.id, elena.revision, {
    roleTemplate: "senior_manager",
  });
  assert.equal(store.isOrganizationAdmin(elena.id), false);
  assert.deepEqual(
    store.permissionGrants(elena.id, undefined, "organization:admin"),
    [],
  );
  assert.deepEqual(
    store.permissionGrants(
      elena.id,
      { kind: "node", id: "training-catalog" },
      "graph:read",
    ),
    [],
  );
  assert.throws(
    () =>
      store.postConversation({
        scope: "workspace",
        workspaceId: workspace.id,
        authorId: elena.id,
        text: "Role-only access",
        idempotencyKey: "role-only",
      }),
    /access/,
  );
  const inactive = store.member("employee-priya")!;
  store.updateMember(inactive.id, inactive.revision, { active: false });
  assert.deepEqual(store.permissionGrants(inactive.id), []);
  store.close();
});

test("explicit incident sharing grants only scoped reads and removal revokes permanently", () => {
  const store = new TetherCompanyStore();
  const incident = store.createIncident({
    title: "Retry review",
    observation: "Reported customer retry issue",
    regionId: "global",
    nodeIds: ["job-api", "retry-route", "tenant-auth"],
    memberIds: ["employee-noah", "employee-priya"],
    commanderId: "employee-ava",
  });
  const read = () =>
    store.permissionGrants(
      "employee-priya",
      { kind: "node", id: "retry-route" },
      "graph:read",
    );
  assert.deepEqual(read(), []);
  store.shareIncidentSystems(incident.id, ["employee-priya"], ["retry-route"]);
  assert.equal(read().length, 1);
  assert.deepEqual(
    store.permissionGrants(
      "employee-priya",
      { kind: "node", id: "retry-route" },
      "graph:write",
    ),
    [],
  );
  const refs = store
    .allState()
    .repositories.filter((ref) => ref.nodeId === "retry-route");
  assert.ok(refs.length);
  for (const ref of refs)
    assert.deepEqual(
      store.permissionGrants(
        "employee-priya",
        { kind: "repository", id: ref.id },
        "repository:read",
      ),
      [],
    );
  store.updateIncident(incident.id, 1, { nodeIds: ["job-api", "tenant-auth"] });
  assert.deepEqual(read(), []);
  store.updateIncident(incident.id, 2, {
    nodeIds: ["job-api", "tenant-auth", "retry-route"],
  });
  assert.deepEqual(read(), []);
  store.shareIncidentSystems(incident.id, ["employee-priya"], ["retry-route"]);
  store.updateIncident(incident.id, 3, {
    memberIds: ["employee-ava", "employee-noah"],
  });
  assert.deepEqual(read(), []);
  store.updateIncident(incident.id, 4, {
    memberIds: [
      "employee-ava",
      "employee-noah",
      "employee-priya",
      "employee-elena",
    ],
  });
  assert.deepEqual(read(), []);
  assert.throws(
    () =>
      store.shareIncidentSystems(
        incident.id,
        ["employee-elena"],
        ["retry-route"],
      ),
    /role cannot read/,
  );
  assert.throws(
    () =>
      store.shareIncidentSystems(
        incident.id,
        ["employee-priya"],
        ["training-catalog"],
      ),
    /already in this incident/,
  );
  store.close();
});
