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
