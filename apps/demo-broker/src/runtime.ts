import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { BrokerDispatch, BrokerReceipt } from "./index.ts";
const dbPath = required("BROKER_DB_PATH"),
  authorization = required("BROKER_AUTHORIZATION");
const requestedSchedulerPort = port("BROKER_SCHEDULER_PORT"),
  requestedControlPort = port("BROKER_CONTROL_PORT");
const generation = randomUUID(),
  token = randomBytes(24).toString("base64url");
const db = new DatabaseSync(dbPath);
let scheduler: ChildProcess | null = null,
  control: Server | null = null,
  shuttingDown = false;
db.exec(
  `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS broker_attempts(execution_id TEXT PRIMARY KEY, action_id TEXT NOT NULL, target_generation TEXT NOT NULL, attempt_id TEXT NOT NULL, state TEXT NOT NULL, observed_at TEXT NOT NULL, reason TEXT) STRICT;`,
);
try {
  control = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ healthy: true, token }));
    } else response.writeHead(404).end();
  });
  await listen(control, requestedControlPort);
  const controlPort = actualPort(control);
  const fixture = fileURLToPath(
    new URL("./fixture-service.ts", import.meta.url),
  );
  scheduler = spawn(process.execPath, [fixture], {
    env: {
      DEMO_FIXTURE_PORT: String(requestedSchedulerPort),
      DEMO_FIXTURE_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const schedulerPort =
    requestedSchedulerPort === 0
      ? await readPortFromChild(scheduler)
      : requestedSchedulerPort;
  await healthy(`http://127.0.0.1:${schedulerPort}/health`, token);
  process.send?.({
    type: "ready",
    value: { generation, token, schedulerPort, controlPort },
  });
} catch (error) {
  process.send?.({ type: "startup_error", error: message(error) });
  await shutdown();
  process.exit(1);
}
process.on("message", async (request: any) => {
  const reply = (ok: boolean, value?: unknown, error?: string) =>
    process.send?.({ requestId: request.requestId, ok, value, error });
  try {
    if (request.type === "dispatch") reply(true, await dispatch(request.value));
    else if (request.type === "lookup") {
      if (!safe(String(request.value.authorization ?? ""), authorization))
        throw new Error("invalid broker authorization");
      reply(true, lookup(request.value.executionId));
    } else if (request.type === "state") reply(true, state());
    else if (request.type === "close") {
      process.send?.(
        { requestId: request.requestId, ok: true, value: null },
        async () => {
          await shutdown();
          process.exit(0);
        },
      );
    } else reply(false, undefined, "unknown broker IPC operation");
  } catch (error) {
    reply(false, undefined, message(error));
  }
});
process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
process.on("disconnect", async () => {
  await shutdown();
  process.exit(0);
});
async function dispatch(request: BrokerDispatch): Promise<BrokerReceipt> {
  if (!safe(request.authorization, authorization))
    return rejected(request, "invalid broker authorization");
  if (request.operation !== "stop_demo_scheduler")
    return rejected(request, "operation not allowlisted");
  if (
    request.target.identity !== "pantry-demo-scheduler" ||
    request.target.generation !== generation
  )
    return rejected(request, "target identity or generation mismatch");
  const prior = db
    .prepare("SELECT * FROM broker_attempts WHERE execution_id=?")
    .get(request.executionId) as any;
  if (prior) {
    if (
      prior.action_id !== request.actionId ||
      prior.target_generation !== request.target.generation
    )
      return rejected(request, "execution identity binding mismatch");
    return receipt(prior);
  }
  const attemptId = randomUUID(),
    now = new Date().toISOString();
  db.prepare(
    "INSERT INTO broker_attempts VALUES(?,?,?,?, 'dispatching', ?, NULL)",
  ).run(request.executionId, request.actionId, generation, attemptId, now);
  try {
    if (state() === "stopped")
      return finish(request.executionId, "already_stopped");
    const owned = scheduler!;
    owned.kill("SIGTERM");
    await exit(owned, 2_000);
    return state() === "stopped"
      ? finish(request.executionId, "effect_applied")
      : finish(
          request.executionId,
          "outcome_unknown",
          "owned scheduler did not exit",
        );
  } catch (error) {
    return finish(request.executionId, "outcome_unknown", message(error));
  }
}
function lookup(id: string): BrokerReceipt | null {
  const row = db
    .prepare("SELECT * FROM broker_attempts WHERE execution_id=?")
    .get(id) as any;
  return row ? receipt(row) : null;
}
function finish(
  id: string,
  status: BrokerReceipt["status"],
  reason?: string,
): BrokerReceipt {
  const at = new Date().toISOString();
  db.prepare(
    "UPDATE broker_attempts SET state=?, observed_at=?, reason=? WHERE execution_id=?",
  ).run(status, at, reason ?? null, id);
  return lookup(id)!;
}
function rejected(request: BrokerDispatch, reason: string): BrokerReceipt {
  return {
    executionId: request.executionId,
    attemptId: "none",
    targetGeneration: generation,
    status: "rejected",
    observedAt: new Date().toISOString(),
    reason,
  };
}
function receipt(row: any): BrokerReceipt {
  return {
    executionId: row.execution_id,
    attemptId: row.attempt_id,
    targetGeneration: row.target_generation,
    status: row.state === "dispatching" ? "outcome_unknown" : row.state,
    observedAt: row.observed_at,
    ...(row.reason
      ? { reason: row.reason }
      : row.state === "dispatching"
        ? { reason: "persisted dispatch has no terminal outcome" }
        : {}),
  };
}
function state(): "running" | "stopped" {
  return scheduler &&
    scheduler.exitCode === null &&
    scheduler.signalCode === null
    ? "running"
    : "stopped";
}
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (scheduler && state() === "running") {
    scheduler.kill("SIGTERM");
    await exit(scheduler, 1_000).catch(() => undefined);
  }
  await new Promise<void>(
    (resolve) => control?.close(() => resolve()) ?? resolve(),
  );
  db.close();
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}
function port(name: string): number {
  const value = Number(process.env[name] ?? "0");
  if (!Number.isInteger(value) || value < 0 || value > 65535)
    throw new Error(`${name} invalid`);
  return value;
}
function safe(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}
function listen(server: Server, targetPort: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      { host: "127.0.0.1", port: targetPort, exclusive: true },
      resolve,
    );
  });
}
function actualPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing listener address");
  return address.port;
}
async function healthy(url: string, expected: string): Promise<void> {
  const until = Date.now() + 2_000;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      const body = (await response.json()) as any;
      if (response.ok && body.token === expected) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("scheduler health startup failed");
}
function exit(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("exit", done);
      reject(new Error("child exit timeout"));
    }, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", done);
  });
}
function readPortFromChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let data = "";
    const timer = setTimeout(
      () => reject(new Error("fixture port timeout")),
      2_000,
    );
    child.stdout?.on("data", (chunk) => {
      data += chunk;
      const match = /PORT:(\d+)/.exec(data);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });
}
