import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { startTetherServer } from "./server.ts";

const manager = "employee-ava",
  engineer = "employee-noah",
  scientist = "employee-priya",
  marketing = "employee-elena";

test("assignment HTTP lifecycle: consent, atomic preflight, private persistence, replay and current source grants", async (t) => {
  const key = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  const runtimeDir = await mkdtemp(join(tmpdir(), "tether-assignments-"));
  let app = await startTetherServer({ port: 0, runtimeDir });
  t.after(async () => {
    await app.close();
    await rm(runtimeDir, { recursive: true, force: true });
    if (key !== undefined) process.env.NVIDIA_API_KEY = key;
  });
  const accounts = JSON.parse(
    await readFile(join(runtimeDir, "bootstrap-accounts.json"), "utf8"),
  ).accounts;
  const tokens = new Map<string, string>();
  async function req(member: string | undefined, path: string, body?: unknown) {
    const response = await fetch(`${app.url}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: app.url,
        ...(member ? { Authorization: `Bearer ${tokens.get(member)}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, ...((await response.json()) as any) };
  }
  const act = (member: string, type: string, payload: unknown) =>
    req(member, "/api/actions", {
      type,
      payload,
      idempotencyKey: randomUUID(),
    });
  for (const account of accounts) {
    const login = await req(undefined, "/api/login", {
      email: account.login,
      password: account.password,
    });
    tokens.set(account.employeeId, login.token);
  }
  // Deterministic off-hours regardless of the wall clock; volunteering does not alter this setting.
  for (const id of [manager, engineer, scientist]) {
    const member = app.company.member(id)!;
    app.company.updateMember(id, member.revision, {
      workingHours: [],
      onCallWindows: [],
      availability: "available",
    });
  }
  const incident = (
    await act(manager, "incident.create", {
      title: "Retry and training checks",
      observation: "Retry failures and training delays were reported",
      nodeIds: ["retry-route", "training-catalog"],
      memberIds: [engineer, scientist],
    })
  ).result;
  assert.ok(incident.id);
  assert.equal(
    (await act(marketing, "assignment.plan", { incidentId: incident.id }))
      .status,
    403,
  );
  assert.equal(
    (await act(engineer, "assignment.plan", { incidentId: incident.id }))
      .status,
    403,
  );
  assert.equal(
    (await act(marketing, "assignment.volunteer", { incidentId: incident.id }))
      .status,
    403,
  );
  const offHours = await act(manager, "assignment.plan", {
    incidentId: incident.id,
  });
  assert.equal(offHours.status, 200, JSON.stringify(offHours));
  assert.equal(offHours.result.tasks.length, 0);
  assert.ok(
    offHours.result.skipped.some(
      (entry: any) =>
        entry.ownerId === engineer && entry.reason.includes("off hours"),
    ),
  );
  for (const id of [engineer, scientist]) {
    const consent = await act(id, "assignment.volunteer", {
      incidentId: incident.id,
      memberId: manager,
    });
    assert.equal(consent.status, 200);
    assert.equal(consent.result.memberId, id);
    assert.equal(app.company.member(id)!.notifications.afterHours, false);
  }
  const planned = await act(manager, "assignment.plan", {
    incidentId: incident.id,
  });
  assert.equal(planned.status, 200, JSON.stringify(planned));
  assert.equal(planned.result.mode, "fallback");
  assert.equal(planned.result.tasks.length, 2);
  assert.equal(app.company.allState().tasks.length, 0);
  assert.equal(
    (await act(engineer, "assignment.apply", { planId: planned.result.planId }))
      .status,
    403,
  );
  // Corrupt the last recipient path to establish whole-batch preflight before any write.
  const record = app.company.assignmentPlan(planned.result.planId)!;
  const expiry = record.expiresAt;
  record.expiresAt = new Date(Date.now() - 1000).toISOString();
  app.company.saveAssignmentPlan(record);
  assert.equal(
    (await act(manager, "assignment.apply", { planId: record.id })).status,
    409,
  );
  record.expiresAt = expiry;
  const originalPath = record.result.tasks[1]!.sourcePaths[0]!;
  record.result.tasks[1]!.sourcePaths = ["fixtures/private/secret.ts"];
  app.company.saveAssignmentPlan(record);
  const noticesBefore = app.company.allState().notifications.length;
  assert.equal(
    (await act(manager, "assignment.apply", { planId: record.id })).status,
    409,
  );
  assert.equal(app.company.allState().tasks.length, 0);
  assert.equal(app.company.allState().notifications.length, noticesBefore);
  record.result.tasks[1]!.sourcePaths = [originalPath];
  app.company.saveAssignmentPlan(record);
  // A concurrent manual task invalidates the plan; it remains untouched.
  const manual = (
    await act(manager, "task.create", {
      incidentId: incident.id,
      title: "Manual investigation",
      ownerId: manager,
      nodeIds: ["retry-route"],
    })
  ).result;
  assert.equal(
    (await act(manager, "assignment.apply", { planId: record.id })).status,
    409,
  );
  assert.equal(
    (
      await act(manager, "task.update", {
        id: manual.id,
        revision: manual.revision,
        status: "done",
      })
    ).status,
    200,
  );
  const fresh = await act(manager, "assignment.plan", {
    incidentId: incident.id,
  });
  const applied = await act(manager, "assignment.apply", {
    planId: fresh.result.planId,
  });
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.result.taskIds.length, 2);
  assert.ok(app.company.allState().tasks.some((task) => task.id === manual.id));
  const deliveredCount = app.company.allState().notifications.length;
  assert.deepEqual(
    (await act(manager, "assignment.apply", { planId: fresh.result.planId }))
      .result.taskIds,
    applied.result.taskIds,
  );
  assert.equal(app.company.allState().notifications.length, deliveredCount);
  const noahTask = applied.result.tasks.find(
    (task: any) => task.ownerId === engineer,
  );
  const noahBrief = await act(engineer, "brief.generate", {
    taskId: noahTask.id,
  });
  assert.equal(noahBrief.status, 200, JSON.stringify(noahBrief));
  assert.equal(
    noahBrief.result.text,
    fresh.result.tasks.find((task: any) => task.ownerId === engineer).prompt,
  );
  assert.equal(noahBrief.result.provenance.mode, "fallback");
  assert.equal(
    (
      await act(engineer, "task.update", {
        id: noahTask.id,
        revision: 1,
        status: "acknowledged",
      })
    ).status,
    200,
  );
  assert.equal(
    (await act(engineer, "brief.generate", { taskId: noahTask.id })).result
      .text,
    noahBrief.result.text,
  );
  assert.equal(
    (await act(scientist, "brief.generate", { taskId: noahTask.id })).status,
    403,
  );
  assert.equal(
    (await act(marketing, "brief.generate", { taskId: noahTask.id })).status,
    403,
  );
  const scientistState = await req(scientist, "/api/state");
  assert.equal(
    scientistState.tasks.find((task: any) => task.id === noahTask.id).title,
    "Assigned investigation",
  );
  assert.equal(
    (await req(engineer, "/api/state")).tasks.find(
      (task: any) => task.id === noahTask.id,
    ).title,
    noahTask.title,
  );
  const stream = await fetch(`${app.url}/api/events`, {
    headers: {
      Origin: app.url,
      Authorization: `Bearer ${tokens.get(scientist)}`,
    },
  });
  assert.equal(stream.status, 200);
  const reader = stream.body!.getReader();
  const chunk = new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  const sseState = JSON.parse(chunk.split("data: ")[1]!.split("\n\n")[0]!);
  assert.equal(
    sseState.tasks.find((task: any) => task.id === noahTask.id).title,
    "Assigned investigation",
  );
  assert.ok(!JSON.stringify(scientistState).includes(noahBrief.result.text));
  assert.equal(
    scientistState.tasks.find((task: any) => task.id === noahTask.id).prompt,
    undefined,
  );
  assert.ok(
    app.company
      .eventsAfter(0)
      .every((event) => !JSON.stringify(event).includes(noahBrief.result.text)),
  );
  await app.close();
  app = await startTetherServer({ port: 0, runtimeDir });
  assert.equal(
    (await act(engineer, "brief.generate", { taskId: noahTask.id })).result
      .text,
    noahBrief.result.text,
  );
  assert.deepEqual(
    (await act(manager, "assignment.apply", { planId: fresh.result.planId }))
      .result.taskIds,
    applied.result.taskIds,
  );
  assert.equal(app.company.allState().notifications.length, deliveredCount);
  // Simulate a persisted pre-upgrade notice, whose title no longer matches after retitling.
  const assignmentNotice = app.company
    .allState()
    .notifications.find(
      (notice) =>
        notice.kind === "assignment" &&
        notice.memberId === engineer &&
        notice.incidentId === incident.id,
    )!;
  const legacyDatabase = new DatabaseSync(join(runtimeDir, "company.sqlite"));
  legacyDatabase
    .prepare(
      "UPDATE tether_records SET json=? WHERE kind='notification' AND id=?",
    )
    .run(
      JSON.stringify({
        ...assignmentNotice,
        text: `Assigned: ${noahTask.title}`,
      }),
      assignmentNotice.id,
    );
  legacyDatabase.close();
  const beforeRetitle = app.company
    .allState()
    .tasks.find((task) => task.id === noahTask.id)!;
  assert.equal(
    (
      await act(manager, "task.update", {
        id: noahTask.id,
        revision: beforeRetitle.revision,
        title: "Updated private investigation",
      })
    ).status,
    200,
  );
  // Revoke ownership-derived source access: neither owner nor manager can retrieve old recipient draft.
  const node = app.company
    .allState()
    .nodes.find((entry) => entry.id === "retry-route")!;
  app.company.updateNode(node.id, node.semanticRevision, { ownerId: manager });
  const revokedState = await req(engineer, "/api/state");
  assert.equal(
    revokedState.tasks.find((task: any) => task.id === noahTask.id).title,
    "Assigned investigation",
  );
  assert.ok(
    !revokedState.notifications.some((notice: any) =>
      notice.text.includes(noahTask.title),
    ),
  );
  const readNotice = await act(engineer, "notification.read", {
    id: assignmentNotice.id,
  });
  assert.equal(readNotice.status, 200);
  assert.ok(!JSON.stringify(readNotice).includes(noahTask.title));
  assert.match(readNotice.result.text, /^An investigation task was assigned/);
  const revokedStream = await fetch(`${app.url}/api/events`, {
    headers: {
      Origin: app.url,
      Authorization: `Bearer ${tokens.get(engineer)}`,
    },
  });
  const revokedReader = revokedStream.body!.getReader();
  const revokedChunk = new TextDecoder().decode(
    (await revokedReader.read()).value,
  );
  await revokedReader.cancel();
  assert.ok(!revokedChunk.includes(noahTask.title));
  assert.ok(!revokedChunk.includes("Updated private investigation"));
  assert.equal(
    (await act(engineer, "brief.generate", { taskId: noahTask.id })).status,
    403,
  );
  assert.equal(
    (await act(manager, "brief.generate", { taskId: noahTask.id })).status,
    403,
  );
  assert.equal(
    (await act(engineer, "brief.copy", { id: noahBrief.result.id })).status,
    409,
  );
  // A commander resource grant alone must not override the engineer role template.
  const latestNode = app.company
    .allState()
    .nodes.find((entry) => entry.id === "retry-route")!;
  app.company.updateNode(latestNode.id, latestNode.semanticRevision, {
    ownerId: engineer,
  });
  const engineerLed = app.company.createIncident({
    title: "Engineer-led triage",
    observation: "Check the recorded retry issue",
    nodeIds: ["retry-route"],
    memberIds: [manager, engineer],
    commanderId: engineer,
    regionId: "global",
  });
  const managerTask = app.company.createTask({
    incidentId: engineerLed.id,
    title: "Manager-owned review",
    ownerId: manager,
    nodeIds: ["retry-route"],
  });
  assert.ok(
    app.company.permissionGrants(
      engineer,
      { kind: "incident", id: engineerLed.id },
      "incident:assign",
    ).length,
  );
  const managerBrief = await act(manager, "brief.generate", {
    taskId: managerTask.id,
  });
  assert.equal(managerBrief.status, 200);
  assert.equal(
    (await act(engineer, "brief.generate", { taskId: managerTask.id })).status,
    403,
  );
  assert.equal(
    (await act(engineer, "brief.copy", { id: managerBrief.result.id })).status,
    403,
  );
  // A legitimate senior-manager commander can see a shared node without its repository.
  const noah = app.company.member(engineer)!;
  app.company.updateMember(engineer, noah.revision, {
    roleTemplate: "senior_manager",
  });
  const restricted = app.company.createIncident({
    title: "Scoped training triage",
    observation: "Investigate the training delay",
    nodeIds: ["training-catalog"],
    memberIds: [scientist, engineer],
    commanderId: engineer,
    regionId: "global",
  });
  app.company.shareIncidentSystems(
    restricted.id,
    [engineer],
    ["training-catalog"],
  );
  await act(scientist, "assignment.volunteer", { incidentId: restricted.id });
  const privateRef = app.company
    .allState()
    .repositories.find((ref) => ref.nodeId === "training-catalog")!;
  assert.ok(
    app.company.permissionGrants(
      engineer,
      { kind: "node", id: privateRef.nodeId },
      "graph:read",
    ).length,
  );
  assert.equal(
    app.company.permissionGrants(
      engineer,
      { kind: "repository", id: privateRef.id },
      "repository:read",
    ).length,
    0,
  );
  const restrictedPlan = await act(engineer, "assignment.plan", {
    incidentId: restricted.id,
  });
  assert.equal(restrictedPlan.status, 200, JSON.stringify(restrictedPlan));
  assert.equal(restrictedPlan.result.tasks.length, 0);
  assert.ok(
    restrictedPlan.result.skipped.some(
      (entry: any) =>
        entry.ownerId === scientist && entry.reason.includes("repository"),
    ),
  );
  assert.ok(!JSON.stringify(restrictedPlan.result).includes(privateRef.path));
  app.company.updateMember(engineer, app.company.member(engineer)!.revision, {
    roleTemplate: "engineer",
  });
  // Revoke the manager's session while inference is pending: no reviewed plan may be returned.
  const waitingIncident = (
    await act(manager, "incident.create", {
      title: "Fresh training check",
      observation: "Training delays require investigation",
      nodeIds: ["training-catalog"],
      memberIds: [scientist],
    })
  ).result;
  await act(scientist, "assignment.volunteer", {
    incidentId: waitingIncident.id,
  });
  const parallelIncidents = [];
  for (let index = 0; index < 2; index++) {
    const next = (
      await act(manager, "incident.create", {
        title: `Parallel training check ${index}`,
        observation: "Training delays require investigation",
        nodeIds: ["training-catalog"],
        memberIds: [scientist],
      })
    ).result;
    await act(scientist, "assignment.volunteer", { incidentId: next.id });
    parallelIncidents.push(next);
  }
  let reached!: () => void, secondReached!: () => void, release!: () => void;
  let requests = 0;
  const requested = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const secondRequested = new Promise<void>((resolve) => {
    secondReached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const model = createServer(async (_request, response) => {
    requests += 1;
    reached();
    if (requests === 2) secondReached();
    await released;
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "unavailable" }));
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const baseUrl = process.env.NVIDIA_BASE_URL;
  const address = model.address() as { port: number };
  process.env.NVIDIA_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.NVIDIA_API_KEY = "local-test-key";
  try {
    const pending = act(manager, "assignment.plan", {
      incidentId: waitingIncident.id,
    });
    await requested;
    const duplicate = await act(manager, "assignment.plan", {
      incidentId: waitingIncident.id,
    });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.error, /already in progress/);
    const secondPending = act(manager, "assignment.plan", {
      incidentId: parallelIncidents[0]!.id,
    });
    await secondRequested;
    const saturated = await act(manager, "assignment.plan", {
      incidentId: parallelIncidents[1]!.id,
    });
    assert.equal(saturated.status, 429);
    await req(manager, "/api/logout", {});
    release();
    assert.equal((await pending).status, 401);
    assert.equal((await secondPending).status, 401);
    const account = accounts.find(
      (entry: any) => entry.employeeId === manager,
    )!;
    const login = await req(undefined, "/api/login", {
      email: account.login,
      password: account.password,
    });
    tokens.set(manager, login.token);
    const afterFailure = await act(manager, "assignment.plan", {
      incidentId: waitingIncident.id,
    });
    assert.equal(afterFailure.status, 200, JSON.stringify(afterFailure));
    assert.equal(afterFailure.result.mode, "fallback");
  } finally {
    release();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    if (baseUrl === undefined) delete process.env.NVIDIA_BASE_URL;
    else process.env.NVIDIA_BASE_URL = baseUrl;
    delete process.env.NVIDIA_API_KEY;
  }
});
