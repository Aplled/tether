# Shared data contracts and provenance rules

**Implemented:** November 7, 2026\
**Contract version:** `schemaVersion: 1`\
**Scope:** Synthetic pantry backend demo

This document describes the code that currently runs. The canonical exports are in `packages/contracts/src/index.ts`; this document does not replace the strict Zod schemas.

## Runtime and package surface

- `packages/contracts/src/index.ts` exports IDs, strict schemas, inferred record types, dependency states, and `NodeEvaluation`.
- `packages/graph-core/src/index.ts` exports `evaluateGraph(input)` and `simulateGraph(input, overrides)`.
- `packages/storage/src/index.ts` exports `CanonicalStore`, revision/scope errors, and atomic save options.
- `packages/workflows/src/index.ts` exports `ContinuityService` and `WorkflowError`.
- `packages/response/src/index.ts` exports the proposal-to-policy `ResponseCoordinator`.
- `packages/agent-orchestration/src/index.ts` exports the durable bounded `RunCoordinator` and injected planner/tool interfaces.
- `fixtures/pantry/index.ts` exports the fictional actors, graph, incident, fallback, tasks, evidence helper, and `seedPantryScenario(store, clock?)`.

`ContinuityService` is the application-facing composition point. Its implemented methods are `provisionActor`, `registerNode`, `registerDependencyGroup`, `openIncident`, `recordEvidence`, `createFallback`, `createTask`, `transitionTask`, `approveFallback`, `markRunningOnFallback`, `submitProposal`, `analyzeIncident`, and `simulateIncident`.

The verified development runtime uses the private official Node 26.13.0 toolchain selected by `scripts/dev.sh`, with direct TypeScript execution and ESM. Inputs cross strict Zod object schemas; unknown properties are rejected rather than stripped into a different trusted meaning.

## Scope and identity

Every stored record has `schemaVersion` and `organizationId`. Incident records use their own ID as their storage incident scope. Evidence, proposals, tasks, and fallback plans also carry `incidentId`.

Caller-provided actor records and role arrays do not authenticate a caller. The authority authenticates a private credential and supplies the actor ID. `ContinuityService` then resolves the actor from canonical provisioned state. The first actor for an organization must be a human incident commander; subsequent provisioning requires an existing authenticated commander.

Reads use the organization and incident composite scope. Cross-organization IDs do not establish access. Canonical events are bound to the record organization, incident, aggregate type, aggregate ID, and aggregate revision.

## Core records

### Actor

An `Actor` is provisioned identity metadata: human, agent, device, or service; display name; roles; and revision. It is not a bearer credential.

### Node and DependencyGroup

A `Node` is a service, operation, procedure, person, or resource. A `DependencyGroup` names a dependent node, selects `ALL` or `ANY`, and lists required or optional node references.

`graphRevision` is the sum of all current node and dependency-group revisions. Graph deletion is unavailable in v1, so every add or revision increase advances this value. Proposals bind to the exact current graph revision.

### Evidence

Evidence separates four ideas:

- provenance and reported `fact`;
- optional subject availability: `satisfied`, `unsatisfied`, or `unknown`;
- subject security trust: `trusted`, `untrusted`, or `unknown`;
- timestamp freshness: `fresh`, `stale`, or `unknown`.

Verifier trust does not imply that the observed subject is trusted. The fictional suspicious scheduler observation is unverified and leaves scheduler security trust unknown. Verification evidence is accepted as trusted only from a provisioned human verifier or the assigned incident commander.

The service re-evaluates a `fresh` label against its clock. Current v1 policy allows at most 15 minutes of age and 30 seconds of future clock skew, and rejects observations materially later than receipt. Old evidence does not remain operationally fresh merely because the stored label says `fresh`.

`task_acceptance` evidence is bound by `subjectNodeId` to the exact task ID. Containment verification is bound to subject `pantry-demo-scheduler`, a nonempty `executionId`, `targetGeneration`, and structured observer facts: verified result, scheduler unreachable, control service reachable, and broker process stopped. Human-readable `fact` text is explanatory and is never parsed as authorization or verification structure. Fallback availability evidence is bound to the plan's `fallbackNodeId` and must explicitly report `availability: satisfied`.

### Incident, Proposal, ResponseTask, and FallbackPlan

The implemented incident states are `open`, `contained`, `running_on_fallback`, `recovering`, and `closed`.

The only proposal action is `stop_demo_scheduler` against `pantry-demo-scheduler` with a strict empty parameter object. A proposal binds its authenticated author, organization, incident, current graph revision, in-scope fresh evidence IDs, fallback plan, verification plan, and expiry. Saving a proposal does not approve or execute it.

Tasks transition `pending → in_progress → completed → verified`. Completion requires evidence bound to that task. Verification additionally requires fresh, trusted, verified task-acceptance evidence from a human verifier or the assigned commander.

A fallback plan identifies `fallbackNodeId`, prerequisite task IDs, containment evidence, approval state, and revision. `running_on_fallback` requires all of the following in the same current scope:

1. the assigned human incident commander;
2. an approved fallback;
3. fresh verified containment bound to the fixed target, execution ID, target generation, and structured independent-observer facts; its `securityTrust` continues to describe the stopped subject and may remain `unknown` or `untrusted`;
4. every prerequisite task in `verified` state with task-bound acceptance evidence;
5. fresh trusted verification that the fallback node is actually available.

The fallback plan and incident transition commit in one SQLite transaction.

## Graph evaluation

Availability, security trust, and freshness remain separate outputs. `ALL` blocks on any unsatisfied required input and otherwise propagates unknown. `ANY` succeeds on one satisfied alternative and selects one coherent alternative for trust and freshness; it never combines trust from one branch with freshness from another. Optional inputs can degrade a result without blocking it.

Unresolved dependency cycles remain unknown unless a valid external basis resolves the requirement. Explanations are deterministic, deduplicated, and bounded to 32 paths of at most 16 node IDs. Simulation clones the base-state map and writes no canonical record, event, execution, or outbox entry.

## Persistence and delivery

`CanonicalStore` uses strict SQLite tables for canonical JSON records, domain events, outbox rows, and processed-event IDs. A mutation checks its expected aggregate revision inside `BEGIN IMMEDIATE`, asserts that exactly one row changed, and commits the canonical record, event, and outbox row together. `saveMany` applies up to 100 aggregate changes atomically. Consumers may receive an event more than once and use `(consumer_id, event_id)` for durable deduplication.

Ordinary SQLite is used only with fictional synthetic data. Encryption at rest is not implemented. WAL files, database copies, mesh identity files, and runtime artifacts must be treated as plaintext demo material. Pre-checkpoint databases do not have a general migration mechanism; regenerate ephemeral demo stores when a required v1 fixture field changes.

## Authority, MCP, and execution boundary

The authority credential fixes actor ID, organization, allowed incidents, and capabilities. The MCP server exposes bounded reads, deterministic analysis/simulation, and proposal submission. It exposes no approval, arbitrary SQL, arbitrary URL, shell, Docker, or execution tool.

Policy approval and broker execution are separate from the domain proposal store. The demo policy binds the fixed action, target identity and generation, graph/policy/recovery revisions, requester, approver, expiry, and single-use reservation. The broker owns one disposable local child process behind private IPC. An independent observer checks scheduler reachability, control-service health, and broker process state.

The `ResponseCoordinator` revalidates the stored proposal, graph revision, incident/fallback state, verification plan, expiry, evidence context, exact proposal digest, target generation, and execution result. It binds the policy action to the proposal digest and projects only structured verified observer facts into domain evidence. Projection is deterministic and idempotent after a crash. The domain and policy SQLite databases still do not share a transaction; this is a known composition boundary, not a claim of distributed atomicity.

## Bounded agent run orchestration

`packages/agent-orchestration` implements persistence and limits around an injected planner. It does not contain model credentials or claim that a deployed LLM produced the demo proposal.

Run triggers bind organization, incident, committed event ID, graph snapshot revision, role, and policy revision. SQLite provides a durable deduplication key and permits only one queued/running run per organization and incident. States are `queued`, `running`, `proposed`, `no_action`, `failed`, `timed_out`, and `superseded`.

The coordinator supplies trusted organization and incident arguments on every MCP call. Exactly eight bounded MCP tools are recognized. Analyst and reviewer roles cannot submit proposals; a planner may invoke `submit_response_proposal` at most once. Planner output is runtime-validated as one of two exact, bounded shapes: `{ outcome: "proposed", proposalId }` or `{ outcome: "no_action", reason }`. A `proposed` terminal result requires the bounded canonical proposal ID and exact organization/incident scope returned by that successful tool invocation. Once submission returns a canonical ID, an invalid, mismatched, or `no_action` planner result cannot hide it. The coordinator drains fire-and-forget calls before choosing a terminal state.

Tool calls, output bytes, deadline, and attempt count are persisted and bounded. The current default limits are 12 calls, 64 KiB of parsed tool output, 60 seconds, and one attempt. Snapshot callbacks and external tool/planner calls share that deadline. Snapshot freshness and persisted run ownership are checked before and after external calls. Concurrent execution claims are atomic. A database lease permits one live coordinator; owner tokens fence stale coordinators. After lease acquisition, restart converts an interrupted `running` record to `failed` without automatic retry; if its durable submit counter is nonzero, the error is `proposal_outcome_uncertain_after_restart`. A deadline after proposal dispatch without a validated canonical response is recorded as `proposal_outcome_uncertain_after_timeout`; transport and validation failures after dispatch use `proposal_outcome_uncertain_after_error:<cause>`. The coordinator never automatically repeats these submissions.

`DeterministicFixturePlanner` exists for tests and local integration adapters. A production model provider, model credentials, and autonomous scheduling are not implemented.

## Mesh provenance boundary

Mesh payloads carry the same fictional organization and incident IDs, but peer traffic is not canonical authority state. A signed recipient acknowledgment proves the enrolled recipient accepted a particular immutable message; a relay custody receipt does not prove recipient delivery. Peer messages cannot grant roles, approve actions, create broker commands, or directly mark tasks verified.

The demonstrated peers are three separate local processes with distinct identities and stores on one Mac. Relay B cannot decrypt the sealed A→C payload, signed recipient receipts return through B, queues survive restart, and replay/tamper/forged-receipt cases are rejected. This is logical-peer protocol evidence, not physical three-device or radio mesh proof.

## Verification commands

- `npm test`
- `npm run typecheck`
- `npm run mcp:smoke`
- `npm run demo`
- `npm run demo:mesh`

The integrated demo writes an evidence JSON file and a short report. Claims should be taken from the latest successful run, not from stale temporary artifacts or this document alone.
