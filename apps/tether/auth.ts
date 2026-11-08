import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AuthContext,
  MembershipSnapshot,
  TetherRole,
} from "./permissions.ts";

const PRESENTATION_ACCOUNTS = [
  {
    employeeId: "employee-ava",
    login: "ava@northstar.local",
    role: "senior_manager",
  },
  {
    employeeId: "employee-noah",
    login: "noah@northstar.local",
    role: "engineer",
  },
  {
    employeeId: "employee-priya",
    login: "priya@northstar.local",
    role: "data_science_manager",
  },
  {
    employeeId: "employee-elena",
    login: "elena@northstar.local",
    role: "marketing",
  },
] as const satisfies readonly {
  employeeId: string;
  login: string;
  role: TetherRole;
}[];

export interface BootstrapAccount {
  employeeId: string;
  login: string;
  password: string;
}

export interface AuthServiceOptions {
  dbPath: string;
  runtimeDir: string;
  membershipLookup: (employeeId: string) => MembershipSnapshot | undefined;
  clock?: () => Date;
  sessionTtlMs?: number;
  loginWindowMs?: number;
  maxLoginAttempts?: number;
  scryptCost?: number;
}

export interface SignInResult {
  token: string;
  context: AuthContext;
}

export class AuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AuthError";
  }
}

export class AuthService {
  readonly #db: DatabaseSync;
  readonly #runtimeDir: string;
  readonly #membershipLookup: AuthServiceOptions["membershipLookup"];
  readonly #clock: () => Date;
  readonly #sessionTtlMs: number;
  readonly #loginWindowMs: number;
  readonly #maxLoginAttempts: number;
  readonly #scryptCost: number;
  readonly #dummySalt = randomBytes(16);
  readonly #dummyHash: Buffer;

  constructor(options: AuthServiceOptions) {
    this.#runtimeDir = options.runtimeDir;
    this.#membershipLookup = options.membershipLookup;
    this.#clock = options.clock ?? (() => new Date());
    this.#sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1_000;
    this.#loginWindowMs = options.loginWindowMs ?? 15 * 60 * 1_000;
    this.#maxLoginAttempts = options.maxLoginAttempts ?? 8;
    this.#scryptCost = options.scryptCost ?? 16_384;
    if (!Number.isSafeInteger(this.#scryptCost) || this.#scryptCost < 1_024)
      throw new AuthError("INVALID_CONFIG", "scrypt cost is invalid");
    this.#dummyHash = this.#derive("invalid-password", this.#dummySalt);
    this.#db = new DatabaseSync(options.dbPath);
    this.#db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    this.#migrate();
  }

  close(): void {
    this.#db.close();
  }

  bootstrapPresentationAccounts(): { path: string; created: boolean } {
    mkdirSync(this.#runtimeDir, { recursive: true, mode: 0o700 });
    chmodSync(this.#runtimeDir, 0o700);
    const path = join(this.#runtimeDir, "bootstrap-accounts.json");
    const count = Number(
      (this.#db.prepare("SELECT count(*) AS count FROM accounts").get() as any)
        .count,
    );
    if (count > 0) return { path, created: false };

    const accounts: BootstrapAccount[] = PRESENTATION_ACCOUNTS.map(
      (account) => ({
        employeeId: account.employeeId,
        login: account.login,
        password: randomBytes(24).toString("base64url"),
      }),
    );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const account of accounts)
        this.#insertAccount(
          account.employeeId,
          account.login,
          account.password,
        );
      writeFileSync(
        path,
        JSON.stringify(
          { generatedAt: this.#clock().toISOString(), accounts },
          null,
          2,
        ),
        {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        },
      );
      chmodSync(path, 0o600);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { path, created: true };
  }

  readBootstrapAccountsForLocalSetup(): BootstrapAccount[] {
    const path = join(this.#runtimeDir, "bootstrap-accounts.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || !Array.isArray(parsed.accounts))
      throw new AuthError(
        "BOOTSTRAP_INVALID",
        "bootstrap account file is invalid",
      );
    return parsed.accounts;
  }

  signIn(login: string, password: string, clientKey = "default"): SignInResult {
    const normalized = normalizeLogin(login);
    if (
      !normalized ||
      password.length < 1 ||
      password.length > 1_024 ||
      clientKey.length > 200
    )
      throw new AuthError(
        "INVALID_CREDENTIALS",
        "login or password is invalid",
      );
    const now = this.#clock();
    this.#pruneAttempts(now);
    const attempts = Number(
      (
        this.#db
          .prepare(
            "SELECT count(*) AS count FROM login_attempts WHERE login=? AND client_key=? AND attempted_at>=?",
          )
          .get(
            normalized,
            clientKey,
            new Date(now.getTime() - this.#loginWindowMs).toISOString(),
          ) as any
      ).count,
    );
    if (attempts >= this.#maxLoginAttempts)
      throw new AuthError(
        "LOGIN_RATE_LIMITED",
        "too many login attempts; try again later",
      );

    const row = this.#db
      .prepare("SELECT * FROM accounts WHERE login=?")
      .get(normalized) as any;
    const salt = row
      ? Buffer.from(row.password_salt, "base64")
      : this.#dummySalt;
    const expected = row
      ? Buffer.from(row.password_hash, "base64")
      : this.#dummyHash;
    const derived = this.#derive(password, salt);
    const valid =
      expected.length === derived.length && timingSafeEqual(expected, derived);
    if (!valid || !row || row.revoked_at) {
      this.#db
        .prepare("INSERT INTO login_attempts VALUES (?, ?, ?)")
        .run(normalized, clientKey, now.toISOString());
      throw new AuthError(
        "INVALID_CREDENTIALS",
        "login or password is invalid",
      );
    }

    const membership = this.#currentMembership(row.employee_id);
    const sessionId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      now.getTime() + this.#sessionTtlMs,
    ).toISOString();
    this.#db
      .prepare(
        "INSERT INTO sessions(session_id,account_id,token_hash,created_at,expires_at,revoked_at) VALUES (?,?,?,?,?,NULL)",
      )
      .run(
        sessionId,
        row.account_id,
        tokenHash(token),
        now.toISOString(),
        expiresAt,
      );
    this.#db
      .prepare("DELETE FROM login_attempts WHERE login=? AND client_key=?")
      .run(normalized, clientKey);
    return { token, context: toContext(membership, sessionId, expiresAt) };
  }

  authenticate(token: string): AuthContext {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(token))
      throw new AuthError("SESSION_INVALID", "session is invalid");
    const row = this.#db
      .prepare(
        `SELECT s.*, a.employee_id, a.revoked_at AS account_revoked_at
       FROM sessions s JOIN accounts a ON a.account_id=s.account_id WHERE s.token_hash=?`,
      )
      .get(tokenHash(token)) as any;
    if (!row || row.revoked_at || row.account_revoked_at)
      throw new AuthError("SESSION_INVALID", "session is invalid");
    if (new Date(row.expires_at).getTime() <= this.#clock().getTime()) {
      this.#db
        .prepare("UPDATE sessions SET revoked_at=? WHERE session_id=?")
        .run(this.#clock().toISOString(), row.session_id);
      throw new AuthError("SESSION_EXPIRED", "session expired");
    }
    const membership = this.#currentMembership(row.employee_id);
    return toContext(membership, row.session_id, row.expires_at);
  }

  signOut(token: string): void {
    if (!token) return;
    this.#db
      .prepare(
        "UPDATE sessions SET revoked_at=coalesce(revoked_at,?) WHERE token_hash=?",
      )
      .run(this.#clock().toISOString(), tokenHash(token));
  }

  logout(token: string): void {
    this.signOut(token);
  }

  createEmployeeAccount(
    actorToken: string,
    input: { employeeId: string; login: string; initialPassword?: string },
  ): { accountId: string; initialPassword: string } {
    const actor = this.authenticate(actorToken);
    if (actor.role !== "senior_manager")
      throw new AuthError(
        "ACCOUNT_ADMIN_FORBIDDEN",
        "account administration requires a senior manager",
      );
    const target = this.#currentMembership(input.employeeId);
    if (target.organizationId !== actor.organizationId)
      throw new AuthError(
        "ORGANIZATION_SCOPE_MISMATCH",
        "target employee belongs to another organization",
      );
    const initialPassword =
      input.initialPassword ?? randomBytes(24).toString("base64url");
    return {
      accountId: this.#insertAccount(
        input.employeeId,
        input.login,
        initialPassword,
      ),
      initialPassword,
    };
  }

  revokeEmployeeAccount(actorToken: string, employeeId: string): void {
    const actor = this.authenticate(actorToken);
    if (actor.role !== "senior_manager")
      throw new AuthError(
        "ACCOUNT_ADMIN_FORBIDDEN",
        "account administration requires a senior manager",
      );
    const target = this.#currentMembership(employeeId);
    if (target.organizationId !== actor.organizationId)
      throw new AuthError(
        "ORGANIZATION_SCOPE_MISMATCH",
        "target employee belongs to another organization",
      );
    const now = this.#clock().toISOString();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare("UPDATE accounts SET revoked_at=? WHERE employee_id=?")
        .run(now, employeeId);
      this.#db
        .prepare(
          "UPDATE sessions SET revoked_at=? WHERE account_id IN (SELECT account_id FROM accounts WHERE employee_id=?)",
        )
        .run(now, employeeId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #currentMembership(employeeId: string): MembershipSnapshot {
    const membership = this.#membershipLookup(employeeId);
    if (!membership || !membership.active)
      throw new AuthError(
        "MEMBERSHIP_INACTIVE",
        "membership is missing or inactive",
      );
    return membership;
  }

  #insertAccount(employeeId: string, login: string, password: string): string {
    const normalized = normalizeLogin(login);
    if (!normalized || password.length < 12 || password.length > 1_024)
      throw new AuthError(
        "ACCOUNT_INPUT_INVALID",
        "account login or password is invalid",
      );
    const salt = randomBytes(16);
    const accountId = randomUUID();
    this.#db
      .prepare(
        "INSERT INTO accounts(account_id,employee_id,login,password_salt,password_hash,created_at,revoked_at) VALUES (?,?,?,?,?,?,NULL)",
      )
      .run(
        accountId,
        employeeId,
        normalized,
        salt.toString("base64"),
        this.#derive(password, salt).toString("base64"),
        this.#clock().toISOString(),
      );
    return accountId;
  }

  #derive(password: string, salt: Buffer): Buffer {
    return scryptSync(password, salt, 32, {
      N: this.#scryptCost,
      r: 8,
      p: 1,
      maxmem: 128 * 1024 * 1024,
    });
  }

  #pruneAttempts(now: Date): void {
    this.#db
      .prepare("DELETE FROM login_attempts WHERE attempted_at<?")
      .run(new Date(now.getTime() - this.#loginWindowMs).toISOString());
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS accounts(
        account_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL UNIQUE, login TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions(
        session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(account_id),
        token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
      CREATE TABLE IF NOT EXISTS login_attempts(login TEXT NOT NULL, client_key TEXT NOT NULL, attempted_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS login_attempt_window ON login_attempts(login,client_key,attempted_at);
    `);
  }
}

function normalizeLogin(login: string): string | null {
  const value = login.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._+-]{0,126}@[a-z0-9.-]{1,190}$/.test(value)
    ? value
    : null;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function toContext(
  membership: MembershipSnapshot,
  sessionId: string,
  expiresAt: string,
): AuthContext {
  return { ...membership, sessionId, sessionExpiresAt: expiresAt };
}
