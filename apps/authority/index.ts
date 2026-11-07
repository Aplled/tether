import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CanonicalStore } from "../../packages/storage/src/index.ts";
import { ContinuityService } from "../../packages/workflows/src/index.ts";
import type { Proposal } from "../../packages/contracts/src/index.ts";

export type AuthorityPrincipal = {
  actorId: string;
  actorRevision: number;
  organizationId: string;
  incidentIds: string[];
  capabilities: Array<"read" | "simulate" | "propose">;
};
export interface AuthorityConfig {
  domainDbPath: string;
  credentials: Array<AuthorityPrincipal & { tokenHash: string }>;
}
const PrincipalSchema = z
  .object({
    actorId: z.string().min(1).max(160),
    actorRevision: z.number().int().positive(),
    organizationId: z.string().min(1).max(160),
    incidentIds: z
      .array(z.string().min(1).max(160))
      .min(1)
      .max(64)
      .refine((v) => new Set(v).size === v.length),
    capabilities: z
      .array(z.enum(["read", "simulate", "propose"]))
      .min(1)
      .max(3)
      .refine((v) => new Set(v).size === v.length),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const ConfigSchema = z
  .object({
    domainDbPath: z.string().min(1).max(4096),
    credentials: z
      .array(PrincipalSchema)
      .min(1)
      .max(128)
      .refine(
        (items) =>
          new Set(items.map((i) => i.actorId)).size === items.length &&
          new Set(items.map((i) => i.tokenHash)).size === items.length,
      ),
  })
  .strict();
function hash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export async function createAuthorityConfig(
  path: string,
  domainDbPath: string,
  principals: Array<Omit<AuthorityPrincipal, "actorRevision">>,
): Promise<Record<string, string>> {
  const store = new CanonicalStore(domainDbPath);
  const tokens: Record<string, string> = {};
  const credentials = [];
  try {
    for (const principal of principals) {
      const actor = store.get(
        principal.organizationId,
        null,
        "actor",
        principal.actorId,
      )?.value;
      if (!actor || actor.organizationId !== principal.organizationId)
        throw new Error("credential actor is absent or out of scope");
      const token = randomBytes(32).toString("base64url");
      tokens[principal.actorId] = token;
      credentials.push({
        ...principal,
        actorRevision: actor.revision,
        tokenHash: hash(token),
      });
    }
  } finally {
    store.close();
  }
  const config = ConfigSchema.parse({ domainDbPath, credentials });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return tokens;
}

export class ApplicationAuthority {
  readonly store: CanonicalStore;
  readonly workflows: ContinuityService;
  readonly config: AuthorityConfig;
  private constructor(config: AuthorityConfig) {
    this.config = config;
    this.store = new CanonicalStore(config.domainDbPath);
    this.workflows = new ContinuityService(this.store);
  }
  static async open(path: string) {
    const config = ConfigSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    ) as AuthorityConfig;
    return new ApplicationAuthority(config);
  }
  close() {
    this.store.close();
  }
  authenticate(token: string): AuthorityPrincipal {
    const tokenHash = hash(token);
    const found = this.config.credentials.find((c) =>
      safeEqual(c.tokenHash, tokenHash),
    );
    if (!found) throw new Error("unauthenticated credential");
    const { tokenHash: _hidden, ...principal } = found;
    this.currentActor(principal);
    return principal;
  }
  private currentActor(p: AuthorityPrincipal) {
    const actor = this.store.get(
      p.organizationId,
      null,
      "actor",
      p.actorId,
    )?.value;
    if (
      !actor ||
      actor.organizationId !== p.organizationId ||
      actor.revision !== p.actorRevision
    )
      throw new Error("credential stale or revoked");
    return actor;
  }
  private scope(
    p: AuthorityPrincipal,
    organizationId: string,
    incidentId: string,
    capability: AuthorityPrincipal["capabilities"][number],
  ) {
    this.currentActor(p);
    if (
      p.organizationId !== organizationId ||
      !p.incidentIds.includes(incidentId)
    )
      throw new Error("scope denied");
    if (!p.capabilities.includes(capability))
      throw new Error("capability denied");
  }
  incident(p: AuthorityPrincipal, organizationId: string, incidentId: string) {
    this.scope(p, organizationId, incidentId, "read");
    const value = this.store.get(
      organizationId,
      incidentId,
      "incident",
      incidentId,
    )?.value;
    if (!value) throw new Error("incident not found in scope");
    const allEvidence = this.store
      .list(organizationId, incidentId, "evidence")
      .map((item) => item.value);
    const evidence = allEvidence.slice(0, 100);
    return {
      ...value,
      evidence,
      evidencePage: {
        returned: evidence.length,
        total: allEvidence.length,
        truncated: allEvidence.length > evidence.length,
      },
    };
  }
  timeline(p: AuthorityPrincipal, organizationId: string, incidentId: string) {
    this.scope(p, organizationId, incidentId, "read");
    this.incident(p, organizationId, incidentId);
    return this.store.listEvents(organizationId, incidentId);
  }
  dependencies(
    p: AuthorityPrincipal,
    organizationId: string,
    incidentId: string,
  ) {
    this.scope(p, organizationId, incidentId, "read");
    this.incident(p, organizationId, incidentId);
    return {
      nodes: this.store.list(organizationId, null, "node").map((x) => x.value),
      groups: this.store
        .list(organizationId, null, "dependency_group")
        .map((x) => x.value),
    };
  }
  tasks(p: AuthorityPrincipal, organizationId: string, incidentId: string) {
    this.scope(p, organizationId, incidentId, "read");
    return this.store
      .list(organizationId, incidentId, "task")
      .map((x) => x.value);
  }
  fallbacks(p: AuthorityPrincipal, organizationId: string, incidentId: string) {
    this.scope(p, organizationId, incidentId, "read");
    return this.store
      .list(organizationId, incidentId, "fallback")
      .map((x) => x.value);
  }
  analyze(p: AuthorityPrincipal, organizationId: string, incidentId: string) {
    this.scope(p, organizationId, incidentId, "read");
    return this.workflows.analyzeIncident(
      organizationId,
      incidentId,
      p.actorId,
    );
  }
  simulate(
    p: AuthorityPrincipal,
    organizationId: string,
    incidentId: string,
    overrides: Record<
      string,
      {
        availability: "satisfied" | "unsatisfied" | "unknown";
        securityTrust: "trusted" | "untrusted" | "unknown";
        freshness: "fresh" | "stale" | "unknown";
        reason: string;
      }
    >,
  ) {
    this.scope(p, organizationId, incidentId, "simulate");
    return this.workflows.simulateIncident(
      organizationId,
      incidentId,
      p.actorId,
      overrides,
    );
  }
  submitProposal(p: AuthorityPrincipal, proposal: Proposal) {
    this.scope(p, proposal.organizationId, proposal.incidentId, "propose");
    return this.workflows.submitProposal(proposal, p.actorId);
  }
}
