import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  RunCoordinator,
  RunCoordinatorError,
  type Planner,
  type ToolAdapter,
} from "../src/index.ts";

const trigger = {
  organizationId: "org_a",
  incidentId: "incident_a",
  eventId: "event_a",
  snapshotRevision: 6,
  role: "planner",
  policyRevision: 1,
};
const toolResult = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: { result: value },
});
function path() {
  return join(mkdtempSync(join(tmpdir(), "agent-runs-")), "runs.sqlite");
}
function tools(
  call: (input: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<unknown>,
): ToolAdapter {
  return {
    listTools: async () => ({
      tools: [
        "get_incident",
        "analyze_incident_impact",
        "submit_response_proposal",
      ].map((name) => ({ name })),
    }),
    callTool: call,
  };
}

test("deduplicates triggers and accepts only the canonical proposal returned by one scoped submit", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const planner: Planner = {
    plan: async ({ callTool }) => {
      const saved = (await callTool("submit_response_proposal", {
        organizationId: "org_evil",
        incidentId: "incident_evil",
        id: "proposal_a",
      })) as { id: string };
      return { outcome: "proposed", proposalId: saved.id };
    },
  };
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner,
    tools: tools(async (input) => {
      calls.push(input);
      return toolResult({
        id: "proposal_a",
        organizationId: "org_a",
        incidentId: "incident_a",
      });
    }),
    currentSnapshotRevision: () => 6,
  });
  const first = coordinator.enqueue(trigger);
  assert.equal(coordinator.enqueue(trigger).id, first.id);
  assert.throws(
    () => coordinator.enqueue({ ...trigger, eventId: "event_b" }),
    (error: unknown) =>
      error instanceof RunCoordinatorError &&
      error.code === "incident_run_active",
  );
  const done = await coordinator.execute(first.id);
  assert.equal(done.state, "proposed");
  assert.equal(done.submitCalls, 1);
  assert.equal(calls[0]?.arguments.organizationId, "org_a");
  assert.equal(calls[0]?.arguments.incidentId, "incident_a");
  coordinator.close();
});

test("analyst cannot submit and planner cannot invent a proposal ID", async () => {
  const submitPlanner: Planner = {
    plan: async ({ callTool }) => {
      await callTool("submit_response_proposal", { id: "proposal" });
      return { outcome: "proposed", proposalId: "proposal" };
    },
  };
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: submitPlanner,
    tools: tools(async () =>
      toolResult({
        id: "proposal",
        organizationId: "org_a",
        incidentId: "incident_a",
      }),
    ),
    currentSnapshotRevision: () => 6,
  });
  const analyst = coordinator.enqueue({ ...trigger, role: "analyst" });
  assert.equal(
    (await coordinator.execute(analyst.id)).errorCode,
    "forbidden_tool",
  );
  const inventedCoordinator = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async () => ({ outcome: "proposed", proposalId: "invented" }),
    },
    tools: tools(async () => toolResult({})),
    currentSnapshotRevision: () => 6,
  });
  const invented = inventedCoordinator.enqueue(trigger);
  assert.equal(
    (await inventedCoordinator.execute(invented.id)).errorCode,
    "unverified_proposal_result",
  );
  coordinator.close();
  inventedCoordinator.close();
});

test("enforces tool-call and output byte budgets", async () => {
  const twoCalls: Planner = {
    plan: async ({ callTool }) => {
      await callTool("get_incident");
      await callTool("get_incident");
      return { outcome: "no_action", reason: "done" };
    },
  };
  const budget = new RunCoordinator({
    dbPath: path(),
    planner: twoCalls,
    tools: tools(async () => toolResult({ ok: true })),
    limits: { maxToolCalls: 1 },
    currentSnapshotRevision: () => 6,
  });
  assert.equal(
    (await budget.execute(budget.enqueue(trigger).id)).errorCode,
    "tool_budget_exceeded",
  );
  const output = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async ({ callTool }) => {
        await callTool("get_incident");
        return { outcome: "no_action", reason: "done" };
      },
    },
    tools: tools(async () => toolResult({ text: "x".repeat(100) })),
    limits: { maxOutputBytes: 10 },
    currentSnapshotRevision: () => 6,
  });
  assert.equal(
    (await output.execute(output.enqueue(trigger).id)).errorCode,
    "output_budget_exceeded",
  );
  budget.close();
  output.close();
});

test("stale snapshots supersede before any tool or planner work", async () => {
  let planned = false;
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async () => {
        planned = true;
        return { outcome: "no_action", reason: "unused" };
      },
    },
    tools: tools(async () => {
      throw new Error("must not call");
    }),
    currentSnapshotRevision: () => 7,
  });
  const done = await coordinator.execute(coordinator.enqueue(trigger).id);
  assert.equal(done.state, "superseded");
  assert.equal(planned, false);
  assert.equal(done.toolCalls, 0);
  coordinator.close();
});

test("atomically claims concurrent execute calls", async () => {
  let planCalls = 0;
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async () => {
        planCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { outcome: "no_action", reason: "complete" };
      },
    },
    tools: tools(async () => toolResult({})),
    currentSnapshotRevision: () => 6,
  });
  const run = coordinator.enqueue(trigger);
  await Promise.all([coordinator.execute(run.id), coordinator.execute(run.id)]);
  assert.equal(planCalls, 1);
  assert.equal(coordinator.getRun(run.id)?.attempts, 1);
  assert.equal(coordinator.getRun(run.id)?.state, "no_action");
  coordinator.close();
});

test("deadline after submit is terminal uncertainty and never auto-retries", async () => {
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async ({ callTool }) => {
        await callTool("submit_response_proposal", { id: "proposal" });
        return await new Promise(() => {});
      },
    },
    tools: tools(async () =>
      toolResult({
        id: "proposal",
        organizationId: "org_a",
        incidentId: "incident_a",
      }),
    ),
    limits: { deadlineMs: 10, maxAttempts: 2 },
    currentSnapshotRevision: () => 6,
  });
  const run = coordinator.enqueue(trigger);
  const done = await coordinator.execute(run.id);
  assert.equal(done.state, "timed_out");
  assert.equal(done.errorCode, "proposal_outcome_uncertain_after_timeout");
  assert.equal(done.submitCalls, 1);
  assert.equal((await coordinator.execute(run.id)).submitCalls, 1);
  coordinator.close();
});

test("restart abandons running work without retrying it", () => {
  const dbPath = path();
  const planner: Planner = {
    plan: async () => ({ outcome: "no_action", reason: "unused" }),
  };
  let coordinator = new RunCoordinator({
    dbPath,
    planner,
    tools: tools(async () => toolResult({})),
    currentSnapshotRevision: () => 6,
  });
  const run = coordinator.enqueue(trigger);
  coordinator.close();
  const db = new DatabaseSync(dbPath);
  db.prepare(
    "UPDATE agent_runs SET state='running',attempts=1,owner_token='dead-owner' WHERE id=?",
  ).run(run.id);
  db.close();
  coordinator = new RunCoordinator({
    dbPath,
    planner,
    tools: tools(async () => toolResult({})),
    currentSnapshotRevision: () => 6,
  });
  assert.equal(coordinator.getRun(run.id)?.state, "failed");
  assert.equal(coordinator.getRun(run.id)?.errorCode, "interrupted_restart");
  coordinator.close();
});

test("strictly validates planner results and preserves a canonical submit over no_action", async () => {
  for (const invalid of [
    { outcome: "executed", proposalId: "proposal_a" },
    { outcome: "no_action", reason: "fine", extra: true },
    { outcome: "no_action", reason: "x".repeat(1_001) },
  ]) {
    const coordinator = new RunCoordinator({
      dbPath: path(),
      planner: { plan: async () => invalid },
      tools: tools(async () => toolResult({})),
      currentSnapshotRevision: () => 6,
    });
    const done = await coordinator.execute(coordinator.enqueue(trigger).id);
    assert.equal(done.state, "failed");
    assert.equal(done.errorCode, "invalid_planner_result");
    coordinator.close();
  }

  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async ({ callTool }) => {
        await callTool("submit_response_proposal");
        return { outcome: "no_action", reason: "ignore the submit" };
      },
    },
    tools: tools(async () =>
      toolResult({
        id: "proposal_canonical",
        organizationId: "org_a",
        incidentId: "incident_a",
      }),
    ),
    currentSnapshotRevision: () => 6,
  });
  const done = await coordinator.execute(coordinator.enqueue(trigger).id);
  assert.equal(done.state, "proposed");
  assert.deepEqual(done.result, {
    outcome: "proposed",
    proposalId: "proposal_canonical",
  });
  assert.equal(done.errorCode, "planner_no_action_after_submit");
  coordinator.close();
});

test("fences a second live coordinator sharing the database", async () => {
  const dbPath = path();
  const planner: Planner = {
    plan: async () => ({
      outcome: "no_action",
      reason: "owner remains active",
    }),
  };
  const first = new RunCoordinator({
    dbPath,
    planner,
    tools: tools(async () => toolResult({})),
    currentSnapshotRevision: () => 6,
  });
  assert.throws(
    () =>
      new RunCoordinator({
        dbPath,
        planner,
        tools: tools(async () => toolResult({})),
        currentSnapshotRevision: () => 6,
      }),
    (error: unknown) =>
      error instanceof RunCoordinatorError &&
      error.code === "coordinator_already_open",
  );
  assert.equal(
    (await first.execute(first.enqueue(trigger).id)).state,
    "no_action",
  );
  first.close();
});

test("bounds snapshot callbacks and blocks late tool calls after timeout", async () => {
  let planned = false;
  const snapshotHang = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async () => {
        planned = true;
        return { outcome: "no_action", reason: "unused" };
      },
    },
    tools: tools(async () => toolResult({})),
    limits: { deadlineMs: 15 },
    currentSnapshotRevision: () => new Promise(() => {}),
  });
  const snapshotDone = await snapshotHang.execute(
    snapshotHang.enqueue(trigger).id,
  );
  assert.equal(snapshotDone.state, "timed_out");
  assert.equal(planned, false);
  snapshotHang.close();

  let adapterCalls = 0;
  let lateCode: string | undefined;
  const late = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async ({ callTool }) => {
        setTimeout(() => {
          void callTool("get_incident").catch((error: unknown) => {
            lateCode =
              error instanceof RunCoordinatorError ? error.code : "unexpected";
          });
        }, 35);
        return await new Promise(() => {});
      },
    },
    tools: tools(async () => {
      adapterCalls += 1;
      return toolResult({});
    }),
    limits: { deadlineMs: 15 },
    currentSnapshotRevision: () => 6,
  });
  const lateDone = await late.execute(late.enqueue(trigger).id);
  assert.equal(lateDone.state, "timed_out");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(lateCode, "run_inactive");
  assert.equal(adapterCalls, 0);
  late.close();
});

test("rejects malformed trigger IDs and hashes the complete trigger tuple", () => {
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: { plan: async () => ({ outcome: "no_action", reason: "unused" }) },
    tools: tools(async () => toolResult({})),
    currentSnapshotRevision: () => 6,
  });
  assert.throws(
    () => coordinator.enqueue({ ...trigger, eventId: "event\0forged" }),
    (error: unknown) =>
      error instanceof RunCoordinatorError && error.code === "invalid_trigger",
  );
  assert.throws(
    () => coordinator.enqueue({ ...trigger, organizationId: "x".repeat(129) }),
    (error: unknown) =>
      error instanceof RunCoordinatorError && error.code === "invalid_trigger",
  );
  const one = coordinator.enqueue(trigger);
  assert.equal(coordinator.enqueue({ ...trigger }).id, one.id);
  coordinator.close();
});

test("drains fire-and-forget submit calls and preserves their canonical result", async () => {
  for (const plannerOutcome of ["no_action", "throw"] as const) {
    let committed = false;
    const coordinator = new RunCoordinator({
      dbPath: path(),
      planner: {
        plan: async ({ callTool }) => {
          void callTool("submit_response_proposal");
          if (plannerOutcome === "throw")
            throw new Error("planner abandoned its call");
          return { outcome: "no_action", reason: "incorrect terminal result" };
        },
      },
      tools: tools(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        committed = true;
        return toolResult({
          id: "proposal_delayed",
          organizationId: "org_a",
          incidentId: "incident_a",
        });
      }),
      currentSnapshotRevision: () => 6,
    });
    const done = await coordinator.execute(coordinator.enqueue(trigger).id);
    assert.equal(committed, true);
    assert.equal(done.state, "proposed");
    assert.deepEqual(done.result, {
      outcome: "proposed",
      proposalId: "proposal_delayed",
    });
    assert.equal(
      done.errorCode,
      plannerOutcome === "throw"
        ? "run_error_after_submit:planner_failed"
        : "planner_no_action_after_submit",
    );
    coordinator.close();
  }
});

test("does not hide a quickly rejected fire-and-forget tool call", async () => {
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async ({ callTool }) => {
        void callTool("not_a_tool");
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { outcome: "no_action", reason: "must not hide rejection" };
      },
    },
    tools: tools(async () => toolResult({})),
    currentSnapshotRevision: () => 6,
  });
  const done = await coordinator.execute(coordinator.enqueue(trigger).id);
  assert.equal(done.state, "failed");
  assert.equal(done.errorCode, "forbidden_tool");
  coordinator.close();
});

test("an unresolved submitted proposal times out as uncertain and is never retried", async () => {
  let committed = false;
  let dispatches = 0;
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async ({ callTool }) => {
        void callTool("submit_response_proposal");
        return { outcome: "no_action", reason: "returned early" };
      },
    },
    tools: tools(async () => {
      dispatches += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      committed = true;
      return toolResult({
        id: "proposal_late",
        organizationId: "org_a",
        incidentId: "incident_a",
      });
    }),
    limits: { deadlineMs: 10, maxAttempts: 2 },
    currentSnapshotRevision: () => 6,
  });
  const run = coordinator.enqueue(trigger);
  const done = await coordinator.execute(run.id);
  assert.equal(done.state, "timed_out");
  assert.equal(done.errorCode, "proposal_outcome_uncertain_after_timeout");
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(committed, true);
  assert.equal(dispatches, 1);
  await coordinator.execute(run.id);
  assert.equal(dispatches, 1);
  coordinator.close();
});

test("restart preserves submit uncertainty and rejects malformed canonical scope", async () => {
  const dbPath = path();
  const planner: Planner = {
    plan: async () => ({ outcome: "no_action", reason: "unused" }),
  };
  let coordinator = new RunCoordinator({
    dbPath,
    planner,
    tools: tools(async () => toolResult({})),
    currentSnapshotRevision: () => 6,
  });
  const run = coordinator.enqueue(trigger);
  coordinator.close();
  const db = new DatabaseSync(dbPath);
  db.prepare(
    "UPDATE agent_runs SET state='running',attempts=1,submit_calls=1,owner_token='dead-owner' WHERE id=?",
  ).run(run.id);
  db.close();
  coordinator = new RunCoordinator({
    dbPath,
    planner,
    tools: tools(async () => toolResult({})),
    currentSnapshotRevision: () => 6,
  });
  assert.equal(coordinator.getRun(run.id)?.state, "failed");
  assert.equal(
    coordinator.getRun(run.id)?.errorCode,
    "proposal_outcome_uncertain_after_restart",
  );
  coordinator.close();

  const badScope = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async ({ callTool }) => {
        await callTool("submit_response_proposal");
        return { outcome: "proposed", proposalId: "proposal_wrong_scope" };
      },
    },
    tools: tools(async () =>
      toolResult({
        id: "proposal_wrong_scope",
        organizationId: "org_other",
        incidentId: "incident_a",
      }),
    ),
    currentSnapshotRevision: () => 6,
  });
  const rejected = await badScope.execute(badScope.enqueue(trigger).id);
  assert.equal(rejected.state, "failed");
  assert.equal(
    rejected.errorCode,
    "proposal_outcome_uncertain_after_error:invalid_submit_result",
  );
  badScope.close();
});

test("classifies ignored transport failures after submit dispatch as uncertain", async () => {
  let committed = false;
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async ({ callTool }) => {
        void callTool("submit_response_proposal");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          outcome: "no_action",
          reason: "transport failure was ignored",
        };
      },
    },
    tools: tools(async () => {
      committed = true;
      throw new Error("connection dropped after commit");
    }),
    currentSnapshotRevision: () => 6,
  });
  const done = await coordinator.execute(coordinator.enqueue(trigger).id);
  assert.equal(committed, true);
  assert.equal(done.state, "failed");
  assert.equal(
    done.errorCode,
    "proposal_outcome_uncertain_after_error:planner_failed",
  );
  coordinator.close();
});

test("preserves a validated canonical submit before output budget accounting", async () => {
  const coordinator = new RunCoordinator({
    dbPath: path(),
    planner: {
      plan: async ({ callTool }) => {
        await callTool("submit_response_proposal");
        return { outcome: "no_action", reason: "unreachable" };
      },
    },
    tools: tools(async () =>
      toolResult({
        id: "proposal_large_response",
        organizationId: "org_a",
        incidentId: "incident_a",
        padding: "x".repeat(200),
      }),
    ),
    limits: { maxOutputBytes: 32 },
    currentSnapshotRevision: () => 6,
  });
  const done = await coordinator.execute(coordinator.enqueue(trigger).id);
  assert.equal(done.state, "proposed");
  assert.deepEqual(done.result, {
    outcome: "proposed",
    proposalId: "proposal_large_response",
  });
  assert.equal(done.errorCode, "run_error_after_submit:output_budget_exceeded");
  coordinator.close();
});
