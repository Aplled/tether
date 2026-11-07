# Local logical-peer mesh implementation

## Implemented proof boundary

The mesh slice runs three actual Node processes on one Mac. Each peer has its own long-lived Ed25519 signing keypair, Curve25519 sealed-box keypair, TCP listener, configuration, private identity file, and SQLite store. The configured graph is A↔B↔C. A and C do not enroll one another as adjacent links, so a link frame signed directly by A is rejected at C even though A is a known organization member. Routing from A to C names B as the only next hop.

This demonstrates the accepted logical-peer protocol. It does not demonstrate three physical devices, radio behavior, separate OS-user isolation, or resistance to a malicious administrator of the shared Mac.

## Public API and daemon contract

`packages/communications/index.ts` exports:

- `createIdentity(identityPath, peerId)` and `readPublicIdentity(identityPath)`
- `startPeer(config)` returning a `MeshPeer`
- `peer.send(request)`, `peer.status(messageId)`, `peer.inbox()`, `peer.events()`, and `peer.stop()`

`apps/mesh-peer/index.ts --config <path>` wraps that API as a JSON-lines process. It emits `ready` and accepts `send`, `status`, `inbox`, `events`, `prove_cannot_decrypt`, and `shutdown`. Every command has a caller-provided `requestId`. The peer has no arbitrary command, URL fetch, role update, approval, policy change, or infrastructure action operation. Accepted message bodies are strictly either `coordination.message` or `coordination.task_claim`, with no extra fields.

Each config pins organization ID, membership version, allowed incident IDs, all trusted public keys, adjacent peers, and routes. Enrollment and key distribution are out of band in this demo.

## Protocol behavior

The sender validates and canonicalizes the coordination body, encrypts it to the final recipient with libsodium `crypto_box_seal`, and signs the complete immutable envelope with its separate Ed25519 key. Signed fields include protocol version, message ID, sender, final recipient, organization, incident, membership version, creation and expiry times, and ciphertext. Relays verify the original signature and scope but cannot open the final recipient's sealed ciphertext.

Each hop uses a separately signed link frame. The receiving peer verifies that the immediate sender is an allowlisted adjacent peer, verifies its link signature, durably stores the packet, and only then returns a signed custody response bound to the message ID and SHA-256 digest of the exact link frame. Custody is queue evidence, not final delivery evidence.

C decrypts and inserts an inbox item transactionally, then signs a recipient receipt binding the original message ID, sender, organization, incident, recipient, accepted outcome, receipt time, and SHA-256 digest of the canonical complete protected envelope, including its ciphertext and sender signature. B persists and reverse-forwards that receipt only when it matches B's stored original envelope. A persists its own sender ID and expected envelope digest when sending, and marks a message `recipient_acknowledged` only after verifying C's signature and every binding against that durable outbound record. This prevents an enrolled relay from replacing A's envelope with a different relay-signed envelope that reuses A's message ID and then presenting the resulting valid C receipt to A. A valid duplicate at C does not create a second inbox item and requeues the cached receipt. B also caches and requeues matching final receipts, allowing receipt recovery after a crash.

SQLite uses WAL and `synchronous=FULL`. Queue inserts occur before custody responses. Queue count and bytes, frame size, inbox/seen/outbound records, event retention, incident scope, TTL, clock skew, hop count, per-adjacent-peer packet rate, connect/frame timeouts, and retry backoff are bounded. Expired protected envelopes remain unacceptable after dedup records are pruned because expiry is signed. The mutable hop counter bounds honest forwarding only; a malicious relay can alter it, drop, delay, reorder, duplicate, or analyze metadata.

Private identity JSON files are created with mode `0600`. They and SQLite contents remain plaintext on the local filesystem. There is no keychain, encrypted-at-rest, transport privacy, or same-user process isolation claim.

## Run and verify

```sh
npm ci --ignore-scripts
npm run typecheck
node --test packages/communications/test/*.test.ts
node scripts/mesh-demo.ts --output /tmp/hackutd-mesh-evidence
```

The demo creates three child processes, delivers an initial A→B→C message, and verifies B's real decryption attempt fails. It then stops C, sends a second message while B is live, waits until A has B's signed custody response and B has the durable forward queue, and proves B still cannot decrypt it. The runner sends `SIGKILL` to its own B child, restarts C and B with their same stores, and waits for C's signed receipt to return to A. C retains exactly one visible inbox item for the restarted delivery. The demo writes machine-readable `evidence.json`, per-peer configs, identities, databases, and process event evidence in the requested output directory. The runner tracks and stops only its own child PIDs.

The integration/security tests exercise real child-process networking and persistence plus altered ciphertext, a receipt signed by the wrong peer, a malicious enrolled B replacing A's envelope with a different B-signed payload under A's message ID, a signed direct A→C link attempt, a correctly signed expired envelope, cross-incident sending, and exact-envelope replay after C restarts. The substituted receipt is rejected and A remains unacknowledged until C receives the genuine envelope. Replay returns the cached valid receipt while leaving one visible inbox item. Receipt-binding columns are mandatory; synthetic stores made by the earlier insecure schema are rejected and must be regenerated rather than accepted through a legacy fallback.

## Cryptographic sources and limitations

- [Libsodium sealed boxes](https://doc.libsodium.org/public-key_cryptography/sealed_boxes) provide recipient confidentiality but do not authenticate the sender; this implementation adds a separate full-envelope signature.
- [Libsodium public-key signatures](https://doc.libsodium.org/public-key_cryptography/public-key_signatures) documents Ed25519 detached signatures used for envelopes, link frames, custody responses, and recipient receipts.
- [Node `node:sqlite`](https://nodejs.org/api/sqlite.html) provides the synchronous SQLite API used for durable local state.
- [Node `net`](https://nodejs.org/api/net.html) provides the loopback TCP byte stream. Frames use a four-byte length prefix and enforce maximum lengths and timeouts.

Sealed boxes use and erase an ephemeral sender key, but they provide no protection for retained ciphertext after compromise of the recipient's long-term private key; this protocol makes no ratchet or post-compromise recovery claim. Revocation cannot retract ciphertext already cached by an offline enrolled device. A compromised endpoint can disclose its own keys and plaintext. Link traffic reveals metadata and is not encrypted separately from the end-to-end ciphertext. Queue/inbox capacity exhaustion rejects new work rather than silently evicting accepted messages. This prototype is suitable for synthetic demo data, not production secrets.

The trust store pins one static membership version for the whole demo. Peers reject envelopes from another version, but the snapshot itself has no issued-at age or automatic expiry and is reloaded unchanged after restart. Revocation therefore requires an explicit out-of-band configuration update on every peer; a disconnected peer can continue trusting its stale snapshot until that update arrives. The implementation does not claim a cached-membership age gate.
