import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import sodium from "libsodium-wrappers";
import {
  createIdentity,
  startPeer,
  type PeerConfig,
  type ProtectedEnvelope,
  type RecipientReceipt,
  type WirePacket,
} from "../index.ts";

function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
function b64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}
function unb64(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") return reject(new Error("port"));
      s.close(() => resolve(a.port));
    });
  });
}
async function rawSend(port: number, frame: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let buffer = Buffer.alloc(0),
      expected: number | undefined;
    socket.once("connect", () => {
      const bytes = Buffer.from(JSON.stringify(frame));
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32BE(bytes.length);
      socket.write(Buffer.concat([prefix, bytes]));
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      if (expected === undefined && buffer.length >= 4) {
        expected = buffer.readUInt32BE(0);
        buffer = buffer.subarray(4);
      }
      if (expected !== undefined && buffer.length >= expected) {
        socket.end();
        resolve(JSON.parse(buffer.subarray(0, expected).toString()));
      }
    });
    socket.on("error", reject);
  });
}
async function waitFor(check: () => boolean, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timeout");
}

test(
  "tamper, forged receipt, direct link, expired message, and replay after restart are rejected",
  { timeout: 20_000 },
  async () => {
    await sodium.ready;
    const root = await mkdtemp(join(tmpdir(), "mesh-security-"));
    const ids = ["a", "b", "c"] as const;
    const pub: any = {};
    const paths: any = {};
    for (const id of ids) {
      paths[id] = join(root, id, "identity.json");
      pub[id] = await createIdentity(paths[id], id);
    }
    const privateIds: any = {};
    for (const id of ids)
      privateIds[id] = JSON.parse(await readFile(paths[id], "utf8"));
    const ports = {
      a: await freePort(),
      b: await freePort(),
      c: await freePort(),
    };
    const trust = Object.fromEntries(
      ids.map((id) => [
        id,
        { ...pub[id], organizationId: "org", membershipVersion: 1 },
      ]),
    );
    const base = (
      id: "a" | "b" | "c",
    ): Omit<PeerConfig, "neighbors" | "routes"> => ({
      peerId: id,
      identityPath: paths[id],
      storePath: join(root, id, "db.sqlite"),
      port: ports[id],
      organizationId: "org",
      allowlistedIncidentIds: ["incident"],
      membershipVersion: 1,
      trustStore: trust,
      retryBaseMs: 50,
      maxClockSkewMs: 0,
    });
    const configs = {
      a: {
        ...base("a"),
        neighbors: { b: { port: ports.b } },
        routes: { b: "b", c: "b" },
      },
      b: {
        ...base("b"),
        neighbors: { a: { port: ports.a }, c: { port: ports.c } },
        routes: { a: "a", c: "c" },
      },
      c: {
        ...base("c"),
        neighbors: { b: { port: ports.b } },
        routes: { a: "b", b: "b" },
      },
    } satisfies Record<string, PeerConfig>;
    const a = await startPeer(configs.a),
      b = await startPeer(configs.b);
    let c = await startPeer(configs.c);
    try {
      const messageId = await a.send({
        recipientId: "c",
        organizationId: "org",
        incidentId: "incident",
        body: { kind: "coordination.message", text: "synthetic" },
        ttlMs: 10_000,
      });
      await waitFor(
        () => a.status(messageId)?.state === "recipient_acknowledged",
      );
      assert.equal(c.inbox().length, 1);
      const db = new DatabaseSync(configs.b.storePath, { readOnly: true });
      const row = db
        .prepare("SELECT envelope FROM seen WHERE message_id=?")
        .get(messageId) as { envelope: string };
      db.close();
      const envelope = JSON.parse(row.envelope) as ProtectedEnvelope;
      const signFrame = (sender: "a" | "b", packet: WirePacket) => ({
        senderId: sender,
        packet,
        signature: b64(
          sodium.crypto_sign_detached(
            canonical(packet),
            unb64(privateIds[sender].signingPrivateKey),
          ),
        ),
      });
      const cachedReceipt = a.status(messageId)!.recipientReceipt!;
      const acknowledgmentEventsBefore = (a.events() as any[]).filter(
        (event) => event.kind === "recipient_acknowledged",
      ).length;
      const duplicateReceipt = await rawSend(
        ports.a,
        signFrame("b", {
          type: "receipt",
          receipt: cachedReceipt,
          hopLimit: 7,
        }),
      );
      assert.equal(duplicateReceipt.duplicate, true);
      assert.equal(
        (a.events() as any[]).filter(
          (event) => event.kind === "recipient_acknowledged",
        ).length,
        acknowledgmentEventsBefore,
      );
      const tampered = {
        ...envelope,
        ciphertext: envelope.ciphertext.slice(0, -2) + "AA",
      };
      const tamperResult = await rawSend(
        ports.c,
        signFrame("b", { type: "envelope", envelope: tampered, hopLimit: 6 }),
      );
      assert.equal(tamperResult.ok, false);
      const directResult = await rawSend(
        ports.c,
        signFrame("a", { type: "envelope", envelope, hopLimit: 8 }),
      );
      assert.equal(directResult.ok, false);
      assert.equal(directResult.error, "packet_rejected");
      const forgedUnsigned: Omit<RecipientReceipt, "signature"> = {
        protocol: "hackutd.mesh.v1",
        receiptType: "recipient.receipt",
        messageId,
        senderId: "a",
        organizationId: "org",
        incidentId: "incident",
        recipientId: "c",
        envelopeDigest: createHash("sha256")
          .update(canonical(envelope))
          .digest("hex"),
        outcome: "accepted",
        receivedAt: new Date().toISOString(),
      };
      const forged: RecipientReceipt = {
        ...forgedUnsigned,
        signature: b64(
          sodium.crypto_sign_detached(
            canonical(forgedUnsigned),
            unb64(privateIds.b.signingPrivateKey),
          ),
        ),
      };
      const forgedResult = await rawSend(
        ports.a,
        signFrame("b", { type: "receipt", receipt: forged, hopLimit: 8 }),
      );
      assert.equal(forgedResult.ok, false);
      assert.equal(forgedResult.error, "packet_rejected");
      await c.stop();
      c = await startPeer(configs.c);
      const replayResult = await rawSend(
        ports.c,
        signFrame("b", { type: "envelope", envelope, hopLimit: 6 }),
      );
      assert.equal(replayResult.duplicate, true);
      assert.equal(c.inbox().length, 1);
      const { signature: _old, ...unsignedOld } = envelope;
      const expiredUnsigned = {
        ...unsignedOld,
        messageId: randomUUID(),
        createdAt: new Date(Date.now() - 5000).toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      const expired = {
        ...expiredUnsigned,
        signature: b64(
          sodium.crypto_sign_detached(
            canonical(expiredUnsigned),
            unb64(privateIds.a.signingPrivateKey),
          ),
        ),
      };
      const expiredResult = await rawSend(
        ports.b,
        signFrame("a", { type: "envelope", envelope: expired, hopLimit: 8 }),
      );
      assert.equal(expiredResult.ok, false);
      assert.equal(expiredResult.error, "packet_rejected");
      await assert.rejects(
        () =>
          a.send({
            recipientId: "c",
            organizationId: "org",
            incidentId: "other",
            body: { kind: "coordination.message", text: "x" },
          }),
        /allowlisted/,
      );
    } finally {
      await Promise.allSettled([a.stop(), b.stop(), c.stop()]);
    }
  },
);

test(
  "recipient receipt binds the original sender and full protected envelope digest",
  { timeout: 20_000 },
  async () => {
    await sodium.ready;
    const root = await mkdtemp(join(tmpdir(), "mesh-receipt-substitution-"));
    const paths = {
      a: join(root, "a.json"),
      b: join(root, "b.json"),
      c: join(root, "c.json"),
    };
    const pub = {
      a: await createIdentity(paths.a, "a"),
      b: await createIdentity(paths.b, "b"),
      c: await createIdentity(paths.c, "c"),
    };
    const privateIds = {
      a: JSON.parse(await readFile(paths.a, "utf8")),
      b: JSON.parse(await readFile(paths.b, "utf8")),
      c: JSON.parse(await readFile(paths.c, "utf8")),
    };
    const ports = {
      a: await freePort(),
      b: await freePort(),
      c: await freePort(),
      dead: await freePort(),
    };
    const trust = Object.fromEntries(
      Object.entries(pub).map(([id, value]) => [
        id,
        { ...value, organizationId: "org", membershipVersion: 1 },
      ]),
    );
    const common = {
      organizationId: "org",
      allowlistedIncidentIds: ["incident"],
      membershipVersion: 1,
      trustStore: trust,
      retryBaseMs: 25,
      connectTimeoutMs: 50,
      maxClockSkewMs: 1_000,
    };
    const a = await startPeer({
      ...common,
      peerId: "a",
      identityPath: paths.a,
      storePath: join(root, "a.sqlite"),
      port: ports.a,
      neighbors: { b: { port: ports.b } },
      routes: { b: "b", c: "b" },
    });
    const b = await startPeer({
      ...common,
      peerId: "b",
      identityPath: paths.b,
      storePath: join(root, "b.sqlite"),
      port: ports.b,
      neighbors: { a: { port: ports.a }, c: { port: ports.dead } },
      routes: { a: "a", c: "c" },
    });
    let c: Awaited<ReturnType<typeof startPeer>> | undefined;
    const signFrame = (sender: "a" | "b" | "c", packet: WirePacket) => ({
      senderId: sender,
      packet,
      signature: b64(
        sodium.crypto_sign_detached(
          canonical(packet),
          unb64(privateIds[sender].signingPrivateKey),
        ),
      ),
    });
    try {
      const messageId = await a.send({
        recipientId: "c",
        organizationId: "org",
        incidentId: "incident",
        body: { kind: "coordination.message", text: "original A payload" },
        ttlMs: 10_000,
      });
      await waitFor(() => a.status(messageId)?.state === "in_custody");
      const relayDb = new DatabaseSync(join(root, "b.sqlite"), {
        readOnly: true,
      });
      const original = JSON.parse(
        (
          relayDb
            .prepare("SELECT envelope FROM seen WHERE message_id=?")
            .get(messageId) as { envelope: string }
        ).envelope,
      ) as ProtectedEnvelope;
      relayDb.close();
      const maliciousBody = new TextEncoder().encode(
        canonical({
          kind: "coordination.message",
          text: "substituted B payload",
        }),
      );
      const { signature: _originalSignature, ...originalFields } = original;
      const substitutedUnsigned = {
        ...originalFields,
        senderId: "b",
        ciphertext: b64(
          sodium.crypto_box_seal(maliciousBody, unb64(pub.c.boxPublicKey)),
        ),
      };
      const substituted: ProtectedEnvelope = {
        ...substitutedUnsigned,
        signature: b64(
          sodium.crypto_sign_detached(
            canonical(substitutedUnsigned),
            unb64(privateIds.b.signingPrivateKey),
          ),
        ),
      };
      const cConfig = {
        ...common,
        peerId: "c",
        identityPath: paths.c,
        storePath: join(root, "c-malicious.sqlite"),
        port: ports.c,
        neighbors: { b: { port: ports.b } },
        routes: { a: "b", b: "b" },
      };
      c = await startPeer(cConfig);
      const substitutionResult = await rawSend(
        ports.c,
        signFrame("b", {
          type: "envelope",
          envelope: substituted,
          hopLimit: 7,
        }),
      );
      assert.equal(substitutionResult.custody, messageId);
      assert.equal(c.inbox()[0]?.body.text, "substituted B payload");
      const maliciousDb = new DatabaseSync(cConfig.storePath, {
        readOnly: true,
      });
      const maliciousReceipt = JSON.parse(
        (
          maliciousDb
            .prepare("SELECT receipt FROM seen WHERE message_id=?")
            .get(messageId) as { receipt: string }
        ).receipt,
      ) as RecipientReceipt;
      maliciousDb.close();
      assert.equal(maliciousReceipt.senderId, "b");
      assert.equal(
        maliciousReceipt.envelopeDigest,
        createHash("sha256").update(canonical(substituted)).digest("hex"),
      );
      const attackResult = await rawSend(
        ports.a,
        signFrame("b", {
          type: "receipt",
          receipt: maliciousReceipt,
          hopLimit: 7,
        }),
      );
      assert.equal(attackResult.ok, false);
      assert.equal(a.status(messageId)?.state, "in_custody");
      await c.stop();
      c = undefined;
      c = await startPeer({
        ...cConfig,
        storePath: join(root, "c-genuine.sqlite"),
      });
      const genuineResult = await rawSend(
        ports.c,
        signFrame("b", { type: "envelope", envelope: original, hopLimit: 7 }),
      );
      assert.equal(genuineResult.custody, messageId);
      await waitFor(
        () => a.status(messageId)?.state === "recipient_acknowledged",
      );
      const genuineReceipt = a.status(messageId)?.recipientReceipt;
      assert.equal(genuineReceipt?.senderId, "a");
      assert.equal(
        genuineReceipt?.envelopeDigest,
        createHash("sha256").update(canonical(original)).digest("hex"),
      );
    } finally {
      await Promise.allSettled(
        [a.stop(), b.stop(), c?.stop()].filter(Boolean) as Promise<void>[],
      );
    }
  },
);

test("durable queue count and frame limits fail closed", async () => {
  await sodium.ready;
  const root = await mkdtemp(join(tmpdir(), "mesh-limits-"));
  const aPath = join(root, "a.json"),
    bPath = join(root, "b.json");
  const aPub = await createIdentity(aPath, "a"),
    bPub = await createIdentity(bPath, "b");
  const port = await freePort(),
    bPort = await freePort();
  const peer = await startPeer({
    peerId: "a",
    identityPath: aPath,
    storePath: join(root, "a.sqlite"),
    port,
    organizationId: "org",
    allowlistedIncidentIds: ["incident"],
    membershipVersion: 1,
    trustStore: {
      a: { ...aPub, organizationId: "org", membershipVersion: 1 },
      b: { ...bPub, organizationId: "org", membershipVersion: 1 },
    },
    neighbors: { b: { port: bPort } },
    routes: { b: "b" },
    maxQueueCount: 1,
    maxQueueBytes: 4096,
    maxFrameBytes: 2048,
    retryBaseMs: 50,
    connectTimeoutMs: 50,
  });
  try {
    await assert.rejects(
      () =>
        peer.send({
          recipientId: "b",
          organizationId: "org",
          incidentId: "incident",
          body: { kind: "coordination.message", text: "x".repeat(10_000) },
        }),
      /frame limit/,
    );
    await peer.send({
      recipientId: "b",
      organizationId: "org",
      incidentId: "incident",
      body: { kind: "coordination.message", text: "queued while absent" },
    });
    await assert.rejects(
      () =>
        peer.send({
          recipientId: "b",
          organizationId: "org",
          incidentId: "incident",
          body: { kind: "coordination.message", text: "second" },
        }),
      /queue capacity/,
    );
  } finally {
    await peer.stop();
  }
});

test("relay queue failure rolls back seen state and cannot support decryption evidence", async () => {
  await sodium.ready;
  const root = await mkdtemp(join(tmpdir(), "mesh-relay-rollback-"));
  const paths = {
    a: join(root, "a.json"),
    b: join(root, "b.json"),
    c: join(root, "c.json"),
  };
  const pub = {
    a: await createIdentity(paths.a, "a"),
    b: await createIdentity(paths.b, "b"),
    c: await createIdentity(paths.c, "c"),
  };
  const ports = {
    a: await freePort(),
    b: await freePort(),
    c: await freePort(),
  };
  const trust = Object.fromEntries(
    Object.entries(pub).map(([id, value]) => [
      id,
      { ...value, organizationId: "org", membershipVersion: 1 },
    ]),
  );
  const common = {
    organizationId: "org",
    allowlistedIncidentIds: ["incident"],
    membershipVersion: 1,
    trustStore: trust,
    retryBaseMs: 25,
    connectTimeoutMs: 50,
    maxQueueCount: 1,
  };
  const a = await startPeer({
    ...common,
    peerId: "a",
    identityPath: paths.a,
    storePath: join(root, "a.sqlite"),
    port: ports.a,
    neighbors: { b: { port: ports.b } },
    routes: { b: "b", c: "b" },
  });
  const b = await startPeer({
    ...common,
    peerId: "b",
    identityPath: paths.b,
    storePath: join(root, "b.sqlite"),
    port: ports.b,
    neighbors: { a: { port: ports.a }, c: { port: ports.c } },
    routes: { a: "a", c: "c" },
  });
  try {
    await b.send({
      recipientId: "c",
      organizationId: "org",
      incidentId: "incident",
      body: { kind: "coordination.message", text: "occupy relay queue" },
    });
    const rejectedId = await a.send({
      recipientId: "c",
      organizationId: "org",
      incidentId: "incident",
      body: { kind: "coordination.message", text: "must not gain custody" },
    });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(a.status(rejectedId)?.state, "queued");
    assert.throws(() => b.cannotDecryptCached(rejectedId), /not observed/);
    const db = new DatabaseSync(join(root, "b.sqlite"), { readOnly: true });
    assert.equal(
      (
        db
          .prepare("SELECT COUNT(*) count FROM seen WHERE message_id=?")
          .get(rejectedId) as { count: number }
      ).count,
      0,
    );
    db.close();
  } finally {
    await Promise.allSettled([a.stop(), b.stop()]);
  }
});
