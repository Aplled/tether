import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CanonicalStore } from "../../packages/storage/src/index.ts";
import {
  PolicyEngine,
  type AuthoritySeed,
} from "../../packages/policy/src/index.ts";
import { ResponseCoordinator } from "../../packages/response/src/index.ts";
import { DemoBroker, IndependentObserver } from "../demo-broker/src/index.ts";
import {
  pantryFallback,
  pantryIncidentId,
  pantryOrganizationId,
  seedPantryScenario,
  trustedEvidence,
} from "../../fixtures/pantry/index.ts";
import type { DemoAction, DemoState } from "./types.ts";
import { analyzeDemo, getModelStatus } from "./agent.ts";
import { ContinuityService } from "../../packages/workflows/src/index.ts";
import { createAuthorityConfig } from "../authority/index.ts";
import {
  connectBoundedMcp,
  toolResultValue,
} from "../agent-runtime/mcp-client.ts";

const MAX_TEXT = 500;
const now = () => new Date().toISOString();
const id = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

function seedState(): DemoState {
  return {
    workspace: { id: "northstar-compute", name: "Northstar Compute" },
    revision: 1,
    source: "live-backend",
    nodes: [
      {
        id: "scheduler",
        kind: "service",
        name: "GPU Job Scheduler",
        x: 340,
        y: 235,
        status: "healthy",
        criticality: "high",
        ownerId: "operator",
        description:
          "Fictional Northstar scheduling view; containment maps to the fixed disposable pantry-demo-scheduler target.",
      },
      {
        id: "training",
        kind: "operation",
        name: "Model Training Queue",
        x: 650,
        y: 180,
        status: "healthy",
        criticality: "critical",
        ownerId: "commander",
      },
      {
        id: "backup_roster",
        kind: "resource",
        name: "Offline Runbook",
        x: 650,
        y: 390,
        status: "standby",
        criticality: "high",
        ownerId: "operator",
      },
      {
        id: "control",
        kind: "service",
        name: "Control Plane Monitor",
        x: 95,
        y: 390,
        status: "healthy",
        criticality: "high",
        ownerId: "verifier",
      },
      {
        id: "commander",
        kind: "person",
        name: "Morgan Chen",
        x: 95,
        y: 105,
        status: "available",
        criticality: "medium",
        ownerId: "commander",
      },
    ],
    edges: [
      {
        id: "e1",
        source: "scheduler",
        target: "training",
        kind: "dependency",
        label: "schedules",
      },
      {
        id: "e2",
        source: "backup_roster",
        target: "training",
        kind: "fallback",
        label: "fallback for",
      },
      {
        id: "e3",
        source: "control",
        target: "scheduler",
        kind: "observation",
        label: "observes",
      },
      {
        id: "e4",
        source: "commander",
        target: "scheduler",
        kind: "ownership",
        label: "approves response for",
      },
    ],
    people: [
      {
        id: "commander",
        name: "Morgan Chen",
        initials: "MC",
        role: "Incident commander (fictional)",
        canApprove: true,
      },
      {
        id: "operator",
        name: "Casey Ortiz",
        initials: "CO",
        role: "Operations owner (fictional)",
        canApprove: false,
      },
      {
        id: "verifier",
        name: "Riley Shah",
        initials: "RS",
        role: "Independent verifier (fictional)",
        canApprove: false,
      },
    ],
    incident: null,
    tasks: [
      {
        id: "task_roster",
        title: "Verify offline runbook is available",
        ownerId: "operator",
        state: "pending",
      },
      {
        id: "task_checkin",
        title: "Verify operator check-in procedure",
        ownerId: "operator",
        state: "pending",
      },
    ],
    messages: [],
    timeline: [
      {
        id: id("event"),
        title: "Demo workspace ready",
        detail: "Fictional data-center graph loaded from local state.",
        createdAt: now(),
        kind: "system",
      },
    ],
    proposal: null,
    model: { ...getModelStatus() },
    mesh: {
      status: "verified-existing",
      label: "Existing verified local-peer proof",
      proofSummary:
        "Encrypted A→B→C relay was previously verified across three local peer processes; this browser does not claim three physical devices.",
    },
  };
}

function text(value: unknown, name: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${name} must be 1..${max} characters`);
  return value.trim();
}
function finite(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 10000
  )
    throw new Error(`${name} is invalid`);
  return value;
}

export class DemoSession {
  readonly runtimeDir: string;
  readonly statePath: string;
  #state: DemoState = seedState();
  #queue: Promise<unknown> = Promise.resolve();
  #store?: CanonicalStore;
  #workflows?: ContinuityService;
  #policy?: PolicyEngine;
  #coordinator?: ResponseCoordinator;
  #broker?: DemoBroker;
  #observer?: IndependentObserver;
  #mcp?: Awaited<ReturnType<typeof connectBoundedMcp>>;
  #containmentEvidenceId: string | undefined;
  constructor(runtimeDir: string) {
    this.runtimeDir = runtimeDir;
    this.statePath = join(runtimeDir, "state.json");
  }
  async start() {
    await mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    let restored = false;
    try {
      this.#state = JSON.parse(await readFile(this.statePath, "utf8"));
      restored = true;
    } catch {
      await this.#persist();
    }
    if (restored) this.#clearStaleBackendClaims();
    await this.#startBackend();
    if (restored) await this.#persist();
  }
  getState(): DemoState {
    return structuredClone(this.#state);
  }
  act(action: DemoAction): Promise<{ state: DemoState; result?: unknown }> {
    const run = this.#queue.then(() => this.#act(action));
    this.#queue = run.catch(() => undefined);
    return run;
  }
  async close() {
    await this.#mcp?.close();
    await this.#broker?.close();
    this.#policy?.close();
    this.#store?.close();
  }
  async #startBackend() {
    const runDir = join(
      this.runtimeDir,
      `backend-${Date.now()}-${randomUUID().slice(0, 8)}`,
    );
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    this.#store = new CanonicalStore(join(runDir, "domain.sqlite"));
    const workflows = seedPantryScenario(this.#store, () => new Date());
    this.#workflows = workflows;
    this.#broker = await DemoBroker.start({
      dbPath: join(runDir, "broker.sqlite"),
    });
    const seed: AuthoritySeed = {
      principals: [
        {
          id: "policy_agent",
          kind: "agent",
          organizationId: pantryOrganizationId,
          roles: ["participant"],
        },
        {
          id: "policy_commander",
          kind: "human",
          organizationId: pantryOrganizationId,
          roles: ["incident_commander"],
        },
        {
          id: "policy_executor",
          kind: "service",
          organizationId: pantryOrganizationId,
          roles: ["execution_service"],
        },
      ],
      incidents: [
        {
          id: pantryIncidentId,
          organizationId: pantryOrganizationId,
          commanderPrincipalId: "policy_commander",
          revision: 1,
          open: true,
        },
      ],
      target: {
        identity: "pantry-demo-scheduler",
        generation: this.#broker.generation,
        organizationId: pantryOrganizationId,
        enabled: true,
      },
      graphVersion: workflows.analyzeIncident(
        pantryOrganizationId,
        pantryIncidentId,
        "actor_agent",
      ).graphRevision,
      policyVersion: 1,
      recoveryVersion: 1,
    };
    this.#policy = new PolicyEngine({
      dbPath: join(runDir, "policy.sqlite"),
      seed,
    });
    this.#coordinator = new ResponseCoordinator({
      store: this.#store,
      workflows,
      policy: this.#policy,
      policyVersion: 1,
      recoveryVersion: 1,
      projectionActorId: "actor_verifier",
    });
    this.#observer = new IndependentObserver({
      schedulerHealthUrl: this.#broker.schedulerHealthUrl,
      controlHealthUrl: this.#broker.controlHealthUrl,
      expectedToken: this.#broker.fixtureToken,
      readBrokerState: () => this.#broker!.readProcessState(),
    });
    const credentials = await createAuthorityConfig(
      join(runDir, "authority.json"),
      join(runDir, "domain.sqlite"),
      [
        {
          actorId: "actor_agent",
          organizationId: pantryOrganizationId,
          incidentIds: [pantryIncidentId],
          capabilities: ["read", "simulate", "propose"],
        },
      ],
    );
    this.#mcp = await connectBoundedMcp({
      authorityConfigPath: join(runDir, "authority.json"),
      credential: credentials.actor_agent!,
    });
  }
  async #act(
    action: DemoAction,
  ): Promise<{ state: DemoState; result?: unknown }> {
    if (
      !action ||
      typeof action.type !== "string" ||
      !action.payload ||
      typeof action.payload !== "object"
    )
      throw new Error("invalid action");
    const p = action.payload;
    let result: unknown;
    switch (action.type) {
      case "add_node": {
        const node = {
          id: id("node"),
          name: text(p.name, "name", 80),
          kind: text(p.kind, "kind", 40),
          x: finite(p.x, "x"),
          y: finite(p.y, "y"),
          ownerId: text(p.ownerId, "ownerId", 80),
          status: "healthy",
          criticality: "medium",
        };
        this.#state.nodes.push(node);
        result = node;
        break;
      }
      case "update_node": {
        const node = this.#state.nodes.find(
          (n) => n.id === text(p.id, "id", 100),
        );
        if (!node) throw new Error("node not found");
        for (const key of [
          "name",
          "kind",
          "ownerId",
          "status",
          "criticality",
        ] as const)
          if (p[key] !== undefined) node[key] = text(p[key], key, 100);
        if (p.x !== undefined) node.x = finite(p.x, "x");
        if (p.y !== undefined) node.y = finite(p.y, "y");
        result = node;
        break;
      }
      case "add_edge": {
        const source = text(p.source, "source", 100),
          target = text(p.target, "target", 100);
        if (
          !this.#state.nodes.some((n) => n.id === source) ||
          !this.#state.nodes.some((n) => n.id === target) ||
          source === target
        )
          throw new Error("edge endpoints are invalid");
        const edge = {
          id: id("edge"),
          source,
          target,
          kind: text(p.kind, "kind", 40),
          label: String(p.label ?? p.kind).slice(0, 100),
        };
        this.#state.edges.push(edge);
        result = edge;
        break;
      }
      case "remove_edge": {
        const edgeId = text(p.id, "id", 100);
        const before = this.#state.edges.length;
        this.#state.edges = this.#state.edges.filter((e) => e.id !== edgeId);
        if (before === this.#state.edges.length)
          throw new Error("edge not found");
        break;
      }
      case "report_incident": {
        const nodeId = text(p.nodeId, "nodeId", 100);
        if (!this.#state.nodes.some((n) => n.id === nodeId))
          throw new Error("affected node not found");
        this.#state.incident = {
          id: id("incident"),
          title: text(p.title, "title", 120),
          status: "open-unverified",
          summary: text(p.description, "description"),
          affectedNodeIds: [nodeId],
        };
        this.#state.nodes.find((n) => n.id === nodeId)!.status = "suspected";
        this.#timeline(
          "Unverified incident reported",
          "User input is stored as an unverified signal; it does not authorize containment.",
          "incident",
        );
        break;
      }
      case "analyze": {
        if (!this.#state.incident) throw new Error("report an incident first");
        if (!this.#state.incident.affectedNodeIds.includes("scheduler"))
          throw new Error(
            "read-only canvas incident recorded; the only executable demo adapter is bound to the fixed scheduler fixture, so no unrelated containment proposal was created",
          );
        const analysis = await analyzeDemo({
          message: text(p.message, "message"),
          context: {
            organizationId: pantryOrganizationId,
            incidentId: pantryIncidentId,
            untrustedCanvasInput: {
              incident: this.#state.incident,
              nodes: this.#state.nodes,
              edges: this.#state.edges,
            },
          },
          callTool: async (name, args, options) =>
            this.#readTool(
              name,
              args,
              options?.signal,
              options?.timeoutMs ?? 30_000,
            ),
        });
        const graphRevision =
          this.#store!.list(pantryOrganizationId, null, "node").reduce(
            (s, r) => s + r.value.revision,
            0,
          ) +
          this.#store!.list(
            pantryOrganizationId,
            null,
            "dependency_group",
          ).reduce((s, r) => s + r.value.revision, 0);
        const evidenceId = id("evidence");
        const t = now();
        this.#workflows!.recordEvidence(
          {
            ...trustedEvidence(
              evidenceId,
              "observation",
              "scheduler",
              "Unverified fictional demo signal from browser incident report",
            ),
            observedAt: t,
            receivedAt: t,
          },
          "actor_verifier",
        );
        const proposalId = id("proposal");
        this.#workflows!.submitProposal(
          {
            schemaVersion: 1,
            organizationId: pantryOrganizationId,
            incidentId: pantryIncidentId,
            id: proposalId,
            authorActorId: "actor_agent",
            snapshotRevision: graphRevision,
            evidenceIds: [evidenceId],
            assumptions: [
              "Synthetic browser signal; compromise is not established.",
              "Editable Northstar canvas nodes are presentation context; authority and deterministic analysis remain bound to the fixed pantry demo fixture.",
            ],
            actionType: "stop_demo_scheduler",
            targetId: "pantry-demo-scheduler",
            parameters: {},
            expectedOperationalEffects: [
              "Fixed disposable scheduler process becomes unreachable while its control service remains reachable.",
            ],
            fallbackPlanId: pantryFallback.id,
            verificationPlanId: "verification_scheduler_stop",
            status: "proposed",
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            revision: 1,
            createdAt: t,
          },
          "actor_agent",
        );
        const prepared = this.#coordinator!.prepareAction({
          organizationId: pantryOrganizationId,
          incidentId: pantryIncidentId,
          proposalId,
          authenticatedRequesterId: "policy_agent",
          targetGeneration: this.#broker!.generation,
        });
        const scopeLabel =
          "Analyzed scope: fixed fictional pantry backend fixture (org_pantry_demo / incident_scheduler_suspicion). Editable Northstar canvas relationships are presentation context and do not grant authority.";
        this.#state.proposal = {
          id: proposalId,
          title: "Contain the disposable scheduler fixture",
          summary: `${scopeLabel} ${analysis.summary} ${analysis.recommendation}`,
          steps: analysis.steps,
          mode: analysis.mode,
          requiresApproval: true,
          actionDigest: prepared.canonicalDigest,
        };
        this.#state.model = {
          configured: analysis.mode === "live",
          model: analysis.model,
          mode: analysis.mode,
          ...(analysis.reason ? { lastError: analysis.reason } : {}),
        };
        this.#timeline(
          "Proposal prepared for fixed fixture scope",
          `${scopeLabel} Canonical digest ${prepared.canonicalDigest.slice(0, 12)}…; no action executed.`,
          "proposal",
        );
        result = {
          proposalId,
          actionDigest: prepared.canonicalDigest,
          mode: analysis.mode,
          analyzedScope: {
            organizationId: pantryOrganizationId,
            incidentId: pantryIncidentId,
            target: "pantry-demo-scheduler",
            canvasEditsAffectAuthority: false,
          },
        };
        break;
      }
      case "approve": {
        if (text(p.actorId, "actorId", 100) !== "commander")
          throw new Error("assigned fictional commander required");
        const suppliedDigest = text(p.actionDigest, "actionDigest", 64);
        if (
          !this.#state.proposal?.actionDigest ||
          suppliedDigest !== this.#state.proposal.actionDigest
        )
          throw new Error("exact displayed canonical digest required");
        const action = this.#policy!.getActionForProposal(
          pantryOrganizationId,
          pantryIncidentId,
          this.#state.proposal.id,
        );
        if (!action || action.canonicalDigest !== suppliedDigest)
          throw new Error("proposal digest is stale");
        this.#policy!.approveAction(action.actionId, "policy_commander", {
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
        const execution = await this.#coordinator!.executePreparedAction(
          {
            actionId: action.actionId,
            authenticatedExecutorId: "policy_executor",
          },
          this.#broker!,
          this.#observer!,
        );
        if (execution.state !== "verified")
          throw new Error(
            "independent verification did not confirm containment",
          );
        const evidence = await this.#coordinator!.projectVerifiedOutcome({
          organizationId: pantryOrganizationId,
          incidentId: pantryIncidentId,
          proposalId: this.#state.proposal.id,
        });
        this.#containmentEvidenceId = evidence.id;
        this.#state.incident!.status = "contained-verified";
        this.#state.nodes.find((n) => n.id === "scheduler")!.status =
          "contained";
        this.#timeline(
          "Containment independently verified",
          `Fixed disposable pantry-demo-scheduler stopped; control remained reachable. Evidence ${evidence.id}.`,
          "verification",
        );
        this.#state.proposal.requiresApproval = false;
        result = {
          executionId: execution.executionId,
          verification: execution.verification,
        };
        break;
      }
      case "activate_fallback": {
        if (
          text(p.actorId, "actorId", 100) !== "commander" ||
          this.#state.incident?.status !== "contained-verified" ||
          !this.#containmentEvidenceId
        )
          throw new Error(
            "verified containment and assigned commander are required",
          );
        const fallback = this.#workflows!.approveFallback(
          pantryOrganizationId,
          pantryIncidentId,
          pantryFallback.id,
          this.#containmentEvidenceId,
          "actor_commander",
          1,
        );
        await this.#verifyFallbackTasks();
        const incident = this.#store!.get(
          pantryOrganizationId,
          pantryIncidentId,
          "incident",
          pantryIncidentId,
        )!.value;
        this.#workflows!.markRunningOnFallback(
          pantryOrganizationId,
          pantryIncidentId,
          pantryFallback.id,
          "actor_commander",
          incident.revision,
          fallback.revision,
        );
        this.#state.incident.status = "running_on_fallback";
        this.#state.nodes.find((n) => n.id === "backup_roster")!.status =
          "active-verified";
        this.#timeline(
          "Fallback verified",
          "Sanitized local artifacts were written, hashed, checked, and canonical prerequisite tasks were verified.",
          "fallback",
        );
        break;
      }
      case "complete_task": {
        const task = this.#state.tasks.find(
          (t) => t.id === text(p.id, "id", 100),
        );
        if (!task) throw new Error("task not found");
        const actorId = text(p.actorId, "actorId", 100);
        if (
          actorId !== task.ownerId &&
          actorId !== "commander" &&
          actorId !== "verifier"
        )
          throw new Error("task owner, verifier, or commander required");
        const canonical = this.#store!.get(
          pantryOrganizationId,
          pantryIncidentId,
          "task",
          task.id,
        )?.value;
        if (!canonical || canonical.state !== "verified")
          throw new Error(
            "task can only be shown verified after canonical artifact verification during fallback activation",
          );
        task.state = "verified";
        this.#timeline("Task verification confirmed", task.title, "task");
        break;
      }
      case "send_message": {
        const actorId = text(p.actorId, "actorId", 100);
        if (!this.#state.people.some((person) => person.id === actorId))
          throw new Error("actor not found");
        const message = {
          id: id("message"),
          text: text(p.text, "text"),
          actorId,
          channel: text(p.channel, "channel", 50),
          createdAt: now(),
        };
        this.#state.messages.push(message);
        result = message;
        break;
      }
      case "reset":
        await this.#mcp?.close();
        await this.#broker?.close();
        this.#policy?.close();
        this.#store?.close();
        this.#containmentEvidenceId = undefined;
        this.#state = seedState();
        await this.#startBackend();
        break;
      default:
        throw new Error("unsupported action");
    }
    this.#state.revision += 1;
    await this.#persist();
    return {
      state: this.getState(),
      ...(result === undefined ? {} : { result }),
    };
  }
  #timeline(title: string, detail: string, kind: string) {
    this.#state.timeline.unshift({
      id: id("event"),
      title,
      detail,
      kind,
      createdAt: now(),
    });
    this.#state.timeline = this.#state.timeline.slice(0, 100);
  }
  #clearStaleBackendClaims() {
    this.#state.incident = null;
    this.#state.proposal = null;
    this.#state.tasks.forEach((task) => {
      task.state = "pending";
    });
    const scheduler = this.#state.nodes.find((node) => node.id === "scheduler");
    if (scheduler) scheduler.status = "healthy";
    const fallback = this.#state.nodes.find(
      (node) => node.id === "backup_roster",
    );
    if (fallback) fallback.status = "standby";
    this.#timeline(
      "Backend session restarted",
      "Canvas edits and messages were restored. Incident, approval, containment, and fallback claims were cleared because a fresh disposable backend generation started.",
      "system",
    );
    this.#state.revision += 1;
  }
  async #readTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    if (
      args.organizationId !== pantryOrganizationId ||
      args.incidentId !== pantryIncidentId
    )
      throw new Error("tool scope mismatch");
    const allowed = new Set([
      "get_incident",
      "get_dependencies",
      "analyze_incident_impact",
      "simulate_containment",
      "list_fallback_plans",
      "list_response_tasks",
      "get_incident_timeline",
    ]);
    if (!allowed.has(name))
      throw new Error("tool is not allowlisted for browser analysis");
    const callArgs =
      name === "simulate_containment"
        ? {
            ...args,
            overrides: {
              scheduler: {
                availability: "unsatisfied",
                securityTrust: "untrusted",
                freshness: "fresh",
                reason: "bounded fixed-target simulation",
              },
            },
          }
        : args;
    return toolResultValue(
      await this.#mcp!.client.callTool(
        { name, arguments: callArgs },
        {
          ...(signal ? { signal } : {}),
          timeout: timeoutMs,
          maxTotalTimeout: timeoutMs,
        },
      ),
    );
  }
  async #verifyFallbackTasks() {
    const artifactDir = join(this.runtimeDir, "fallback-artifacts");
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
    for (const task of this.#state.tasks) {
      const path = join(artifactDir, `${task.id}.json`);
      const raw = `${JSON.stringify({ schemaVersion: 1, fictional: true, taskId: task.id, verifiedSteps: task.id === "task_roster" ? ["load sanitized roster", "validate fictional shifts"] : ["read procedure", "record fictional check-in"] }, null, 2)}\n`;
      await writeFile(path, raw, { mode: 0o600 });
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (
        parsed.fictional !== true ||
        parsed.taskId !== task.id ||
        !Array.isArray(parsed.verifiedSteps)
      )
        throw new Error("fallback artifact validation failed");
      let canonical = this.#store!.get(
        pantryOrganizationId,
        pantryIncidentId,
        "task",
        task.id,
      )!.value;
      canonical = this.#workflows!.transitionTask(
        pantryOrganizationId,
        pantryIncidentId,
        task.id,
        "in_progress",
        "actor_volunteer",
        canonical.revision,
      );
      const t = now(),
        evidenceId = id("task_evidence");
      this.#workflows!.recordEvidence(
        {
          ...trustedEvidence(
            evidenceId,
            "task_acceptance",
            task.id,
            `Verified fictional artifact sha256=${createHash("sha256").update(raw).digest("hex")}`,
          ),
          observedAt: t,
          receivedAt: t,
        },
        "actor_verifier",
      );
      canonical = this.#workflows!.transitionTask(
        pantryOrganizationId,
        pantryIncidentId,
        task.id,
        "completed",
        "actor_volunteer",
        canonical.revision,
        [evidenceId],
      );
      this.#workflows!.transitionTask(
        pantryOrganizationId,
        pantryIncidentId,
        task.id,
        "verified",
        "actor_verifier",
        canonical.revision,
        [evidenceId],
      );
      task.state = "verified";
    }
    const t = now();
    this.#workflows!.recordEvidence(
      {
        ...trustedEvidence(
          id("fallback_available"),
          "verification",
          "backup_roster",
          "Validated fictional fallback artifacts are locally available",
        ),
        availability: "satisfied",
        observedAt: t,
        receivedAt: t,
      },
      "actor_verifier",
    );
  }
  async #persist() {
    const temp = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(this.#state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temp, this.statePath);
  }
}
