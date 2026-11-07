# Security and Resilience Plan — Product Name TBD

**Status:** Researched requirements with the accepted backend checkpoint frozen and verified. Both mandatory pillars pass; production limitations remain explicit.\
**Planning date:** November 6, 2026, America/New_York.\
**Naming:** “Zero Day” is the hackathon theme, not the application name.\
**Scope:** One fictional organization, one incident, one disposable containment target, mandatory real mesh/relay proof on one proven transport, and one real MCP integration. UI design is intentionally deferred.\
**Confirmed constraints:** User-provided build window is November 7–8, 2026, 10:00–10:00 Dallas time. This Mac is confirmed, an iPhone reporting iOS 27.0.1 is possible, and no third device is available. Graphite at `/Users/vyomsingh/Projects/flowstate` has been audited read-only. The user accepted the three-real-local-peer mesh demonstration on November 7, 2026, with the physical phone link optional and physical three-device mesh unverified.

**Implementation overlay, November 7:** The current backend uses a checksum-verified private Node 26.13.0 runtime, ordinary SQLite, a fixed broker-owned disposable child process, modern stdio MCP, and libsodium sealed boxes plus separate Ed25519 signatures across three loopback peer processes. The initial system Node 26.3.1 is superseded for this project's final checks; see [RUNTIME-SECURITY.md](RUNTIME-SECURITY.md). Native Apple transport, Keychain, SQLCipher, container/network isolation, and deployed autonomous model inference are not implemented by this slice. The synthetic-only storage exception below applies. See [SECURITY-IMPLEMENTATION.md](SECURITY-IMPLEMENTATION.md), [MESH-IMPLEMENTATION.md](MESH-IMPLEMENTATION.md), and [OVERNIGHT-HANDOFF.md](OVERNIGHT-HANDOFF.md) for measured evidence; research proposals below do not imply implemented controls.

## 1. Recommended direction

Build an incident-response and continuity system whose strongest security demonstration is an enforced, observable action: report suspicious behavior → calculate operational impact → propose stopping the disposable scheduler → authorize the exact action → stop only the permitted test target → independently verify it → activate and verify a fallback.

An AI-generated recommendation is a proposal. A graph calculation is a model. A successful API response is an execution acknowledgment. None independently proves compromise, containment, recovery, or safety. Store these as different record types.

The design aligns incident preparation, detection, response, recovery, and improvement with [NIST SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final). This is architectural guidance, not NIST certification or a claim that the product satisfies an entire standard.

**Security claim we can support:** narrowly scoped actions, protected identities and data, explicit trust boundaries, and measured rejection/recovery behavior in the documented demo environment. “Fully secure” is not a technically supportable promise, especially for a hackathon prototype.

## 2. Concrete threat model

### Assets and adversaries

Protect incident records, private messages, recovery procedures, device keys, organization memberships, approvals, execution credentials, fallback task state, and evidence integrity.

Assume an attacker can join the same network, advertise a fake peer, control a relay, replay or modify messages, submit malicious graph text or tool results, possess a participant account, guess object identifiers, and interrupt connectivity. Also test compromised agent behavior and a stolen enrolled device. A compromised host administrator or authority/execution service remains a major residual risk; encryption and an AI reviewer cannot neutralize that adversary.

### Trust boundaries

| Boundary | Trusted responsibility | Untrusted input and required defense |
|---|---|---|
| Desktop renderer → local application service | Schema validation and normal user workflows | Rendered text is data; no shell, arbitrary filesystem, arbitrary fetch, or direct database writes |
| Human/agent → authority service | Current membership, action permissions, incident scope, policy version | Reject caller-supplied claims of role, approval, confidence, or organization authority |
| Planner → execution service | Exact-action authorization, target allowlist, execution state | A proposal cannot become an executable command by naming a tool |
| Execution service → disposable broker | Only predefined target operations | No model-supplied executable, arguments, container ID, network ID, URL, or Docker request |
| Peer/relay → recipient | Verify authenticated sender, recipient, envelope, freshness, deduplication | A discovered device or valid key is not automatically an organization member |
| Device → synchronization authority | Validate each incoming event against current policy | Offline events do not overwrite roles, approvals, commands, or incident closure |
| Application → remote model/provider | Minimal authorized incident context | Secrets and unrelated private records never enter prompts; remote processing requires a connection |

Use one policy implementation through every entry point. A renderer button, MCP tool, sync request, and local network message must not acquire different authority merely because they use different transports.

## 3. Authority and local-first architecture

### MVP decision

Use a **single trusted local authority service** on the demonstration coordinator's machine. It owns memberships, policies, approvals, incident transitions, and the serialized execution queue. The application's ordinary renderer and product-side agent runtime use restricted APIs. A separate broker owns the privileged infrastructure interface.

“Centralized authorization” describes one authoritative decision point; it need not mean a cloud server. The local service can operate without internet while reachable and healthy. Other disconnected devices retain cached procedures, messages, notes, and pending task updates. They cannot independently promote themselves to an execution authority. If the authority is unavailable, privileged actions stop; low-risk coordination continues.

This is a single-organization demonstration topology, not secure distributed administration. Future cloud deployment may relocate the authority while preserving the service interfaces. Do not run a cloud authority and multiple disconnected local authorities that can each spend the same approval.

### Identity is four separate things

1. **Device identity:** proof of possession of a particular device key.
2. **Verified contact:** a person verifies the device fingerprint in person, preferably by QR comparison.
3. **Organization membership:** an authority enrolls that verified key for a person or service principal.
4. **Action permission:** current policy permits that principal to perform a specific operation in a particular organization and incident.

A QR exchange grants no containment permission. A valid signature grants no managerial authority. A manager role grants no automatic incident-command authority.

Proposed minimum permissions: participants report observations and update their own assignments; coordinators activate preapproved fallbacks; incident commanders approve the one demo containment operation; agents read permitted incident context and submit proposals. Policy edits and key enrollment occur through the authority's administrative path, never through an agent tool.

The demo should avoid general public account registration and use explicitly provisioned principals with revocable, randomly generated credentials. Prove separate participant, commander, and agent identities. A local OS account is a host trust boundary; merely running several processes as the same user does not create strong isolation from same-user malware.

## 4. Exact-action authorization and safe execution

### Immutable action record

The authority generates the authoritative record containing:

`action_id`, organization, incident, authenticated requester, adapter operation, fixed target identity, normalized parameters, simulation/live mode, expected target state/version, graph snapshot/version, policy version, approval principal, created time, expiry, nonce, recovery procedure version, and idempotency key.

The approver reviews the server-produced record and concrete modeled consequences. Store an approval bound to its stable canonical representation/digest. A digest provides binding; it is not authentication by itself. An authenticated actor and trusted approval store establish authority. Any change to target, parameters, scope, state prerequisites, or policy invalidates the approval.

The execution service atomically reserves the approval for one stable execution ID and persists its dispatch intent, then rechecks current roles and target preconditions before sending the fixed operation to the broker. Concurrent submissions cannot reserve it twice or create a second execution. The reservation is durable; retries reconcile the same execution. A `user_confirmed: true` argument from an agent is never evidence of approval. This follows the independent execution and exact-action controls in [OWASP AI Agent Security](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) and [OWASP Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html).

### Crash behavior and state machine

Use execution states aligned with the architecture: `proposed → approved → reserved → dispatching → awaiting_verification → verified | failed | outcome_unknown`. Approval has its own lifecycle, including awaiting review, denial, and expiry; those are not execution outcomes. Check expiry at reservation and again immediately before external dispatch. Expiry before dispatch blocks the action and requires fresh review; expiry after an external effect does not suppress reconciliation of that effect.

An external side effect and local database transaction cannot be made magically atomic. If a crash occurs after dispatch, recover from the durable action ID and inspect the real target before retrying an idempotent operation. The broker's persisted attempt marker must not be interpreted as a successful effect. Never treat a timeout as proof that execution did not happen.

Reject stale expected versions. Serialize opposite actions against the same target. Restoring a target is a separately authorized action, not an unconditional automatic rollback; resuming a compromised workload can reintroduce risk. A verified fallback does not declare the original service secure.

## 5. Disposable containment without a management backdoor

The first and only containment operation is `stop_demo_scheduler`: stop the fixed fictional scheduling-service container mapped to `pantry-demo-scheduler`. Verify that exact container generation is stopped and the expected client can no longer reach the scheduler, while an unrelated control service remains available. Describe this as stopping a demo service; it does not establish that a real host is fully isolated, a compromise is eradicated, or an original provider is safe. Network-disconnect adapters and broader network isolation are deferred, not interchangeable alternate MVP operations.

The deployment operator creates a dedicated disposable VM or equivalent isolated demo environment containing only fictional workloads. A small broker inside that boundary is the only component allowed to access that environment's Docker control socket. App, MCP server, model runtime, and ordinary workload containers receive **no Docker socket** and no Docker TCP endpoint. Never mount the developer's main Docker socket into the app. A generic socket proxy is insufficient if it still permits arbitrary privileged Docker operations.

The broker accepts only an authenticated action ID and the narrow `stop_demo_scheduler` operation; it maps this to a startup-pinned container identity and configuration. A later recovery operation such as `restore_demo_scheduler` must be independently specified and authorized. The broker cannot create containers, execute code, choose mounts, change images, or reach production credentials. Confirm exact identity/labels and expected configuration before acting. The broker remains highly trusted and must be kept small and isolated. Docker documents why daemon control can grant powerful host filesystem access in [Docker Engine security](https://docs.docker.com/engine/security/). [Rootless mode](https://docs.docker.com/engine/security/rootless/) reduces some risks where supported; it does not replace broker isolation or fit every desktop environment.

Run test workloads as nonroot with resource limits, dropped unnecessary capabilities, no privileged mode, no host networking, no host filesystem mounts, and restricted egress. These are containment measures, not a guarantee against kernel or runtime escapes. Use no real malware or production data.

Verify through an independent probe process using a preconfigured address and expected protocol result. Prove the scheduler was reachable before stopping, unreachable from the intended client afterward, and an unrelated control service stayed available. Also inspect the permitted control-plane state through separately scoped read-only access. An arbitrary timeout alone cannot distinguish a stopped service from unrelated network failure; ambiguous evidence produces `outcome_unknown`, not `verified`.

## 6. Cybersecurity substance and evidence handling

The demonstration should include a real structured observation with provenance: collector/principal, source, observed time, received time, service identity, event ID, raw-record digest/reference, and whether the event is synthetic. A deterministic rule may flag a burst of failed authentication attempts emitted by the disposable service. That is suspicious behavior, not proof of a zero-day exploit or confirmed compromise.

Store observed facts, incident hypotheses, deterministic graph consequences, proposed actions, approvals, and verified effects separately. Preserve source records with append-only application permissions and do not let an LLM rewrite the evidence it summarizes. Record uncertainty, missing dependencies, and collector failure. This is incident evidence handling for a prototype; it is not forensic acquisition, chain-of-custody certification, or an intrusion detection system covering a real organization.

The dedicated cybersecurity implementation owner should own the authority/action contracts, threat cases, broker review, abuse tests, and release sign-off. They should review other agents' boundary-crossing changes continuously, rather than bolt on a security checklist after integration.

## 7. Communications feasibility and honest mesh claims

Choose one transport after the actual three devices and operating-system versions are known. Test installation, permissions, discovery, authenticated connection, bidirectional transfer, and reconnect before building mesh abstractions.

| Available devices | Practical first candidate | Claim allowed after proof |
|---|---|---|
| Three supported Apple devices | Native Network framework sidecar with Bonjour and explicitly enabled peer-to-peer networking | Peer-to-peer without the test access point only if measured on those devices |
| Three supported Android devices | Nearby Connections with required permissions and appropriate topology strategy | Offline direct connections; application forwarding is still our responsibility |
| Mixed desktop hardware / insufficient native tooling | TLS connections on a controlled local router or hotspot | Internet-independent local store-and-forward; dependent on that router/hotspot |

Apple documents peer-to-peer opt-in in [TN3151](https://developer.apple.com/documentation/technotes/tn3151-choosing-the-right-networking-api) and real-device permissions in [TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy). [Google Nearby Connections](https://developers.google.com/nearby/connections/overview) provides encrypted nearby links without internet; link encryption does not automatically provide sender-to-recipient encryption through an application relay. API availability is not proof that our exact three-device hardware, background behavior, and packaging work.

### Relay proof

Use three physical devices: A connects only to B, C connects only to B. Disable the direct A↔C application path using independently observable network rules/topology; a routing preference in our code is insufficient. Disconnect WAN and verify the application uses no internet service. Show A→B→C receipt and C→B→A authenticated acknowledgment. B stopping must prevent delivery; queued delivery resumes after B returns. Preserve peer topology, per-hop events, and recipient receipt evidence.

A same-LAN demonstration can prove application relay. It does not prove radio range extension, an ad hoc physical mesh, or independence from all infrastructure. A range-extension claim requires evidence that A and C cannot directly communicate at the physical/link layer while each can reach B. A sequential A↔B then B↔C demonstration proves delay-tolerant store-and-forward, not necessarily a simultaneous multihop route. No browser-only demonstration should be marketed as native radio mesh.

An unauthenticated or unencrypted transport spike may use synthetic, nonsensitive payloads to establish feasibility. It does not satisfy the acceptance criteria for secure messaging; label its proof accordingly until enrollment, message authentication, and sender-to-recipient encryption are verified.

## 8. Message identity, encryption, replay, and revocation

**Apple-first refinement:** Given the user's Mac/possible-iPhone inventory, the [mesh feasibility research](MESH-FEASIBILITY.md) recommends built-in CryptoKit HPKE plus separate sender/receipt signatures on compatible iOS 17+/macOS 14+ targets. That is the preferred candidate for the proposed native Swift peer, subject to actual phone/toolchain proof and envelope review. The libsodium option below remains an alternative for inspected targets, not a requirement to add bindings unnecessarily.

Use maintained platform/library cryptography, an OS random generator, separate signing/encryption keys, and versioned encodings. Do not invent a cipher, key agreement, handshake, group key distribution scheme, or ratchet. A plausible narrow implementation uses established libsodium authenticated public-key encryption for each intended recipient and detached Ed25519 signatures for publicly verifiable sender envelopes; security review must check the envelope binding and supported language bindings before implementation. See [libsodium authenticated encryption](https://doc.libsodium.org/public-key_cryptography/authenticated_encryption) and [public-key signatures](https://doc.libsodium.org/public-key_cryptography/public-key_signatures). Do not claim forward secrecy or post-compromise security for static-key encrypted messages.

Bind the immutable envelope to protocol version, organization, incident, message ID, sender key ID, recipient key ID, membership epoch, created/expiry times, and ciphertext. The same routing-critical values must be covered by authentication and checked against the decrypted payload to prevent substitution. Sign exactly the specified bytes; never rely on inconsistent JSON serialization. Relay routing metadata is distinct from the authenticated payload. Relays must not decrypt sensitive contents.

For the MVP, send separate encrypted copies to a small, preenrolled recipient list. Defer general group membership/key rotation and large dynamic groups. The broker/execution service never interprets a chat message as a command.

Persist seen message IDs and authenticated sender identifiers across restart. A replay after restart must remain a replay. Use expiration plus bounded clock-skew handling, receiver receipt time, and persistent deduplication; timestamps alone are not replay protection. Unknown membership epochs, impossible clocks, stale membership snapshots, and expired messages become untrusted/pending or rejected according to explicit policy. Do not renew freshness merely because a relay resends an old message.

Delivery states distinguish queued, accepted by relay, received by intended recipient, and acknowledged by that recipient. Only a valid recipient-authenticated receipt advances to recipient delivery. Malicious relays may drop, delay, reorder, duplicate, or withhold receipts; the protocol cannot guarantee availability.

Bound message sizes, queue sizes, retries, peer counts, per-sender rates, and deduplication storage. A hop counter helps honest forwarding but is not a hard defense against a relay resetting mutable metadata. Avoid advertising organization names, person names, incident contents, or stable device fingerprints during open discovery. Traffic timing and adjacency metadata still leak.

Revocation cannot propagate instantly to partitioned devices. Cached membership needs an explicit age limit; after it expires, coordination messages may be shown with reduced trust, while privileged operations remain unavailable. A lost key may expose old static-key ciphertext; revoking it cannot erase data already received. Recovery means reenrollment, fresh keys, recipient updates, and documenting the exposure window.

## 9. Local data and key protection

Local-first means data persists locally; it does not mean encrypted. Store device private keys and the local database wrapping key through platform secret storage, using [Apple Keychain](https://developer.apple.com/documentation/security/storing-keys-in-the-keychain) on the initial macOS target. If Android is selected, use supported [Android Keystore](https://developer.android.com/privacy-and-security/keystore) operations; hardware backing and supported algorithms vary by device. Do not claim every key is hardware protected, especially exportable library keys.

Use a maintained encrypted SQLite distribution such as SQLCipher for cached procedures, messages, and incident data, with a random database key protected by the OS store. **The selected Node runtime, native driver, operating system, and packaging combination must pass an encrypted-driver compatibility gate before sensitive data is allowed.** Confirm the actual deployed binding supports encryption and validate wrong-key failure. SQLite, browser storage, JSON files, and ordinary preferences are not encrypted databases. SQLCipher documents encrypted database pages and the importance of temporary-store configuration in its [security design](https://www.zetetic.net/sqlcipher/design/).

Test journal/WAL behavior, temp files, exports, crash logs, backups, and attachments; database encryption does not cover plaintext copied elsewhere. Redact secrets and message bodies from logs. Minimize cached data by role. Device unlock and a compromised running process can expose plaintext, and same-user malware may access an unlocked secret store. Disk encryption, screen locking, and least-privilege processes remain relevant. **Fallback if the compatibility gate fails:** an ordinary SQLite demonstration may proceed with synthetic, nonsensitive fixture data only, and must explicitly report encryption at rest as unmet. Do not put real procedures, messages, participant data, or private keys in that unencrypted database, and do not describe ordinary SQLite as encrypted.

## 10. MCP, product agents, and hostile inputs

Start with one reviewed local `stdio` MCP server and one real client, exposing only authorized graph/incident reads, simulation, and structured proposal submission. Keep execution, role edits, credential access, arbitrary shell, arbitrary SQL, file traversal, URL fetching, and unrestricted posting out of the tool surface. Run the server with a minimized environment and scoped credentials. `stdio` avoids a listening endpoint; it does not sandbox the subprocess. Pin reviewed tool schemas and package versions, and treat descriptions and return values as untrusted attack surfaces, consistent with [OWASP MCP Security](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html).

If HTTP MCP becomes necessary, implement the authorization flow supported by the pinned SDK and client, with validated issuer, audience/resource, expiry, and scopes; do not pass upstream tokens through as if they were ours. Use HTTPS off-host. The [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) distinguishes HTTP authorization from environment-provided `stdio` credentials. Current [Streamable HTTP guidance](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) requires Origin validation and recommends localhost binding for local servers. The July 2026 revision removed protocol-level sessions; do not implement old session assumptions while claiming the new revision. Explicitly choose and test the SDK/client protocol combination.

Treat graph descriptions, incident feed text, imported files, peer messages, tool results, and other agents' output as data. Parse structured output with strict schemas, bounded lengths and enums; reject extra properties. Source-tag evidence and provide identifiers so recommendations can be checked. Do not persist arbitrary tool text as trusted agent memory. An independent risk-review model is useful commentary but cannot grant authority or replace deterministic policy. Prompts, classifiers, and delimiters reduce exposure; none guarantees prompt-injection prevention.

Use bounded agent runs: explicit input event ID, immutable context version, tool budget, token/cost limit, wall-time limit, no recursive spawning, cancellation, and idempotent proposal insertion. A proposal records the agent identity, evidence references, assumptions, modeled effects, and requested action. MCP is an interface; a separate event worker schedules agent activity. Remote inference stops without its required network/compute; deterministic services and cached procedures continue.

## 11. Network, secret, and organization safety

For the demo, prefer fixed endpoint identifiers resolved by trusted configuration instead of caller-supplied URLs. The verification probe may reach its exact sandbox endpoint; ordinary model tools cannot reach loopback services, cloud metadata, local-network addresses, or arbitrary hosts. If later supporting URL ingestion, validate destination and scheme, forbid unexpected redirects, check IPv4/IPv6 and DNS changes, and enforce an outbound proxy/firewall. [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) supports allowlisting and network controls; MCP adds risks around discovery URLs and local services in its [security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices).

Keep runtime execution credentials only in the broker/secret store. Never embed administrator keys in the renderer, mobile bundle, logs, source control, screenshots, or model prompts. Prevent arbitrary environment inheritance into agents and MCP subprocesses. Separate development credentials from runtime product identities.

Bind organization context to an authenticated principal and membership check, not an `org_id` argument. Scope every graph query, message, proposal, approval, task, cache key, event queue, export, and audit lookup. Include an unauthorized second-organization fixture even if the demo serves one organization. Opaque IDs are not authorization. See [OWASP Multi Tenant Security](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html).

If Tauri is retained, explicitly scope custom commands and plugin capabilities, bundle trusted application content, restrict navigation and content sources, and never grant remote pages native capabilities. Tauri's own documentation notes that registered custom commands need explicit configuration and capability boundaries do not correct insecure Rust command logic: [Tauri capabilities](https://v2.tauri.app/security/capabilities/). This is a security boundary requirement, not a UI-design task.

## 12. Synchronization conflicts and audit limits

Assign immutable event IDs and persist accepted-event deduplication. Merge independent chat records as an authenticated set. For task updates, enforce ownership and expected version; a stale completion cannot silently overwrite reassignment. Divergent graph edits require conflict records or explicit resolution. Preserve both timestamps: source observation and authority receipt; do not infer a reliable global chronology from unsynchronized clocks.

Never merge approvals, infrastructure commands, membership changes, key revocations, incident closure, or recovery verification using last-write-wins. Revalidate these with the reachable authority and current state; expired approvals are not resurrected by sync. MVP offline updates are proposals/notes until accepted by the authority. No distributed consensus or privileged offline capability tokens are needed for this demo.

Audit records include actor and agent ID, organization, event/action ID, source time, receipt time, policy version, decision/reason, approval binding, execution attempts, independent probe evidence, and unknown outcomes. Preserve failures and denials without logging private payloads or tokens. Protect and test the logging path as recommended by [OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

A hash chain can reveal edits relative to a separately trusted checkpoint. If one compromised host controls the log, keys, and checkpoints, it can rewrite the chain or truncate the tail. Local append-only application permissions are not tamper-proof storage. MVP language should be “auditable event history”; use “tamper-evident” only after verifying an independently stored or witnessed checkpoint. Do not call it immutable.

## 13. High-value acceptance and abuse tests

These are required behavior tests for consequential boundaries, not tests of superficial implementation details.

| Test | Required result |
|---|---|
| Participant, agent, or wrong-organization principal requests containment | Denied with attributable audit event; target unchanged |
| Approval target/parameters/mode/policy/version changed after review | Approval invalidated; no broker call |
| Same approval submitted twice and concurrently | One durable authorized action at most; no duplicate effect |
| Approver loses role, approval expires, or target changes before dispatch | Reject and request fresh authority decision |
| Crash just before/after dispatch; response lost | Recover actual state; no fabricated success or blind repeated non-idempotent action |
| Malicious incident text says to disable policy, exfiltrate keys, or run a shell | Agent cannot acquire those tools/credentials; proposal/action rejected independently |
| MCP tries arbitrary URL, raw SQL, filesystem traversal, unknown tool, extra properties | Schema/scope rejection before side effect |
| Probe fails while unrelated control target also fails | Outcome unknown; no false containment verification |
| Isolation/restoration against wrong or recreated container | Reject identity/configuration mismatch |
| Same peer message replayed after process restart | One visible authenticated message; no repeated workflow mutation |
| Ciphertext, recipient, sender key, incident, or expiry modified | Authentication/binding validation rejects it |
| Relay drops messages or claims recipient delivery | Remain uncertain unless recipient-authenticated receipt arrives |
| Lost/revoked device, old membership epoch, expired cached membership | No privileged execution; trust downgrade/rejection follows explicit policy |
| Delayed task completion conflicts with reassignment | Conflict shown/preserved; current task not silently overwritten |
| Internet removed and authority unavailable | Cached procedures/allowed local coordination continue; privileged commands stop |
| Peer floods messages, malformed payloads, or oversized envelopes | Enforced resource bounds; bounded error handling and retry |
| Encrypted database opened with wrong key; storage/log scan after use | Wrong-key failure; no plaintext secrets in covered files; uncovered copies documented |
| `stop_demo_scheduler` followed by fallback verification | Exact fixed container stopped; unrelated service available; workflow marked operating on fallback |

Measure and retain evidence for the final two-device and three-device transport tests. Do not replace physical-device proof with mocks. A focused test suite should also validate graph AND/OR alternatives, cycles, unknown dependencies, and the distinction between modeled impact and observed service health.

## 14. MVP, deferred work, and decision gates

**MVP must deliver:** one authoritative policy path; separate participant/commander/agent principals; exact one-use approval; one isolated broker action; independent verification and recovery states; encrypted local persistence with OS-protected keys or the explicitly documented synthetic-only exception; one real MCP read/propose integration; a complete evidence timeline; and relevant abuse tests above. Any communications capability claimed as delivered must include verified enrollment/authentication, honest delivery/replay handling, and sender-to-recipient encryption for sensitive contents.

**Accepted mandatory protocol goal, November 7, 2026:** encrypted relay across three real local peer processes with separate identities/stores, actual forwarding and signed recipient receipts, persistent queues, replay/tamper rejection, and relay restart recovery. A separate Mac↔iPhone physical link is optional if setup works. This supersedes the original physical demo criterion. It does not prove physical three-device/radio mesh, range extension, host independence, or resistance to a compromised shared OS. Native access-point-independent claims still require measured physical tests.

**Defer:** production infrastructure connectors, automatic production containment, arbitrary scanners/exploits, general remote MCP OAuth hosting, arbitrary third-party MCP installation, dynamic encrypted groups, ratcheting/forward secrecy, multi-authority consensus, privileged offline execution, cross-platform native radio support, background delivery guarantees, remote wipe, full forensic acquisition, and regulatory/security certification.

**Cannot honestly solve during the hackathon:** compromised OS/kernel/authority, perfect prompt-injection resistance, internet-scale peer discovery, instant offline revocation, guaranteed mesh delivery, arbitrary graph accuracy, mature cryptographic protocol assurance, complete distributed audit integrity, and broad production incident detection.

The local-peer scope is accepted; no direction approval remains pending. Choose its constrained topology, freeze contracts, and resolve isolated broker tooling during implementation. iOS 27.0.1/no third device are confirmed and Flowstate audit is complete. A native phone installation/run test is optional and timeboxed, not assumed possible from SDK-version matching. See [BUILD-PLAN.md](BUILD-PLAN.md) and [MESH-FEASIBILITY.md](MESH-FEASIBILITY.md). The lead reviews boundaries; every implementation worker uses GPT-5.6 Sol. Exact-model launch is verified. If future selection fails, report it rather than substitute.
