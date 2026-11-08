import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AuthContext, MembershipSnapshot } from "./permissions.ts";
import {
  ResponseAuthority,
  ResponseError,
  RetryServiceObserver,
  RetryServiceTarget,
  type IncidentAuthorityState,
} from "./response.ts";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "tether-response-"));
  const memberships = new Map<string, MembershipSnapshot>([
    [
      "employee-ava",
      {
        employeeId: "employee-ava",
        organizationId: "northstar",
        role: "senior_manager",
        active: true,
        policyRevision: 7,
      },
    ],
    [
      "employee-noah",
      {
        employeeId: "employee-noah",
        organizationId: "northstar",
        role: "engineer",
        active: true,
        policyRevision: 7,
      },
    ],
    [
      "employee-priya",
      {
        employeeId: "employee-priya",
        organizationId: "northstar",
        role: "data_science_manager",
        active: true,
        policyRevision: 7,
      },
    ],
    [
      "employee-elena",
      {
        employeeId: "employee-elena",
        organizationId: "northstar",
        role: "marketing",
        active: true,
        policyRevision: 7,
      },
    ],
  ]);
  let incident: IncidentAuthorityState = {
    id: "incident-retry",
    organizationId: "northstar",
    open: true,
    semanticRevision: 11,
    evidenceRevision: 5,
    policyRevision: 7,
    commanderEmployeeId: "employee-ava",
  };
  let now = new Date("2026-11-08T13:00:00.000Z");
  let approvalGranted = true;
  const responseOptions: ConstructorParameters<typeof ResponseAuthority>[0] = {
    dbPath: join(dir, "response.db"),
    incidentLookup: (id) => (id === incident.id ? incident : undefined),
    membershipLookup: (id) => memberships.get(id),
    approvalGrantLookup: (employeeId, incidentId) =>
      approvalGranted &&
      employeeId === "employee-ava" &&
      incidentId === "incident-retry",
    clock: () => now,
  };
  const authority = new ResponseAuthority(responseOptions);
  const target = await RetryServiceTarget.start();
  const observer = new RetryServiceObserver(target);
  const context = (employeeId: string): AuthContext => ({
    ...memberships.get(employeeId)!,
    sessionId: `session-${employeeId}`,
    sessionExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
  });
  const prepare = (employeeId = "employee-noah") =>
    authority.prepare({
      context: context(employeeId),
      incidentId: incident.id,
      sourceProposal: {
        id: "proposal-retry",
        digest: "a".repeat(64),
        contextDigest: "b".repeat(64),
      },
      targetGeneration: target.generation,
      semanticRevision: incident.semanticRevision,
      evidenceRevision: incident.evidenceRevision,
      policyRevision: incident.policyRevision,
    });
  return {
    authority,
    target,
    observer,
    memberships,
    context,
    prepare,
    responseOptions,
    setIncident(update: Partial<IncidentAuthorityState>) {
      incident = { ...incident, ...update };
    },
    setApprovalGranted(value: boolean) {
      approvalGranted = value;
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    async close() {
      authority.close();
      await target.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function expectCode(code: string, operation: () => unknown): void {
  assert.throws(
    operation,
    (error: unknown) => error instanceof ResponseError && error.code === code,
  );
}

test("fixed service reproduces cross-tenant retry, then exact action disables and independently verifies fallback", async () => {
  const f = await fixture();
  try {
    const vulnerable = await fetch(
      `${f.target.serviceUrl}/api/v1/jobs/job-tenant-b/retry`,
      { method: "POST", headers: { authorization: "Bearer tenant-a" } },
    );
    assert.equal(vulnerable.status, 202);
    const action = f.prepare();
    f.authority.approve({
      context: f.context("employee-ava"),
      actionId: action.actionId,
      approvedDigest: action.canonicalDigest,
      expiresAt: "2026-11-08T13:05:00.000Z",
    });
    const execution = await f.authority.executeApproved(
      action.actionId,
      f.target,
      f.observer,
    );
    assert.equal(execution.state, "verified");
    assert.equal(execution.routeDisabled, true);
    assert.equal(execution.controlReachable, true);
    assert.equal(execution.fallbackReady, true);
    assert.equal(
      (
        await fetch(`${f.target.serviceUrl}/api/v1/jobs/job-tenant-b/retry`, {
          method: "POST",
          headers: { authorization: "Bearer tenant-a" },
        })
      ).status,
      503,
    );
    const replay = await f.authority.executeApproved(
      action.actionId,
      f.target,
      f.observer,
    );
    assert.equal(replay.executionId, execution.executionId);
  } finally {
    await f.close();
  }
});

test("model, participant, marketing, and forged actor roles cannot approve", async () => {
  const f = await fixture();
  try {
    const action = f.prepare();
    expectCode("APPROVAL_FORBIDDEN", () =>
      f.authority.approve({
        context: f.context("employee-noah"),
        actionId: action.actionId,
        approvedDigest: action.canonicalDigest,
        expiresAt: "2026-11-08T13:05:00.000Z",
      }),
    );
    expectCode("PROPOSAL_FORBIDDEN", () => f.prepare("employee-elena"));
    expectCode("STALE_AUTH_CONTEXT", () =>
      f.authority.approve({
        context: { ...f.context("employee-noah"), role: "senior_manager" },
        actionId: action.actionId,
        approvedDigest: action.canonicalDigest,
        expiresAt: "2026-11-08T13:05:00.000Z",
      }),
    );
    assert.equal(f.target.disabled, false);
  } finally {
    await f.close();
  }
});

test("semantic, evidence, grant, commander, digest, expiry, and target generation changes fail closed", async () => {
  const f = await fixture();
  try {
    const action = f.prepare();
    expectCode("APPROVAL_DIGEST_MISMATCH", () =>
      f.authority.approve({
        context: f.context("employee-ava"),
        actionId: action.actionId,
        approvedDigest: "f".repeat(64),
        expiresAt: "2026-11-08T13:05:00.000Z",
      }),
    );
    f.authority.approve({
      context: f.context("employee-ava"),
      actionId: action.actionId,
      approvedDigest: action.canonicalDigest,
      expiresAt: "2026-11-08T13:05:00.000Z",
    });
    f.setIncident({ evidenceRevision: 6 });
    await assert.rejects(
      () => f.authority.executeApproved(action.actionId, f.target, f.observer),
      (error: unknown) =>
        error instanceof ResponseError && error.code === "STALE_PROPOSAL",
    );
    assert.equal(f.target.disabled, false);
  } finally {
    await f.close();
  }
});

test("target generation is pinned and dispatch rejects arbitrary operation or authorization", async () => {
  const f = await fixture();
  try {
    const rejected = await f.target.dispatch({
      executionId: "execution-forged",
      actionId: "action-forged",
      operation: "disable_cross_tenant_retry",
      target: {
        identity: "northstar-retry-api",
        generation: f.target.generation,
      },
      authorization: "client-controlled",
    });
    assert.equal(rejected.status, "rejected");
    const action = f.authority.prepare({
      context: f.context("employee-noah"),
      incidentId: "incident-retry",
      sourceProposal: {
        id: "proposal-stale-target",
        digest: "c".repeat(64),
        contextDigest: "d".repeat(64),
      },
      targetGeneration: "recreated-target",
      semanticRevision: 11,
      evidenceRevision: 5,
      policyRevision: 7,
    });
    f.authority.approve({
      context: f.context("employee-ava"),
      actionId: action.actionId,
      approvedDigest: action.canonicalDigest,
      expiresAt: "2026-11-08T13:05:00.000Z",
    });
    await assert.rejects(
      () => f.authority.executeApproved(action.actionId, f.target, f.observer),
      (error: unknown) =>
        error instanceof ResponseError && error.code === "TARGET_STALE",
    );
    assert.equal(f.target.disabled, false);
  } finally {
    await f.close();
  }
});

test("explicit approval grant is required and revocation before execution prevents the effect", async () => {
  const f = await fixture();
  try {
    const action = f.prepare();
    f.setApprovalGranted(false);
    expectCode("APPROVAL_GRANT_REQUIRED", () =>
      f.authority.approve({
        context: f.context("employee-ava"),
        actionId: action.actionId,
        approvedDigest: action.canonicalDigest,
        expiresAt: "2026-11-08T13:05:00.000Z",
      }),
    );
    f.setApprovalGranted(true);
    f.authority.approve({
      context: f.context("employee-ava"),
      actionId: action.actionId,
      approvedDigest: action.canonicalDigest,
      expiresAt: "2026-11-08T13:05:00.000Z",
    });
    f.setApprovalGranted(false);
    await assert.rejects(
      () => f.authority.executeApproved(action.actionId, f.target, f.observer),
      (error: unknown) =>
        error instanceof ResponseError && error.code === "APPROVAL_STALE",
    );
    assert.equal(f.target.disabled, false);
  } finally {
    await f.close();
  }
});

test("concurrent execution reserves before dispatch and produces at most one effect", async () => {
  const f = await fixture();
  try {
    const action = f.prepare();
    f.authority.approve({
      context: f.context("employee-ava"),
      actionId: action.actionId,
      approvedDigest: action.canonicalDigest,
      expiresAt: "2026-11-08T13:05:00.000Z",
    });
    const results = await Promise.allSettled([
      f.authority.executeApproved(action.actionId, f.target, f.observer),
      f.authority.executeApproved(action.actionId, f.target, f.observer),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(f.target.disabled, true);
  } finally {
    await f.close();
  }
});

test("persisted action and execution snapshots are JSON-safe across authority instances", async () => {
  const f = await fixture();
  let reopened: ResponseAuthority | undefined;
  try {
    const action = f.prepare();
    f.authority.approve({
      context: f.context("employee-ava"),
      actionId: action.actionId,
      approvedDigest: action.canonicalDigest,
      expiresAt: "2026-11-08T13:05:00.000Z",
    });
    const execution = await f.authority.executeApproved(
      action.actionId,
      f.target,
      f.observer,
    );
    reopened = new ResponseAuthority(f.responseOptions);
    assert.deepEqual(reopened.listActions(), [action]);
    assert.deepEqual(reopened.getExecution(action.actionId), execution);
    assert.equal(reopened.getExecution("missing-action"), null);
    assert.doesNotThrow(() =>
      JSON.stringify({
        actions: reopened!.listActions(),
        execution: reopened!.getExecution(action.actionId),
      }),
    );
  } finally {
    reopened?.close();
    await f.close();
  }
});
