# Tether

Tether gives a company one shared map of its systems and the people responsible for them. Teams save workspaces for everyday work. When something goes wrong, they select the affected systems, open an incident, assign work, and talk in the same place. Nemotron reads permitted information through MCP and suggests next steps. A manager approves any supported system change, and the server checks what actually happened.

This repository contains an authenticated local company workspace and two retained backend proof paths:

1. a scoped incident response loop from structured observation through deterministic impact analysis, bounded MCP proposal, exact-action approval, a real stop of one disposable broker-owned scheduler process, independent verification, persistent fallback tasks, and restart recovery;
2. encrypted A→B→C coordination across three real local peer processes with durable relay custody, a signed final-recipient receipt, replay rejection, relay `SIGKILL`/restart recovery, and no direct A→C adjacency.

“Zero Day” is the event theme. The product name is **Tether**.

The current scope and proof criteria are recorded in [PRD.md](PRD.md), [docs/TRACK-STRATEGY.md](docs/TRACK-STRATEGY.md), [docs/AGENT-ORCHESTRATION.md](docs/AGENT-ORCHESTRATION.md), and [docs/PROOF-MATRIX.md](docs/PROOF-MATRIX.md).

The user selected **NMC² + NVIDIA**, restored the original canvas idea, and authorized a solo demonstration build. Data-center incident response and evidence-linked handoffs provide one fictional canvas scenario. The earlier Photon recommendation and team ideation pause are superseded.

The company app in `apps/tether` starts with 100 employee profiles and 38 connected systems, people, and teams in local SQLite. Four real accounts have independent per-tab sessions. Setup includes employee, node, and connection editing, source links, and previewed CSV/catalog imports. Saved normal workspaces and conversations are separate from incidents. Full-page incidents contain tasks, messages, coding-agent prompts, analysis, and action review. Managers explicitly share selected systems with responders; marketing receives a limited notice. Engineers can maintain their own components. Company analysis uses a real MCP client/server bridge with seven scoped read/simulation tools. A separate bounded MCP layout tool arranges the map.

Incident assignment uses a separate bounded workflow: scoped MCP reads, a Nemotron dispatcher, and up to two parallel recipient-specific prompt writers. Managers review one proposal and assign its tasks together. Tasks, prepared prompts and notices are saved for each responder. Current source access and availability are enforced; off-hours staff can explicitly volunteer for one incident. Coverage gaps and any model fallback are shown. External coding applications are not automatically started. See the [assignment contract](docs/ASSIGNMENT-WORKFLOW-CONTRACT.md) and [live assignment verification](docs/evidence/ASSIGNMENT-VERIFICATION.json).

The Northstar retry service is a disposable local process with an intentional cross-tenant authorization failure. The fixed response disables that route, verifies the actual service effect independently, and checks a safe fallback for both same-tenant success and cross-tenant denial. This company scenario is separate from the older pantry regression fixture described below.

The Nemotron adapter is connected to the user's Brev A100 through an authenticated private SSH forward. On November 8, an actual browser-triggered application run used pretrained Nemotron 3 Nano and three real MCP tools before returning a live synthesis. Model output remains untrusted and grants no execution authority. Failed provider runs use a visibly labeled rule-based backup. See the [current verification](docs/evidence/TETHER-VERIFICATION.json), [company plan](docs/TETHER-COMPANY-PLAN.md), and [build contract](docs/TETHER-BUILD-CONTRACT.md).

## Open the web demo

```sh
./scripts/dev.sh run demo:web
```

Open **http://127.0.0.1:4173**. Sign in using the locally generated credentials in `.runtime/tether/bootstrap-accounts.json`. This file is private and ignored by Git; never paste it into chat or commit it. Open separate tabs for Ava, Noah, Priya, and Elena. There is no persona picker. See the [Tether walkthrough](docs/TETHER-RUNBOOK.md), [security boundary](docs/TETHER-SECURITY.md), and [Brev setup](docs/BREV-SETUP.md).

Run `./scripts/dev.sh run tether:check` for company, authentication, permissions, assignment, fixture, and HTTP checks, and `./scripts/dev.sh run demo:web:check` for the model adapter and older web regressions. The current app passes **92 company checks and typecheck**. The previous 13 web/model checks, 2 Brev setup checks, and historical 60-test core checkpoint remain separately recorded. Fresh reviewers also walk the actual browser flows without source access; those findings drive fixes. Test totals alone do not establish UI readiness. See [the rebuild contract](docs/TETHER-REBUILD-CONTRACT.md). The old web server remains available through `demo:web:legacy` for regression work.

[Latest browser verification](docs/evidence/REBUILD-VERIFICATION.json) records four broad independent walkthroughs and further setup/import retests, the failures they found, the fixes rechecked afterward, and actual screenshots at 1280×720 and 1440×900. Browser coverage includes real copy/paste, four accounts, live notices, verified response, eight simultaneous signed-in tabs, invalid-file rejection, and corrected imports.

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

## Historical core MCP bridge

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
- The legacy integrated CLI uses a scripted synthetic commander approval; only its explicit `--manual-approval` digest entry records manual review mode. The Tether web application instead requires real server-authenticated current commander approval with an explicit incident grant.
- The broker stops one fixed local child process. This is a real effect within a narrow broker-owned process boundary; it is not host, network, VM, container, malware, or production containment.
- Domain, policy, broker, and mesh stores are ordinary plaintext SQLite. Mesh identity JSON is mode `0600`, but there is no keychain, hardware-key, or encrypted-at-rest claim.
- Mesh peers are separate Node processes under one OS user on one Mac. End-to-end encryption prevents the honest relay application from opening final-recipient ciphertext. It does not protect against a host administrator or prove physical-device/radio mesh behavior.
- The relay can still drop, delay, reorder, duplicate, or analyze metadata. The mutable hop bound constrains honest forwarding and is not an authenticated security guarantee.
- A recipient inbox has one visible item per immutable message ID. This is protocol deduplication with cached receipts, not a general exactly-once guarantee for external effects.
- Domain and policy persistence are separate databases. No cross-database atomic transaction is claimed; the response coordinator reconciles a verified execution into canonical evidence by execution ID.

See [docs/MESH-IMPLEMENTATION.md](docs/MESH-IMPLEMENTATION.md), [docs/SECURITY-IMPLEMENTATION.md](docs/SECURITY-IMPLEMENTATION.md), and [docs/INTEGRATION-PLAN.md](docs/INTEGRATION-PLAN.md) for the protocol, trust boundaries, and remaining risks.
