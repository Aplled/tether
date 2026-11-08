import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startTetherServer } from "./server.ts";

test("incident deletion is authorized, revision guarded, and removes collaboration records", async (t) => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "tether-delete-"));
  const app = await startTetherServer({ port: 0, runtimeDir });
  t.after(async () => {
    await app.close();
    await rm(runtimeDir, { recursive: true, force: true });
  });
  const accounts = JSON.parse(
    await readFile(join(runtimeDir, "bootstrap-accounts.json"), "utf8"),
  ).accounts as Array<{ employeeId: string; login: string; password: string }>;
  const tokens = new Map<string, string>();
  async function request(member: string | undefined, body: unknown) {
    const response = await fetch(
      `${app.url}/api/${member ? "actions" : "login"}`,
      {
        method: "POST",
        headers: {
          Origin: app.url,
          "Content-Type": "application/json",
          ...(member ? { Authorization: `Bearer ${tokens.get(member)}` } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, ...((await response.json()) as any) };
  }
  async function act(member: string, type: string, payload: unknown) {
    return request(member, { type, payload, idempotencyKey: randomUUID() });
  }
  for (const account of accounts) {
    const login = await request(undefined, {
      email: account.login,
      password: account.password,
    });
    tokens.set(account.employeeId, login.token);
  }

  const before = app.company.allState();
  const incident = app.company.createIncident({
    title: "Disposable incident",
    observation: "A bounded test observation",
    regionId: "global",
    nodeIds: ["retry-route"],
    memberIds: ["employee-noah", "employee-priya"],
    commanderId: "employee-ava",
    idempotencyKey: "delete-incident-key",
  });
  const updated = app.company.updateIncident(incident.id, 1, {
    commanderId: "employee-noah",
  });
  const task = app.company.createTask({
    incidentId: incident.id,
    title: "Inspect retry isolation",
    ownerId: "employee-noah",
    nodeIds: ["retry-route"],
  });
  app.company.postMessage({
    incidentId: incident.id,
    taskId: task.id,
    authorId: "employee-noah",
    text: "Investigation started",
    idempotencyKey: "delete-message-key",
  });
  app.company.volunteerForAssignments(incident.id, "employee-priya");
  app.company.shareIncidentSystems(
    incident.id,
    ["employee-noah"],
    ["retry-route"],
  );
  app.company.saveDelegation({
    id: "delegation-delete-test",
    fromId: "employee-ava",
    toId: "employee-noah",
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(Date.now() + 60_000).toISOString(),
    capabilities: ["incident:assign"],
    resourceIds: [incident.id, "retry-route"],
  });
  app.company.saveAssignmentPlan({
    id: "assignment-delete-test",
    actorId: "employee-noah",
    incidentId: incident.id,
    binding: "test",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    result: {
      tasks: [
        {
          title: "Review retry implementation",
          ownerId: "employee-noah",
          nodeIds: ["retry-route"],
          sourcePaths: ["fixtures/northstar/retry-service.ts"],
          prompt: "Review the bounded retry implementation.",
          provenance: { mode: "fallback", provider: "test", model: "test" },
        },
      ],
      skipped: [],
      steps: [],
    } as any,
  });
  const [plannedTask] = app.company.applyAssignmentPlan(
    "assignment-delete-test",
    () => {},
    (assignedTask) =>
      ({
        id: `brief-${assignedTask.id}`,
        taskId: assignedTask.id,
        assigneeId: assignedTask.ownerId,
        generatedAt: new Date().toISOString(),
        snapshotRevision: 1,
        taskRevision: 1,
        incidentRevision: updated.revision,
        evidenceRevision: updated.evidenceRevision,
        repositoryDigest: "test",
        snapshotDigest: "test",
        stale: false,
        text: "Bounded test brief",
      }) as any,
  );
  assert.ok(app.company.assignmentBrief(plannedTask!.id));

  assert.equal(
    (
      await act("employee-elena", "incident.delete", {
        id: incident.id,
        revision: updated.revision,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await act("employee-noah", "incident.delete", {
        id: incident.id,
        revision: 1,
      })
    ).status,
    409,
  );
  const deleted = await act("employee-noah", "incident.delete", {
    id: incident.id,
    revision: updated.revision,
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.result, { id: incident.id, deleted: true });

  const after = app.company.allState();
  assert.equal(
    after.incidents.some((item) => item.id === incident.id),
    false,
  );
  assert.equal(
    after.tasks.some((item) => item.incidentId === incident.id),
    false,
  );
  assert.equal(
    after.messages.some((item) => item.incidentId === incident.id),
    false,
  );
  assert.equal(
    after.notifications.some((item) => item.incidentId === incident.id),
    false,
  );
  assert.equal(
    after.grants.some((item) => item.incidentId === incident.id),
    false,
  );
  assert.equal(app.company.assignmentPlan("assignment-delete-test"), undefined);
  assert.equal(app.company.assignmentBrief(plannedTask!.id), undefined);
  assert.equal(
    app.company.assignmentVolunteer(incident.id, "employee-priya"),
    undefined,
  );
  assert.deepEqual(
    after.delegations.find((item) => item.id === "delegation-delete-test")
      ?.resourceIds,
    ["retry-route"],
  );
  assert.equal(after.nodes.length, before.nodes.length);
  assert.equal(after.repositories.length, before.repositories.length);

  const recreated = app.company.createIncident({
    title: "Recreated incident",
    observation: "The deleted idempotency record must not alias this incident",
    regionId: "global",
    nodeIds: ["retry-route"],
    memberIds: ["employee-noah"],
    commanderId: "employee-ava",
    idempotencyKey: "delete-incident-key",
  });
  assert.notEqual(recreated.id, incident.id);
});

test("workspace deletion remains admin-only and removes its conversations", async (t) => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "tether-workspace-delete-"));
  const app = await startTetherServer({ port: 0, runtimeDir });
  t.after(async () => {
    await app.close();
    await rm(runtimeDir, { recursive: true, force: true });
  });
  const accounts = JSON.parse(
    await readFile(join(runtimeDir, "bootstrap-accounts.json"), "utf8"),
  ).accounts as Array<{ employeeId: string; login: string; password: string }>;
  const tokens = new Map<string, string>();
  for (const account of accounts) {
    const response = await fetch(`${app.url}/api/login`, {
      method: "POST",
      headers: { Origin: app.url, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: account.login,
        password: account.password,
      }),
    });
    tokens.set(account.employeeId, ((await response.json()) as any).token);
  }
  const workspace = app.company.createWorkspace({
    name: "Temporary workspace",
    nodeIds: ["retry-route"],
    memberIds: ["employee-noah"],
    createdBy: "employee-noah",
  });
  app.company.postConversation({
    scope: "workspace",
    workspaceId: workspace.id,
    authorId: "employee-noah",
    text: "Temporary conversation",
    idempotencyKey: "workspace-delete-message",
  });
  async function remove(member: string, revision: number) {
    const response = await fetch(`${app.url}/api/actions`, {
      method: "POST",
      headers: {
        Origin: app.url,
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.get(member)}`,
      },
      body: JSON.stringify({
        type: "workspace.delete",
        payload: { id: workspace.id, revision },
        idempotencyKey: randomUUID(),
      }),
    });
    return response.status;
  }
  assert.equal(await remove("employee-noah", 1), 403);
  assert.equal(await remove("employee-ava", 2), 409);
  assert.equal(await remove("employee-ava", 1), 200);
  const state = app.company.allState();
  assert.equal(
    state.workspaces.some((item) => item.id === workspace.id),
    false,
  );
  assert.equal(
    state.conversations.some((item) => item.workspaceId === workspace.id),
    false,
  );
});
