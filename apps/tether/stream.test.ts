import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { Agent, get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startTetherServer } from "./server.ts";

test(
  "leased SSE streams release a saturated six-connection pool, reconnect current state, and clean up revoked/aborted streams",
  { timeout: 25_000 },
  async (t) => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "tether-stream-"));
    const app = await startTetherServer({ port: 0, runtimeDir });
    const agent = new Agent({ keepAlive: true, maxSockets: 6 });
    t.after(async () => {
      agent.destroy();
      await app.close();
      await rm(runtimeDir, { recursive: true, force: true });
    });
    const accounts = JSON.parse(
      await readFile(join(runtimeDir, "bootstrap-accounts.json"), "utf8"),
    ).accounts;
    const tokens = new Map<string, string>();
    for (const account of accounts) {
      const response = await fetch(`${app.url}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: app.url },
        body: JSON.stringify({
          email: account.login,
          password: account.password,
        }),
      });
      tokens.set(account.employeeId, ((await response.json()) as any).token);
    }
    let subscriptions = 0;
    const subscribe = app.company.subscribe.bind(app.company);
    app.company.subscribe = (listener) => {
      subscriptions++;
      const unsubscribe = subscribe(listener);
      let active = true;
      return () => {
        assert.ok(active, "each stream unsubscribes exactly once");
        active = false;
        subscriptions--;
        unsubscribe();
      };
    };
    const headers = (member = "employee-ava") => ({
      Authorization: `Bearer ${tokens.get(member)}`,
      Origin: app.url,
    });
    const open = (path: string, member = "employee-ava") =>
      new Promise<any>((resolve, reject) => {
        const request = get(
          `${app.url}${path}`,
          { agent, headers: headers(member) },
          (response) => {
            let body = "";
            const ended = new Promise<string>((done, fail) => {
              response.on("data", (chunk) => {
                body += chunk;
              });
              response.once("end", () => done(body));
              response.once("error", fail);
            });
            resolve({ response, ended });
          },
        );
        request.once("error", reject);
      });
    const snapshot = (body: string) =>
      JSON.parse(
        body
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6),
      );
    const started = Date.now();
    const streams = await Promise.all(
      Array.from({ length: 6 }, () => open("/api/events?cursor=0")),
    );
    assert.equal(subscriptions, 6);
    let queuedFinished = false;
    const queued = open("/api/state").then(async ({ response, ended }) => {
      assert.equal(response.statusCode, 200);
      await ended;
      queuedFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      queuedFinished,
      false,
      "ordinary request queues behind the six live streams",
    );
    const bodies = await Promise.all(streams.map((stream) => stream.ended));
    await queued;
    assert.ok(Date.now() - started >= 9_000, "exercised the real stream lease");
    assert.ok(
      Date.now() - started < 15_000,
      "lease releases queued requests within a bounded interval",
    );
    assert.equal(subscriptions, 0, "lease removes all subscribers");
    const cursor = snapshot(bodies[0]).eventCursor;
    const createNode = async (name: string) => {
      const response = await fetch(`${app.url}/api/actions`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "node.create",
          payload: {
            name,
            kind: "component",
            description: "Stream test",
            regionId: "global",
            criticality: "medium",
            x: 1,
            y: 2,
          },
        }),
      });
      assert.equal(response.status, 200);
      return ((await response.json()) as any).result;
    };
    const node = await createNode("Created between stream leases");
    const reconnect = await fetch(`${app.url}/api/events?cursor=${cursor}`, {
      headers: headers(),
    });
    const reader = reconnect.body!.getReader();
    let initial = "";
    const decoder = new TextDecoder();
    while (!initial.includes("\n\n")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      initial += decoder.decode(chunk.value, { stream: true });
    }
    const current = snapshot(initial);
    assert.ok(current.eventCursor > cursor);
    assert.ok(
      current.nodes.some((item: any) => item.id === node.id),
      "reconnect includes changes from the disconnected interval",
    );
    await reader.cancel();
    // Give the server the socket-close event before checking subscriber cleanup.
    for (let i = 0; subscriptions && i < 50; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(subscriptions, 0, "client cancellation removes subscriber");
    const revoked = await open("/api/events?cursor=0", "employee-noah");
    const logout = await fetch(`${app.url}/api/logout`, {
      method: "POST",
      headers: headers("employee-noah"),
    });
    assert.equal(logout.status, 200);
    await logout.json();
    await createNode("Must not reach revoked stream");
    const revokedBody = await revoked.ended;
    assert.equal(
      (revokedBody.match(/event: state/g) ?? []).length,
      1,
      "no state is sent after revocation",
    );
    assert.equal(subscriptions, 0, "authorization failure removes subscriber");
    const denied = await open("/api/events?cursor=0", "employee-noah");
    assert.equal(denied.response.statusCode, 401);
    await denied.ended;
    assert.equal(subscriptions, 0);
  },
);
