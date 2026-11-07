#!/usr/bin/env node
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { CanonicalStore } from "../packages/storage/src/index.ts";
import { ContinuityService } from "../packages/workflows/src/index.ts";
import {
  PolicyEngine,
  type AuthoritySeed,
} from "../packages/policy/src/index.ts";
import { ResponseCoordinator } from "../packages/response/src/index.ts";
import {
  DemoBroker,
  IndependentObserver,
} from "../apps/demo-broker/src/index.ts";
import { createAuthorityConfig } from "../apps/authority/index.ts";
import {
  connectBoundedMcp,
  toolResultValue,
} from "../apps/agent-runtime/mcp-client.ts";
import {
  pantryFallback,
  pantryIncidentId,
  pantryOrganizationId,
  pantryTasks,
  seedPantryScenario,
  trustedEvidence,
} from "../fixtures/pantry/index.ts";

const execFileAsync = promisify(execFile);
const outputIndex = process.argv.indexOf("--output");
const outputDir =
  outputIndex >= 0 && process.argv[outputIndex + 1]
    ? resolve(process.argv[outputIndex + 1]!)
    : await mkdtemp(join(tmpdir(), "hackutd-integrated-demo-"));
await mkdir(outputDir, { recursive: true, mode: 0o700 });
await chmod(outputDir, 0o700);
const domainDb = join(outputDir, "domain.sqlite"),
  policyDb = join(outputDir, "policy.sqlite"),
  brokerDb = join(outputDir, "broker.sqlite"),
  authorityPath = join(outputDir, "authority.json");
function requireDemo(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`demo assertion failed: ${message}`);
}
async function readApprovalDigest(): Promise<string> {
  return new Promise((resolveDigest, reject) => {
    let input = "",
      settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      process.stdin.pause();
    };
    const finish = (error: Error | undefined, value?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolveDigest(value!);
    };
    const onData = (chunk: string) => {
      input += chunk;
      if (input.length > 128)
        return finish(
          new Error("manual approval input exceeds 128 characters"),
        );
      const newline = input.indexOf("\n");
      if (newline >= 0) finish(undefined, input.slice(0, newline).trim());
    };
    const onEnd = () =>
      finish(new Error("manual approval input ended before newline"));
    const onError = (error: Error) => finish(error);
    const timer = setTimeout(
      () => finish(new Error("manual approval input timed out")),
      60_000,
    );
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}
let domainStore = new CanonicalStore(domainDb),
  workflows = seedPantryScenario(domainStore, () => new Date());
const evidenceNow = new Date().toISOString();
const observation = {
  ...trustedEvidence(
    "evidence_scheduler_signal",
    "observation",
    "scheduler",
    "Synthetic exercise signal: unexpected scheduler behavior",
  ),
  observedAt: evidenceNow,
  receivedAt: evidenceNow,
};
workflows.recordEvidence(observation, "actor_verifier");
const graphRevision = workflows.analyzeIncident(
  pantryOrganizationId,
  pantryIncidentId,
  "actor_agent",
).graphRevision;
const broker = await DemoBroker.start({ dbPath: brokerDb });
let policy: PolicyEngine | undefined;
try {
  const observer = new IndependentObserver({
    schedulerHealthUrl: broker.schedulerHealthUrl,
    controlHealthUrl: broker.controlHealthUrl,
    expectedToken: broker.fixtureToken,
    readBrokerState: () => broker.readProcessState(),
  });
  const baseline = await observer.verifyStopped();
  requireDemo(
    baseline.schedulerReachable === true &&
      baseline.controlReachable === true &&
      baseline.brokerProcessState === "running",
    "healthy baseline scheduler/control/process evidence",
  );
  const policySeed: AuthoritySeed = {
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
        id: "policy_participant",
        kind: "human",
        organizationId: pantryOrganizationId,
        roles: ["participant"],
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
      generation: broker.generation,
      organizationId: pantryOrganizationId,
      enabled: true,
    },
    graphVersion: graphRevision,
    policyVersion: 1,
    recoveryVersion: 1,
  };
  policy = new PolicyEngine({ dbPath: policyDb, seed: policySeed });
  const coordinator = new ResponseCoordinator({
    store: domainStore,
    workflows,
    policy,
    policyVersion: 1,
    recoveryVersion: 1,
    projectionActorId: "actor_verifier",
  });
  const credentials = await createAuthorityConfig(authorityPath, domainDb, [
    {
      actorId: "actor_agent",
      organizationId: pantryOrganizationId,
      incidentIds: [pantryIncidentId],
      capabilities: ["read", "simulate", "propose"],
    },
    {
      actorId: "actor_commander",
      organizationId: pantryOrganizationId,
      incidentIds: [pantryIncidentId],
      capabilities: ["read"],
    },
  ]);
  const mcp = await connectBoundedMcp({
    authorityConfigPath: authorityPath,
    credential: credentials.actor_agent!,
  });
  let mcpEvidence: any;
  try {
    const tools = await mcp.client.listTools();
    const scope = {
      organizationId: pantryOrganizationId,
      incidentId: pantryIncidentId,
    };
    const incident = toolResultValue(
      await mcp.client.callTool({ name: "get_incident", arguments: scope }),
    );
    const dependencies = toolResultValue(
      await mcp.client.callTool({ name: "get_dependencies", arguments: scope }),
    );
    const impact = toolResultValue(
      await mcp.client.callTool({
        name: "analyze_incident_impact",
        arguments: scope,
      }),
    );
    const simulation = toolResultValue(
      await mcp.client.callTool({
        name: "simulate_containment",
        arguments: {
          ...scope,
          overrides: {
            scheduler: {
              availability: "unsatisfied",
              securityTrust: "untrusted",
              freshness: "fresh",
              reason: "synthetic scheduler stop simulation",
            },
          },
        },
      }),
    );
    const now = new Date();
    const proposal = {
      schemaVersion: 1,
      ...scope,
      id: "proposal_agent_containment",
      authorActorId: "actor_agent",
      snapshotRevision: impact.graphRevision,
      evidenceIds: [observation.id],
      assumptions: [
        "Synthetic demo signal only; compromise is not established.",
      ],
      actionType: "stop_demo_scheduler" as const,
      targetId: "pantry-demo-scheduler" as const,
      parameters: {},
      expectedOperationalEffects: [
        "The fixed disposable scheduler process becomes unreachable while the control service stays healthy.",
      ],
      fallbackPlanId: pantryFallback.id,
      verificationPlanId: "verification_scheduler_stop",
      status: "proposed" as const,
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      revision: 1,
      createdAt: now.toISOString(),
    };
    const storedProposal = toolResultValue(
      await mcp.client.callTool({
        name: "submit_response_proposal",
        arguments: proposal,
      }),
    );
    const denials: any[] = [];
    const denialCases: Array<[string, Record<string, unknown>]> = [
      ["approve_action", {}],
      [
        "get_incident",
        { organizationId: "org_other_demo", incidentId: pantryIncidentId },
      ],
      [
        "submit_response_proposal",
        { ...proposal, targetId: "arbitrary-target" },
      ],
      ["get_incident", { ...scope, role: "incident_commander" }],
    ];
    for (const [name, args] of denialCases) {
      try {
        const response = await mcp.client.callTool({ name, arguments: args });
        denials.push({ name, rejected: response.isError === true });
      } catch {
        denials.push({ name, rejected: true });
      }
    }
    requireDemo(
      mcp.protocolVersion === "2026-07-28" && mcp.protocolEra === "modern",
      "modern MCP revision",
    );
    requireDemo(
      denials.every((item) => item.rejected),
      "all forbidden MCP calls rejected",
    );
    mcpEvidence = {
      protocolVersion: mcp.protocolVersion,
      protocolEra: mcp.protocolEra,
      toolNames: tools.tools.map((t) => t.name),
      incident,
      dependencyCount: dependencies.nodes.length,
      impact,
      simulation,
      storedProposalId: storedProposal.id,
      denials,
    };
  } finally {
    await mcp.close();
  }
  const action = coordinator.prepareAction({
    organizationId: pantryOrganizationId,
    incidentId: pantryIncidentId,
    proposalId: mcpEvidence.storedProposalId,
    authenticatedRequesterId: "policy_agent",
    targetGeneration: broker.generation,
  });
  let unauthorizedApprovalRejected = false;
  try {
    policy.approveAction(action.actionId, "policy_participant", {
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  } catch {
    unauthorizedApprovalRejected = true;
  }
  const manualApproval = process.argv.includes("--manual-approval");
  if (manualApproval) {
    process.stderr.write(
      `${JSON.stringify({ approvalRequired: true, instruction: "Type the canonicalDigest exactly, then press Enter.", action: { actionId: action.actionId, organizationId: action.organizationId, incidentId: action.incidentId, operation: action.operation, target: action.target, parameters: action.parameters, mode: action.mode, graphVersion: action.graphVersion, policyVersion: action.policyVersion, recoveryVersion: action.recoveryVersion, sourceProposal: action.sourceProposal, canonicalDigest: action.canonicalDigest } }, null, 2)}\n`,
    );
    requireDemo(
      (await readApprovalDigest()) === action.canonicalDigest,
      "manual approval digest mismatch or missing input",
    );
  }
  const approval = policy.approveAction(action.actionId, "policy_commander", {
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  const execution = await coordinator.executePreparedAction(
    { actionId: action.actionId, authenticatedExecutorId: "policy_executor" },
    broker,
    observer,
  );
  requireDemo(
    action.mode === "live" &&
      action.target.identity === "pantry-demo-scheduler" &&
      action.target.generation === broker.generation &&
      execution.state === "verified" &&
      execution.verification?.result === "verified",
    "live fixed-target containment independently verified",
  );
  const verification = await coordinator.projectVerifiedOutcome({
    organizationId: pantryOrganizationId,
    incidentId: pantryIncidentId,
    proposalId: mcpEvidence.storedProposalId,
  });
  const approvedFallback = workflows.approveFallback(
    pantryOrganizationId,
    pantryIncidentId,
    pantryFallback.id,
    verification.id,
    "actor_commander",
    1,
  );
  const artifactDir = join(outputDir, "fallback-artifacts");
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  const rosterPath = join(artifactDir, "sanitized-roster.json"),
    procedurePath = join(artifactDir, "checkin-procedure.json");
  await writeFile(
    rosterPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        fictional: true,
        volunteers: [
          { id: "volunteer_alpha", shift: "morning" },
          { id: "volunteer_beta", shift: "afternoon" },
        ],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    procedurePath,
    `${JSON.stringify({ schemaVersion: 1, fictional: true, steps: ["read sanitized roster", "call fictional volunteer", "record check-in result"] }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const rosterRaw = await readFile(rosterPath, "utf8"),
    procedureRaw = await readFile(procedurePath, "utf8"),
    rosterArtifact = JSON.parse(rosterRaw),
    procedureArtifact = JSON.parse(procedureRaw);
  requireDemo(
    rosterArtifact.schemaVersion === 1 &&
      rosterArtifact.fictional === true &&
      Array.isArray(rosterArtifact.volunteers) &&
      rosterArtifact.volunteers.length >= 2 &&
      rosterArtifact.volunteers.every(
        (v: any) => typeof v.id === "string" && typeof v.shift === "string",
      ),
    "sanitized roster artifact schema",
  );
  requireDemo(
    procedureArtifact.schemaVersion === 1 &&
      procedureArtifact.fictional === true &&
      Array.isArray(procedureArtifact.steps) &&
      [
        "read sanitized roster",
        "call fictional volunteer",
        "record check-in result",
      ].every((step) => procedureArtifact.steps.includes(step)),
    "check-in procedure artifact contents",
  );
  const artifactDigests = {
    task_roster: createHash("sha256").update(rosterRaw).digest("hex"),
    task_checkin: createHash("sha256").update(procedureRaw).digest("hex"),
  };
  for (const taskSeed of pantryTasks) {
    let task = workflows.transitionTask(
      pantryOrganizationId,
      pantryIncidentId,
      taskSeed.id,
      "in_progress",
      "actor_volunteer",
      1,
    );
    const acceptedAt = new Date().toISOString();
    const acceptance = {
      ...trustedEvidence(
        `evidence_${taskSeed.id}_accepted`,
        "task_acceptance",
        taskSeed.id,
        `Scripted synthetic verifier validated ${taskSeed.title}; artifact sha256=${artifactDigests[taskSeed.id as keyof typeof artifactDigests]}`,
      ),
      observedAt: acceptedAt,
      receivedAt: acceptedAt,
    };
    // Keep completion and verification tied to a separately stored trusted acceptance fact.
    workflows.recordEvidence(acceptance as any, "actor_verifier");
    task = workflows.transitionTask(
      pantryOrganizationId,
      pantryIncidentId,
      taskSeed.id,
      "completed",
      "actor_volunteer",
      task.revision,
      [acceptance.id],
    );
    workflows.transitionTask(
      pantryOrganizationId,
      pantryIncidentId,
      taskSeed.id,
      "verified",
      "actor_verifier",
      task.revision,
      [acceptance.id],
    );
  }
  const rosterVerifiedAt = new Date().toISOString();
  const rosterAvailability = {
    ...trustedEvidence(
      "evidence_backup_roster_available",
      "verification",
      pantryFallback.fallbackNodeId,
      `Scripted synthetic verifier confirmed sanitized roster artifact sha256=${artifactDigests.task_roster}`,
    ),
    availability: "satisfied" as const,
    observedAt: rosterVerifiedAt,
    receivedAt: rosterVerifiedAt,
  };
  workflows.recordEvidence(rosterAvailability, "actor_verifier");
  const finalIncident = workflows.markRunningOnFallback(
    pantryOrganizationId,
    pantryIncidentId,
    pantryFallback.id,
    "actor_commander",
    1,
    approvedFallback.revision,
  );
  domainStore.close();
  policy.close();
  policy = undefined;
  domainStore = new CanonicalStore(domainDb);
  workflows = new ContinuityService(domainStore);
  policy = new PolicyEngine({ dbPath: policyDb });
  const restarted = {
    incident: domainStore.get(
      pantryOrganizationId,
      pantryIncidentId,
      "incident",
      pantryIncidentId,
    )?.value,
    tasks: domainStore
      .list(pantryOrganizationId, pantryIncidentId, "task")
      .map((x) => x.value),
    proposalCount: domainStore.list(
      pantryOrganizationId,
      pantryIncidentId,
      "proposal",
    ).length,
    execution: policy.getExecution(execution.executionId),
    timelineCount: domainStore.listEvents(
      pantryOrganizationId,
      pantryIncidentId,
    ).length,
  };
  requireDemo(
    restarted.incident?.status === "running_on_fallback" &&
      restarted.tasks.every((task) => task.state === "verified") &&
      restarted.proposalCount === 1 &&
      restarted.execution?.state === "verified",
    "restart persistence without duplicate effects",
  );
  const meshDir = join(outputDir, "mesh");
  const meshFirst = `Incident ${pantryIncidentId}: independently verified containment execution ${execution.executionId}; fallback ${pantryFallback.id} approved.`;
  const meshRestart = `Claim persisted tasks ${pantryTasks.map((task) => task.id).join(", ")} for verified fallback coordination.`;
  const meshRun = await execFileAsync(
    process.execPath,
    [
      resolve("scripts/mesh-demo.ts"),
      "--output",
      meshDir,
      "--organization",
      pantryOrganizationId,
      "--incident",
      pantryIncidentId,
      "--first-text",
      meshFirst,
      "--restart-text",
      meshRestart,
    ],
    { cwd: resolve("."), timeout: 30_000 },
  );
  const mesh = JSON.parse(
    await readFile(join(meshDir, "evidence.json"), "utf8"),
  );
  requireDemo(
    mesh.scope.organizationId === pantryOrganizationId &&
      mesh.scope.incidentId === pantryIncidentId &&
      mesh.persistence.relayHadDurableCustody === true &&
      mesh.messages.every(
        (message: any) => message.status.state === "recipient_acknowledged",
      ) &&
      mesh.recipientInbox.some((item: any) =>
        item.body.text.includes(execution.executionId),
      ) &&
      mesh.recipientInbox.some((item: any) =>
        item.body.text.includes("task_roster"),
      ),
    "mesh incident linkage and relay-custody recovery",
  );
  const evidence = {
    schema: "hackutd.integrated.demo.v1",
    generatedAt: new Date().toISOString(),
    syntheticDataOnly: true,
    outputDir,
    scriptedActors: [
      "actor_commander",
      "actor_verifier",
      "actor_volunteer",
      "actor_agent",
    ],
    baseline: {
      result: baseline.result,
      schedulerReachable: baseline.schedulerReachable,
      controlReachable: baseline.controlReachable,
      brokerProcessState: baseline.brokerProcessState,
      observation,
    },
    mcp: mcpEvidence,
    authority: {
      approvalMode: manualApproval
        ? "manual_digest_entry"
        : "scripted_synthetic_fixture",
      unauthorizedApprovalRejected,
      actionId: action.actionId,
      approvalId: approval.approvalId,
      execution,
    },
    fallback: {
      finalIncidentStatus: finalIncident.status,
      artifactDigests,
      tasks: restarted.tasks.map((t) => ({
        id: t.id,
        state: t.state,
        evidenceIds: t.acceptanceEvidenceIds,
      })),
    },
    restart: restarted,
    mesh: {
      scope: mesh.scope,
      topology: mesh.topology,
      crypto: mesh.crypto,
      persistence: mesh.persistence,
      messages: mesh.messages,
      recipientInboxCount: mesh.recipientInbox.length,
    },
    limitations: [
      "Containment stops one broker-owned disposable local child process; it is not host, network, container, or production isolation.",
      "Domain and policy use separate SQLite databases; projection is persisted but not a cross-database transaction.",
      "SQLite and mesh identity files are plaintext synthetic-demo storage.",
      "Mesh peers are separate processes on one Mac under one OS user; no physical three-device or radio proof.",
      "All commander, verifier, volunteer, and agent personas in this script are deterministic synthetic demo actors.",
      "The MCP client is real; the stored proposal in this scripted run is deterministic fixture input, not a claimed external model inference.",
    ],
  };
  await writeFile(
    join(outputDir, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await writeFile(
    join(outputDir, "report.md"),
    `# Integrated synthetic demo\n\nAll commander, verifier, volunteer, and agent personas below are scripted synthetic demo actors.\n\n- MCP: ${mcpEvidence.protocolVersion} (${mcpEvidence.protocolEra}), ${mcpEvidence.toolNames.length} bounded tools\n- Containment: ${execution.state}; scheduler reachable=${execution.verification?.schedulerReachable}; control reachable=${execution.verification?.controlReachable}\n- Fallback: ${finalIncident.status}; ${restarted.tasks.length} tasks persisted and verified against artifacts ${JSON.stringify(artifactDigests)}\n- Mesh: ${mesh.messages.length} incident-scoped messages recipient-acknowledged; relay could not decrypt=${mesh.crypto.relayCannotDecrypt}\n\nSee evidence.json for assertions and limitations.\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ ok: true, outputDir, evidencePath: join(outputDir, "evidence.json"), reportPath: join(outputDir, "report.md"), meshRun: JSON.parse(meshRun.stdout.trim()) })}\n`,
  );
  policy.close();
  domainStore.close();
  await broker.close();
} finally {
  try {
    policy?.close();
  } catch {}
  try {
    domainStore.close();
  } catch {}
  await broker.close();
}
