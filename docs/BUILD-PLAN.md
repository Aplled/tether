# 24-hour build plan and implemented checkpoint

**Planning date:** November 6, 2026.\
**Product name:** TBD.\
**Confirmed priority:** The response/containment/fallback loop **and** mesh are both mandatory.\
**Demo scope accepted:** November 7, 2026 — three real local peer processes; physical three-device mesh remains unverified.\
**Window supplied by user:** Saturday November 7, 2026, 10:00 → Sunday November 8, 2026, 10:00, Dallas time (`America/Chicago`, CST). In New Jersey this is 11:00 → 11:00 EST. The schedule below uses Dallas time.

## 1. Available resources

- Main machine: this Mac, confirmed.
- Possible second device: the user's iPhone, reported iOS 27.0.1. It is not yet an installed test endpoint.
- Third physical peer: **unavailable**, explicitly confirmed by the user. Do not plan on borrowing one or repeat that question.
- Existing foundation: Graphite at `/Users/vyomsingh/Projects/flowstate`; read-only audit complete. Recommend a standalone incident core plus selective inspected helpers; see [FLOWSTATE-AUDIT.md](FLOWSTATE-AUDIT.md).
- Native tooling: macOS 15.5 and Swift command-line tools found; no active full Xcode. The iPhone reports iOS 27.0.1. A compatible signed-app installation/run has not been proven; SDK version alone does not settle physical-device compatibility.
- Development staffing: lead coordinator plus up to three concurrent workers. Every implementation worker explicitly uses GPT-5.6 Sol.
- Current stage: integrated backend demo implemented and verified. UI polish, production connectors, encrypted-at-rest persistence, and physical-device mesh proof remain outside this checkpoint.

## 2. What the iPhone contributes

The phone can be an actual second participant: receive the emergency message while internet is unavailable, verify the sender, persist it, and send an authenticated acknowledgment back to the Mac. This exercises a real device boundary rather than a second terminal window.

For a native nearby transport, the iPhone needs an installable native companion with the required network permissions. A browser page on the phone does not automatically acquire the Mac app's native peer-discovery/radio capabilities. Native deployment/tooling must be proven early; exact requirements are being researched in [MESH-FEASIBILITY.md](MESH-FEASIBILITY.md).

Mac + iPhone gives two physical peers, not a three-device relay. The user explicitly has no third device, so the original physical A→B→C proof cannot be met with this inventory.

### Accepted mesh demonstration — November 7, 2026

Keep mesh as an implementation track. Build three independent local peers A, B, and C, each with its own identity, durable queue, and restricted adjacent connections. Send actual encrypted messages A→B→C and recipient-authenticated acknowledgments C→B→A. Stop/restart B, show queued recovery, and reject replay/tampering/forged receipts. Containers may add independent network isolation if suitable local tooling exists; separate processes still share the host trust/failure boundary. The forwarder must really persist and relay bytes, not fabricate receipts or drive a visual simulation.

Demonstrate a separate Mac↔iPhone link if signing/tooling can be proven. This combination demonstrates an implemented mesh protocol and potentially a physical two-device transport, while **physical three-device mesh and radio range extension remain unverified**. The user explicitly accepted this revision of the original demonstration criterion on November 7, 2026. No further scope confirmation is required. Do not spend the 24-hour window on a major OS migration solely to make phone packaging possible.

## 3. Completed preparation work

1. Backend/security contracts and the narrow demonstration narrative were finalized.
2. Flowstate was audited read-only; the implementation remained a standalone core and preserved Flowstate's local state.
3. Native Apple-device feasibility was researched without changing the Mac or phone. A signed iPhone run remains unproven and optional.
4. The accepted three-local-peer proof was implemented without a third-device procurement dependency.
5. Acceptance tests, worker ownership, evidence requirements, and explicit limitations were recorded before integration.

## 4. Three parallel tracks from the start

| Track | Dedicated owner | First concrete result |
| --- | --- | --- |
| Security and containment | Security worker | Exact-action policy and one fixed sandbox action, including denial tests |
| Domain and response | Domain/data worker, then response/MCP assignment | Deterministic graph impact, persistent incident/task/fallback state |
| Communications | Mesh worker | Three real local peer processes, encrypted forwarding and authenticated receipts, restart and replay tests; optional physical phone link |

The lead handles shared-contract review, scope, integration, evidence review, and user ideas. Communications no longer waits for the response loop to finish. Once the domain core is stable, use that worker's slot for response/MCP work. Keep the dedicated security owner throughout.

## 5. Dallas-time checkpoints

| Time | Required progress | Lead decision |
| --- | --- | --- |
| Sat 10:00–11:00 | Freeze contracts/fixture and accepted demo scope; choose local peer topology and isolated containment environment; timebox phone readiness | Do not assume unavailable physical peers or proven phone compatibility |
| Sat 11:00–14:00 | Core graph/storage and policy independently work; three local peers exchange real messages on constrained links | Distinguish actual logical-peer execution from physical network proof |
| Sat 14:00–17:00 | First fallback workflow; fixed sandbox action plus independent observation; encrypted A→B→C relay and authenticated receipt | Both tracks must be integrating; cut optional node types, connectors, and agent roles if needed |
| Sat 17:00–20:00 | Human-approved containment → verification → fallback; real MCP read/proposal; authenticated relay receipts | Reach a first full demonstration of both mandatory pillars |
| Sat 20:00–Sun 00:00 | Join incident/task messages to the same event model; exercise reconnect, restart, deduplication, and authorization rejection | Freeze feature scope; repair integration rather than add breadth |
| Sun 00:00–06:00 | Crash/timeout recovery, replay/target-swap/cross-scope tests, storage checks, repeatable reset and rehearsal | Preserve unknown outcomes; record remaining limitations and proof gaps |
| Sun 06:00–09:00 | Freeze implementation, capture real topology/action evidence, rehearse the concise demo, complete submission materials | Only fixes to demonstrated blockers; no UI redesign |
| Sun 09:00–10:00 | Final reset/rehearsal and submission buffer | Submit before the user-provided deadline |

The backend reached the mandatory logical-peer and response-loop checkpoints. Phone/radio tooling was not placed on the critical path and remains unverified.

## 6. Minimum complete demo

### Cybersecurity and continuity pillar

- A sourced, explicitly synthetic suspicious observation opens the pantry incident.
- Deterministic graph logic explains which operation is affected and why.
- A real MCP client reads scoped evidence and stores a structured response proposal.
- A participant/agent containment attempt is rejected; an authorized human can approve the exact fixed sandbox action.
- `stop_demo_scheduler` affects only the pinned disposable target. Separate evidence confirms the result while an unrelated control service remains healthy.
- The approved fallback creates persistent assignments. Evidence establishes check-in/distribution is operating on fallback, while the original provider remains untrusted/unrestored.

### Mesh pillar — accepted local-peer proof

- The original three-physical-peer criterion is superseded for this demo. Physical three-device/radio mesh remains unverified.
- The accepted criterion is the concrete three-local-peer protocol proof above, plus an optional separately demonstrated Mac↔iPhone link. User acceptance was recorded November 7, 2026.
- For either implementation, relays cannot read sensitive payloads. Duplicate, tampered, expired, or forged-receipt traffic is rejected; custody/delivery state survives restart. Removing B prevents delivery and returning B permits queued delivery.
- Record the actual host/process/device/network topology. Do not claim radio range extension or independently deployed physical peers from a one-Mac lab.

No privileged infrastructure command is accepted from peer messages. Offline coordination and privileged execution remain separate.

## 7. Scope protected against the 24-hour limit

Keep one organization, one service-control action, one incident fixture, one fallback, one MCP runtime, and one transport. Reuse only inspected components. Preserve both mandatory demo pillars by cutting breadth elsewhere: automatic containment, production connectors, universal platform support, dynamic encrypted groups, multiple autonomous agent roles, generalized onboarding, and UI polish remain outside this build.

## 8. Decisions already made and still open

**Confirmed:** both pillars mandatory; accepted three-local-peer mesh demo; optional physical phone link; 24-hour Dallas-time window; this Mac; possible iPhone reporting iOS 27.0.1; no third device; Graphite location; exact GPT-5.6 Sol worker requirement and successful launch.

**Implemented:** contracts, graph runtime, ordinary SQLite persistence, proposal-to-policy digest binding, policy and approval state, private-IPC demo broker, independent observer, modern MCP integration, verified fallback workflow and graph availability, a durable bounded injected-planner run coordinator, and the accepted local-peer transport. The integrated script records actual target generation, execution and verification IDs, task evidence, restart state, mesh custody, signed recipient receipts, and limitations. A deployed LLM provider is not implemented or claimed.

**Remaining:** encrypted-at-rest persistence, production-grade key storage, deployment isolation beyond the broker-owned disposable child process, native phone proof, physical three-device/radio mesh, production connectors, UI, and migration tooling for persisted schema changes. Existing ephemeral demo databases should be regenerated when the v1 fixture schema changes; there is not yet a general migration path for pre-checkpoint databases. See [DATA-CONTRACTS.md](DATA-CONTRACTS.md).
