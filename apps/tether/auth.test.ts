import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthError, AuthService } from "./auth.ts";
import type { MembershipSnapshot } from "./permissions.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "tether-auth-"));
  const memberships = new Map<string, MembershipSnapshot>([
    [
      "employee-ava",
      {
        employeeId: "employee-ava",
        organizationId: "northstar",
        role: "senior_manager",
        active: true,
        policyRevision: 1,
      },
    ],
    [
      "employee-noah",
      {
        employeeId: "employee-noah",
        organizationId: "northstar",
        role: "engineer",
        active: true,
        policyRevision: 1,
      },
    ],
    [
      "employee-priya",
      {
        employeeId: "employee-priya",
        organizationId: "northstar",
        role: "data_science_manager",
        active: true,
        policyRevision: 1,
      },
    ],
    [
      "employee-elena",
      {
        employeeId: "employee-elena",
        organizationId: "northstar",
        role: "marketing",
        active: true,
        policyRevision: 1,
      },
    ],
  ]);
  let now = new Date("2026-11-08T12:00:00.000Z");
  const auth = new AuthService({
    dbPath: join(dir, "auth.db"),
    runtimeDir: join(dir, "private"),
    membershipLookup: (id) => memberships.get(id),
    clock: () => now,
    sessionTtlMs: 10_000,
    maxLoginAttempts: 3,
    scryptCost: 1_024,
  });
  const bootstrap = auth.bootstrapPresentationAccounts();
  const accounts = auth.readBootstrapAccountsForLocalSetup();
  return {
    dir,
    auth,
    memberships,
    accounts,
    bootstrap,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    close() {
      auth.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function expectCode(code: string, operation: () => unknown): void {
  assert.throws(
    operation,
    (error: unknown) => error instanceof AuthError && error.code === code,
  );
}

test("bootstrap credentials are random, private, and four real accounts authenticate", () => {
  const f = fixture();
  try {
    assert.equal(f.accounts.length, 4);
    assert.equal(statSync(join(f.dir, "private")).mode & 0o777, 0o700);
    assert.equal(statSync(f.bootstrap.path).mode & 0o777, 0o600);
    assert.equal(
      new Set(f.accounts.map((account) => account.password)).size,
      4,
    );
    for (const account of f.accounts) {
      const signedIn = f.auth.signIn(
        account.login,
        account.password,
        account.employeeId,
      );
      assert.equal(signedIn.context.employeeId, account.employeeId);
      assert.equal(
        f.auth.authenticate(signedIn.token).employeeId,
        account.employeeId,
      );
    }
  } finally {
    f.close();
  }
});

test("sessions are opaque, isolated, individually logged out, and expire", () => {
  const f = fixture();
  try {
    const ava = f.accounts.find(
      (account) => account.employeeId === "employee-ava",
    )!;
    const first = f.auth.signIn(ava.login, ava.password, "tab-1");
    const second = f.auth.signIn(ava.login, ava.password, "tab-2");
    assert.notEqual(first.token, second.token);
    assert.equal(first.token.includes("employee-ava"), false);
    f.auth.signOut(first.token);
    expectCode("SESSION_INVALID", () => f.auth.authenticate(first.token));
    assert.equal(
      f.auth.authenticate(second.token).sessionId,
      second.context.sessionId,
    );
    f.advance(10_001);
    expectCode("SESSION_EXPIRED", () => f.auth.authenticate(second.token));
  } finally {
    f.close();
  }
});

test("membership is looked up on every request and client claims cannot preserve stale authority", () => {
  const f = fixture();
  try {
    const noah = f.accounts.find(
      (account) => account.employeeId === "employee-noah",
    )!;
    const session = f.auth.signIn(noah.login, noah.password).token;
    f.memberships.set("employee-noah", {
      ...f.memberships.get("employee-noah")!,
      role: "senior_manager",
      policyRevision: 2,
    });
    const refreshed = f.auth.authenticate(session);
    assert.equal(refreshed.role, "senior_manager");
    assert.equal(refreshed.policyRevision, 2);
    f.memberships.set("employee-noah", {
      ...f.memberships.get("employee-noah")!,
      active: false,
    });
    expectCode("MEMBERSHIP_INACTIVE", () => f.auth.authenticate(session));
  } finally {
    f.close();
  }
});

test("failed logins are bounded and passwords are never accepted across accounts", () => {
  const f = fixture();
  try {
    const noah = f.accounts.find(
      (account) => account.employeeId === "employee-noah",
    )!;
    const priya = f.accounts.find(
      (account) => account.employeeId === "employee-priya",
    )!;
    expectCode("INVALID_CREDENTIALS", () =>
      f.auth.signIn(noah.login, priya.password, "source-a"),
    );
    expectCode("INVALID_CREDENTIALS", () =>
      f.auth.signIn(noah.login, "wrong-password-1", "source-a"),
    );
    expectCode("INVALID_CREDENTIALS", () =>
      f.auth.signIn(noah.login, "wrong-password-2", "source-a"),
    );
    expectCode("LOGIN_RATE_LIMITED", () =>
      f.auth.signIn(noah.login, noah.password, "source-a"),
    );
    assert.equal(
      f.auth.signIn(noah.login, noah.password, "source-b").context.employeeId,
      "employee-noah",
    );
  } finally {
    f.close();
  }
});

test("only a current senior manager can create and revoke employee accounts", () => {
  const f = fixture();
  try {
    f.memberships.set("employee-new", {
      employeeId: "employee-new",
      organizationId: "northstar",
      role: "engineer",
      active: true,
      policyRevision: 1,
    });
    const avaAccount = f.accounts.find(
      (account) => account.employeeId === "employee-ava",
    )!;
    const noahAccount = f.accounts.find(
      (account) => account.employeeId === "employee-noah",
    )!;
    const ava = f.auth.signIn(avaAccount.login, avaAccount.password).token;
    const noah = f.auth.signIn(noahAccount.login, noahAccount.password).token;
    expectCode("ACCOUNT_ADMIN_FORBIDDEN", () =>
      f.auth.createEmployeeAccount(noah, {
        employeeId: "employee-new",
        login: "new@northstar.local",
      }),
    );
    const created = f.auth.createEmployeeAccount(ava, {
      employeeId: "employee-new",
      login: "new@northstar.local",
    });
    const target = f.auth.signIn(
      "new@northstar.local",
      created.initialPassword,
    ).token;
    f.auth.revokeEmployeeAccount(ava, "employee-new");
    expectCode("SESSION_INVALID", () => f.auth.authenticate(target));
  } finally {
    f.close();
  }
});
