import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startTetherServer } from "./server.ts";

type Wire = Record<string, any>;

test("HTTP projections do not cross employee node or analysis scopes", async (t) => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "tether-projection-"));
  const priorKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  const app = await startTetherServer({ port: 0, runtimeDir });
  t.after(async () => {
    await app.close();
    await rm(runtimeDir, { recursive: true, force: true });
    if (priorKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = priorKey;
  });

  const accounts = JSON.parse(
    await readFile(join(runtimeDir, "bootstrap-accounts.json"), "utf8"),
  ).accounts as Array<{
    employeeId: string;
    login: string;
    password: string;
  }>;
  const tokens = new Map<string, string>();

  async function request(path: string, memberId?: string, body?: Wire) {
    const headers: Record<string, string> = { Origin: app.url };
    if (memberId) headers.Authorization = `Bearer ${tokens.get(memberId)}`;
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetch(`${app.url}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(35_000),
    });
    return { status: response.status, body: (await response.json()) as Wire };
  }

  for (const account of accounts.filter((item) =>
    ["employee-ava", "employee-noah", "employee-priya"].includes(
      item.employeeId,
    ),
  )) {
    const login = await request("/api/login", undefined, {
      email: account.login,
      password: account.password,
    });
    assert.equal(login.status, 200);
    tokens.set(account.employeeId, login.body.token);
  }

  const noahNodeId = "node-NOAH_ONLY_SENTINEL";
  const priyaNodeId = "node-PRIYA_ONLY_SENTINEL";
  const avaNodeId = "node-AVA_HIDDEN_SENTINEL";
  const makeNode = (id: string, name: string, ownerId: string) =>
    app.company.createNode({
      id,
      name,
      kind: "component",
      description: `${name} private component`,
      regionId: "global",
      ownerId,
      criticality: "high",
      status: "healthy",
      x: 0,
      y: 0,
    });
  makeNode(noahNodeId, "NOAH_ONLY_SENTINEL", "employee-noah");
  makeNode(priyaNodeId, "PRIYA_ONLY_SENTINEL", "employee-priya");
  makeNode(avaNodeId, "AVA_HIDDEN_SENTINEL", "employee-ava");
  app.company.createEdge({
    id: "edge-AVA_HIDDEN_SENTINEL-retry-route",
    sourceId: avaNodeId,
    targetId: "retry-route",
    kind: "depends_on",
    label: "AVA_HIDDEN_SENTINEL dependency",
    optional: false,
  });
  const incident = app.company.createIncident({
    title: "Projection boundary investigation",
    observation: "A retry anomaly requires scoped investigation.",
    regionId: "global",
    nodeIds: [noahNodeId, priyaNodeId, avaNodeId, "retry-route"],
    memberIds: ["employee-noah", "employee-priya"],
    commanderId: "employee-ava",
    idempotencyKey: randomUUID(),
  });
  const task = app.company.createTask({
    incidentId: incident.id,
    title: "Inspect scoped nodes",
    ownerId: "employee-noah",
    nodeIds: [noahNodeId, priyaNodeId, avaNodeId],
  });
  app.company.postMessage({
    incidentId: incident.id,
    nodeId: avaNodeId,
    authorId: "employee-ava",
    text: "AVA_HIDDEN_MESSAGE_SENTINEL",
    idempotencyKey: randomUUID(),
  });
  app.company.postMessage({
    incidentId: incident.id,
    nodeId: noahNodeId,
    authorId: "employee-noah",
    text: "NOAH_VISIBLE_MESSAGE_SENTINEL",
    idempotencyKey: randomUUID(),
  });

  const noahState = (await request("/api/state", "employee-noah")).body;
  const projectedIncident = noahState.incidents.find(
    (item: Wire) => item.id === incident.id,
  );
  const projectedTask = noahState.tasks.find(
    (item: Wire) => item.id === task.id,
  );
  assert.deepEqual(
    new Set(projectedIncident.nodeIds),
    new Set([noahNodeId, "retry-route"]),
  );
  assert.deepEqual(projectedTask.nodeIds, [noahNodeId]);
  assert.ok(
    noahState.messages.some(
      (item: Wire) => item.text === "NOAH_VISIBLE_MESSAGE_SENTINEL",
    ),
  );
  assert.ok(
    !noahState.messages.some(
      (item: Wire) => item.text === "AVA_HIDDEN_MESSAGE_SENTINEL",
    ),
  );
  const serializedNoahState = JSON.stringify(noahState);
  assert.ok(!serializedNoahState.includes(priyaNodeId));
  assert.ok(!serializedNoahState.includes(avaNodeId));

  const analyzed = await request("/api/actions", "employee-noah", {
    type: "analysis.run",
    payload: { incidentId: incident.id, message: "Analyze scoped evidence." },
    idempotencyKey: randomUUID(),
  });
  assert.equal(analyzed.status, 200, analyzed.body.error ?? analyzed.body.code);
  assert.equal(analyzed.body.result.mode, "scripted");
  const serializedAnalysis = JSON.stringify(analyzed.body.result);
  assert.ok(!serializedAnalysis.includes(avaNodeId));
  assert.ok(!serializedAnalysis.includes("AVA_HIDDEN_SENTINEL"));
  assert.ok(!serializedAnalysis.includes(priyaNodeId));

  const refreshedNoah = (await request("/api/state", "employee-noah")).body;
  assert.ok(refreshedNoah.analysis);
  for (const memberId of ["employee-priya", "employee-ava"]) {
    const state = (await request("/api/state", memberId)).body;
    assert.equal(
      state.analysis,
      null,
      `${memberId} inherited Noah's scoped analysis`,
    );
  }
  const priyaPrepare = await request("/api/actions", "employee-priya", {
    type: "response.prepare",
    payload: { incidentId: incident.id },
    idempotencyKey: randomUUID(),
  });
  // Missing system access is rejected before exposing whether analysis exists.
  assert.equal(priyaPrepare.status, 403);
  assert.equal(priyaPrepare.body.code, "RESOURCE_GRANT_REQUIRED");
});
