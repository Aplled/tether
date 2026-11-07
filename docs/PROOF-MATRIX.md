# Backend proof matrix

This is the evidence boundary for the accepted hackathon slice. Broader PRD features remain roadmap requirements. Final commands, counts, and artifact hashes belong in the overnight handoff.

| Capability | Implemented boundary | Verification | Important limit |
| --- | --- | --- | --- |
| Dependency impact | Deterministic ALL/ANY/optional evaluation; separate availability, subject trust, and evidence freshness; conservative unknown/cycle handling | `packages/graph-core/test/evaluate.test.ts` | A graph models recorded dependencies; it does not discover a real organization's complete topology |
| Durable local state | Canonical SQLite records, CAS revisions, events/outbox in one transaction, consumer deduplication | `packages/storage/test/store.test.ts` | Ordinary SQLite is unencrypted; synthetic data only |
| Human workflow | Scoped actors, assigned commander, task ownership, exact task evidence, time-derived freshness, atomic fallback/incident transition | `packages/workflows/test/service.test.ts` | Demo human personas are scripted fictional actors |
| Action authority | Exact immutable action digest, current authority/version/target checks, expiring single-use approval, stable execution identity, durable denials | `packages/policy/test/policy.test.ts` | One trusted local authority; same-user malicious processes remain a residual risk |
| Containment | Separate private-IPC broker owns one disposable scheduler child; no caller-selected PID, URL, executable, shell, or Docker socket | Policy/broker live-effect tests and integrated demo | Process stopping only; no host, network, container, malware-eradication, or production isolation |
| Independent verification | Scheduler probe, healthy control probe, and broker-owned stopped state must agree | Live-effect and observer-failure tests | Loss of observation remains `outcome_unknown`; a broker receipt alone is insufficient |
| MCP | Official client/server 2.4.0 over real stdio, negotiated modern `2026-07-28`, eight scoped read/simulate/propose tools | `npm run mcp:smoke`; integrated demo | No approval, execution, shell, raw SQL, arbitrary fetch, or device-enrollment tool |
| AI reasoning through MCP | Lead coding agent read actual structured evidence, simulated the stop, and submitted an evidence-linked cautious proposal once | [Sanitized AI MCP trace](evidence/AI-MCP-REVIEW.json) | This is a coding-agent client demonstration, not a deployed autonomous provider-backed runtime |
| Encrypted relay | Three actual loopback peer processes with distinct keys/stores, sealed ciphertext, full-envelope Ed25519 signatures, signed hop custody and recipient receipts | `packages/communications/test/*.test.ts`; `npm run demo:mesh` | One Mac and OS user; physical three-device/radio mesh remains unverified |
| Exact receipt binding | Recipient signature binds original sender and SHA-256 of the complete immutable encrypted envelope; sender/relay compare against durable expectations | Real malicious-B substitution regression in communications security tests | A valid receipt for a different envelope cannot acknowledge A's original, even when a relay reuses its message ID |
| Replay/tamper rejection | Persistent seen IDs and cached receipts, signed scope/expiry, strict framing, queue/rate bounds | Communications adversarial tests | A malicious relay can still drop, delay, reorder, and inspect metadata |
| Relay crash recovery | C offline; B queues before signed custody; B receives actual SIGKILL; B/C restart from the same stores; one C delivery and signed receipt | Standalone mesh assertions and communications tests | This is actual process-kill proof on one host |
| Stored proposal to action | Trusted coordinator binds canonical proposal and response-context digests to one policy action and target generation; rechecks before dispatch | `packages/response/test/coordinator.test.ts` | Context changes fail closed and require a new reviewed proposal |
| Policy to domain recovery | Stable target/graph evidence identities, partial-write reconciliation, exact live verified execution checks | Projection fault injection with both domain/policy DBs closed and reopened | This is durable DB-reopen proof, not a SIGKILL test; separate databases do not share one atomic transaction |
| Product-agent run control | Durable trigger deduplication, scoped budgets/deadlines, ownership fencing, tracked background calls, canonical submission proof, explicit uncertainty and no guessed retry | `packages/agent-orchestration/test/coordinator.test.ts`; `npm run agent:demo` | An orchestration engine with an injected planner is distinct from an integrated external model provider |

## Explicitly incomplete production controls

Encrypted-at-rest persistence, OS-protected device keys, independent host isolation, production connectors, native iPhone packaging, physical/radio mesh, dynamic enrollment/revocation propagation, general schema migrations, and security certification are not established by this prototype. No real malware, participant information, production credentials, or real operational procedures are needed to run it.

An advisory-free dependency audit, high test coverage, and a successful demonstration are useful evidence, but none proves complete security.
