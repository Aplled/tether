import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startTetherServer } from "./server.ts";

type Wire = Record<string, any>;

test("four authenticated company views keep setup, response, and private work scoped", async (t) => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "tether-http-"));
  const previousKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  let app = await startTetherServer({ port: 0, runtimeDir });
  const controllers: AbortController[] = [];
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    await app.close();
    await rm(runtimeDir, { recursive: true, force: true });
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
  });

  const accounts = JSON.parse(
    await readFile(join(runtimeDir, "bootstrap-accounts.json"), "utf8"),
  ).accounts as Array<{ employeeId: string; login: string; password: string }>;
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
  async function act(
    memberId: string,
    type: string,
    payload: Wire,
    key: string = randomUUID(),
  ) {
    return request("/api/actions", memberId, {
      type,
      payload,
      idempotencyKey: key,
    });
  }
  async function success(
    memberId: string,
    type: string,
    payload: Wire,
    key?: string,
  ) {
    const result = await act(memberId, type, payload, key);
    assert.equal(
      result.status,
      200,
      `${type}: ${result.body.code ?? result.status} ${result.body.error ?? ""}`,
    );
    return result.body;
  }

  await t.test(
    "private bootstrap, four independent sessions, and logout",
    async () => {
      assert.equal(
        (await stat(join(runtimeDir, "bootstrap-accounts.json"))).mode & 0o777,
        0o600,
      );
      assert.equal((await request("/api/state")).status, 401);
      for (const account of accounts) {
        const result = await request("/api/login", undefined, {
          email: account.login,
          password: account.password,
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.user.id, account.employeeId);
        assert.equal(typeof result.body.token, "string");
        tokens.set(account.employeeId, result.body.token);
      }
      assert.equal(new Set(tokens.values()).size, 4);
      const ids = await Promise.all(
        accounts.map(
          async (account) =>
            (await request("/api/state", account.employeeId)).body.user.id,
        ),
      );
      assert.deepEqual(
        ids.sort(),
        accounts.map((account) => account.employeeId).sort(),
      );
      const second = await request("/api/login", undefined, {
        email: accounts[0]!.login,
        password: accounts[0]!.password,
      });
      const revoked = await fetch(`${app.url}/api/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${second.body.token}`,
          Origin: app.url,
        },
      });
      assert.equal(revoked.status, 200);
      const blocked = await fetch(`${app.url}/api/state`, {
        headers: { Authorization: `Bearer ${second.body.token}` },
      });
      assert.equal(blocked.status, 401);
      assert.equal((await request("/api/state", "employee-ava")).status, 200);
    },
  );

  let createdNode: Wire;
  let incident: Wire;
  let noahTask: Wire;
  let priyaTask: Wire;
  await t.test(
    "normal startup, real employee and graph setup, and revision conflicts",
    async () => {
      const initial = (await request("/api/state", "employee-ava")).body;
      assert.equal(initial.members.length, 100);
      assert.ok(initial.nodes.length >= 30);
      assert.equal(initial.incidents.length, 0);
      assert.equal(initial.analysis, null);
      assert.equal(initial.proposal, null);
      const person = await success("employee-ava", "member.create", {
        name: "Riley Chen",
        email: "riley.chen@northstar.local",
        departmentId: "engineering",
        team: "Platform",
        jobFamily: "Engineering",
        level: "Senior",
        title: "Senior Platform Engineer",
        timezone: "America/Chicago",
      });
      assert.equal(person.state.members.length, 101);
      assert.equal(person.result.loginProvisioned, false);
      const forged = await act("employee-noah", "member.create", {
        name: "Unauthorized",
        email: "blocked@northstar.local",
        departmentId: "engineering",
        team: "Platform",
        jobFamily: "Engineering",
        level: "Senior",
        title: "Senior Manager",
        role: "senior_manager",
        actorId: "employee-ava",
      });
      assert.equal(forged.status, 403);
      const created = await success("employee-ava", "node.create", {
        name: "Retry authorization monitor",
        kind: "component",
        description: "Checks tenant ownership outcomes for retry requests.",
        regionId: "dfw",
        ownerId: "employee-noah",
        criticality: "high",
        x: 940,
        y: 800,
      });
      createdNode = created.result;
      assert.ok(
        created.state.nodes.some((node: Wire) => node.id === createdNode.id),
      );
      const source = created.state.nodes.find(
        (node: Wire) => /retry/i.test(node.name) && node.id !== createdNode.id,
      );
      assert.ok(source, "the concrete retry component exists");
      await success("employee-ava", "edge.create", {
        sourceId: source.id,
        targetId: createdNode.id,
        kind: "depends_on",
        label: "observes retry authorization",
      });
      const before = (await request("/api/state", "employee-ava")).body
        .organization.semanticRevision;
      const moved = await success("employee-ava", "node.move", {
        id: createdNode.id,
        x: 1000,
        y: 850,
        layoutRevision: createdNode.layoutRevision,
      });
      assert.equal(moved.state.organization.semanticRevision, before);
      const edited = await success("employee-ava", "node.update", {
        id: createdNode.id,
        semanticRevision: createdNode.semanticRevision,
        patch: { description: "Updated ownership outcome monitor." },
      });
      assert.ok(edited.state.organization.semanticRevision > before);
      assert.equal(
        (
          await act("employee-ava", "node.update", {
            id: createdNode.id,
            semanticRevision: createdNode.semanticRevision,
            patch: { name: "Stale edit" },
          })
        ).status,
        409,
      );
    },
  );

  await t.test(
    "server import preview commits once without granting imported titles authority",
    async () => {
      const preview = await success("employee-ava", "import.preview", {
        format: "employees_csv",
        content:
          "id,name,email,departmentId,team,jobFamily,level,title\nemployee-jordan-park,Jordan Park,jordan.park@northstar.local,engineering,Platform,Engineering,Director,Director of Engineering",
      });
      assert.ok(preview.result.previewId);
      assert.deepEqual(preview.result.errors, []);
      const state = (await request("/api/state", "employee-ava")).body;
      const imported = await success("employee-ava", "import.commit", {
        previewId: preview.result.previewId,
        semanticRevision: state.organization.semanticRevision,
      });
      assert.equal(imported.result.inserted, 1);
      const member = imported.state.members.find(
        (entry: Wire) => entry.email === "jordan.park@northstar.local",
      );
      assert.ok(member);
      assert.equal(member.loginProvisioned, false);
      assert.ok(
        !imported.state.grants.some(
          (grant: Wire) =>
            grant.memberId === member.id &&
            grant.capabilities.includes("incident:approve"),
        ),
      );
      assert.ok(
        (
          await act("employee-ava", "import.commit", {
            previewId: preview.result.previewId,
            semanticRevision: state.organization.semanticRevision,
          })
        ).status >= 400,
      );
      const selfPromotion = await act("employee-noah", "settings.update", {
        title: "Director",
        departmentId: "security",
        active: true,
        role: "senior_manager",
      });
      assert.ok(
        selfPromotion.status === 400 || selfPromotion.status === 403,
        "self settings reject trusted membership fields",
      );
    },
  );

  await t.test(
    "one incident workspace, parent scopes, messages, and minimal notice",
    async () => {
      const state = (await request("/api/state", "employee-ava")).body;
      const nodes = state.nodes
        .filter((node: Wire) =>
          /retry|dataset|training|scheduler/i.test(node.name),
        )
        .slice(0, 8)
        .map((node: Wire) => node.id);
      const payload = {
        title: "Cross-customer retry investigation",
        observation:
          "A customer reports a retry accepted for another tenant's job; cause is unconfirmed.",
        regionId: "dfw",
        nodeIds: nodes,
        memberIds: ["employee-noah", "employee-priya"],
      };
      const key = randomUUID();
      const created = await success(
        "employee-ava",
        "incident.create",
        payload,
        key,
      );
      incident = created.result;
      assert.equal(
        (
          await act("employee-noah", "escalation.check", {
            incidentId: incident.id,
          })
        ).status,
        403,
        "coverage preferences require current assignment authority",
      );
      assert.equal(
        (
          await act("employee-ava", "escalation.check", {
            incidentId: incident.id,
          })
        ).status,
        200,
      );
      const duplicate = await success(
        "employee-ava",
        "incident.create",
        payload,
        key,
      );
      assert.equal(duplicate.result.id, incident.id);
      noahTask = (
        await success("employee-ava", "task.create", {
          incidentId: incident.id,
          title: "Inspect cross-tenant retry authorization",
          ownerId: "employee-noah",
          nodeIds: nodes,
        })
      ).result;
      priyaTask = (
        await success("employee-ava", "task.create", {
          incidentId: incident.id,
          title: "Check dataset and training backlog impact",
          ownerId: "employee-priya",
          nodeIds: nodes,
        })
      ).result;
      const keyMessage = randomUUID();
      const first = await success(
        "employee-noah",
        "message.send",
        {
          incidentId: incident.id,
          taskId: noahTask.id,
          text: "Checking tenant ownership before retry dispatch.",
        },
        keyMessage,
      );
      const replay = await success(
        "employee-noah",
        "message.send",
        {
          incidentId: incident.id,
          taskId: noahTask.id,
          text: "Checking tenant ownership before retry dispatch.",
        },
        keyMessage,
      );
      assert.equal(first.result.id, replay.result.id);
      const priya = (await request("/api/state", "employee-priya")).body;
      assert.ok(
        priya.messages.some((message: Wire) => message.id === first.result.id),
      );
      const foreignTask = await act("employee-noah", "task.update", {
        id: priyaTask.id,
        revision: priyaTask.revision,
        status: "done",
      });
      assert.equal(foreignTask.status, 403);
      assert.equal(
        (
          await act("employee-noah", "message.send", {
            incidentId: incident.id,
            nodeId: "missing-node",
            text: "Bad parent",
          })
        ).status,
        400,
      );
      const marketing = (await request("/api/state", "employee-elena")).body;
      for (const name of ["incidents", "messages", "tasks", "repositories"])
        assert.deepEqual(marketing[name], []);
      assert.equal(marketing.analysis, null);
      assert.ok(marketing.notifications.length > 0);
      assert.ok(
        marketing.notifications.every(
          (notice: Wire) => !Object.hasOwn(notice, "incidentId"),
        ),
      );
      const serialized = JSON.stringify(marketing);
      assert.ok(!serialized.includes(incident.id));
      assert.ok(!serialized.includes("Cross-customer retry investigation"));
      assert.ok(
        !serialized.includes(
          "Checking tenant ownership before retry dispatch.",
        ),
      );
      assert.equal(
        (
          await act("employee-elena", "analysis.run", {
            incidentId: incident.id,
          })
        ).status,
        403,
      );
    },
  );

  await t.test(
    "authorized stream delivers a persisted change and marketing stream stays redacted",
    async () => {
      async function stream(memberId: string) {
        const controller = new AbortController();
        controllers.push(controller);
        const response = await fetch(`${app.url}/api/events?cursor=0`, {
          headers: { Authorization: `Bearer ${tokens.get(memberId)}` },
          signal: controller.signal,
        });
        assert.equal(response.status, 200);
        const reader = response.body!.getReader();
        let buffer = "";
        return {
          controller,
          async nextState(): Promise<Wire> {
            const until = Date.now() + 5000;
            while (Date.now() < until) {
              const boundary = buffer.indexOf("\n\n");
              if (boundary >= 0) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const data = frame
                  .split("\n")
                  .filter((line) => line.startsWith("data: "))
                  .map((line) => line.slice(6))
                  .join("\n");
                if (data) return JSON.parse(data);
                continue;
              }
              const read = await reader.read();
              if (read.done)
                throw new Error("event stream closed before state");
              buffer += new TextDecoder().decode(read.value);
            }
            throw new Error("event stream state deadline exceeded");
          },
        };
      }
      const noah = await stream("employee-noah");
      await noah.nextState();
      const marketing = await stream("employee-elena");
      const noticeState = await marketing.nextState();
      assert.deepEqual(noticeState.messages, []);
      const posted = await success("employee-priya", "message.send", {
        incidentId: incident.id,
        text: "Training backlog checks are now assigned.",
      });
      const update = await noah.nextState();
      assert.ok(
        update.messages.some(
          (message: Wire) => message.id === posted.result.id,
        ),
      );
      noah.controller.abort();
      marketing.controller.abort();
    },
  );

  await t.test(
    "incident evidence stays keyed and changed evidence can replace a stale proposal",
    async () => {
      const second = (
        await success("employee-ava", "incident.create", {
          title: "Separate training investigation",
          observation:
            "A training queue is delayed; investigate independently.",
          regionId: "dfw",
          nodeIds: incident.nodeIds,
          memberIds: [],
        })
      ).result;
      await success("employee-ava", "analysis.run", { incidentId: second.id });
      const firstAnalysis = await success("employee-ava", "analysis.run", {
        incidentId: incident.id,
      });
      assert.equal(
        firstAnalysis.state.analysisByIncident[incident.id].incidentId,
        incident.id,
      );
      assert.equal(
        firstAnalysis.state.analysisByIncident[second.id].incidentId,
        second.id,
      );
      const firstProposal = (
        await success("employee-ava", "response.prepare", {
          incidentId: incident.id,
        })
      ).result;
      const otherProposal = await success("employee-ava", "response.prepare", {
        incidentId: second.id,
      });
      assert.equal(
        otherProposal.state.proposalsByIncident[incident.id].id,
        firstProposal.id,
      );
      assert.equal(
        otherProposal.state.proposalsByIncident[second.id].id,
        otherProposal.result.id,
      );
      const current = otherProposal.state.incidents.find(
        (entry: Wire) => entry.id === incident.id,
      );
      const changed = await success("employee-ava", "incident.update", {
        id: incident.id,
        revision: current.revision,
        patch: {
          observation:
            "Additional evidence confirms a cross-tenant retry was accepted; the cause still needs reproduction.",
        },
      });
      assert.equal(
        changed.state.proposalsByIncident[incident.id].status,
        "stale_context",
      );
      assert.equal(changed.state.analysisByIncident[incident.id], undefined);
      await success("employee-ava", "analysis.run", {
        incidentId: incident.id,
      });
      const refreshed = await success("employee-ava", "response.prepare", {
        incidentId: incident.id,
      });
      assert.notEqual(refreshed.result.id, firstProposal.id);
      assert.equal(
        refreshed.state.proposalsByIncident[incident.id].id,
        refreshed.result.id,
      );
      assert.equal(
        refreshed.state.proposalsByIncident[second.id].id,
        otherProposal.result.id,
      );
      assert.ok(
        (
          await act("employee-ava", "response.approve", {
            proposalId: firstProposal.id,
            digest: firstProposal.digest,
          })
        ).status >= 400,
      );
      const noah = (await request("/api/state", "employee-noah")).body;
      assert.equal(noah.analysisByIncident[second.id], undefined);
      assert.equal(noah.proposalsByIncident[second.id], undefined);
      const marketing = (await request("/api/state", "employee-elena")).body;
      assert.deepEqual(marketing.analysisByIncident, {});
      assert.deepEqual(marketing.proposalsByIncident, {});
    },
  );

  await t.test(
    "real analysis, exact fixed response, safe fallback, and task brief freshness",
    async () => {
      const analyzed = await success("employee-ava", "analysis.run", {
        incidentId: incident.id,
      });
      assert.equal(analyzed.result.mode, "scripted");
      assert.ok(analyzed.result.steps.length > 0);
      assert.equal(analyzed.result.mcp.protocolVersion, "2026-07-28");
      assert.equal(analyzed.result.mcp.tools.length, 7);
      const prepared = await success("employee-ava", "response.prepare", {
        incidentId: incident.id,
      });
      const proposal = prepared.state.proposal ?? prepared.result;
      assert.ok(proposal.id || proposal.actionId);
      const proposalId = proposal.id ?? proposal.actionId;
      const digest = proposal.digest ?? proposal.canonicalDigest;
      assert.ok(typeof digest === "string" && digest.length === 64);
      assert.equal(
        (await act("employee-noah", "response.approve", { proposalId, digest }))
          .status,
        403,
      );
      assert.ok(
        (
          await act("employee-ava", "response.approve", {
            proposalId,
            digest: "0".repeat(64),
          })
        ).status >= 400,
      );
      await success("employee-ava", "response.approve", { proposalId, digest });
      await success("employee-ava", "response.fallback", {
        incidentId: incident.id,
      });
      const brief = (
        await success("employee-noah", "brief.generate", {
          taskId: noahTask.id,
        })
      ).result;
      assert.match(brief.text, /fixtures\/northstar\/retry-service/);
      assert.ok(!brief.text.includes("apps/tether/scenario/job-service.ts"));
      await success("employee-noah", "brief.copy", { id: brief.id });
      const currentTask = (
        await request("/api/state", "employee-noah")
      ).body.tasks.find((task: Wire) => task.id === noahTask.id);
      await success("employee-noah", "task.update", {
        id: noahTask.id,
        revision: currentTask.revision,
        status: "investigating",
      });
      assert.equal(
        (await act("employee-noah", "brief.copy", { id: brief.id })).status,
        409,
      );
      const resolved = await success("employee-ava", "response.resolve", {
        incidentId: incident.id,
      });
      assert.equal(
        resolved.state.incidents.find((entry: Wire) => entry.id === incident.id)
          .status,
        "resolved",
      );
      const marketing = (await request("/api/state", "employee-elena")).body;
      assert.ok(
        marketing.notifications.some((notice: Wire) =>
          /resolved/i.test(notice.text),
        ),
      );
    },
  );

  await t.test(
    "source access, restart persistence, and immediate account revocation",
    async () => {
      const state = (await request("/api/state", "employee-noah")).body;
      const source = state.repositories.find((entry: Wire) =>
        entry.path.includes("retry-service"),
      );
      assert.ok(source, "engineer has a real approved source mapping");
      const read = await request(
        `/api/source?id=${encodeURIComponent(source.id)}`,
        "employee-noah",
      );
      assert.equal(read.status, 200);
      assert.match(read.body.text, /tenant/);
      assert.equal(
        (
          await request(
            `/api/source?id=${encodeURIComponent(source.id)}`,
            "employee-elena",
          )
        ).status,
        403,
      );
      await app.close();
      app = await startTetherServer({ port: 0, runtimeDir });
      const reopened = (await request("/api/state", "employee-ava")).body;
      assert.ok(
        reopened.nodes.some((node: Wire) => node.id === createdNode.id),
      );
      assert.ok(reopened.messages.length >= 2);
      const priya = reopened.members.find(
        (member: Wire) => member.id === "employee-priya",
      );
      await success("employee-ava", "member.revoke", {
        id: priya.id,
        revision: priya.revision,
      });
      assert.equal((await request("/api/state", "employee-priya")).status, 401);
    },
  );
});
