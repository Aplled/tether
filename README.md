# HackUTD continuity and incident-response backend

This repository contains a synthetic, local-only demonstration of two mandatory paths:

1. a scoped incident response loop from structured observation through deterministic impact analysis, bounded MCP proposal, exact-action approval, a real stop of one disposable broker-owned scheduler process, independent verification, persistent fallback tasks, and restart recovery;
2. encrypted A→B→C coordination across three real local peer processes with durable relay custody, a signed final-recipient receipt, replay rejection, relay `SIGKILL`/restart recovery, and no direct A→C adjacency.

“Zero Day” is the event theme. The product has no final name.

The current scope and proof criteria are recorded in [PRD.md](PRD.md), [docs/AGENT-ORCHESTRATION.md](docs/AGENT-ORCHESTRATION.md), and [docs/PROOF-MATRIX.md](docs/PROOF-MATRIX.md).

The November 7 checkpoint passes 60 tests, typecheck, formatting, MCP, agent-run, and integrated demos from a clean dependency install. [Verification evidence](docs/evidence/VERIFICATION.json) and the [overnight handoff](docs/OVERNIGHT-HANDOFF.md) record the exact proof and remaining limits.

## Run

Use the project wrapper with its checksum-verified private Node 26.13.0 runtime. The first invocation downloads the official macOS archive; it leaves global Node and other projects untouched. See [runtime security notes](docs/RUNTIME-SECURITY.md).

```sh
./scripts/dev.sh ci --ignore-scripts
./scripts/dev.sh run typecheck
./scripts/dev.sh test
./scripts/dev.sh run mcp:smoke
./scripts/dev.sh run agent:demo
./scripts/dev.sh run demo:mesh
./scripts/dev.sh run demo
```

The integrated demo writes `evidence.json`, `report.md`, three mesh peer stores/configs, and fictional fallback artifacts under the requested output directory. Its stdout prints the exact artifact paths. It validates every success claim before printing `ok:true` and cleans up its MCP client, policy/domain stores, broker-owned process, and mesh children on failure or completion.

Each demo creates a fresh private temporary directory by default. Use `-- --output /path/to/a/fresh/demo-directory` to choose a location; keep generated identities, authority configuration, and databases out of source control.

For an interactive local-operator demo, `./scripts/dev.sh run demo -- --manual-approval` prints the exact fixed action and canonical digest to stderr, then requires that digest on stdin within 60 seconds before the trusted commander approval call. Missing, oversized, or mismatched input aborts before execution. This is a reviewable local demo path, not production authentication. The default remains a scripted synthetic approval, and unattended runs do not claim human review.

## MCP bridge for an actual coding-agent run

The MCP server uses the official split TypeScript SDK 2.4.0. The child client pins and verifies protocol revision `2026-07-28` in the modern era. It exposes exactly eight tools: incident, timeline, dependency, impact, simulation, fallback, task, and proposal operations. There is no MCP approval, execution, role, enrollment, SQL, file, URL, shell, or infrastructure tool.

The trusted launcher creates a private `authority.json` and a random opaque credential without printing it. A client with a launcher-provisioned `HACKUTD_MCP_CREDENTIAL` can use the real MCP protocol bridge; do not paste credentials into shell history:

```sh
./scripts/dev.sh run mcp:tool -- --config /private/runtime/authority.json --tool list
```

`scripts/mcp-tool.ts` also accepts `--tool <name> --args '<strict JSON>'`. The integrated scripted proposal is labeled deterministic fixture input. A live coding-agent invocation through this bridge is separate evidence and is never inferred from a successful scripted client call.

The lead coding agent also completed a real MCP bridge review and stored its sanitized, evidence-linked proposal transcript at [docs/evidence/AI-MCP-REVIEW.json](docs/evidence/AI-MCP-REVIEW.json). This proves a coding agent used the real protocol client and bounded tools; it does not claim a deployed autonomous runtime or an external provider API invocation.

## Durable bounded run coordinator

`./scripts/dev.sh run agent:demo` starts the real modern MCP client/server pair and runs a deterministic synthetic fixture planner from a committed `IncidentOpened` event. It reads current incident, dependency, impact, fallback, and task context; runs a deterministic containment simulation; and submits one scoped proposal through seven calls within an eight-tool budget. The run trigger binds the persisted event ID, current graph revision, planner role, and policy revision.

The demo enqueues the identical trigger twice and requires the same run ID. It then closes and reopens the run database with planner and tool adapters that fail if called, proving the terminal proposal is recovered without another submission. Its private output directory is mode `0700`; `authority.json` and the opaque credential stay private, and the sanitized `agent-run-evidence.json` contains no token. This fixture does not use provider credentials, model inference, approval, or action execution.

## Boundaries

- All records, identities, people, evidence, rosters, and services are fictional demo data.
- The default integrated demo uses a scripted synthetic commander approval; only the explicit `--manual-approval` digest entry records manual review mode.
- The broker stops one fixed local child process. This is a real effect within a narrow broker-owned process boundary; it is not host, network, VM, container, malware, or production containment.
- Domain, policy, broker, and mesh stores are ordinary plaintext SQLite. Mesh identity JSON is mode `0600`, but there is no keychain, hardware-key, or encrypted-at-rest claim.
- Mesh peers are separate Node processes under one OS user on one Mac. End-to-end encryption prevents the honest relay application from opening final-recipient ciphertext. It does not protect against a host administrator or prove physical-device/radio mesh behavior.
- The relay can still drop, delay, reorder, duplicate, or analyze metadata. The mutable hop bound constrains honest forwarding and is not an authenticated security guarantee.
- A recipient inbox has one visible item per immutable message ID. This is protocol deduplication with cached receipts, not a general exactly-once guarantee for external effects.
- Domain and policy persistence are separate databases. No cross-database atomic transaction is claimed; the response coordinator reconciles a verified execution into canonical evidence by execution ID.

See [docs/MESH-IMPLEMENTATION.md](docs/MESH-IMPLEMENTATION.md), [docs/SECURITY-IMPLEMENTATION.md](docs/SECURITY-IMPLEMENTATION.md), and [docs/INTEGRATION-PLAN.md](docs/INTEGRATION-PLAN.md) for the protocol, trust boundaries, and remaining risks.
