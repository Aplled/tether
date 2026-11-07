#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import {
  createIdentity,
  type PeerConfig,
  type PublicIdentity,
} from "../packages/communications/index.ts";

interface Response {
  type: string;
  requestId?: string;
  [key: string]: unknown;
}
class PeerChild {
  child: ChildProcess;
  private lines = "";
  private waiting = new Map<
    string,
    {
      resolve: (v: Response) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  ready: Promise<Response>;
  readonly id: string;
  readonly configPath: string;
  constructor(id: string, configPath: string) {
    this.id = id;
    this.configPath = configPath;
    this.child = spawn(
      process.execPath,
      [resolve("apps/mesh-peer/index.ts"), "--config", configPath],
      { cwd: resolve("."), stdio: ["pipe", "pipe", "pipe"], env: {} },
    );
    this.ready = new Promise((resolveReady, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${id} ready timeout`)),
        8_000,
      );
      this.child.stdout!.setEncoding("utf8");
      this.child.stdout!.on("data", (chunk) => {
        this.lines += chunk;
        for (;;) {
          const i = this.lines.indexOf("\n");
          if (i < 0) break;
          const line = this.lines.slice(0, i);
          this.lines = this.lines.slice(i + 1);
          if (!line) continue;
          const response = JSON.parse(line) as Response;
          if (response.type === "ready") {
            clearTimeout(timer);
            resolveReady(response);
          }
          if (response.requestId) {
            const w = this.waiting.get(response.requestId);
            if (w) {
              clearTimeout(w.timer);
              this.waiting.delete(response.requestId);
              response.type === "error"
                ? w.reject(new Error(String(response.error)))
                : w.resolve(response);
            }
          }
        }
      });
      this.child.once("exit", (code) => {
        if (code !== 0) {
          clearTimeout(timer);
          reject(new Error(`${id} exited ${code}`));
        }
      });
    });
  }
  async command(
    command: Record<string, unknown>,
    timeoutMs = 8_000,
  ): Promise<Response> {
    await this.ready;
    const requestId = randomUUID();
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(requestId);
        reject(new Error(`${this.id} command timeout`));
      }, timeoutMs);
      this.waiting.set(requestId, { resolve: resolveCommand, reject, timer });
      this.child.stdin!.write(`${JSON.stringify({ ...command, requestId })}\n`);
    });
  }
  async crash(): Promise<void> {
    if (this.child.exitCode !== null) return;
    this.child.kill("SIGKILL");
    await new Promise<void>((resolveExit) =>
      this.child.once("exit", () => resolveExit()),
    );
  }
  async stop(): Promise<void> {
    if (this.child.exitCode !== null) return;
    try {
      await this.command({ command: "shutdown" }, 3_000);
    } catch {
      this.child.kill("SIGTERM");
    }
    await new Promise<void>((resolveExit) =>
      this.child.once("exit", () => resolveExit()),
    );
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("no TCP port"));
      server.close(() => resolvePort(address.port));
    });
    server.on("error", reject);
  });
}
async function waitFor<T>(
  read: () => Promise<T>,
  accept: (v: T) => boolean,
  timeoutMs = 12_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T;
  while (Date.now() < until) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`condition timed out; last=${JSON.stringify(last!)}`);
}
function requireDemo(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`mesh_demo_failed:${message}`);
}

const outputArg = process.argv.indexOf("--output");
const outputDir =
  outputArg >= 0 && process.argv[outputArg + 1]
    ? resolve(process.argv[outputArg + 1]!)
    : await mkdtemp(join(tmpdir(), "hackutd-mesh-demo-"));
function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}
const organizationId = option("--organization", "org-demo"),
  incidentId = option("--incident", "incident-pantry-demo"),
  firstText = option("--first-text", "Synthetic initial relay check"),
  restartText = option(
    "--restart-text",
    "Synthetic fallback delivery after relay restart",
  );
for (const [label, value, max] of [
  ["organization", organizationId, 120],
  ["incident", incidentId, 160],
  ["first text", firstText, 2000],
  ["restart text", restartText, 2000],
] as const)
  if (!value || value.length > max || /[\u0000-\u001f]/.test(value))
    throw new Error(`invalid ${label}`);
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);
const peerIds = ["peer-a", "peer-b", "peer-c"] as const;
const identities: Record<string, PublicIdentity> = {};
for (const id of peerIds) {
  const peerDir = join(outputDir, id);
  await mkdir(peerDir, { recursive: true, mode: 0o700 });
  await chmod(peerDir, 0o700);
  identities[id] = await createIdentity(join(peerDir, "identity.json"), id);
}
const ports: Record<string, number> = {};
for (const id of peerIds) ports[id] = await freePort();
const trustStore = Object.fromEntries(
  peerIds.map((id) => [
    id,
    { ...identities[id]!, organizationId, membershipVersion: 1 },
  ]),
);
const configs: Record<string, PeerConfig> = {
  "peer-a": {
    peerId: "peer-a",
    identityPath: join(outputDir, "peer-a", "identity.json"),
    storePath: join(outputDir, "peer-a", "mesh.sqlite"),
    port: ports["peer-a"]!,
    organizationId,
    allowlistedIncidentIds: [incidentId],
    membershipVersion: 1,
    trustStore,
    neighbors: { "peer-b": { port: ports["peer-b"]! } },
    routes: { "peer-b": "peer-b", "peer-c": "peer-b" },
  },
  "peer-b": {
    peerId: "peer-b",
    identityPath: join(outputDir, "peer-b", "identity.json"),
    storePath: join(outputDir, "peer-b", "mesh.sqlite"),
    port: ports["peer-b"]!,
    organizationId,
    allowlistedIncidentIds: [incidentId],
    membershipVersion: 1,
    trustStore,
    neighbors: {
      "peer-a": { port: ports["peer-a"]! },
      "peer-c": { port: ports["peer-c"]! },
    },
    routes: { "peer-a": "peer-a", "peer-c": "peer-c" },
  },
  "peer-c": {
    peerId: "peer-c",
    identityPath: join(outputDir, "peer-c", "identity.json"),
    storePath: join(outputDir, "peer-c", "mesh.sqlite"),
    port: ports["peer-c"]!,
    organizationId,
    allowlistedIncidentIds: [incidentId],
    membershipVersion: 1,
    trustStore,
    neighbors: { "peer-b": { port: ports["peer-b"]! } },
    routes: { "peer-a": "peer-b", "peer-b": "peer-b" },
  },
};
for (const id of peerIds)
  await writeFile(
    join(outputDir, id, "config.json"),
    `${JSON.stringify(configs[id], null, 2)}\n`,
    { mode: 0o600 },
  );
let a: PeerChild | undefined,
  b: PeerChild | undefined,
  c: PeerChild | undefined;
try {
  a = new PeerChild("peer-a", join(outputDir, "peer-a", "config.json"));
  b = new PeerChild("peer-b", join(outputDir, "peer-b", "config.json"));
  c = new PeerChild("peer-c", join(outputDir, "peer-c", "config.json"));
  await Promise.all([a.ready, b.ready, c.ready]);
  const first = await a.command({
    command: "send",
    request: {
      recipientId: "peer-c",
      organizationId,
      incidentId,
      body: { kind: "coordination.message", text: firstText },
      ttlMs: 30_000,
    },
  });
  const firstId = String(first.messageId);
  const firstStatus = await waitFor(
    () => a!.command({ command: "status", messageId: firstId }),
    (v) => (v.status as any)?.state === "recipient_acknowledged",
  );
  const relayProbe = await b.command({
    command: "prove_cannot_decrypt",
    messageId: firstId,
  });
  await c.stop();
  c = undefined;
  const queued = await a.command({
    command: "send",
    request: {
      recipientId: "peer-c",
      organizationId,
      incidentId,
      body: { kind: "coordination.task_claim", text: restartText },
      ttlMs: 30_000,
    },
  });
  const queuedId = String(queued.messageId);
  const whileAbsent = await waitFor(
    () => a!.command({ command: "status", messageId: queuedId }),
    (v) => (v.status as any)?.state === "in_custody",
  );
  const relayQueuedEvents = await b.command({ command: "events" });
  const relayQueuedProbe = await b.command({
    command: "prove_cannot_decrypt",
    messageId: queuedId,
  });
  await b.crash();
  b = undefined;
  c = new PeerChild(
    "peer-c-restarted",
    join(outputDir, "peer-c", "config.json"),
  );
  await c.ready;
  b = new PeerChild(
    "peer-b-restarted",
    join(outputDir, "peer-b", "config.json"),
  );
  await b.ready;
  const restartedStatus = await waitFor(
    () => a!.command({ command: "status", messageId: queuedId }),
    (v) => (v.status as any)?.state === "recipient_acknowledged",
  );
  const inbox = await c.command({ command: "inbox" });
  const relayEvents = await b.command({ command: "events" });
  const directBlocked =
    !Object.hasOwn(configs["peer-a"]!.neighbors, "peer-c") &&
    configs["peer-a"]!.routes["peer-c"] === "peer-b";
  const relayCannotDecrypt =
    relayProbe.cannotDecrypt === true &&
    relayQueuedProbe.cannotDecrypt === true;
  const relayHadDurableCustody = (relayQueuedEvents.items as any[]).some(
    (event) =>
      event.kind === "relay_custody" && event.detail?.messageId === queuedId,
  );
  const inboxItems = inbox.items as any[];
  const expectedInbox = new Map([
    [firstId, { kind: "coordination.message", text: firstText }],
    [queuedId, { kind: "coordination.task_claim", text: restartText }],
  ]);
  requireDemo(directBlocked, "direct_a_to_c_not_blocked");
  requireDemo(relayCannotDecrypt, "relay_decryption_probe");
  requireDemo(relayHadDurableCustody, "relay_durable_custody_before_kill");
  requireDemo(
    (firstStatus.status as any)?.state === "recipient_acknowledged" &&
      (restartedStatus.status as any)?.state === "recipient_acknowledged",
    "signed_recipient_acknowledgments",
  );
  requireDemo(
    inboxItems.length === 2 &&
      new Set(inboxItems.map((item) => item.messageId)).size === 2,
    "recipient_inbox_exact_count",
  );
  for (const item of inboxItems) {
    const expected = expectedInbox.get(item.messageId);
    requireDemo(
      expected &&
        item.senderId === "peer-a" &&
        item.organizationId === organizationId &&
        item.incidentId === incidentId &&
        item.body?.kind === expected.kind &&
        item.body?.text === expected.text,
      "recipient_inbox_scope_or_payload",
    );
  }
  requireDemo(
    inboxItems.filter((item) => item.messageId === queuedId).length === 1,
    "queued_message_exactly_once_visible",
  );
  const evidence = {
    schema: "hackutd.mesh.demo.evidence.v1",
    generatedAt: new Date().toISOString(),
    outputDir,
    scope: { organizationId, incidentId },
    topology: {
      logicalPeers: 3,
      processes: "separate child processes",
      transport: "length-prefixed JSON over loopback TCP",
      adjacency: ["peer-a<->peer-b", "peer-b<->peer-c"],
      directAtoCBlocked: directBlocked,
      physicalDeviceMeshVerified: false,
    },
    crypto: {
      sealedBox: "libsodium crypto_box_seal",
      senderAuthentication:
        "Ed25519 signature over canonical full protected envelope",
      recipientReceipt: "Ed25519 signed and bound to message/scope/outcome",
      relayCannotDecrypt,
    },
    persistence: {
      recipientStoppedBeforeSecondMessage: true,
      statusAfterRelayCustody: (whileAbsent.status as any)?.state,
      relayHadDurableCustody,
      relayKilledAfterCustody: true,
      relayRestartedWithSameStore: true,
      recipientRestartedWithSameStore: true,
    },
    messages: [
      { messageId: firstId, status: firstStatus.status },
      { messageId: queuedId, status: restartedStatus.status },
    ],
    recipientInbox: inboxItems,
    relayRestartEvents: relayEvents.items,
    limitations: [
      "All peers share one OS user and host failure boundary.",
      "SQLite stores envelopes and private identity files are local plaintext with 0600 permissions; no OS keychain or encrypted-at-rest claim.",
      "A mutable hop limit bounds honest forwarding but is not an authenticated security guarantee against a malicious relay.",
      "A relay can drop, delay, reorder, duplicate, and observe metadata.",
    ],
  };
  await writeFile(
    join(outputDir, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ ok: true, outputDir, evidencePath: join(outputDir, "evidence.json"), firstMessage: firstId, restartMessage: queuedId })}\n`,
  );
} finally {
  await Promise.allSettled(
    [a?.stop(), b?.stop(), c?.stop()].filter(Boolean) as Promise<void>[],
  );
}
