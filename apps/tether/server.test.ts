import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startTetherServer } from "./server.ts";

test("saved workspaces and ordinary conversations remain scoped across requests and restart", async (t) => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "tether-normal-http-"));
  let app = await startTetherServer({ port: 0, runtimeDir });
  t.after(async () => {
    await app.close();
    await rm(runtimeDir, { recursive: true, force: true });
  });
  const accounts = JSON.parse(
    await readFile(join(runtimeDir, "bootstrap-accounts.json"), "utf8"),
  ).accounts;
  const tokens = new Map<string, string>();
  async function req(member: string | undefined, path: string, body?: unknown) {
    const result = await fetch(`${app.url}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: app.url,
        ...(member ? { Authorization: `Bearer ${tokens.get(member)}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: result.status, ...((await result.json()) as any) };
  }
  async function act(
    member: string,
    type: string,
    payload: unknown,
    key = randomUUID(),
  ) {
    return req(member, "/api/actions", { type, payload, idempotencyKey: key });
  }
  for (const account of accounts) {
    const login = await req(undefined, "/api/login", {
      email: account.login,
      password: account.password,
    });
    tokens.set(account.employeeId, login.token);
  }
  const admin = "employee-ava",
    engineer = "employee-noah",
    scientist = "employee-priya",
    marketing = "employee-elena";
  const ownNode = await act(engineer, "node.create", {
    name: "Usage service",
    kind: "component",
    description: "Tracks usage requests",
    regionId: "global",
    ownerId: admin,
    criticality: "medium",
    x: 1,
    y: 2,
  });
  assert.equal(ownNode.status, 200);
  assert.equal(ownNode.result.ownerId, engineer);
  const ownId = ownNode.result.id;
  assert.equal(
    (
      await act(engineer, "node.update", {
        id: ownId,
        semanticRevision: 1,
        patch: { description: "Tracks validated usage requests" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await act(engineer, "node.update", {
        id: ownId,
        semanticRevision: 2,
        patch: { ownerId: admin },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await act(engineer, "node.update", {
        id: "training-catalog",
        semanticRevision: 1,
        patch: { description: "Unauthorized" },
      })
    ).status,
    403,
  );
  const edge = await act(engineer, "edge.create", {
    sourceId: ownId,
    targetId: "job-api",
    kind: "depends_on",
    label: "uses",
  });
  assert.equal(edge.status, 200);
  assert.equal(
    (
      await act(engineer, "edge.update", {
        id: edge.result.id,
        revision: 1,
        patch: { label: "requires" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await act(engineer, "edge.create", {
        sourceId: "training-catalog",
        targetId: ownId,
        kind: "depends_on",
      })
    ).status,
    403,
  );
  assert.equal(
    (await act(engineer, "edge.delete", { id: edge.result.id, revision: 2 }))
      .status,
    200,
  );
  assert.equal(
    (await act(engineer, "node.delete", { id: ownId, semanticRevision: 2 }))
      .status,
    200,
  );
  assert.equal(
    (
      await act(engineer, "workspace.create", {
        name: "Unauthorized",
        nodeIds: [],
        memberIds: [],
      })
    ).status,
    403,
  );
  const created = await act(admin, "workspace.create", {
    name: "Private training planning",
    nodeIds: ["training-catalog", "retry-route"],
    memberIds: [scientist],
  });
  assert.equal(created.status, 200);
  const workspace = created.result;
  const science = await req(scientist, "/api/state");
  assert.ok(science.workspaces.some((item: any) => item.id === workspace.id));
  assert.ok(
    science.workspaces
      .find((item: any) => item.id === workspace.id)
      .nodeIds.every((id: string) =>
        science.nodes.some((node: any) => node.id === id),
      ),
  );
  const hidden = await req(marketing, "/api/state");
  assert.deepEqual(hidden.workspaces, []);
  assert.deepEqual(hidden.conversations, []);
  assert.equal(
    (
      await act(marketing, "conversation.send", {
        scope: "workspace",
        workspaceId: workspace.id,
        text: "Attempt",
      })
    ).status,
    403,
  );
  const key = randomUUID();
  const message = await act(
    scientist,
    "conversation.send",
    {
      scope: "workspace",
      workspaceId: workspace.id,
      text: "Private planning update",
    },
    key,
  );
  assert.equal(message.status, 200);
  const duplicate = await act(
    scientist,
    "conversation.send",
    { scope: "workspace", workspaceId: workspace.id, text: "Duplicate" },
    key,
  );
  assert.equal(duplicate.result.id, message.result.id);
  const general = await act(marketing, "conversation.send", {
    scope: "company",
    text: "Company announcement",
  });
  assert.equal(general.status, 200);
  const marketingState = await req(marketing, "/api/state");
  assert.equal(marketingState.conversations.length, 1);
  assert.ok(
    !JSON.stringify(marketingState).includes("Private planning update"),
  );
  assert.equal(marketingState.incidents.length, 0);
  await app.close();
  app = await startTetherServer({ port: 0, runtimeDir });
  const restarted = await req(scientist, "/api/state");
  assert.equal(
    restarted.workspaces.find((item: any) => item.id === workspace.id).name,
    "Private training planning",
  );
  assert.equal(restarted.conversations.length, 2);
  assert.equal(
    (
      await act(admin, "workspace.update", {
        id: workspace.id,
        revision: 1,
        memberIds: [],
      })
    ).status,
    200,
  );
  const removed = await req(scientist, "/api/state");
  assert.equal(
    removed.workspaces.some((item: any) => item.id === workspace.id),
    false,
  );
  assert.equal(removed.conversations.length, 1);
  assert.equal(
    (
      await act(
        scientist,
        "conversation.send",
        {
          scope: "workspace",
          workspaceId: workspace.id,
          text: "Retry after removal",
        },
        key,
      )
    ).status,
    403,
  );
  const incident = await act(admin, "incident.create", {
    title: "Check retries",
    observation: "Reported customer retry issue",
    priority: "critical",
    nodeIds: ["retry-route"],
    memberIds: [engineer],
  });
  assert.equal(incident.status, 200);
  assert.equal(incident.result.priority, "critical");
  assert.equal(
    (
      await act(admin, "incident.update", {
        id: incident.result.id,
        revision: 1,
        patch: { status: "resolved" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await act(admin, "member.update", {
        id: engineer,
        revision: 1,
        patch: {
          onCallWindows: [
            {
              startsAt: "2026-01-01T00:00:00Z",
              endsAt: "2027-01-01T00:00:00Z",
              accepted: true,
            },
          ],
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await act(engineer, "settings.update", {
        workingHours: [{ weekday: 1, start: "99:00", end: "99:30" }],
      })
    ).status,
    400,
  );
  const invalidRepo = await act(admin, "repository.save", {
    nodeId: "retry-route",
    repository: "local:hackutd",
    path: "apps/does-not-exist.ts",
    revision: "WORKTREE",
  });
  assert.equal(invalidRepo.status, 400);
  const ref = (await req(admin, "/api/state")).repositories.find(
    (ref: any) => ref.revision === "WORKTREE",
  );
  if (ref) {
    const source = await req(
      admin,
      `/api/source?id=${encodeURIComponent(ref.id)}`,
    );
    assert.equal(source.status, 200);
    assert.match(source.editorUrl, /^vscode:\/\/file\//);
  }
  const sharedIncident = await act(admin, "incident.create", {
    title: "Shared retry review",
    observation: "Reported retry issue",
    nodeIds: ["job-api", "retry-route", "tenant-auth"],
    memberIds: [engineer, scientist, marketing],
  });
  assert.equal(sharedIncident.status, 200);
  const shareId = sharedIncident.result.id;
  const beforeShare = (await req(scientist, "/api/state")).incidents.find(
    (item: any) => item.id === shareId,
  );
  assert.deepEqual(beforeShare.nodeIds, []);
  assert.equal(beforeShare.restrictedNodeCount, 3);
  assert.equal(beforeShare.allowedAutomaticAction, null);
  assert.equal(
    (
      await act(scientist, "incident.share_systems", {
        incidentId: shareId,
        memberIds: [scientist],
        nodeIds: ["retry-route"],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await act(admin, "incident.share_systems", {
        incidentId: shareId,
        memberIds: [scientist],
        nodeIds: ["job-api", "retry-route", "tenant-auth"],
      })
    ).status,
    200,
  );
  const afterShare = (await req(scientist, "/api/state")).incidents.find(
    (item: any) => item.id === shareId,
  );
  assert.equal(afterShare.nodeIds.length, 3);
  assert.equal(afterShare.restrictedNodeCount, 0);
  assert.equal(afterShare.allowedAutomaticAction, "disable_cross_tenant_retry");
  const retryReference = app.company
    .allState()
    .repositories.find((ref) => ref.nodeId === "retry-route")!;
  assert.equal(
    (
      await req(
        scientist,
        `/api/source?id=${encodeURIComponent(retryReference.id)}`,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await act(admin, "incident.share_systems", {
        incidentId: shareId,
        memberIds: [marketing],
        nodeIds: ["retry-route"],
      })
    ).status,
    403,
  );
  const marketingAfterShare = await req(marketing, "/api/state");
  assert.deepEqual(marketingAfterShare.incidents, []);
  assert.ok(!JSON.stringify(marketingAfterShare).includes(shareId));
  assert.equal(
    (
      await act(admin, "incident.update", {
        id: shareId,
        revision: 1,
        patch: { memberIds: [admin, engineer] },
      })
    ).status,
    200,
  );
  const afterRemoval = await req(scientist, "/api/state");
  assert.equal(
    afterRemoval.nodes.some((node: any) => node.id === "retry-route"),
    false,
  );
  const unrelated = await act(admin, "incident.create", {
    title: "Training check",
    observation: "Dataset review",
    nodeIds: ["training-catalog"],
    memberIds: [scientist],
  });
  assert.equal(unrelated.status, 200);
  const unavailable = await act(admin, "response.prepare", {
    incidentId: unrelated.result.id,
  });
  assert.equal(unavailable.status, 409);
  assert.equal(unavailable.code, "automatic_action_unavailable");

  // An existing session must lose broad access immediately when its current role changes.
  const currentAdmin = app.company.member(admin)!;
  app.company.updateMember(admin, currentAdmin.revision, {
    roleTemplate: "engineer",
  });
  const demoted = await req(admin, "/api/state");
  assert.equal(demoted.permissions.includes("organization:admin"), false);
  assert.equal(
    demoted.nodes.some((node: any) => node.id === "training-catalog"),
    false,
  );
  assert.equal(
    demoted.workspaces.some((item: any) => item.id === workspace.id),
    false,
  );
  assert.equal(
    (
      await act(admin, "node.move", {
        id: "training-catalog",
        layoutRevision: 1,
        x: 0,
        y: 0,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await act(admin, "conversation.send", {
        scope: "workspace",
        workspaceId: workspace.id,
        text: "No longer an administrator",
      })
    ).status,
    403,
  );
  // Changing a trusted role does not create the missing organization resource grant.
  const currentMarketing = app.company.member(marketing)!;
  app.company.updateMember(marketing, currentMarketing.revision, {
    roleTemplate: "senior_manager",
  });
  const roleOnly = await req(marketing, "/api/state");
  assert.equal(roleOnly.permissions.includes("organization:admin"), false);
  assert.equal(
    roleOnly.nodes.some((node: any) => node.id === "training-catalog"),
    false,
  );
  assert.deepEqual(roleOnly.incidents, []);
  assert.equal(
    roleOnly.workspaces.some((item: any) => item.id === workspace.id),
    false,
  );
  assert.equal(
    (
      await act(marketing, "node.move", {
        id: "training-catalog",
        layoutRevision: 1,
        x: 0,
        y: 0,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await act(marketing, "conversation.send", {
        scope: "workspace",
        workspaceId: workspace.id,
        text: "No organization grant",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await act(marketing, "workspace.create", {
        name: "No organization grant",
        nodeIds: [],
        memberIds: [],
      })
    ).status,
    403,
  );
});
