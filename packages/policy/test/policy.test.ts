import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  DemoBroker,
  IndependentObserver,
} from "../../../apps/demo-broker/src/index.ts";
import { PolicyEngine, PolicyError, type AuthoritySeed } from "../src/index.ts";

async function fixture(mode: "live" | "simulation" = "live") {
  const dir = mkdtempSync(join(tmpdir(), "hackutd-policy-"));
  const brokerPath = join(dir, "broker.db");
  const broker = await DemoBroker.start({
    dbPath: brokerPath,
    schedulerPort: 0,
    controlPort: 0,
  });
  const seed: AuthoritySeed = {
    principals: [
      { id: "agent-a", kind: "agent", organizationId: "org-a", roles: [] },
      {
        id: "participant-a",
        kind: "human",
        organizationId: "org-a",
        roles: ["participant"],
      },
      {
        id: "commander-a",
        kind: "human",
        organizationId: "org-a",
        roles: ["incident_commander"],
      },
      {
        id: "executor-a",
        kind: "service",
        organizationId: "org-a",
        roles: ["execution_service"],
      },
      {
        id: "commander-b",
        kind: "human",
        organizationId: "org-b",
        roles: ["incident_commander"],
      },
    ],
    incidents: [
      {
        id: "incident-a",
        organizationId: "org-a",
        commanderPrincipalId: "commander-a",
        revision: 1,
        open: true,
      },
      {
        id: "incident-b",
        organizationId: "org-b",
        commanderPrincipalId: "commander-b",
        revision: 1,
        open: true,
      },
    ],
    target: {
      identity: "pantry-demo-scheduler",
      generation: broker.generation,
      organizationId: "org-a",
      enabled: true,
    },
    graphVersion: 4,
    policyVersion: 7,
    recoveryVersion: 2,
  };
  const policyPath = join(dir, "policy.db");
  const policy = new PolicyEngine({ dbPath: policyPath, seed });
  const observer = new IndependentObserver({
    schedulerHealthUrl: broker.schedulerHealthUrl,
    controlHealthUrl: broker.controlHealthUrl,
    expectedToken: broker.fixtureToken,
    readBrokerState: () => broker.readProcessState(),
  });
  const input = {
    organizationId: "org-a",
    incidentId: "incident-a",
    operation: "stop_demo_scheduler" as const,
    target: {
      identity: "pantry-demo-scheduler" as const,
      generation: broker.generation,
    },
    parameters: {},
    mode,
    graphVersion: 4,
    policyVersion: 7,
    recoveryVersion: 2,
    sourceProposal: {
      id: "proposal-a",
      digest: "a".repeat(64),
      contextDigest: "c".repeat(64),
    },
  };
  return {
    dir,
    policyPath,
    brokerPath,
    seed,
    broker,
    policy,
    observer,
    input,
    cleanup: async () => {
      try {
        policy.close();
      } catch {}
      await broker.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function expiry(): string {
  return new Date(Date.now() + 60_000).toISOString();
}
function expectCode(code: string, fn: () => unknown): void {
  assert.throws(
    fn,
    (error: unknown) => error instanceof PolicyError && error.code === code,
  );
}

test("exact approval stops only pinned generation and independent observer verifies", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    const approval = f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    assert.equal(approval.approvedDigest.length, 64);
    const execution = await f.policy.executeApproved(
      action.actionId,
      "executor-a",
      f.broker,
      f.observer,
    );
    assert.equal(execution.state, "verified");
    assert.equal(f.broker.processState, "stopped");
    assert.equal(execution.verification?.controlReachable, true);
    const invalid = await f.broker.dispatch({
      executionId: execution.executionId,
      actionId: action.actionId,
      operation: "stop_demo_scheduler",
      target: f.input.target,
      authorization: "invalid",
    });
    assert.equal(invalid.status, "rejected");
    assert.equal(invalid.attemptId, "none");
    const rebound = await f.broker.dispatch({
      executionId: execution.executionId,
      actionId: "different-action",
      operation: "stop_demo_scheduler",
      target: f.input.target,
      authorization: f.broker.dispatchAuthorization,
    });
    assert.equal(rebound.status, "rejected");
    assert.match(rebound.reason!, /binding mismatch/);
  } finally {
    await f.cleanup();
  }
});

test("caller roles and flags cannot confer approve or execute authority", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    expectCode("APPROVAL_FORBIDDEN", () =>
      f.policy.approveAction(action.actionId, "participant-a", {
        expiresAt: expiry(),
      }),
    );
    expectCode("ORGANIZATION_SCOPE_MISMATCH", () =>
      f.policy.approveAction(action.actionId, "commander-b", {
        expiresAt: expiry(),
      }),
    );
    f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    await assert.rejects(
      () =>
        f.policy.executeApproved(
          action.actionId,
          "participant-a",
          f.broker,
          f.observer,
        ),
      (error: unknown) =>
        error instanceof PolicyError && error.code === "EXECUTION_FORBIDDEN",
    );
    assert.equal(f.broker.processState, "running");
  } finally {
    await f.cleanup();
  }
});

test("changed target, parameters, mode, organization and stale versions require a distinct valid intent", async () => {
  const f = await fixture();
  try {
    expectCode("TARGET_STALE", () =>
      f.policy.proposeAction(
        { ...f.input, target: { ...f.input.target, generation: "swapped" } },
        "agent-a",
      ),
    );
    expectCode("INVALID_PARAMETERS", () =>
      f.policy.proposeAction(
        { ...f.input, parameters: { user_confirmed: true } as never },
        "agent-a",
      ),
    );
    expectCode("ORGANIZATION_SCOPE_MISMATCH", () =>
      f.policy.proposeAction(
        { ...f.input, organizationId: "org-b" },
        "agent-a",
      ),
    );
    expectCode("STALE_VERSION", () =>
      f.policy.proposeAction({ ...f.input, graphVersion: 3 }, "agent-a"),
    );
    const live = f.policy.proposeAction(f.input, "agent-a");
    expectCode("PROPOSAL_BINDING_CONFLICT", () =>
      f.policy.proposeAction({ ...f.input, mode: "simulation" }, "agent-a"),
    );
    const simulation = f.policy.proposeAction(
      {
        ...f.input,
        mode: "simulation",
        sourceProposal: {
          id: "proposal-simulation",
          digest: "b".repeat(64),
          contextDigest: "d".repeat(64),
        },
      },
      "agent-a",
    );
    assert.notEqual(live.canonicalDigest, simulation.canonicalDigest);
  } finally {
    await f.cleanup();
  }
});

test("single-use reservation rejects concurrent replay with one stable execution", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    const results = await Promise.allSettled([
      f.policy.executeApproved(
        action.actionId,
        "executor-a",
        f.broker,
        f.observer,
      ),
      f.policy.executeApproved(
        action.actionId,
        "executor-a",
        f.broker,
        f.observer,
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.ok(f.policy.getApproval(action.actionId)?.executionId);
  } finally {
    await f.cleanup();
  }
});

test("simulation is authorized but dispatches zero effects", async () => {
  const f = await fixture("simulation");
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    const execution = await f.policy.executeApproved(
      action.actionId,
      "executor-a",
      f.broker,
      f.observer,
    );
    assert.equal(execution.state, "verified");
    assert.match(execution.reason!, /no external effect/);
    assert.equal(f.broker.processState, "running");
    assert.equal(await f.broker.lookup(execution.executionId), null);
  } finally {
    await f.cleanup();
  }
});

test("revoked requester and target-generation swap fail closed before side effect", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    f.policy.close();
    const changed = structuredClone(f.seed);
    changed.principals[0]!.revoked = true;
    changed.target.generation = "new-generation";
    const changedPolicy = new PolicyEngine({
      dbPath: f.policyPath,
      seed: changed,
    });
    await assert.rejects(
      () =>
        changedPolicy.executeApproved(
          action.actionId,
          "executor-a",
          f.broker,
          f.observer,
        ),
      (error: unknown) =>
        error instanceof PolicyError &&
        ["UNAUTHENTICATED_OR_REVOKED", "TARGET_STALE"].includes(error.code),
    );
    changedPolicy.close();
    assert.equal(f.broker.processState, "running");
  } finally {
    await f.cleanup();
  }
});

test("crash after reservation never redispatches by timeout guess", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    await assert.rejects(
      () =>
        f.policy.executeApproved(
          action.actionId,
          "executor-a",
          f.broker,
          f.observer,
          {
            afterReserve: () => {
              throw new Error("injected crash");
            },
          },
        ),
      /injected crash/,
    );
    const executionId = f.policy.getApproval(action.actionId)!.executionId!;
    const reconciled = await f.policy.reconcileExecution(
      executionId,
      f.broker,
      f.observer,
    );
    assert.equal(reconciled.state, "outcome_unknown");
    assert.equal(f.broker.processState, "running");
    await assert.rejects(() =>
      f.policy.executeApproved(
        action.actionId,
        "executor-a",
        f.broker,
        f.observer,
      ),
    );
  } finally {
    await f.cleanup();
  }
});

test("persisted broker dispatch marker without terminal receipt reconciles outcome_unknown without reexecution", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    await assert.rejects(() =>
      f.policy.executeApproved(
        action.actionId,
        "executor-a",
        f.broker,
        f.observer,
        {
          afterReserve: () => {
            throw new Error("authority crashed before receiving broker result");
          },
        },
      ),
    );
    const executionId = f.policy.getApproval(action.actionId)!.executionId!;
    const brokerStore = new DatabaseSync(f.brokerPath);
    brokerStore
      .prepare(
        "INSERT INTO broker_attempts VALUES(?,?,?,?, 'dispatching', ?, NULL)",
      )
      .run(
        executionId,
        action.actionId,
        f.broker.generation,
        "attempt-crash-marker",
        new Date().toISOString(),
      );
    brokerStore.close();
    const reconciled = await f.policy.reconcileExecution(
      executionId,
      f.broker,
      f.observer,
    );
    assert.equal(reconciled.state, "outcome_unknown");
    assert.match(reconciled.reason!, /no redispatch permitted/);
    assert.equal(reconciled.brokerReceipt?.status, "outcome_unknown");
    assert.equal(f.broker.processState, "running");
  } finally {
    await f.cleanup();
  }
});

test("observer outage records outcome_unknown, never verified", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    const broken = new IndependentObserver({
      schedulerHealthUrl: f.broker.schedulerHealthUrl,
      controlHealthUrl: "http://127.0.0.1:1/health",
      expectedToken: f.broker.fixtureToken,
      readBrokerState: () => f.broker.readProcessState(),
    });
    const execution = await f.policy.executeApproved(
      action.actionId,
      "executor-a",
      f.broker,
      broken,
    );
    assert.equal(execution.state, "outcome_unknown");
    const reconciled = await f.policy.reconcileExecution(
      execution.executionId,
      f.broker,
      f.observer,
    );
    assert.equal(reconciled.state, "verified");
    assert.equal(reconciled.executionId, execution.executionId);
  } finally {
    await f.cleanup();
  }
});

test("approval expires before reservation and creates durable denial-safe state", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: new Date(Date.now() + 10).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(
      () =>
        f.policy.executeApproved(
          action.actionId,
          "executor-a",
          f.broker,
          f.observer,
        ),
      (error: unknown) =>
        error instanceof PolicyError && error.code === "APPROVAL_EXPIRED",
    );
    assert.equal(f.broker.processState, "running");
  } finally {
    await f.cleanup();
  }
});

test("post-approval row mutation breaks the recomputed immutable digest", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    f.policy.approveAction(action.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    const attacker = new DatabaseSync(f.policyPath);
    attacker
      .prepare("UPDATE actions SET mode='simulation' WHERE action_id=?")
      .run(action.actionId);
    attacker.close();
    await assert.rejects(
      () =>
        f.policy.executeApproved(
          action.actionId,
          "executor-a",
          f.broker,
          f.observer,
        ),
      (error: unknown) =>
        error instanceof PolicyError && error.code === "ACTION_DIGEST_MISMATCH",
    );
    assert.equal(f.broker.processState, "running");
  } finally {
    await f.cleanup();
  }
});

test("target organization scope is enforced independently of incident membership", async () => {
  const f = await fixture();
  try {
    expectCode("TARGET_STALE", () =>
      f.policy.proposeAction(
        { ...f.input, organizationId: "org-b", incidentId: "incident-b" },
        "commander-b",
      ),
    );
  } finally {
    await f.cleanup();
  }
});

test("distinct approved actions serialize on one target until uncertain execution reconciles", async () => {
  const f = await fixture();
  try {
    const first = f.policy.proposeAction(f.input, "agent-a"),
      second = f.policy.proposeAction(
        {
          ...f.input,
          sourceProposal: {
            id: "proposal-b",
            digest: "b".repeat(64),
            contextDigest: "d".repeat(64),
          },
        },
        "agent-a",
      );
    f.policy.approveAction(first.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    f.policy.approveAction(second.actionId, "commander-a", {
      expiresAt: expiry(),
    });
    await assert.rejects(() =>
      f.policy.executeApproved(
        first.actionId,
        "executor-a",
        f.broker,
        f.observer,
        {
          afterReserve: () => {
            throw new Error("crash");
          },
        },
      ),
    );
    await assert.rejects(
      () =>
        f.policy.executeApproved(
          second.actionId,
          "executor-a",
          f.broker,
          f.observer,
        ),
      (error: unknown) =>
        error instanceof PolicyError && error.code === "TARGET_BUSY",
    );
    assert.equal(f.broker.processState, "running");
  } finally {
    await f.cleanup();
  }
});

test("authorization denials are durable without storing request payloads", async () => {
  const f = await fixture();
  try {
    const action = f.policy.proposeAction(f.input, "agent-a");
    expectCode("APPROVAL_FORBIDDEN", () =>
      f.policy.approveAction(action.actionId, "participant-a", {
        expiresAt: expiry(),
      }),
    );
    assert.ok(
      f.policy
        .listAudit()
        .some(
          (entry) =>
            entry.event === "denied" &&
            entry.reasonCode === "APPROVAL_FORBIDDEN" &&
            entry.actionId === action.actionId,
        ),
    );
  } finally {
    await f.cleanup();
  }
});
