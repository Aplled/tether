export const PROTOCOL = "hackutd.mesh.v1" as const;

export type CoordinationKind =
  "coordination.message" | "coordination.task_claim";

export interface MessageBody {
  kind: CoordinationKind;
  text: string;
}

export interface PublicIdentity {
  peerId: string;
  signingPublicKey: string;
  boxPublicKey: string;
}

export interface PrivateIdentity extends PublicIdentity {
  signingPrivateKey: string;
  boxPrivateKey: string;
}

export interface TrustEntry extends PublicIdentity {
  organizationId: string;
  membershipVersion: number;
}

export interface ProtectedEnvelope {
  protocol: typeof PROTOCOL;
  messageId: string;
  senderId: string;
  recipientId: string;
  organizationId: string;
  incidentId: string;
  membershipVersion: number;
  createdAt: string;
  expiresAt: string;
  ciphertext: string;
  signature: string;
}

export interface RecipientReceipt {
  protocol: typeof PROTOCOL;
  receiptType: "recipient.receipt";
  messageId: string;
  senderId: string;
  organizationId: string;
  incidentId: string;
  recipientId: string;
  envelopeDigest: string;
  outcome: "accepted";
  receivedAt: string;
  signature: string;
}

export type WirePacket =
  | { type: "envelope"; envelope: ProtectedEnvelope; hopLimit: number }
  | { type: "receipt"; receipt: RecipientReceipt; hopLimit: number };

export interface PeerConfig {
  peerId: string;
  identityPath: string;
  storePath: string;
  host?: string;
  port: number;
  organizationId: string;
  allowlistedIncidentIds: string[];
  membershipVersion: number;
  trustStore: Record<string, TrustEntry>;
  neighbors: Record<string, { host?: string; port: number }>;
  routes: Record<string, string>;
  maxFrameBytes?: number;
  maxQueueCount?: number;
  maxQueueBytes?: number;
  maxClockSkewMs?: number;
  retryBaseMs?: number;
  connectTimeoutMs?: number;
  maxPacketsPerMinute?: number;
}

export interface SendRequest {
  recipientId: string;
  organizationId: string;
  incidentId: string;
  body: MessageBody;
  ttlMs?: number;
}

export interface MessageStatus {
  messageId: string;
  state: "queued" | "in_custody" | "recipient_acknowledged" | "expired";
  recipientReceipt?: RecipientReceipt;
}

export interface InboxItem {
  messageId: string;
  senderId: string;
  organizationId: string;
  incidentId: string;
  receivedAt: string;
  body: MessageBody;
}
