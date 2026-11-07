import { createServer, connect, type Server, type Socket } from "node:net";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import sodium from "libsodium-wrappers";
import {
  PROTOCOL,
  type InboxItem,
  type MessageBody,
  type MessageStatus,
  type PeerConfig,
  type PrivateIdentity,
  type ProtectedEnvelope,
  type PublicIdentity,
  type RecipientReceipt,
  type SendRequest,
  type TrustEntry,
  type WirePacket,
} from "./types.ts";

const DEFAULT_MAX_FRAME = 256 * 1024;
const DEFAULT_QUEUE_COUNT = 1_000;
const DEFAULT_QUEUE_BYTES = 16 * 1024 * 1024;
const DEFAULT_SKEW_MS = 30_000;
const DEFAULT_RETRY_MS = 250;
const DEFAULT_CONNECT_TIMEOUT_MS = 1_000;
const MAX_HOPS = 8;
const ALLOWED_BODY_KINDS = new Set([
  "coordination.message",
  "coordination.task_claim",
]);

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  throw new Error("unsupported canonical value");
}

function envelopeSignedFields(
  e: Omit<ProtectedEnvelope, "signature"> | ProtectedEnvelope,
) {
  const { signature: _ignored, ...fields } = e as ProtectedEnvelope;
  return fields;
}

function envelopeDigest(e: ProtectedEnvelope): string {
  return createHash("sha256").update(canonical(e), "utf8").digest("hex");
}

function receiptSignedFields(
  r: Omit<RecipientReceipt, "signature"> | RecipientReceipt,
) {
  const { signature: _ignored, ...fields } = r as RecipientReceipt;
  return fields;
}

function b64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}
function unb64(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}
function nowIso(): string {
  return new Date().toISOString();
}
function boundedId(value: string, label: string): void {
  if (value.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
    throw new Error(`invalid ${label}`);
}

export async function createIdentity(
  identityPath: string,
  peerId: string,
): Promise<PublicIdentity> {
  await sodium.ready;
  try {
    const existing = JSON.parse(
      await readFile(identityPath, "utf8"),
    ) as PrivateIdentity;
    if (existing.peerId !== peerId) throw new Error("identity peer mismatch");
    return publicIdentity(existing);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const signing = sodium.crypto_sign_keypair();
  const box = sodium.crypto_box_keypair();
  const identity: PrivateIdentity = {
    peerId,
    signingPublicKey: b64(signing.publicKey),
    signingPrivateKey: b64(signing.privateKey),
    boxPublicKey: b64(box.publicKey),
    boxPrivateKey: b64(box.privateKey),
  };
  await mkdir(dirname(identityPath), { recursive: true });
  await writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(identityPath, 0o600);
  return publicIdentity(identity);
}

export async function readPublicIdentity(
  identityPath: string,
): Promise<PublicIdentity> {
  return publicIdentity(
    JSON.parse(await readFile(identityPath, "utf8")) as PrivateIdentity,
  );
}

function publicIdentity(identity: PrivateIdentity): PublicIdentity {
  return {
    peerId: identity.peerId,
    signingPublicKey: identity.signingPublicKey,
    boxPublicKey: identity.boxPublicKey,
  };
}

function validateBody(value: unknown): MessageBody {
  if (!value || typeof value !== "object")
    throw new Error("invalid message body");
  const body = value as Record<string, unknown>;
  strictKeys(body, ["kind", "text"], "message body");
  if (
    typeof body.kind !== "string" ||
    !ALLOWED_BODY_KINDS.has(body.kind) ||
    typeof body.text !== "string" ||
    body.text.length > 32_768
  )
    throw new Error("invalid or prohibited coordination body");
  return { kind: body.kind as MessageBody["kind"], text: body.text };
}

function strictKeys(
  value: Record<string, unknown>,
  keys: string[],
  label: string,
): void {
  const actual = Object.keys(value).sort().join(",");
  if (actual !== [...keys].sort().join(","))
    throw new Error(`${label} fields invalid`);
}

function parsePacket(raw: string): WirePacket {
  const packet = JSON.parse(raw) as Record<string, unknown>;
  if (!packet || typeof packet !== "object") throw new Error("invalid packet");
  if (packet.type === "envelope") {
    strictKeys(packet, ["type", "envelope", "hopLimit"], "packet");
    const e = packet.envelope as Record<string, unknown>;
    strictKeys(
      e,
      [
        "protocol",
        "messageId",
        "senderId",
        "recipientId",
        "organizationId",
        "incidentId",
        "membershipVersion",
        "createdAt",
        "expiresAt",
        "ciphertext",
        "signature",
      ],
      "envelope",
    );
    if (
      e.protocol !== PROTOCOL ||
      !Number.isInteger(e.membershipVersion) ||
      typeof packet.hopLimit !== "number"
    )
      throw new Error("invalid envelope header");
    for (const key of [
      "messageId",
      "senderId",
      "recipientId",
      "organizationId",
      "incidentId",
      "createdAt",
      "expiresAt",
      "ciphertext",
      "signature",
    ])
      if (typeof e[key] !== "string" || !(e[key] as string).length)
        throw new Error(`invalid ${key}`);
    return {
      type: "envelope",
      envelope: e as unknown as ProtectedEnvelope,
      hopLimit: packet.hopLimit,
    };
  }
  if (packet.type === "receipt") {
    strictKeys(packet, ["type", "receipt", "hopLimit"], "packet");
    const r = packet.receipt as Record<string, unknown>;
    strictKeys(
      r,
      [
        "protocol",
        "receiptType",
        "messageId",
        "senderId",
        "organizationId",
        "incidentId",
        "recipientId",
        "envelopeDigest",
        "outcome",
        "receivedAt",
        "signature",
      ],
      "receipt",
    );
    if (
      r.protocol !== PROTOCOL ||
      r.receiptType !== "recipient.receipt" ||
      r.outcome !== "accepted" ||
      typeof packet.hopLimit !== "number"
    )
      throw new Error("invalid receipt header");
    for (const key of [
      "messageId",
      "senderId",
      "organizationId",
      "incidentId",
      "recipientId",
      "envelopeDigest",
      "receivedAt",
      "signature",
    ])
      if (typeof r[key] !== "string" || !(r[key] as string).length)
        throw new Error(`invalid ${key}`);
    if (!/^[a-f0-9]{64}$/.test(r.envelopeDigest as string))
      throw new Error("invalid envelope digest");
    return {
      type: "receipt",
      receipt: r as unknown as RecipientReceipt,
      hopLimit: packet.hopLimit,
    };
  }
  throw new Error("unknown packet type");
}

export class MeshPeer {
  readonly config: Required<Omit<PeerConfig, "host">> & { host: string };
  private identity!: PrivateIdentity;
  private db!: DatabaseSync;
  private server?: Server;
  private retryTimer?: NodeJS.Timeout;
  private sending = false;
  private sockets = new Set<Socket>();
  private rateWindows = new Map<string, { started: number; count: number }>();

  constructor(config: PeerConfig) {
    this.config = {
      ...config,
      host: config.host ?? "127.0.0.1",
      maxFrameBytes: config.maxFrameBytes ?? DEFAULT_MAX_FRAME,
      maxQueueCount: config.maxQueueCount ?? DEFAULT_QUEUE_COUNT,
      maxQueueBytes: config.maxQueueBytes ?? DEFAULT_QUEUE_BYTES,
      maxClockSkewMs: config.maxClockSkewMs ?? DEFAULT_SKEW_MS,
      retryBaseMs: config.retryBaseMs ?? DEFAULT_RETRY_MS,
      connectTimeoutMs: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      maxPacketsPerMinute: config.maxPacketsPerMinute ?? 600,
    };
  }

  async start(): Promise<this> {
    await sodium.ready;
    this.identity = JSON.parse(
      await readFile(this.config.identityPath, "utf8"),
    ) as PrivateIdentity;
    if (this.identity.peerId !== this.config.peerId)
      throw new Error("identity peer mismatch");
    const selfTrust = this.config.trustStore[this.config.peerId];
    if (
      !selfTrust ||
      selfTrust.signingPublicKey !== this.identity.signingPublicKey ||
      selfTrust.boxPublicKey !== this.identity.boxPublicKey
    )
      throw new Error("self trust entry mismatch");
    await mkdir(dirname(this.config.storePath), { recursive: true });
    this.db = new DatabaseSync(this.config.storePath);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY, packet TEXT NOT NULL, next_peer TEXT NOT NULL, bytes INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_ms INTEGER NOT NULL DEFAULT 0, expires_ms INTEGER NOT NULL, direction TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS seen(message_id TEXT PRIMARY KEY, envelope TEXT NOT NULL, receipt TEXT, first_seen_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox(message_id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, organization_id TEXT NOT NULL, incident_id TEXT NOT NULL, received_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbound(message_id TEXT PRIMARY KEY, state TEXT NOT NULL, receipt TEXT, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, organization_id TEXT NOT NULL, incident_id TEXT NOT NULL, envelope_digest TEXT NOT NULL, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);`);
    const outboundColumns = new Set(
      (
        this.db.prepare("PRAGMA table_info(outbound)").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (
      !outboundColumns.has("sender_id") ||
      !outboundColumns.has("envelope_digest")
    ) {
      this.db.close();
      throw new Error(
        "incompatible mesh store schema; regenerate the synthetic store",
      );
    }
    await new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => this.acceptSocket(socket));
      this.server.once("error", reject);
      this.server.listen(this.config.port, this.config.host, () => resolve());
    });
    this.retryTimer = setInterval(
      () => void this.flushQueue(),
      this.config.retryBaseMs,
    );
    this.retryTimer.unref();
    void this.flushQueue();
    this.event("peer_started", {
      peerId: this.config.peerId,
      port: this.config.port,
    });
    return this;
  }

  async stop(): Promise<void> {
    if (this.retryTimer) clearInterval(this.retryTimer);
    const serverClosed = new Promise<void>(
      (resolve) => this.server?.close(() => resolve()) ?? resolve(),
    );
    for (const socket of this.sockets) socket.destroy();
    await serverClosed;
    const drainUntil = Date.now() + this.config.connectTimeoutMs;
    while (this.sending && Date.now() < drainUntil)
      await new Promise((resolve) => setTimeout(resolve, 10));
    this.db?.close();
  }

  async send(request: SendRequest): Promise<string> {
    if (request.organizationId !== this.config.organizationId)
      throw new Error("wrong organization scope");
    this.requireIncident(request.incidentId);
    const recipient = this.requireTrusted(request.recipientId);
    const outboundCount = (
      this.db.prepare("SELECT COUNT(*) count FROM outbound").get() as {
        count: number;
      }
    ).count;
    if (outboundCount >= this.config.maxQueueCount * 4)
      throw new Error("outbound record capacity exceeded");
    validateBody(request.body);
    const messageId = randomUUID();
    const createdAt = nowIso();
    const ttl = Math.min(
      Math.max(request.ttlMs ?? 60_000, 1_000),
      24 * 60 * 60 * 1000,
    );
    const plaintext = new TextEncoder().encode(canonical(request.body));
    const ciphertext = b64(
      sodium.crypto_box_seal(plaintext, unb64(recipient.boxPublicKey)),
    );
    const unsigned: Omit<ProtectedEnvelope, "signature"> = {
      protocol: PROTOCOL,
      messageId,
      senderId: this.config.peerId,
      recipientId: request.recipientId,
      organizationId: request.organizationId,
      incidentId: request.incidentId,
      membershipVersion: this.config.membershipVersion,
      createdAt,
      expiresAt: new Date(Date.now() + ttl).toISOString(),
      ciphertext,
    };
    const signature = b64(
      sodium.crypto_sign_detached(
        canonical(unsigned),
        unb64(this.identity.signingPrivateKey),
      ),
    );
    const envelope: ProtectedEnvelope = { ...unsigned, signature };
    const packet: WirePacket = {
      type: "envelope",
      envelope,
      hopLimit: MAX_HOPS,
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO outbound(message_id,state,sender_id,recipient_id,organization_id,incident_id,envelope_digest,created_ms,expires_ms) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          messageId,
          "queued",
          this.config.peerId,
          request.recipientId,
          request.organizationId,
          request.incidentId,
          envelopeDigest(envelope),
          Date.parse(unsigned.createdAt),
          Date.parse(unsigned.expiresAt),
        );
      this.enqueue(
        `env:${messageId}`,
        packet,
        this.routeFor(request.recipientId),
        Date.parse(unsigned.expiresAt),
        "forward",
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    void this.flushQueue();
    return messageId;
  }

  status(messageId: string): MessageStatus | undefined {
    const row = this.db
      .prepare(
        "SELECT state,receipt,expires_ms FROM outbound WHERE message_id=?",
      )
      .get(messageId) as
      { state: string; receipt: string | null; expires_ms: number } | undefined;
    if (!row) return undefined;
    if (
      row.state !== "recipient_acknowledged" &&
      row.expires_ms < Date.now() - this.config.maxClockSkewMs
    ) {
      row.state = "expired";
      this.db
        .prepare("UPDATE outbound SET state='expired' WHERE message_id=?")
        .run(messageId);
    }
    return {
      messageId,
      state: row.state as MessageStatus["state"],
      ...(row.receipt ? { recipientReceipt: JSON.parse(row.receipt) } : {}),
    };
  }

  inbox(): InboxItem[] {
    return (
      this.db
        .prepare("SELECT * FROM inbox ORDER BY received_at")
        .all() as Record<string, string>[]
    ).map((r) => ({
      messageId: r.message_id!,
      senderId: r.sender_id!,
      organizationId: r.organization_id!,
      incidentId: r.incident_id!,
      receivedAt: r.received_at!,
      body: JSON.parse(r.body!),
    }));
  }

  events(): unknown[] {
    return (
      this.db
        .prepare("SELECT at,kind,detail FROM events ORDER BY seq")
        .all() as Record<string, string>[]
    ).map((r) => ({ at: r.at!, kind: r.kind!, detail: JSON.parse(r.detail!) }));
  }

  cannotDecryptCached(messageId: string): boolean {
    const raw = (
      this.db
        .prepare("SELECT envelope FROM seen WHERE message_id=?")
        .get(messageId) as { envelope: string } | undefined
    )?.envelope;
    if (!raw) throw new Error("ciphertext was not observed by this peer");
    const envelope = JSON.parse(raw) as ProtectedEnvelope;
    try {
      sodium.crypto_box_seal_open(
        unb64(envelope.ciphertext),
        unb64(this.identity.boxPublicKey),
        unb64(this.identity.boxPrivateKey),
      );
      return false;
    } catch {
      return true;
    }
  }

  private acceptSocket(socket: Socket): void {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let expected: number | undefined;
    let handled = false;
    const timeout = setTimeout(
      () => socket.destroy(new Error("frame timeout")),
      this.config.connectTimeoutMs * 2,
    );
    socket.on("data", (chunk) => {
      if (handled) return;
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      if (buffer.length > this.config.maxFrameBytes + 4) {
        handled = true;
        socket.destroy(new Error("frame limit"));
        return;
      }
      if (expected === undefined && buffer.length >= 4) {
        expected = buffer.readUInt32BE(0);
        buffer = buffer.subarray(4);
        if (expected <= 0 || expected > this.config.maxFrameBytes)
          socket.destroy(new Error("frame limit"));
      }
      if (expected !== undefined && buffer.length >= expected) {
        handled = true;
        clearTimeout(timeout);
        const raw = buffer.subarray(0, expected).toString("utf8");
        void this.receive(raw)
          .then((response) => {
            const unsigned = {
              protocol: PROTOCOL,
              responseType: "custody" as const,
              senderId: this.config.peerId,
              custody: response.custody!,
              packetDigest: createHash("sha256").update(raw).digest("base64"),
              duplicate: response.duplicate ?? false,
            };
            const signed = {
              ...unsigned,
              signature: b64(
                sodium.crypto_sign_detached(
                  canonical(unsigned),
                  unb64(this.identity.signingPrivateKey),
                ),
              ),
            };
            const bytes = Buffer.from(JSON.stringify(signed));
            const prefix = Buffer.alloc(4);
            prefix.writeUInt32BE(bytes.length);
            socket.end(Buffer.concat([prefix, bytes]));
          })
          .catch((error) => {
            this.event("packet_rejected", {
              reason: String(error?.message ?? error),
            });
            const bytes = Buffer.from(
              JSON.stringify({ ok: false, error: "packet_rejected" }),
            );
            const prefix = Buffer.alloc(4);
            prefix.writeUInt32BE(bytes.length);
            socket.end(Buffer.concat([prefix, bytes]));
          });
      }
    });
    socket.on("error", () => clearTimeout(timeout));
  }

  private async receive(raw: string): Promise<{
    ok: boolean;
    custody?: string;
    duplicate?: boolean;
    error?: string;
  }> {
    if (Buffer.byteLength(raw) > this.config.maxFrameBytes)
      throw new Error("frame limit");
    const frame = JSON.parse(raw) as Record<string, unknown>;
    strictKeys(frame, ["senderId", "packet", "signature"], "link frame");
    if (
      typeof frame.senderId !== "string" ||
      typeof frame.signature !== "string" ||
      !this.config.neighbors[frame.senderId]
    )
      throw new Error("non-adjacent sender");
    this.consumeRate(frame.senderId);
    const linkIdentity = this.requireTrusted(frame.senderId);
    if (
      !sodium.crypto_sign_verify_detached(
        unb64(frame.signature),
        canonical(frame.packet),
        unb64(linkIdentity.signingPublicKey),
      )
    )
      throw new Error("invalid link signature");
    const packet = parsePacket(JSON.stringify(frame.packet));
    if (
      !Number.isInteger(packet.hopLimit) ||
      packet.hopLimit < 1 ||
      packet.hopLimit > MAX_HOPS
    )
      throw new Error("invalid hop limit");
    if (packet.type === "envelope") return this.receiveEnvelope(packet);
    return this.receiveReceipt(packet);
  }

  private async receiveEnvelope(
    packet: Extract<WirePacket, { type: "envelope" }>,
  ): Promise<{ ok: boolean; custody: string; duplicate?: boolean }> {
    const e = packet.envelope;
    for (const [value, label] of [
      [e.messageId, "message ID"],
      [e.senderId, "sender ID"],
      [e.recipientId, "recipient ID"],
      [e.organizationId, "organization ID"],
      [e.incidentId, "incident ID"],
    ] as const)
      boundedId(value, label);
    const sender = this.requireTrusted(e.senderId);
    const recipient = this.requireTrusted(e.recipientId);
    if (
      e.organizationId !== this.config.organizationId ||
      sender.organizationId !== e.organizationId ||
      recipient.organizationId !== e.organizationId
    )
      throw new Error("wrong organization scope");
    this.requireIncident(e.incidentId);
    if (
      sender.membershipVersion !== e.membershipVersion ||
      recipient.membershipVersion !== e.membershipVersion ||
      e.membershipVersion !== this.config.membershipVersion
    )
      throw new Error("membership version mismatch");
    const created = Date.parse(e.createdAt),
      expires = Date.parse(e.expiresAt),
      now = Date.now();
    if (
      !Number.isFinite(created) ||
      !Number.isFinite(expires) ||
      created > now + this.config.maxClockSkewMs ||
      expires <= now - this.config.maxClockSkewMs ||
      expires <= created ||
      expires - created > 24 * 60 * 60 * 1000 + this.config.maxClockSkewMs
    )
      throw new Error("expired or invalid time bounds");
    if (
      !sodium.crypto_sign_verify_detached(
        unb64(e.signature),
        canonical(envelopeSignedFields(e)),
        unb64(sender.signingPublicKey),
      )
    )
      throw new Error("invalid envelope signature");
    const existing = this.db
      .prepare("SELECT receipt,envelope FROM seen WHERE message_id=?")
      .get(e.messageId) as
      { receipt: string | null; envelope: string } | undefined;
    if (existing) {
      if (existing.envelope !== JSON.stringify(e))
        throw new Error("message id collision");
      if (existing.receipt)
        this.enqueue(
          `receipt:${e.messageId}`,
          {
            type: "receipt",
            receipt: JSON.parse(existing.receipt),
            hopLimit: MAX_HOPS,
          },
          this.routeFor(e.senderId),
          expires + this.config.maxClockSkewMs,
          "return",
        );
      this.event("duplicate_rejected", {
        messageId: e.messageId,
        cachedReceipt: !!existing.receipt,
      });
      return { ok: true, custody: e.messageId, duplicate: true };
    }
    const seenCount = (
      this.db.prepare("SELECT COUNT(*) count FROM seen").get() as {
        count: number;
      }
    ).count;
    if (seenCount >= this.config.maxQueueCount * 4)
      throw new Error("seen record capacity exceeded");
    const serialized = JSON.stringify(e);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO seen(message_id,envelope,first_seen_at) VALUES(?,?,?)",
        )
        .run(e.messageId, serialized, nowIso());
      if (this.config.peerId === e.recipientId) {
        const inboxCount = (
          this.db.prepare("SELECT COUNT(*) count FROM inbox").get() as {
            count: number;
          }
        ).count;
        if (inboxCount >= this.config.maxQueueCount)
          throw new Error("inbox capacity exceeded");
        const opened = sodium.crypto_box_seal_open(
          unb64(e.ciphertext),
          unb64(this.identity.boxPublicKey),
          unb64(this.identity.boxPrivateKey),
        );
        const body = validateBody(JSON.parse(new TextDecoder().decode(opened)));
        const receivedAt = nowIso();
        this.db
          .prepare("INSERT INTO inbox VALUES(?,?,?,?,?,?)")
          .run(
            e.messageId,
            e.senderId,
            e.organizationId,
            e.incidentId,
            receivedAt,
            JSON.stringify(body),
          );
        const unsigned: Omit<RecipientReceipt, "signature"> = {
          protocol: PROTOCOL,
          receiptType: "recipient.receipt",
          messageId: e.messageId,
          senderId: e.senderId,
          organizationId: e.organizationId,
          incidentId: e.incidentId,
          recipientId: e.recipientId,
          envelopeDigest: envelopeDigest(e),
          outcome: "accepted",
          receivedAt,
        };
        const receipt: RecipientReceipt = {
          ...unsigned,
          signature: b64(
            sodium.crypto_sign_detached(
              canonical(unsigned),
              unb64(this.identity.signingPrivateKey),
            ),
          ),
        };
        this.db
          .prepare("UPDATE seen SET receipt=? WHERE message_id=?")
          .run(JSON.stringify(receipt), e.messageId);
        this.enqueue(
          `receipt:${e.messageId}`,
          { type: "receipt", receipt, hopLimit: MAX_HOPS },
          this.routeFor(e.senderId),
          expires,
          "return",
        );
        this.event("message_delivered", {
          messageId: e.messageId,
          senderId: e.senderId,
        });
      } else {
        this.enqueue(
          `env:${e.messageId}`,
          { ...packet, hopLimit: packet.hopLimit - 1 },
          this.routeFor(e.recipientId),
          expires,
          "forward",
        );
        this.event("relay_custody", {
          messageId: e.messageId,
          recipientId: e.recipientId,
        });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    void this.flushQueue();
    return { ok: true, custody: e.messageId };
  }

  private async receiveReceipt(
    packet: Extract<WirePacket, { type: "receipt" }>,
  ): Promise<{ ok: boolean; custody: string; duplicate?: boolean }> {
    const r = packet.receipt,
      recipient = this.requireTrusted(r.recipientId);
    for (const [value, label] of [
      [r.messageId, "message ID"],
      [r.senderId, "sender ID"],
      [r.organizationId, "organization ID"],
      [r.incidentId, "incident ID"],
      [r.recipientId, "recipient ID"],
    ] as const)
      boundedId(value, label);
    if (
      r.organizationId !== this.config.organizationId ||
      recipient.organizationId !== r.organizationId
    )
      throw new Error("wrong receipt scope");
    if (recipient.membershipVersion !== this.config.membershipVersion)
      throw new Error("membership version mismatch");
    this.requireIncident(r.incidentId);
    if (
      !sodium.crypto_sign_verify_detached(
        unb64(r.signature),
        canonical(receiptSignedFields(r)),
        unb64(recipient.signingPublicKey),
      )
    )
      throw new Error("invalid recipient receipt signature");
    const seen = this.db
      .prepare("SELECT envelope,receipt FROM seen WHERE message_id=?")
      .get(r.messageId) as
      { envelope: string; receipt: string | null } | undefined;
    const outbound = this.db
      .prepare(
        "SELECT sender_id,recipient_id,organization_id,incident_id,envelope_digest,created_ms,expires_ms,receipt FROM outbound WHERE message_id=?",
      )
      .get(r.messageId) as
      | {
          sender_id: string;
          recipient_id: string;
          organization_id: string;
          incident_id: string;
          envelope_digest: string;
          created_ms: number;
          expires_ms: number;
          receipt: string | null;
        }
      | undefined;
    const envelope = seen
      ? (JSON.parse(seen.envelope) as ProtectedEnvelope)
      : undefined;
    if (!envelope && !outbound) throw new Error("receipt for unknown message");
    const receiptTime = Date.parse(r.receivedAt);
    if (
      !Number.isFinite(receiptTime) ||
      receiptTime > Date.now() + this.config.maxClockSkewMs
    )
      throw new Error("invalid receipt time");
    const createdTime = envelope
      ? Date.parse(envelope.createdAt)
      : outbound!.created_ms;
    const expectedSender = envelope?.senderId ?? outbound?.sender_id,
      expectedEnvelopeDigest = envelope
        ? envelopeDigest(envelope)
        : outbound?.envelope_digest;
    if (
      r.senderId !== expectedSender ||
      r.envelopeDigest !== expectedEnvelopeDigest ||
      r.recipientId !== (envelope?.recipientId ?? outbound?.recipient_id) ||
      r.organizationId !==
        (envelope?.organizationId ?? outbound?.organization_id) ||
      r.incidentId !== (envelope?.incidentId ?? outbound?.incident_id) ||
      receiptTime < createdTime - this.config.maxClockSkewMs ||
      receiptTime >
        (envelope ? Date.parse(envelope.expiresAt) : outbound!.expires_ms) +
          this.config.maxClockSkewMs
    )
      throw new Error("receipt binding mismatch");
    if (outbound) {
      if (outbound.receipt && outbound.receipt !== JSON.stringify(r))
        throw new Error("conflicting receipt");
      if (outbound.receipt === JSON.stringify(r))
        return { ok: true, custody: r.messageId, duplicate: true };
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare(
            "UPDATE outbound SET state='recipient_acknowledged',receipt=? WHERE message_id=?",
          )
          .run(JSON.stringify(r), r.messageId);
        this.db
          .prepare("DELETE FROM queue WHERE id=?")
          .run(`env:${r.messageId}`);
        this.event("recipient_acknowledged", { messageId: r.messageId });
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } else {
      if (seen?.receipt && seen.receipt !== JSON.stringify(r))
        throw new Error("conflicting receipt");
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare("UPDATE seen SET receipt=? WHERE message_id=?")
          .run(JSON.stringify(r), r.messageId);
        const origin = envelope!.senderId;
        this.enqueue(
          `receipt:${r.messageId}`,
          { ...packet, hopLimit: packet.hopLimit - 1 },
          this.routeFor(origin),
          Date.parse(envelope!.expiresAt) + this.config.maxClockSkewMs,
          "return",
        );
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      void this.flushQueue();
    }
    return { ok: true, custody: r.messageId, duplicate: !!seen?.receipt };
  }

  private enqueue(
    id: string,
    packet: WirePacket,
    nextPeer: string,
    expiresMs: number,
    direction: string,
  ): void {
    if (!this.config.neighbors[nextPeer])
      throw new Error(
        `next hop ${nextPeer} is not an adjacent allowlisted peer`,
      );
    const raw = JSON.stringify(packet),
      bytes = Buffer.byteLength(raw);
    if (bytes > this.config.maxFrameBytes) throw new Error("frame limit");
    const totals = this.db
      .prepare("SELECT COUNT(*) count,COALESCE(SUM(bytes),0) bytes FROM queue")
      .get() as { count: number; bytes: number };
    const exists = this.db.prepare("SELECT 1 ok FROM queue WHERE id=?").get(id);
    if (
      !exists &&
      (totals.count >= this.config.maxQueueCount ||
        totals.bytes + bytes > this.config.maxQueueBytes)
    )
      throw new Error("durable queue capacity exceeded");
    this.db
      .prepare(
        "INSERT INTO queue(id,packet,next_peer,bytes,expires_ms,direction) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
      )
      .run(id, raw, nextPeer, bytes, expiresMs, direction);
  }

  private async flushQueue(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      this.prune();
      const rows = this.db
        .prepare(
          "SELECT * FROM queue WHERE next_attempt_ms<=? ORDER BY rowid LIMIT 32",
        )
        .all(Date.now()) as Record<string, any>[];
      for (const row of rows) {
        if (row.expires_ms < Date.now() - this.config.maxClockSkewMs) {
          this.db.prepare("DELETE FROM queue WHERE id=?").run(row.id);
          if (row.direction === "forward")
            this.db
              .prepare("UPDATE outbound SET state='expired' WHERE message_id=?")
              .run(String(row.id).replace("env:", ""));
          continue;
        }
        try {
          const response = await this.transmit(row.next_peer, row.packet);
          this.db.prepare("DELETE FROM queue WHERE id=?").run(row.id);
          if (row.direction === "forward")
            this.db
              .prepare(
                "UPDATE outbound SET state='in_custody' WHERE message_id=? AND state='queued'",
              )
              .run(String(row.id).replace("env:", ""));
          this.event("custody_acknowledged", {
            queueId: row.id,
            nextPeer: row.next_peer,
            duplicate: response.duplicate ?? false,
          });
        } catch (error) {
          const attempts = Number(row.attempts) + 1;
          const delay = Math.min(
            this.config.retryBaseMs * 2 ** Math.min(attempts, 6),
            10_000,
          );
          this.db
            .prepare("UPDATE queue SET attempts=?,next_attempt_ms=? WHERE id=?")
            .run(attempts, Date.now() + delay, row.id);
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private transmit(
    nextPeer: string,
    raw: string,
  ): Promise<{ duplicate: boolean }> {
    const target = this.config.neighbors[nextPeer];
    if (!target) return Promise.reject(new Error("non-adjacent target"));
    const packet = JSON.parse(raw) as WirePacket;
    const frame = JSON.stringify({
      senderId: this.config.peerId,
      packet,
      signature: b64(
        sodium.crypto_sign_detached(
          canonical(packet),
          unb64(this.identity.signingPrivateKey),
        ),
      ),
    });
    return new Promise((resolve, reject) => {
      const socket = connect(target.port, target.host ?? "127.0.0.1");
      this.sockets.add(socket);
      let settled = false;
      const finish = (error?: Error, value?: { duplicate: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.sockets.delete(socket);
        error ? reject(error) : resolve(value!);
      };
      const timeout = setTimeout(() => {
        socket.destroy();
        finish(new Error("connect timeout"));
      }, this.config.connectTimeoutMs);
      let buffer = Buffer.alloc(0),
        expected: number | undefined;
      socket.once("connect", () => {
        const data = Buffer.from(frame);
        const prefix = Buffer.alloc(4);
        prefix.writeUInt32BE(data.length);
        socket.write(Buffer.concat([prefix, data]));
      });
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        if (buffer.length > this.config.maxFrameBytes + 4) {
          socket.destroy();
          finish(new Error("response frame limit"));
          return;
        }
        if (expected === undefined && buffer.length >= 4) {
          expected = buffer.readUInt32BE(0);
          buffer = buffer.subarray(4);
          if (expected <= 0 || expected > this.config.maxFrameBytes) {
            socket.destroy();
            finish(new Error("response frame limit"));
            return;
          }
        }
        if (expected !== undefined && buffer.length >= expected) {
          socket.end();
          try {
            const response = JSON.parse(
              buffer.subarray(0, expected).toString("utf8"),
            ) as Record<string, unknown>;
            strictKeys(
              response,
              [
                "protocol",
                "responseType",
                "senderId",
                "custody",
                "packetDigest",
                "duplicate",
                "signature",
              ],
              "custody response",
            );
            const expectedIdentity = this.requireTrusted(nextPeer);
            const { signature, ...unsigned } = response;
            const expectedCustody =
              packet.type === "envelope"
                ? packet.envelope.messageId
                : packet.receipt.messageId;
            if (
              response.protocol !== PROTOCOL ||
              response.responseType !== "custody" ||
              response.senderId !== nextPeer ||
              response.custody !== expectedCustody ||
              typeof response.signature !== "string" ||
              response.packetDigest !==
                createHash("sha256").update(frame).digest("base64") ||
              !sodium.crypto_sign_verify_detached(
                unb64(response.signature),
                canonical(unsigned),
                unb64(expectedIdentity.signingPublicKey),
              )
            )
              throw new Error("invalid custody response");
            finish(undefined, { duplicate: response.duplicate === true });
          } catch (error) {
            finish(error as Error);
          }
        }
      });
      socket.once("error", (error) => finish(error));
      socket.once("close", () => {
        this.sockets.delete(socket);
        if (!settled)
          finish(new Error("connection closed before complete response"));
      });
      socket.once("end", () => {
        if (!settled)
          finish(new Error("connection ended before complete response"));
      });
    });
  }

  private requireTrusted(peerId: string): TrustEntry {
    const entry = this.config.trustStore[peerId];
    if (!entry) throw new Error(`unknown peer ${peerId}`);
    return entry;
  }
  private routeFor(peerId: string): string {
    if (peerId === this.config.peerId) throw new Error("local route invalid");
    const next = this.config.routes[peerId];
    if (!next) throw new Error(`no route for ${peerId}`);
    return next;
  }
  private requireIncident(incidentId: string): void {
    if (!this.config.allowlistedIncidentIds.includes(incidentId))
      throw new Error("incident is not allowlisted");
  }
  private consumeRate(peerId: string): void {
    const now = Date.now();
    let window = this.rateWindows.get(peerId);
    if (!window || now - window.started >= 60_000) {
      window = { started: now, count: 0 };
      this.rateWindows.set(peerId, window);
    }
    window.count++;
    if (window.count > this.config.maxPacketsPerMinute)
      throw new Error("peer rate limit exceeded");
  }
  private prune(): void {
    const cutoff = Date.now() - this.config.maxClockSkewMs;
    this.db
      .prepare(
        "DELETE FROM seen WHERE message_id IN (SELECT message_id FROM seen WHERE json_extract(envelope,'$.expiresAt') < ?)",
      )
      .run(new Date(cutoff).toISOString());
    this.db
      .prepare(
        "DELETE FROM events WHERE seq NOT IN (SELECT seq FROM events ORDER BY seq DESC LIMIT 5000)",
      )
      .run();
  }
  private event(kind: string, detail: unknown): void {
    this.db
      .prepare("INSERT INTO events(at,kind,detail) VALUES(?,?,?)")
      .run(nowIso(), kind, JSON.stringify(detail));
    this.db
      .prepare(
        "DELETE FROM events WHERE seq NOT IN (SELECT seq FROM events ORDER BY seq DESC LIMIT 5000)",
      )
      .run();
  }
}

export async function startPeer(config: PeerConfig): Promise<MeshPeer> {
  return new MeshPeer(config).start();
}
