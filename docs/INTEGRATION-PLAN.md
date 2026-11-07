# First integrated backend demonstration

**Status: implemented and verified November 7, 2026.** The work order below records the accepted scope. Actual final test results, public proof artifacts, and limitations are in [OVERNIGHT-HANDOFF.md](OVERNIGHT-HANDOFF.md) and [PROOF-MATRIX.md](PROOF-MATRIX.md); this specification alone is not test evidence.

## Ownership

The integration worker will own `apps/authority/**`, `apps/mcp-server/**`, `apps/agent-runtime/**`, `scripts/demo.ts`, integration-specific tests, and the root README. Root package/lock/config changes require handoff from the domain owner. Existing security/domain/mesh modules remain single-writer owned by their workers.

## Application boundary

- Compose the canonical domain services and the policy engine without reimplementing either.
- Provision distinct participant, commander, coordinator, and agent identities from trusted local configuration. API callers supply opaque credentials or inherited stdio identity, never trusted role claims. Keep generated credentials private; do not log or commit them.
- Use one explicitly scoped MCP agent principal with read/simulate/propose tools. No approval, execution, arbitrary SQL, URL fetching, files, shell, enrollment, role changes, or broad posting tools.
- Validate inputs strictly. Treat graph descriptions and peer/tool content as untrusted data. Resolve organization/incident permissions on every service read/write, including lookup and error responses.
- Use the real compatible installed official MCP SDK and a separate client process/transport. Record the actual negotiated protocol revision. Do not implement a pretend MCP JSON endpoint or claim a revision it does not speak.
- A functioning real MCP client is distinct from a deployed autonomous LLM. If no model credential is available, expose an explicit client bridge so the coding agent can read actual MCP results and submit its structured proposal, and label any scripted deterministic planner honestly. Never scan user credential files or claim a live model invocation that did not happen.

## Scenario and proof order

1. Create a private temporary/runtime directory, fixture organization, roles, seeded graph, and disposable scheduler through the broker. Capture actual target generation and a healthy baseline/control check.
2. Record explicitly synthetic suspicious evidence and deterministic graph impact, keeping availability, security trust, and freshness separate.
3. Through a real MCP client, list tools, read scoped incident/dependencies/tasks, simulate containment without effects, and store a structured evidence-linked proposal.
4. Demonstrate that the agent and participant cannot approve or execute, cross-organization reads fail, and malicious proposal fields/targets cannot broaden authority.
5. A trusted commander path reviews and approves the exact fixed action. Dispatch through PolicyEngine using its single-use/durable execution ID.
6. Independently verify the actual target stop plus healthy control, preserving `outcome_unknown` for observer/control failure. Record the narrower broker-owned local-process boundary if containers/VM were not used.
7. Project the verified outcome into domain evidence, approve/activate the fixed fallback, create persistent owned tasks, and require valid trusted evidence before task verification and `running_on_fallback`.
8. Send incident coordination over actual mesh peer processes; capture recipient-authenticated acknowledgment. Stop/restart the relay and demonstrate durable recovery. No peer message may authorize infrastructure actions.
9. Restart domain/policy services, reread the incident/timeline/tasks, and demonstrate no duplicate execution/proposal/task/message effect.
10. Produce sanitized JSON evidence and a readable concise report with actual assertions and limitations. Dispose only processes and temporary resources created by this run; do not kill unrelated services.

## Persistence and security limits

- Domain and policy stores may be separate SQLite databases. Do not claim a transaction spans both. Persist references and reconcile projections from verified policy executions without repeating effects.
- Any ordinary SQLite store is synthetic-data-only, with encryption at rest explicitly unmet. Private key files need private directories and restrictive permissions; do not call that Keychain or hardware-backed protection.
- Three local peers share OS and hardware. Encryption protects relay payload access in the application protocol, not against an administrator of the shared host.
- All health targets and broker operations must resolve through fixed local configuration; external inputs never choose a PID, executable, Docker request, arbitrary URL, or credentials.

## Verification and morning output

Run one coherent end-to-end test after module unit tests pass. Include real MCP child-client behavior, actual service stop, independent observation, fallback/restart persistence, mesh relay/restart, and consequential rejection paths. Test meaningful behavior rather than mirroring implementation. Record test commands, counts, exact output artifacts, protocol revision, and each incomplete claim in README and the overnight handoff.

Verified commands use the private runtime wrapper: `./scripts/dev.sh run typecheck`, `./scripts/dev.sh test`, `./scripts/dev.sh run demo`, `./scripts/dev.sh run demo:mesh`, `./scripts/dev.sh run mcp:smoke`, and `./scripts/dev.sh run agent:demo`.
