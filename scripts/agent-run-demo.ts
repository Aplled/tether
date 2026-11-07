#!/usr/bin/env node
import { access, chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAuthorityConfig } from "../apps/authority/index.ts";
import { connectBoundedMcp } from "../apps/agent-runtime/mcp-client.ts";
import {
  RunCoordinator,
  type Planner,
  type RunRecord,
  type ToolAdapter,
} from "../packages/agent-orchestration/src/index.ts";
import { CanonicalStore } from "../packages/storage/src/index.ts";
import {
  pantryFallback,
  pantryIncidentId,
  pantryOrganizationId,
  seedPantryScenario,
  trustedEvidence,
} from "../fixtures/pantry/index.ts";

function requireDemo(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`agent_run_demo_failed:${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  requireDemo(
    Boolean(value) && typeof value === "object" && !Array.isArray(value),
    `${label}_shape`,
  );
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  requireDemo(Array.isArray(value), `${label}_shape`);
  return value;
}

async function outputRoot(): Promise<string> {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    const requested = process.argv[outputIndex + 1];
    requireDemo(Boolean(requested), "output_path_missing");
    const root = resolve(requested!);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    try {
      await access(join(root, "domain.sqlite"));
      throw new Error(
        "agent_run_demo_failed:output_already_contains_demo_store",
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("agent_run_demo_failed:")
      )
        throw error;
    }
    return root;
  }
  const root = await mkdtemp(join(tmpdir(), "hackutd-agent-run-"));
  await chmod(root, 0o700);
  return root;
}

const root = await outputRoot();
const domainDbPath = join(root, "domain.sqlite");
const runDbPath = join(root, "agent-runs.sqlite");
const authorityConfigPath = join(root, "authority.json");
const evidencePath = join(root, "agent-run-evidence.json");
const store = new CanonicalStore(domainDbPath);
const workflows = seedPantryScenario(store, () => new Date());
let coordinator: RunCoordinator | undefined;
let restartedCoordinator: RunCoordinator | undefined;
let mcp: Awaited<ReturnType<typeof connectBoundedMcp>> | undefined;

try {
  const now = new Date();
  const observedAt = now.toISOString();
  const observation = {
    ...trustedEvidence(
      "evidence_agent_run_signal",
      "observation",
      "scheduler",
      "Synthetic fixture signal: unexpected scheduler behavior",
    ),
    observedAt,
    receivedAt: observedAt,
  };
  workflows.recordEvidence(observation, "actor_verifier");
  const analysis = workflows.analyzeIncident(
    pantryOrganizationId,
    pantryIncidentId,
    "actor_agent",
  );
  const incidentOpened = store
    .listEvents(pantryOrganizationId, pantryIncidentId)
    .find((event) => event.eventType === "IncidentOpened");
  requireDemo(incidentOpened, "committed_incident_opened_event_missing");

  const credentials = await createAuthorityConfig(
    authorityConfigPath,
    domainDbPath,
    [
      {
        actorId: "actor_agent",
        organizationId: pantryOrganizationId,
        incidentIds: [pantryIncidentId],
        capabilities: ["read", "simulate", "propose"],
      },
    ],
  );
  mcp = await connectBoundedMcp({
    authorityConfigPath,
    credential: credentials.actor_agent!,
  });
  requireDemo(
    mcp.protocolVersion === "2026-07-28" && mcp.protocolEra === "modern",
    "modern_mcp_negotiation",
  );

  const toolNames: string[] = [];
  const actualAdapter: ToolAdapter = {
    async listTools() {
      const listed = await mcp!.client.listTools();
      toolNames.splice(
        0,
        toolNames.length,
        ...listed.tools.map((tool) => tool.name),
      );
      return { tools: listed.tools.map((tool) => ({ name: tool.name })) };
    },
    async callTool(input) {
      return mcp!.client.callTool({
        name: input.name,
        arguments: input.arguments,
      });
    },
  };

  const plannerTrace: Record<string, unknown> = {};
  const deterministicFixturePlanner: Planner = {
    async plan({ run, callTool }) {
      const incident = record(await callTool("get_incident"), "incident");
      const dependencies = record(
        await callTool("get_dependencies"),
        "dependencies",
      );
      const impact = record(
        await callTool("analyze_incident_impact"),
        "impact",
      );
      const simulation = record(
        await callTool("simulate_containment", {
          overrides: {
            scheduler: {
              availability: "unsatisfied",
              securityTrust: "untrusted",
              freshness: "fresh",
              reason:
                "Synthetic fixture simulation only; no compromise conclusion",
            },
          },
        }),
        "simulation",
      );
      const fallbacks = array(
        await callTool("list_fallback_plans"),
        "fallbacks",
      );
      const tasks = array(await callTool("list_response_tasks"), "tasks");
      requireDemo(
        impact.graphRevision === run.snapshotRevision,
        "planner_snapshot_revision",
      );
      requireDemo(
        array(dependencies.nodes, "dependency_nodes").length > 0,
        "planner_dependency_context",
      );
      requireDemo(
        fallbacks.some(
          (item) => record(item, "fallback").id === pantryFallback.id,
        ),
        "planner_fallback_context",
      );
      requireDemo(tasks.length > 0, "planner_task_context");
      const createdAt = new Date();
      const proposal = {
        schemaVersion: 1,
        organizationId: run.organizationId,
        incidentId: run.incidentId,
        id: "proposal_durable_fixture_run",
        authorActorId: "actor_agent",
        snapshotRevision: run.snapshotRevision,
        evidenceIds: [observation.id],
        assumptions: [
          "Deterministic synthetic fixture signal only; compromise is not established.",
        ],
        actionType: "stop_demo_scheduler",
        targetId: "pantry-demo-scheduler",
        parameters: {},
        expectedOperationalEffects: [
          "If independently approved later, the fixed disposable demo scheduler would stop while control remains healthy.",
        ],
        fallbackPlanId: pantryFallback.id,
        verificationPlanId: "verification_scheduler_stop",
        status: "proposed",
        expiresAt: new Date(createdAt.getTime() + 10 * 60_000).toISOString(),
        revision: 1,
        createdAt: createdAt.toISOString(),
      };
      const canonical = record(
        await callTool("submit_response_proposal", proposal),
        "canonical_proposal",
      );
      requireDemo(canonical.id === proposal.id, "canonical_proposal_id");
      plannerTrace.incidentTitle = incident.title;
      plannerTrace.evidenceCount = array(
        incident.evidence,
        "incident_evidence",
      ).length;
      plannerTrace.graphRevision = impact.graphRevision;
      plannerTrace.simulationEvaluations = Object.keys(
        record(simulation.evaluations, "simulation_evaluations"),
      ).length;
      plannerTrace.fallbackCount = fallbacks.length;
      plannerTrace.taskCount = tasks.length;
      return { outcome: "proposed", proposalId: String(canonical.id) };
    },
  };

  const trigger = {
    organizationId: pantryOrganizationId,
    incidentId: pantryIncidentId,
    eventId: incidentOpened.id,
    snapshotRevision: analysis.graphRevision,
    role: "planner",
    policyRevision: 1,
  } as const;
  const options = {
    dbPath: runDbPath,
    planner: deterministicFixturePlanner,
    tools: actualAdapter,
    allowedTools: [
      "get_incident",
      "get_dependencies",
      "analyze_incident_impact",
      "simulate_containment",
      "list_fallback_plans",
      "list_response_tasks",
      "submit_response_proposal",
    ],
    limits: {
      maxToolCalls: 8,
      maxOutputBytes: 256 * 1024,
      deadlineMs: 20_000,
      maxAttempts: 1,
    },
    currentSnapshotRevision: () =>
      workflows.analyzeIncident(
        pantryOrganizationId,
        pantryIncidentId,
        "actor_agent",
      ).graphRevision,
  };
  coordinator = new RunCoordinator(options);
  const enqueued = coordinator.enqueue(trigger);
  const duplicateTrigger = coordinator.enqueue(trigger);
  requireDemo(
    duplicateTrigger.id === enqueued.id,
    "trigger_replay_deduplication",
  );
  const terminal = await coordinator.execute(enqueued.id);
  requireDemo(
    terminal.state === "proposed" && terminal.errorCode === null,
    `terminal_state_${terminal.state}_${terminal.errorCode ?? "none"}`,
  );
  requireDemo(
    terminal.result?.outcome === "proposed" &&
      terminal.result.proposalId === "proposal_durable_fixture_run",
    "terminal_canonical_proposal",
  );
  requireDemo(
    terminal.toolCalls === 7 &&
      terminal.toolCalls <= 8 &&
      terminal.submitCalls === 1,
    "bounded_tool_and_submit_counts",
  );
  requireDemo(
    store.list(pantryOrganizationId, pantryIncidentId, "proposal").length === 1,
    "single_canonical_proposal",
  );

  coordinator.close();
  coordinator = undefined;
  let forbiddenPostRestartCalls = 0;
  const neverPlanner: Planner = {
    async plan() {
      forbiddenPostRestartCalls += 1;
      throw new Error("terminal run must not restart planner");
    },
  };
  const neverTools: ToolAdapter = {
    async listTools() {
      forbiddenPostRestartCalls += 1;
      throw new Error("terminal run must not relist tools");
    },
    async callTool() {
      forbiddenPostRestartCalls += 1;
      throw new Error("terminal run must not recall tools");
    },
  };
  restartedCoordinator = new RunCoordinator({
    ...options,
    planner: neverPlanner,
    tools: neverTools,
  });
  const replayed = restartedCoordinator.enqueue(trigger);
  const replayTerminal = await restartedCoordinator.execute(replayed.id);
  requireDemo(
    replayed.id === terminal.id && replayTerminal.state === "proposed",
    "terminal_run_survives_restart",
  );
  requireDemo(forbiddenPostRestartCalls === 0, "no_resubmission_after_restart");
  requireDemo(
    store.list(pantryOrganizationId, pantryIncidentId, "proposal").length === 1,
    "proposal_remains_single_after_restart",
  );

  const sanitizeRun = (run: RunRecord) => ({
    id: run.id,
    state: run.state,
    eventId: run.eventId,
    snapshotRevision: run.snapshotRevision,
    policyRevision: run.policyRevision,
    attempts: run.attempts,
    toolCalls: run.toolCalls,
    submitCalls: run.submitCalls,
    outputBytes: run.outputBytes,
    result: run.result,
    errorCode: run.errorCode,
  });
  const evidence = {
    schemaVersion: 1,
    ok: true,
    classification: "deterministic synthetic fixture planner",
    protocol: {
      version: mcp.protocolVersion,
      era: mcp.protocolEra,
      advertisedToolCount: toolNames.length,
    },
    trigger: {
      eventId: incidentOpened.id,
      eventType: incidentOpened.eventType,
      committed: true,
      snapshotRevision: trigger.snapshotRevision,
      policyRevision: trigger.policyRevision,
    },
    planner: {
      toolBudget: 8,
      callsUsed: terminal.toolCalls,
      submitCalls: terminal.submitCalls,
      trace: plannerTrace,
    },
    firstExecution: sanitizeRun(terminal),
    restartReplay: {
      run: sanitizeRun(replayTerminal),
      sameRunId: replayTerminal.id === terminal.id,
      plannerOrToolCalls: forbiddenPostRestartCalls,
    },
    canonicalProposal: {
      id:
        terminal.result?.outcome === "proposed"
          ? terminal.result.proposalId
          : null,
      persistedCount: 1,
    },
    boundaries: [
      "No provider credential or model API is used; the planner is deterministic fixture code.",
      "The run can read, simulate, and submit one proposal. It cannot approve or execute infrastructure actions.",
      "All data and identities are fictional, local, and synthetic.",
    ],
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      ok: true,
      outputDirectory: root,
      evidencePath,
      runId: terminal.id,
      proposalId: "proposal_durable_fixture_run",
    }),
  );
} finally {
  restartedCoordinator?.close();
  coordinator?.close();
  await mcp?.close().catch(() => undefined);
  store.close();
}
