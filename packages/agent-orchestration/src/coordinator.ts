import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type RunState =
  | "queued"
  | "running"
  | "proposed"
  | "no_action"
  | "failed"
  | "timed_out"
  | "superseded";
export type RunTrigger = {
  organizationId: string;
  incidentId: string;
  eventId: string;
  snapshotRevision: number;
  role: string;
  policyRevision: number;
};
export type RunRecord = RunTrigger & {
  id: string;
  state: RunState;
  attempts: number;
  toolCalls: number;
  submitCalls: number;
  outputBytes: number;
  deadlineAt: string;
  result: PlannerResult | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};
export type PlannerResult =
  | { outcome: "proposed"; proposalId: string }
  | { outcome: "no_action"; reason: string };
export type ToolAdapter = {
  listTools(): Promise<{ tools: Array<{ name: string }> }>;
  callTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
};
export type PlannerContext = {
  run: Readonly<RunRecord>;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
};
export type Planner = { plan(context: PlannerContext): Promise<unknown> };
export type RunLimits = {
  maxToolCalls: number;
  maxOutputBytes: number;
  deadlineMs: number;
  maxAttempts: number;
};
export type RunCoordinatorOptions = {
  dbPath: string;
  planner: Planner;
  tools: ToolAdapter;
  allowedTools?: readonly string[];
  limits?: Partial<RunLimits>;
  clock?: () => Date;
  currentSnapshotRevision(trigger: RunTrigger): number | Promise<number>;
};

export class RunCoordinatorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const defaults: RunLimits = {
  maxToolCalls: 12,
  maxOutputBytes: 64 * 1024,
  deadlineMs: 60_000,
  maxAttempts: 1,
};
const supportedTools = new Set([
  "get_incident",
  "get_incident_timeline",
  "get_dependencies",
  "analyze_incident_impact",
  "simulate_containment",
  "list_fallback_plans",
  "list_response_tasks",
  "submit_response_proposal",
]);

function resultValue(result: unknown): unknown {
  if (!result || typeof result !== "object")
    throw new RunCoordinatorError(
      "invalid_tool_result",
      "Tool returned no structured result",
    );
  const candidate = result as {
    isError?: unknown;
    structuredContent?: unknown;
    content?: unknown;
  };
  if (candidate.isError === true)
    throw new RunCoordinatorError(
      "tool_error",
      "Tool rejected the bounded call",
    );
  if (
    candidate.structuredContent &&
    typeof candidate.structuredContent === "object" &&
    "result" in candidate.structuredContent
  ) {
    return (candidate.structuredContent as { result: unknown }).result;
  }
  if (Array.isArray(candidate.content)) {
    const text = candidate.content.find(
      (item): item is { type: "text"; text: string } =>
        Boolean(
          item &&
          typeof item === "object" &&
          (item as { type?: unknown }).type === "text" &&
          typeof (item as { text?: unknown }).text === "string",
        ),
    )?.text;
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        throw new RunCoordinatorError(
          "invalid_tool_result",
          "Tool text result is not JSON",
        );
      }
    }
  }
  throw new RunCoordinatorError(
    "invalid_tool_result",
    "Tool result has no supported value",
  );
}

function plannerResult(value: unknown): PlannerResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RunCoordinatorError(
      "invalid_planner_result",
      "Planner result must be an object",
    );
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    record.outcome === "proposed" &&
    keys.join(",") === "outcome,proposalId" &&
    typeof record.proposalId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.proposalId)
  ) {
    return { outcome: "proposed", proposalId: record.proposalId };
  }
  if (
    record.outcome === "no_action" &&
    keys.join(",") === "outcome,reason" &&
    typeof record.reason === "string" &&
    record.reason.length >= 1 &&
    record.reason.length <= 1_000
  ) {
    return { outcome: "no_action", reason: record.reason };
  }
  throw new RunCoordinatorError(
    "invalid_planner_result",
    "Planner result has an invalid outcome, fields, or bounds",
  );
}

export class RunCoordinator {
  readonly #db: DatabaseSync;
  readonly #planner: Planner;
  readonly #tools: ToolAdapter;
  readonly #allowedTools: Set<string>;
  readonly #limits: RunLimits;
  readonly #clock: () => Date;
  readonly #currentSnapshotRevision: (
    trigger: RunTrigger,
  ) => number | Promise<number>;
  readonly #ownerToken = randomUUID();
  readonly #leaseMs: number;
  #closed = false;

  constructor(options: RunCoordinatorOptions) {
    this.#planner = options.planner;
    this.#tools = options.tools;
    this.#clock = options.clock ?? (() => new Date());
    this.#currentSnapshotRevision = options.currentSnapshotRevision;
    this.#limits = { ...defaults, ...options.limits };
    this.#leaseMs = Math.max(60_000, this.#limits.deadlineMs + 30_000);
    if (
      !Number.isInteger(this.#limits.maxToolCalls) ||
      this.#limits.maxToolCalls < 0 ||
      this.#limits.maxToolCalls > 100 ||
      !Number.isInteger(this.#limits.maxOutputBytes) ||
      this.#limits.maxOutputBytes < 1 ||
      this.#limits.maxOutputBytes > 10_000_000 ||
      !Number.isInteger(this.#limits.deadlineMs) ||
      this.#limits.deadlineMs < 1 ||
      this.#limits.deadlineMs > 300_000 ||
      !Number.isInteger(this.#limits.maxAttempts) ||
      this.#limits.maxAttempts < 1 ||
      this.#limits.maxAttempts > 3
    ) {
      throw new RangeError("invalid run limits");
    }
    const requested = options.allowedTools ?? [...supportedTools];
    if (requested.some((name) => !supportedTools.has(name)))
      throw new RunCoordinatorError(
        "unsupported_tool_allowlist",
        "Allowlist contains unsupported tool",
      );
    this.#allowedTools = new Set(requested);
    this.#db = new DatabaseSync(options.dbPath);
    this.#db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;\n" +
        `CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, incident_id TEXT NOT NULL, event_id TEXT NOT NULL,
        snapshot_revision INTEGER NOT NULL, role TEXT NOT NULL, policy_revision INTEGER NOT NULL,
        dedup_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL, attempts INTEGER NOT NULL, tool_calls INTEGER NOT NULL, submit_calls INTEGER NOT NULL,
        output_bytes INTEGER NOT NULL, deadline_at TEXT NOT NULL, result_json TEXT, error_code TEXT, owner_token TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS coordinator_lock (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner_token TEXT NOT NULL, lease_until TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_incident
        ON agent_runs(organization_id,incident_id) WHERE state IN ('queued','running');`,
    );
    this.#acquireOwnership();
  }

  close(): void {
    if (this.#closed) return;
    this.#db
      .prepare(
        "DELETE FROM coordinator_lock WHERE singleton=1 AND owner_token=?",
      )
      .run(this.#ownerToken);
    this.#closed = true;
    this.#db.close();
  }

  recoverInterrupted(): number {
    this.#renewOwnership();
    const now = this.#clock().toISOString();
    const result = this.#db
      .prepare(
        `UPDATE agent_runs SET state='failed',
      error_code=CASE WHEN submit_calls>0 THEN 'proposal_outcome_uncertain_after_restart' ELSE 'interrupted_restart' END,
      owner_token=NULL,updated_at=? WHERE state='running' AND owner_token IS NOT ?`,
      )
      .run(now, this.#ownerToken);
    return Number(result.changes);
  }

  #acquireOwnership(): void {
    const now = this.#clock();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const lock = this.#db
        .prepare(
          "SELECT owner_token,lease_until FROM coordinator_lock WHERE singleton=1",
        )
        .get() as { owner_token: string; lease_until: string } | undefined;
      if (lock && Date.parse(lock.lease_until) > now.getTime()) {
        throw new RunCoordinatorError(
          "coordinator_already_open",
          "Another live coordinator owns this database",
        );
      }
      this.#db
        .prepare(
          `INSERT INTO coordinator_lock(singleton,owner_token,lease_until) VALUES(1,?,?)
        ON CONFLICT(singleton) DO UPDATE SET owner_token=excluded.owner_token,lease_until=excluded.lease_until`,
        )
        .run(
          this.#ownerToken,
          new Date(now.getTime() + this.#leaseMs).toISOString(),
        );
      this.#db
        .prepare(
          `UPDATE agent_runs SET state='failed',
        error_code=CASE WHEN submit_calls>0 THEN 'proposal_outcome_uncertain_after_restart' ELSE 'interrupted_restart' END,
        owner_token=NULL,updated_at=? WHERE state='running'`,
        )
        .run(now.toISOString());
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      this.#db.close();
      throw error;
    }
  }

  #renewOwnership(): void {
    if (this.#closed)
      throw new RunCoordinatorError(
        "coordinator_closed",
        "Coordinator is closed",
      );
    const until = new Date(
      this.#clock().getTime() + this.#leaseMs,
    ).toISOString();
    const result = this.#db
      .prepare(
        "UPDATE coordinator_lock SET lease_until=? WHERE singleton=1 AND owner_token=?",
      )
      .run(until, this.#ownerToken);
    if (result.changes !== 1)
      throw new RunCoordinatorError(
        "coordinator_ownership_lost",
        "Coordinator ownership was lost",
      );
  }

  async #withDeadline<T>(promise: Promise<T>, deadlineAt: string): Promise<T> {
    const remaining = Math.max(
      1,
      Date.parse(deadlineAt) - this.#clock().getTime(),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new RunCoordinatorError(
                  "deadline_exceeded",
                  "Run deadline elapsed",
                ),
              ),
            remaining,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async #assertActiveAndFresh(run: RunRecord): Promise<void> {
    this.#renewOwnership();
    const persisted = this.getRun(run.id);
    if (!persisted || persisted.state !== "running")
      throw new RunCoordinatorError("run_inactive", "Run is no longer running");
    const owner = this.#db
      .prepare("SELECT owner_token FROM agent_runs WHERE id=?")
      .get(run.id) as { owner_token: string | null } | undefined;
    if (owner?.owner_token !== this.#ownerToken)
      throw new RunCoordinatorError(
        "run_fenced",
        "Run is owned by another coordinator",
      );
    if (this.#clock().getTime() >= Date.parse(run.deadlineAt))
      throw new RunCoordinatorError(
        "deadline_exceeded",
        "Run deadline elapsed",
      );
    const revision = await this.#withDeadline(
      Promise.resolve(this.#currentSnapshotRevision(run)),
      run.deadlineAt,
    );
    if (revision !== run.snapshotRevision)
      throw new RunCoordinatorError("stale_snapshot", "Run snapshot is stale");
  }

  enqueue(trigger: RunTrigger): RunRecord {
    this.#renewOwnership();
    const boundedId = (value: unknown): value is string =>
      typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
    if (
      !boundedId(trigger.organizationId) ||
      !boundedId(trigger.incidentId) ||
      !boundedId(trigger.eventId) ||
      !["analyst", "reviewer", "planner"].includes(trigger.role) ||
      !Number.isSafeInteger(trigger.snapshotRevision) ||
      trigger.snapshotRevision < 1 ||
      !Number.isSafeInteger(trigger.policyRevision) ||
      trigger.policyRevision < 1
    ) {
      throw new RunCoordinatorError(
        "invalid_trigger",
        "Run trigger is incomplete",
      );
    }
    const dedupKey = createHash("sha256")
      .update(
        JSON.stringify([
          trigger.organizationId,
          trigger.incidentId,
          trigger.eventId,
          trigger.snapshotRevision,
          trigger.role,
          trigger.policyRevision,
        ]),
      )
      .digest("hex");
    const existing = this.#db
      .prepare("SELECT id FROM agent_runs WHERE dedup_key=?")
      .get(dedupKey) as { id: string } | undefined;
    if (existing) return this.getRun(existing.id)!;
    const now = this.#clock();
    const id = `run_${randomUUID()}`;
    try {
      this.#db
        .prepare(
          `INSERT INTO agent_runs
        (id,organization_id,incident_id,event_id,snapshot_revision,role,policy_revision,dedup_key,state,attempts,tool_calls,submit_calls,output_bytes,deadline_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?, 'queued',0,0,0,0,?,?,?)`,
        )
        .run(
          id,
          trigger.organizationId,
          trigger.incidentId,
          trigger.eventId,
          trigger.snapshotRevision,
          trigger.role,
          trigger.policyRevision,
          dedupKey,
          new Date(now.getTime() + this.#limits.deadlineMs).toISOString(),
          now.toISOString(),
          now.toISOString(),
        );
    } catch (error) {
      if (
        String(error).includes("one_active_run_per_incident") ||
        String(error).includes(
          "agent_runs.organization_id, agent_runs.incident_id",
        )
      ) {
        throw new RunCoordinatorError(
          "incident_run_active",
          "Another run is active for this incident",
        );
      }
      throw error;
    }
    return this.getRun(id)!;
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.#db
      .prepare("SELECT * FROM agent_runs WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.#row(row) : undefined;
  }

  listRuns(organizationId: string, incidentId: string): RunRecord[] {
    return (
      this.#db
        .prepare(
          "SELECT * FROM agent_runs WHERE organization_id=? AND incident_id=? ORDER BY created_at,id",
        )
        .all(organizationId, incidentId) as Array<Record<string, unknown>>
    ).map((row) => this.#row(row));
  }

  async execute(id: string): Promise<RunRecord> {
    this.#renewOwnership();
    const initial = this.getRun(id);
    if (!initial)
      throw new RunCoordinatorError("run_not_found", "Run does not exist");
    if (initial.state !== "queued") return initial;
    if (initial.attempts >= this.#limits.maxAttempts)
      return this.#finish(id, "failed", null, "attempt_budget_exceeded");
    if (this.#clock().getTime() >= Date.parse(initial.deadlineAt))
      return this.#finish(id, "timed_out", null, "deadline_exceeded");
    let initialRevision: number;
    try {
      initialRevision = await this.#withDeadline(
        Promise.resolve(this.#currentSnapshotRevision(initial)),
        initial.deadlineAt,
      );
    } catch (error) {
      const code =
        error instanceof RunCoordinatorError
          ? error.code
          : "snapshot_check_failed";
      return this.#finish(
        id,
        code === "deadline_exceeded" ? "timed_out" : "failed",
        null,
        code,
      );
    }
    if (initialRevision !== initial.snapshotRevision)
      return this.#finish(id, "superseded", null, "stale_snapshot");
    const startedAt = this.#clock().toISOString();
    const claim = this.#db
      .prepare(
        "UPDATE agent_runs SET state='running',attempts=attempts+1,owner_token=?,updated_at=? WHERE id=? AND state='queued'",
      )
      .run(this.#ownerToken, startedAt, id);
    if (claim.changes !== 1) return this.getRun(id)!;
    const run = this.getRun(id)!;
    let active = true;
    let submitAttempted = false;
    let submittedProposalId: string | undefined;
    const inFlight = new Set<Promise<unknown>>();
    try {
      await this.#assertActiveAndFresh(run);
      const listed = await this.#withDeadline(
        this.#tools.listTools(),
        run.deadlineAt,
      );
      await this.#assertActiveAndFresh(run);
      const advertised = new Set(listed.tools.map((tool) => tool.name));
      const performCall = async (
        name: string,
        args: Record<string, unknown> = {},
      ): Promise<unknown> => {
        if (!active)
          throw new RunCoordinatorError(
            "run_inactive",
            "Run is no longer active",
          );
        await this.#assertActiveAndFresh(run);
        if (!active)
          throw new RunCoordinatorError(
            "run_inactive",
            "Run is no longer active",
          );
        const roleTools =
          run.role === "planner"
            ? this.#allowedTools
            : new Set(
                [...this.#allowedTools].filter(
                  (tool) => tool !== "submit_response_proposal",
                ),
              );
        if (!roleTools.has(name) || !advertised.has(name))
          throw new RunCoordinatorError(
            "forbidden_tool",
            `Tool ${name} is unavailable or forbidden for this role`,
          );
        const current = this.getRun(id)!;
        if (current.toolCalls >= this.#limits.maxToolCalls)
          throw new RunCoordinatorError(
            "tool_budget_exceeded",
            "Tool-call budget exhausted",
          );
        if (name === "submit_response_proposal") {
          if (current.submitCalls >= 1)
            throw new RunCoordinatorError(
              "submit_budget_exceeded",
              "Only one proposal submission is allowed per run",
            );
          submitAttempted = true;
        }
        this.#db
          .prepare(
            "UPDATE agent_runs SET tool_calls=tool_calls+1,submit_calls=submit_calls+?,updated_at=? WHERE id=?",
          )
          .run(
            name === "submit_response_proposal" ? 1 : 0,
            this.#clock().toISOString(),
            id,
          );
        const raw = await this.#withDeadline(
          this.#tools.callTool({
            name,
            arguments: {
              ...args,
              organizationId: run.organizationId,
              incidentId: run.incidentId,
            },
          }),
          run.deadlineAt,
        );
        if (!active)
          throw new RunCoordinatorError(
            "run_inactive",
            "Tool returned after the run became terminal",
          );
        await this.#assertActiveAndFresh(run);
        const value = resultValue(raw);
        if (name === "submit_response_proposal") {
          const proposal = value as {
            id?: unknown;
            organizationId?: unknown;
            incidentId?: unknown;
          } | null;
          if (
            !proposal ||
            typeof proposal.id !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(proposal.id) ||
            proposal.organizationId !== run.organizationId ||
            proposal.incidentId !== run.incidentId
          ) {
            throw new RunCoordinatorError(
              "invalid_submit_result",
              "Proposal submission returned no bounded canonical ID in the run scope",
            );
          }
          submittedProposalId = proposal.id;
        }
        const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
        const after = this.getRun(id)!;
        if (after.outputBytes + bytes > this.#limits.maxOutputBytes)
          throw new RunCoordinatorError(
            "output_budget_exceeded",
            "Tool-output budget exhausted",
          );
        this.#db
          .prepare(
            "UPDATE agent_runs SET output_bytes=output_bytes+?,updated_at=? WHERE id=?",
          )
          .run(bytes, this.#clock().toISOString(), id);
        return value;
      };
      const callTool = (
        name: string,
        args: Record<string, unknown> = {},
      ): Promise<unknown> => {
        const tracked = performCall(name, args);
        inFlight.add(tracked);
        void tracked.catch(() => undefined);
        return tracked;
      };
      let rawResult: unknown;
      let plannerError: unknown;
      try {
        rawResult = await this.#withDeadline(
          this.#planner.plan({ run, callTool }),
          run.deadlineAt,
        );
      } catch (error) {
        plannerError = error;
      }
      let detachedError: unknown;
      while (inFlight.size > 0) {
        const batch = [...inFlight];
        inFlight.clear();
        const settled = await this.#withDeadline(
          Promise.allSettled(batch),
          run.deadlineAt,
        );
        detachedError ??= settled.find(
          (item): item is PromiseRejectedResult => item.status === "rejected",
        )?.reason;
      }
      active = false;
      if (plannerError) throw plannerError;
      if (detachedError) throw detachedError;
      await this.#assertActiveAndFresh(run);
      let result: PlannerResult;
      try {
        result = plannerResult(rawResult);
      } catch (error) {
        if (submittedProposalId)
          return this.#finish(
            id,
            "proposed",
            { outcome: "proposed", proposalId: submittedProposalId },
            "planner_result_rejected_after_submit",
          );
        throw error;
      }
      if (
        submittedProposalId &&
        (result.outcome === "no_action" ||
          result.proposalId !== submittedProposalId)
      ) {
        return this.#finish(
          id,
          "proposed",
          { outcome: "proposed", proposalId: submittedProposalId },
          result.outcome === "no_action"
            ? "planner_no_action_after_submit"
            : "planner_proposal_id_mismatch",
        );
      }
      if (result.outcome === "proposed" && !submittedProposalId)
        throw new RunCoordinatorError(
          "unverified_proposal_result",
          "Proposed terminal state requires the canonical submit result from this run",
        );
      return this.#finish(id, result.outcome, result, null);
    } catch (error) {
      active = false;
      const code =
        error instanceof RunCoordinatorError ? error.code : "planner_failed";
      const timedOut = code === "deadline_exceeded";
      if (submittedProposalId && !timedOut) {
        return this.#finish(
          id,
          "proposed",
          { outcome: "proposed", proposalId: submittedProposalId },
          `run_error_after_submit:${code}`,
        );
      }
      const finalCode =
        timedOut && submitAttempted
          ? "proposal_outcome_uncertain_after_timeout"
          : submitAttempted
            ? `proposal_outcome_uncertain_after_error:${code}`
            : code;
      const state =
        code === "stale_snapshot"
          ? "superseded"
          : timedOut
            ? "timed_out"
            : "failed";
      return this.#finish(id, state, null, finalCode);
    }
  }

  #finish(
    id: string,
    state: Exclude<RunState, "queued" | "running">,
    result: PlannerResult | null,
    errorCode: string | null,
  ): RunRecord {
    this.#db
      .prepare(
        `UPDATE agent_runs SET state=?,result_json=?,error_code=?,owner_token=NULL,updated_at=? WHERE id=? AND
      (state='queued' OR (state='running' AND owner_token=?))`,
      )
      .run(
        state,
        result ? JSON.stringify(result) : null,
        errorCode,
        this.#clock().toISOString(),
        id,
        this.#ownerToken,
      );
    return this.getRun(id)!;
  }

  #row(row: Record<string, unknown>): RunRecord {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      incidentId: String(row.incident_id),
      eventId: String(row.event_id),
      snapshotRevision: Number(row.snapshot_revision),
      role: String(row.role),
      policyRevision: Number(row.policy_revision),
      state: row.state as RunState,
      attempts: Number(row.attempts),
      toolCalls: Number(row.tool_calls),
      submitCalls: Number(row.submit_calls),
      outputBytes: Number(row.output_bytes),
      deadlineAt: String(row.deadline_at),
      result: row.result_json
        ? (JSON.parse(String(row.result_json)) as PlannerResult)
        : null,
      errorCode: row.error_code ? String(row.error_code) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

export class DeterministicFixturePlanner implements Planner {
  readonly toolName: string;
  readonly result: PlannerResult;
  readonly args: Record<string, unknown>;
  constructor(
    toolName: string,
    result: PlannerResult,
    args: Record<string, unknown> = {},
  ) {
    this.toolName = toolName;
    this.result = result;
    this.args = args;
  }
  async plan(context: PlannerContext): Promise<PlannerResult> {
    await context.callTool(this.toolName, this.args);
    return this.result;
  }
}
