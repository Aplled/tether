import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("demo web enforces token, origin, body limit and accepts bounded graph edits", async (t) => {
  const runtime = await mkdtemp(join(tmpdir(), "demo-web-test-"));
  const child = spawn(
    process.execPath,
    ["apps/demo-web/server.ts", "--port", "0"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DEMO_WEB_RUNTIME: runtime },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => child.kill("SIGTERM"));
  const ready: any = await new Promise((resolve, reject) => {
    let data = "";
    const timer = setTimeout(() => reject(new Error("server timeout")), 5000);
    child.stdout.on("data", (chunk) => {
      data += chunk;
      const line = data.split("\n")[0];
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }
    });
    child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  const index = await (await fetch(ready.url)).text();
  const token = /name="demo-token" content="([^"]+)"/.exec(index)?.[1];
  assert.ok(token);
  const stateResponse = await fetch(`${ready.url}/api/state`);
  assert.equal(stateResponse.status, 200);
  const before: any = await stateResponse.json();
  assert.equal(before.source, "live-backend");
  assert.equal(
    (
      await fetch(`${ready.url}/api/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "reset", payload: {} }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${ready.url}/api/actions`, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "x-demo-token": token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: "reset", payload: {} }),
      })
    ).status,
    403,
  );
  const changed = await fetch(`${ready.url}/api/actions`, {
    method: "POST",
    headers: { "x-demo-token": token, "content-type": "application/json" },
    body: JSON.stringify({
      type: "update_node",
      payload: { id: "scheduler", x: 777, y: 222 },
    }),
  });
  assert.equal(changed.status, 200);
  const output: any = await changed.json();
  assert.equal(
    output.state.nodes.find((n: any) => n.id === "scheduler").x,
    777,
  );
  assert.equal((await fetch(`${ready.url}/etc/passwd`)).status, 404);
  const oversized = await fetch(`${ready.url}/api/actions`, {
    method: "POST",
    headers: { "x-demo-token": token, "content-type": "application/json" },
    body: JSON.stringify({
      type: "send_message",
      payload: {
        text: "x".repeat(66_000),
        actorId: "commander",
        channel: "ops",
      },
    }),
  });
  assert.equal(oversized.status, 413);
});

test("HTTP flow uses MCP, exact approval, independent containment, canonical fallback, and fresh reset", async (t) => {
  const runtime = await mkdtemp(join(tmpdir(), "demo-web-flow-"));
  const child = spawn(
    process.execPath,
    ["apps/demo-web/server.ts", "--port", "0"],
    {
      cwd: process.cwd(),
      env: { ...process.env, NVIDIA_API_KEY: "", DEMO_WEB_RUNTIME: runtime },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => child.kill("SIGTERM"));
  const ready: any = await new Promise((resolve, reject) => {
    let data = "";
    const timer = setTimeout(() => reject(new Error("server timeout")), 5000);
    child.stdout.on("data", (chunk) => {
      data += chunk;
      const line = data.split("\n")[0];
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }
    });
    child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  const html = await (await fetch(ready.url)).text();
  const token = /name="demo-token" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(token);
  const action = async (type: string, payload: Record<string, unknown>) => {
    const response = await fetch(`${ready.url}/api/actions`, {
      method: "POST",
      headers: { "x-demo-token": token, "content-type": "application/json" },
      body: JSON.stringify({ type, payload }),
    });
    return { response, body: (await response.json()) as any };
  };
  let step = await action("report_incident", {
    title: "Synthetic scheduler anomaly",
    description: "Fictional exercise signal",
    nodeId: "scheduler",
  });
  assert.equal(step.response.status, 200);
  assert.equal(step.body.state.incident.status, "open-unverified");
  step = await action("analyze", {
    message: "Analyze the bounded incident and propose a safe response.",
  });
  assert.equal(step.response.status, 200);
  assert.equal(step.body.state.proposal.mode, "scripted");
  assert.equal(step.body.state.proposal.steps.length, 6);
  assert.match(
    step.body.state.proposal.summary,
    /fixed fictional pantry backend fixture/,
  );
  assert.deepEqual(step.body.result.analyzedScope, {
    organizationId: "org_pantry_demo",
    incidentId: "incident_scheduler_suspicion",
    target: "pantry-demo-scheduler",
    canvasEditsAffectAuthority: false,
  });
  const digest = step.body.state.proposal.actionDigest;
  assert.match(digest, /^[a-f0-9]{64}$/);
  let rejected = await action("approve", {
    actorId: "operator",
    actionDigest: digest,
  });
  assert.equal(rejected.response.status, 400);
  assert.match(rejected.body.error, /commander/);
  rejected = await action("approve", {
    actorId: "commander",
    actionDigest: "0".repeat(64),
  });
  assert.equal(rejected.response.status, 400);
  assert.match(rejected.body.error, /digest/);
  step = await action("approve", {
    actorId: "commander",
    actionDigest: digest,
  });
  assert.equal(step.response.status, 200);
  assert.equal(step.body.state.incident.status, "contained-verified");
  assert.equal(step.body.result.verification.result, "verified");
  assert.equal(step.body.result.verification.schedulerReachable, false);
  assert.equal(step.body.result.verification.controlReachable, true);
  assert.equal(step.body.result.verification.brokerProcessState, "stopped");
  step = await action("activate_fallback", { actorId: "commander" });
  assert.equal(step.response.status, 200);
  assert.equal(step.body.state.incident.status, "running_on_fallback");
  assert.deepEqual(
    step.body.state.tasks.map((item: any) => item.state),
    ["verified", "verified"],
  );
  step = await action("reset", {});
  assert.equal(step.response.status, 200);
  assert.equal(step.body.state.incident, null);
  assert.equal(step.body.state.proposal, null);
  assert.deepEqual(
    step.body.state.tasks.map((item: any) => item.state),
    ["pending", "pending"],
  );
  step = await action("report_incident", {
    title: "Second synthetic anomaly",
    description: "Fresh exercise after reset",
    nodeId: "scheduler",
  });
  assert.equal(step.response.status, 200);
  step = await action("analyze", {
    message: "Prepare a second bounded proposal.",
  });
  assert.equal(step.response.status, 200);
  assert.match(step.body.state.proposal.actionDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(step.body.state.proposal.actionDigest, digest);
  step = await action("update_node", { id: "scheduler", x: 888, y: 222 });
  assert.equal(step.response.status, 200);
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const child2 = spawn(
    process.execPath,
    ["apps/demo-web/server.ts", "--port", "0"],
    {
      cwd: process.cwd(),
      env: { ...process.env, NVIDIA_API_KEY: "", DEMO_WEB_RUNTIME: runtime },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => child2.kill("SIGTERM"));
  const ready2: any = await new Promise((resolve, reject) => {
    let data = "";
    const timer = setTimeout(() => reject(new Error("restart timeout")), 5000);
    child2.stdout.on("data", (chunk) => {
      data += chunk;
      const line = data.split("\n")[0];
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }
    });
    child2.once("exit", (code) =>
      reject(new Error(`restarted server exited ${code}`)),
    );
  });
  const restarted: any = await (await fetch(`${ready2.url}/api/state`)).json();
  assert.equal(restarted.incident, null);
  assert.equal(restarted.proposal, null);
  assert.deepEqual(
    restarted.tasks.map((item: any) => item.state),
    ["pending", "pending"],
  );
  assert.equal(
    restarted.nodes.find((item: any) => item.id === "scheduler").x,
    888,
  );
  assert.equal(
    restarted.nodes.find((item: any) => item.id === "scheduler").status,
    "healthy",
  );
  assert.match(restarted.timeline[0].detail, /claims were cleared/);
  const html2 = await (await fetch(ready2.url)).text();
  const token2 = /name="demo-token" content="([^"]+)"/.exec(html2)?.[1];
  assert.ok(token2);
  const secondAction = async (
    type: string,
    payload: Record<string, unknown>,
  ) => {
    const response = await fetch(`${ready2.url}/api/actions`, {
      method: "POST",
      headers: { "x-demo-token": token2, "content-type": "application/json" },
      body: JSON.stringify({ type, payload }),
    });
    return { response, body: (await response.json()) as any };
  };
  let unrelated = await secondAction("report_incident", {
    title: "Training queue note",
    description: "Unverified issue outside the fixed adapter scope",
    nodeId: "training",
  });
  assert.equal(unrelated.response.status, 200);
  unrelated = await secondAction("analyze", { message: "Stop something" });
  assert.equal(unrelated.response.status, 400);
  assert.match(unrelated.body.error, /no unrelated containment proposal/);
  const afterUnrelated: any = await (
    await fetch(`${ready2.url}/api/state`)
  ).json();
  assert.equal(afterUnrelated.proposal, null);
});
