#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { createReadStream, existsSync, lstatSync, realpathSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { AuthError, AuthService } from "./auth.ts";
import { analyzeDemo } from "../demo-web/agent.ts";
import { CompanyError, TetherCompanyStore } from "./company.ts";
import { planIncidentAssignments } from "./assignments.ts";
import {
  briefIsStale,
  generateTaskBrief,
  taskDefinitionDigest,
  type TaskBrief,
} from "./handoffs.ts";
import {
  employeeFromImport,
  ImportService,
  nodeFromImport,
} from "./imports.ts";
import { proposeCanvasLayoutViaMcp } from "./layout-mcp.ts";
import { createCompanyMcpSession, type CompanyMcpTool } from "./mcp.ts";
import { chooseEscalation, effectiveAvailability } from "./scheduling.ts";
import {
  authorize,
  PermissionError,
  roleTemplate,
  type AuthContext,
  type Capability,
  type ResourceKind,
} from "./permissions.ts";
import {
  ResponseAuthority,
  ResponseError,
  RetryServiceObserver,
  RetryServiceTarget,
  type ResponseAction,
  type ResponseExecution,
} from "./response.ts";
import type {
  CompanyEvent,
  CompanyNode,
  CompanyState,
  Incident,
  Member,
  RepositoryReference,
} from "./types.ts";

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(root, "../..");
const publicDir = join(root, "public");
const execFile = promisify(execFileCallback);
try {
  process.loadEnvFile(join(projectRoot, ".env.local"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const staticFiles = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/api.js", "api.js"],
  ["/canvas.js", "canvas.js"],
  ["/panels.js", "panels.js"],
  ["/icons.js", "icons.js"],
  ["/styles.css", "styles.css"],
  ["/canvas.css", "canvas.css"],
  ["/canvas-layout.js", "canvas-layout.js"],
  ["/favicon.svg", "favicon.svg"],
]);
const pretextFiles = new Set([
  "analysis.js",
  "gecko-line-breaks.js",
  "graphemes.js",
  "han-kerning.js",
  "layout.js",
  "line-break.js",
  "line-breaks.js",
  "line-text.js",
  "measurement.js",
  "prepare.js",
  "rich-inline.js",
]);
const pretextGeneratedFiles = new Set([
  "engine-break-data.js",
  "webkit-generic-families.js",
]);
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function securityHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    ...extra,
  };
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(
    status,
    securityHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  );
  res.end(JSON.stringify(value));
}
async function jsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > 196_608)
      throw new HttpError(
        413,
        "body_too_large",
        "request body exceeds 192 KiB",
      );
    chunks.push(data);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      "request body must be a JSON object",
    );
  }
}
class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function bearer(req: IncomingMessage): string {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer "))
    throw new HttpError(
      401,
      "authentication_required",
      "authentication required",
    );
  return value.slice(7);
}
function string(value: unknown, name: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, "invalid_input", `${name} is required`);
  return value.trim();
}
function number(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value))
    throw new HttpError(400, "invalid_input", `${name} must be an integer`);
  return value as number;
}
function array(value: unknown, name: string, max = 100): string[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    value.some((item) => typeof item !== "string")
  )
    throw new HttpError(
      400,
      "invalid_input",
      `${name} must be a bounded string array`,
    );
  return value as string[];
}
function publicMember(member: Member) {
  return {
    id: member.id,
    name: member.name,
    departmentId: member.departmentId,
    team: member.team,
    jobFamily: member.jobFamily,
    level: member.level,
    title: member.title,
    availability: effectiveAvailability(member),
    active: member.active,
  };
}

type ViewState = Record<string, unknown>;

export async function startTetherServer(
  options: { port?: number; runtimeDir?: string } = {},
): Promise<{
  url: string;
  runtimeDir: string;
  company: TetherCompanyStore;
  auth: AuthService;
  close: () => Promise<void>;
}> {
  const runtimeDir = resolve(
    options.runtimeDir ?? join(projectRoot, ".runtime/tether"),
  );
  const company = new TetherCompanyStore(join(runtimeDir, "company.sqlite"));
  const auth = new AuthService({
    dbPath: join(runtimeDir, "auth.sqlite"),
    runtimeDir,
    membershipLookup: (id) => company.membershipSnapshot(id),
  });
  auth.bootstrapPresentationAccounts();
  const imports = new ImportService(() => company.allState());
  const briefs = new Map<string, TaskBrief>();
  const activeAssignmentPlans = new Set<string>();
  const responseChecks = new Map<
    string,
    { generation: string; fallback?: unknown; resolution?: unknown }
  >();
  const analysisByScope = new Map<string, Record<string, unknown>>();
  const responseTarget = await RetryServiceTarget.start();
  const responseObserver = new RetryServiceObserver(responseTarget);
  const responseActions = new Map<string, ResponseAction>();
  const responseExecutions = new Map<string, ResponseExecution>();
  const fallbackVerified = new Set<string>();
  const response = new ResponseAuthority({
    dbPath: join(runtimeDir, "response.sqlite"),
    incidentLookup: (id) => {
      const incident = company
        .allState()
        .incidents.find((item) => item.id === id);
      if (!incident) return undefined;
      return {
        id: incident.id,
        organizationId: "northstar",
        open: incident.status !== "resolved",
        semanticRevision: company.allState().organization.semanticRevision,
        evidenceRevision: incident.evidenceRevision,
        policyRevision:
          company.membershipSnapshot(incident.commanderId)?.policyRevision ?? 0,
        commanderEmployeeId: incident.commanderId,
      };
    },
    membershipLookup: (id) => company.membershipSnapshot(id),
    approvalGrantLookup: (employeeId, incidentId) =>
      company.permissionGrants(
        employeeId,
        { kind: "incident", id: incidentId },
        "incident:approve",
      ).length > 0,
  });
  for (const persisted of response.listActions()) {
    responseActions.set(persisted.actionId, persisted);
    const execution = response.getExecution(persisted.actionId);
    if (execution && execution.state !== "reserved")
      responseExecutions.set(persisted.actionId, execution);
  }

  function context(req: IncomingMessage): {
    token: string;
    value: AuthContext;
  } {
    const token = bearer(req);
    return { token, value: auth.authenticate(token) };
  }
  function allow(
    ctx: AuthContext,
    capability: Capability,
    kind: ResourceKind,
    id: string,
  ): void {
    authorize({
      context: ctx,
      currentMembership: company.membershipSnapshot(ctx.employeeId)!,
      capability,
      resource: { organizationId: "northstar", kind, id },
      grants: company.permissionGrants(
        ctx.employeeId,
        { kind, id },
        capability,
      ),
    });
  }
  function readableNodeIds(
    ctx: AuthContext,
    incident: Incident,
    state = company.allState(),
  ): Set<string> {
    return new Set(
      incident.nodeIds.filter(
        (id) =>
          company.isOrganizationAdmin(ctx.employeeId) ||
          company.permissionGrants(
            ctx.employeeId,
            { kind: "node", id },
            "graph:read",
          ).length,
      ),
    );
  }
  function allowed(
    ctx: AuthContext,
    capability: Capability,
    kind: ResourceKind,
    id: string,
  ): boolean {
    try {
      allow(ctx, capability, kind, id);
      return true;
    } catch (error) {
      if (error instanceof PermissionError) return false;
      throw error;
    }
  }
  function projectIncident(
    ctx: AuthContext,
    incident: Incident,
    state = company.allState(),
  ) {
    const nodeIds = readableNodeIds(ctx, incident, state);
    return {
      ...incident,
      nodeIds: [...nodeIds],
      totalNodeCount: incident.nodeIds.length,
      restrictedNodeCount: incident.nodeIds.length - nodeIds.size,
      allowedAutomaticAction: nodeIds.has("retry-route")
        ? "disable_cross_tenant_retry"
        : null,
      memberIds: [...incident.memberIds],
    };
  }
  function scopeKey(
    ctx: AuthContext,
    incident: Incident,
    state = company.allState(),
  ): string {
    const nodes = [...readableNodeIds(ctx, incident, state)].sort();
    return createHash("sha256")
      .update(
        JSON.stringify({
          incidentId: incident.id,
          employeeId: ctx.employeeId,
          policyRevision: ctx.policyRevision,
          incidentRevision: incident.revision,
          semanticRevision: state.organization.semanticRevision,
          nodes,
        }),
      )
      .digest("hex");
  }
  function capabilities(ctx: AuthContext): string[] {
    return [...roleTemplate(ctx.role)].filter((capability) => {
      if (capability === "organization:admin")
        return company.isOrganizationAdmin(ctx.employeeId);
      return (
        company.permissionGrants(ctx.employeeId, undefined, capability).length >
        0
      );
    });
  }
  function assignmentContext(ctx: AuthContext, incidentId: string) {
    allow(ctx, "incident:assign", "incident", incidentId);
    const state = company.allState();
    const incident = state.incidents.find((entry) => entry.id === incidentId);
    if (!incident || incident.status === "resolved")
      throw new HttpError(
        409,
        "assignment_stale",
        "The incident is no longer open",
      );
    const readable = readableNodeIds(ctx, incident, state);
    const candidates: Parameters<
      typeof planIncidentAssignments
    >[0]["candidates"] = [];
    const skipped: Array<{ ownerId: string; reason: string }> = [];
    const consents = incident.memberIds.map((id) =>
      company.assignmentVolunteer(incidentId, id),
    );
    const at = new Date();
    for (const memberId of incident.memberIds) {
      const member = state.members.find((entry) => entry.id === memberId);
      const consent = company.assignmentVolunteer(incidentId, memberId);
      const presence = member ? effectiveAvailability(member, at) : "away";
      const availability =
        presence === "off_hours" && consent && new Date(consent.expiresAt) > at
          ? "on_call"
          : presence;
      let reason = !member?.active
        ? "Account is inactive"
        : !["available", "on_call"].includes(availability)
          ? `Currently ${availability.replaceAll("_", " ")}; explicit availability is required`
          : "";
      const refs = state.repositories.filter(
        (ref) =>
          readable.has(ref.nodeId) &&
          allowed(ctx, "repository:read", "repository", ref.id) &&
          Boolean(
            member &&
            roleTemplate(member.roleTemplate).has("repository:read") &&
            roleTemplate(member.roleTemplate).has("graph:read"),
          ) &&
          company.permissionGrants(
            memberId,
            { kind: "node", id: ref.nodeId },
            "graph:read",
          ).length &&
          company.permissionGrants(
            memberId,
            { kind: "repository", id: ref.id },
            "repository:read",
          ).length,
      );
      if (!reason && !refs.length)
        reason = "No authorized repository mapping in this incident";
      if (reason || !member) {
        skipped.push({ ownerId: memberId, reason });
        continue;
      }
      candidates.push({
        id: member.id,
        name: member.name,
        title: member.title,
        nodeIds: [...new Set(refs.map((ref) => ref.nodeId))],
        sourcePaths: [...new Set(refs.map((ref) => ref.path))],
        nodeSourcePaths: Object.fromEntries(
          [...new Set(refs.map((ref) => ref.nodeId))].map((nodeId) => [
            nodeId,
            refs.filter((ref) => ref.nodeId === nodeId).map((ref) => ref.path),
          ]),
        ),
        availability,
        active: true,
      });
    }
    const binding = createHash("sha256")
      .update(
        JSON.stringify({
          actor: ctx.employeeId,
          policy: ctx.policyRevision,
          incident,
          semantic: state.organization.semanticRevision,
          members: state.members,
          grants: state.grants,
          repositories: state.repositories,
          delegations: state.delegations,
          tasks: state.tasks.filter((task) => task.incidentId === incidentId),
          messages: state.messages.filter(
            (message) => message.incidentId === incidentId,
          ),
          candidates,
          consents,
        }),
      )
      .digest("hex");
    return { state, incident, readable, candidates, skipped, binding };
  }
  function checkBriefAccess(
    ctx: AuthContext,
    task: CompanyState["tasks"][number],
    paths: string[],
    state: CompanyState,
  ) {
    allow(ctx, "task:read", "task", task.id);
    if (task.ownerId !== ctx.employeeId)
      allow(ctx, "incident:assign", "incident", task.incidentId);
    const incident = state.incidents.find(
      (entry) => entry.id === task.incidentId,
    );
    if (
      !company.member(task.ownerId)?.active ||
      !roleTemplate(company.member(task.ownerId)!.roleTemplate).has(
        "repository:read",
      ) ||
      !incident?.memberIds.includes(task.ownerId)
    )
      throw new HttpError(
        403,
        "source_forbidden",
        "The assignee no longer has incident access",
      );
    for (const path of paths) {
      const refs = state.repositories.filter(
        (ref) => ref.path === path && task.nodeIds.includes(ref.nodeId),
      );
      if (
        !refs.some(
          (ref) =>
            allowed(ctx, "repository:read", "repository", ref.id) &&
            allowed(ctx, "graph:read", "node", ref.nodeId) &&
            [ctx.employeeId, task.ownerId].every(
              (memberId) =>
                company.permissionGrants(
                  memberId,
                  { kind: "node", id: ref.nodeId },
                  "graph:read",
                ).length &&
                company.permissionGrants(
                  memberId,
                  { kind: "repository", id: ref.id },
                  "repository:read",
                ).length,
            ),
        )
      )
        throw new HttpError(
          403,
          "source_forbidden",
          "Current repository permission is required for this prompt",
        );
    }
  }
  function projectTask(
    ctx: AuthContext,
    task: CompanyState["tasks"][number],
    state: CompanyState,
  ) {
    const incident = state.incidents.find(
      (entry) => entry.id === task.incidentId,
    )!;
    const readable = readableNodeIds(ctx, incident, state);
    let title = task.title;
    if (task.hasPreparedPrompt) {
      const brief = company.assignmentBrief(task.id);
      try {
        if (
          !brief ||
          task.nodeIds.some((id) => !allowed(ctx, "graph:read", "node", id))
        )
          throw new HttpError(
            403,
            "source_forbidden",
            "Assigned source scope is restricted",
          );
        checkBriefAccess(ctx, task, brief.permittedPaths ?? [], state);
      } catch (error) {
        if (
          !(error instanceof PermissionError) &&
          !(error instanceof HttpError)
        )
          throw error;
        title = "Assigned investigation";
      }
    }
    return {
      ...task,
      title,
      nodeIds: task.nodeIds.filter((id) => readable.has(id)),
    };
  }
  function projectNotification(
    notification: CompanyState["notifications"][number],
  ) {
    // Legacy records may contain a former task title. Never infer access by matching mutable text.
    return notification.kind === "assignment"
      ? {
          ...notification,
          text: "An investigation task was assigned. Open the incident to review your work.",
        }
      : notification;
  }
  function visibleState(ctx: AuthContext): ViewState {
    const state = company.allState();
    const member = company.member(ctx.employeeId)!;
    const isAdmin = company.isOrganizationAdmin(ctx.employeeId);
    const workspaces = state.workspaces
      .filter(
        (workspace) => isAdmin || workspace.memberIds.includes(ctx.employeeId),
      )
      .map((workspace) => ({
        ...workspace,
        nodeIds: workspace.nodeIds.filter(
          (id) =>
            isAdmin ||
            company.permissionGrants(
              ctx.employeeId,
              { kind: "node", id },
              "graph:read",
            ).length,
        ),
      }));
    const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    const conversations = state.conversations.filter(
      (message) =>
        message.scope === "company" ||
        (message.workspaceId && workspaceIds.has(message.workspaceId)),
    );
    if (ctx.role === "marketing") {
      const notices = state.notifications
        .filter(
          (n) => n.memberId === ctx.employeeId && n.kind === "minimal_notice",
        )
        .map(({ incidentId: _hidden, ...notice }) => notice);
      const cursor = company.recipientCursor(ctx.employeeId);
      return {
        organization: state.organization,
        departments: state.departments,
        members: state.members.map((entry) =>
          entry.id === ctx.employeeId
            ? {
                ...entry,
                availabilitySetting: entry.availability,
                availability: effectiveAvailability(entry),
              }
            : publicMember(entry),
        ),
        nodes: state.nodes.filter(
          (node) =>
            node.ownerId === ctx.employeeId || node.id === "status-page",
        ),
        edges: [],
        regions: [],
        repositories: [],
        incidents: [],
        workspaces,
        conversations,
        tasks: [],
        messages: [],
        notifications: notices,
        grants: [],
        eventCursor: cursor,
        user: {
          id: member.id,
          name: member.name,
          email: member.email,
          title: member.title,
          departmentId: member.departmentId,
          role: ctx.role,
        },
        permissions: capabilities(ctx),
        model: {
          configured: Boolean(process.env.NVIDIA_API_KEY),
          model: process.env.NVIDIA_MODEL ?? "nvidia/nemotron",
          mode: process.env.NVIDIA_API_KEY ? "configured" : "rule-based",
        },
        integrations: {
          identity: "local",
          database: "sqlite",
          realtime: "server",
          supabaseConnected: false,
        },
        analysisByIncident: {},
        proposalsByIncident: {},
        responseByIncident: {},
        analysis: null,
        proposal: null,
      };
    }
    const incidentIds = new Set(
      state.incidents
        .filter(
          (incident) => isAdmin || incident.memberIds.includes(ctx.employeeId),
        )
        .map((incident) => incident.id),
    );
    const allowedNodeIds = new Set(
      state.nodes
        .filter(
          (node) =>
            isAdmin ||
            company.permissionGrants(
              ctx.employeeId,
              { kind: "node", id: node.id },
              "graph:read",
            ).length,
        )
        .map((node) => node.id),
    );
    const repositories = state.repositories.filter(
      (repo) =>
        isAdmin ||
        company.permissionGrants(
          ctx.employeeId,
          { kind: "repository", id: repo.id },
          "repository:read",
        ).length,
    );
    const rawIncidents = state.incidents.filter((incident) =>
      incidentIds.has(incident.id),
    );
    const incidents = rawIncidents.map((incident) =>
      projectIncident(ctx, incident, state),
    );
    const analysisByIncident = Object.fromEntries(
      rawIncidents.flatMap((incident) => {
        const analysis = analysisByScope.get(scopeKey(ctx, incident, state));
        return analysis ? [[incident.id, analysis]] : [];
      }),
    );
    const projectProposal = (proposal: ResponseAction) => {
      const currentIncident = state.incidents.find(
        (incident) => incident.id === proposal.incidentId,
      );
      const currentPolicyRevision = currentIncident
        ? company.membershipSnapshot(currentIncident.commanderId)
            ?.policyRevision
        : undefined;
      const execution = responseExecutions.get(proposal.actionId);
      const staleContext =
        !currentIncident ||
        proposal.semanticRevision !== state.organization.semanticRevision ||
        proposal.evidenceRevision !== currentIncident.evidenceRevision ||
        proposal.policyRevision !== currentPolicyRevision;
      return {
        ...proposal,
        id: proposal.actionId,
        digest: proposal.canonicalDigest,
        status:
          proposal.target.generation !== responseTarget.generation
            ? "stale_target"
            : execution
              ? execution.state
              : staleContext
                ? "stale_context"
                : "awaiting_approval",
      };
    };
    const proposalsByIncident = Object.fromEntries(
      rawIncidents.flatMap((incident) => {
        const proposal = [...responseActions.values()]
          .reverse()
          .find((item) => item.incidentId === incident.id);
        return proposal ? [[incident.id, projectProposal(proposal)]] : [];
      }),
    );
    const responseByIncident = Object.fromEntries(
      rawIncidents.flatMap((incident) => {
        const proposal = [...responseActions.values()]
          .reverse()
          .find((item) => item.incidentId === incident.id);
        if (
          !proposal ||
          proposal.target.generation !== responseTarget.generation
        )
          return [];
        const execution = responseExecutions.get(proposal.actionId),
          checks = responseChecks.get(incident.id);
        if (!execution && !checks) return [];
        return [
          [
            incident.id,
            {
              incidentId: incident.id,
              affectedNodeIds:
                execution?.state === "verified" &&
                execution.routeDisabled === true
                  ? [...readableNodeIds(ctx, incident, state)].filter(
                      (id) => id === "retry-route",
                    )
                  : [],
              ...(execution?.state === "verified" &&
              execution.routeDisabled === true
                ? { safetyMode: "unsafe_route_disabled" }
                : {}),
              containment: execution
                ? {
                    status: execution.state,
                    observedAt: execution.observedAt,
                    checks: [
                      {
                        label: "Retry endpoint disabled",
                        passed: execution.routeDisabled,
                      },
                      {
                        label: "Service control reachable",
                        passed: execution.controlReachable,
                      },
                      {
                        label: "Fallback ready",
                        passed: execution.fallbackReady,
                      },
                    ],
                    ...(execution.reason ? { reason: execution.reason } : {}),
                  }
                : null,
              fallback:
                checks?.generation === responseTarget.generation
                  ? (checks.fallback ?? null)
                  : null,
              resolution:
                checks?.generation === responseTarget.generation
                  ? (checks.resolution ?? null)
                  : null,
            },
          ],
        ];
      }),
    );
    const activeAnalysis =
      rawIncidents
        .map((incident) => analysisByIncident[incident.id])
        .find(Boolean) ?? null;
    const activeProposal =
      [...responseActions.values()]
        .reverse()
        .find((item) => incidentIds.has(item.incidentId)) ?? null;
    const visibleTasks = state.tasks
      .filter((task) => incidentIds.has(task.incidentId))
      .map((task) => projectTask(ctx, task, state));
    const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
    const visibleMessages = state.messages.filter((message) => {
      if (!incidentIds.has(message.incidentId)) return false;
      const incident = state.incidents.find(
        (item) => item.id === message.incidentId,
      )!;
      const readable = readableNodeIds(ctx, incident, state);
      return (
        (!message.nodeId || readable.has(message.nodeId)) &&
        (!message.taskId || visibleTaskIds.has(message.taskId))
      );
    });
    return {
      ...state,
      eventCursor: company.recipientCursor(ctx.employeeId),
      members: state.members.map((entry) =>
        isAdmin || entry.id === ctx.employeeId
          ? {
              ...entry,
              availabilitySetting: entry.availability,
              availability: effectiveAvailability(entry),
            }
          : publicMember(entry),
      ),
      nodes: state.nodes.filter((node) => allowedNodeIds.has(node.id)),
      edges: state.edges.filter(
        (edge) =>
          allowedNodeIds.has(edge.sourceId) &&
          allowedNodeIds.has(edge.targetId),
      ),
      regions: state.regions
        .map((region) => ({
          ...region,
          nodeIds: region.nodeIds.filter((id) => allowedNodeIds.has(id)),
        }))
        .filter((region) => region.nodeIds.length),
      repositories,
      incidents,
      workspaces,
      conversations,
      tasks: visibleTasks,
      assignmentVolunteers: rawIncidents.flatMap((incident) =>
        incident.memberIds.flatMap((id) => {
          const consent = company.assignmentVolunteer(incident.id, id);
          return consent && Date.parse(consent.expiresAt) > Date.now()
            ? [consent]
            : [];
        }),
      ),
      messages: visibleMessages,
      notifications: state.notifications
        .filter((notification) => notification.memberId === ctx.employeeId)
        .map(projectNotification),
      grants: isAdmin ? state.grants : [],
      delegations: isAdmin
        ? state.delegations
        : state.delegations.filter(
            (delegation) =>
              delegation.fromId === ctx.employeeId ||
              delegation.toId === ctx.employeeId,
          ),
      user: {
        id: member.id,
        name: member.name,
        email: member.email,
        title: member.title,
        departmentId: member.departmentId,
        role: ctx.role,
      },
      permissions: capabilities(ctx),
      model: {
        configured: Boolean(process.env.NVIDIA_API_KEY),
        model: process.env.NVIDIA_MODEL ?? "nvidia/nemotron",
        mode: process.env.NVIDIA_API_KEY ? "configured" : "rule-based",
      },
      integrations: {
        identity: "local",
        database: "sqlite",
        realtime: "server",
        supabaseConnected: false,
      },
      analysisByIncident,
      proposalsByIncident,
      responseByIncident,
      analysis: activeAnalysis,
      proposal: activeProposal ? projectProposal(activeProposal) : null,
    };
  }

  async function action(
    ctx: AuthContext,
    token: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const type = string(body.type, "type", 80);
    const payload =
      body.payload &&
      typeof body.payload === "object" &&
      !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : {};
    if (type === "graph.organize") {
      allow(ctx, "organization:admin", "organization", "northstar");
      const before = company.allState(),
        requested =
          payload.nodeIds === undefined
            ? before.nodes.map((node) => node.id)
            : array(payload.nodeIds, "nodeIds", 500);
      if (
        new Set(requested).size !== requested.length ||
        requested.some((id) => !before.nodes.some((node) => node.id === id))
      )
        throw new HttpError(400, "invalid_scope", "layout nodes are invalid");
      const selected = new Set(requested),
        nodes = before.nodes.filter((node) => selected.has(node.id));
      const result = await proposeCanvasLayoutViaMcp({
        nodes: nodes.map((node) => ({
          ...node,
          departmentName:
            before.departments.find(
              (department) =>
                department.id ===
                before.members.find((member) => member.id === node.ownerId)
                  ?.departmentId,
            )?.name ?? "Other systems",
        })),
        edges: before.edges.filter(
          (edge) => selected.has(edge.sourceId) && selected.has(edge.targetId),
        ),
        authorize: () => {
          const current = auth.authenticate(token);
          allow(current, "organization:admin", "organization", "northstar");
        },
      });
      const latest = company.allState();
      if (
        latest.organization.semanticRevision !==
          before.organization.semanticRevision ||
        nodes.some(
          (node) =>
            latest.nodes.find((current) => current.id === node.id)
              ?.layoutRevision !== node.layoutRevision,
        )
      )
        throw new HttpError(
          409,
          "revision_conflict",
          "canvas changed while its layout was being proposed",
        );
      // Recheck after awaiting MCP and before committing the bounded positions.
      allow(
        auth.authenticate(token),
        "organization:admin",
        "organization",
        "northstar",
      );
      company.updateNodeLayouts(
        result.positions.map((position) => ({
          ...position,
          layoutRevision:
            nodes.find((node) => node.id === position.id)?.layoutRevision ?? -1,
        })),
        selected,
      );
      return result;
    }
    if (
      ["workspace.create", "workspace.update", "workspace.delete"].includes(
        type,
      )
    ) {
      allow(ctx, "organization:admin", "organization", "northstar");
      if (type === "workspace.create")
        return company.createWorkspace({
          name: string(payload.name, "name", 180),
          nodeIds: array(payload.nodeIds ?? [], "nodeIds"),
          memberIds: array(payload.memberIds ?? [], "memberIds"),
          createdBy: ctx.employeeId,
        });
      const id = string(payload.id, "id", 100),
        revision = number(payload.revision, "revision");
      if (type === "workspace.delete") {
        company.deleteWorkspace(id, revision);
        return { id, deleted: true };
      }
      const patch =
        payload.patch &&
        typeof payload.patch === "object" &&
        !Array.isArray(payload.patch)
          ? (payload.patch as Record<string, unknown>)
          : payload;
      return company.updateWorkspace(id, revision, {
        ...(patch.name === undefined
          ? {}
          : { name: string(patch.name, "name", 180) }),
        ...(patch.nodeIds === undefined
          ? {}
          : { nodeIds: array(patch.nodeIds, "nodeIds") }),
        ...(patch.memberIds === undefined
          ? {}
          : { memberIds: array(patch.memberIds, "memberIds") }),
      });
    }
    if (type === "conversation.send")
      return company.postConversation({
        scope: string(payload.scope, "scope", 20) as "company" | "workspace",
        ...(payload.workspaceId === undefined
          ? {}
          : { workspaceId: string(payload.workspaceId, "workspaceId", 100) }),
        authorId: ctx.employeeId,
        text: string(payload.text, "text", 4000),
        idempotencyKey: string(body.idempotencyKey, "idempotencyKey", 120),
      });
    if (type === "member.create") {
      allow(ctx, "organization:admin", "organization", "northstar");
      const id = `employee-${string(payload.email, "email", 200)
        .split("@")[0]!
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`;
      return company.addMember(employeeFromImport({ ...payload, id }));
    }
    if (type === "member.update" || type === "settings.update") {
      const id =
        type === "settings.update"
          ? ctx.employeeId
          : string(payload.id, "id", 100);
      const selfFields = new Set([
        "workingHours",
        "timezone",
        "availability",
        "availabilityUntil",
        "leave",
        "notifications",
        "onCallWindows",
      ]);
      const rawPatch =
        type === "settings.update"
          ? payload
          : ((payload.patch as Record<string, unknown>) ?? {});
      if (
        id !== ctx.employeeId ||
        Object.keys(rawPatch).some((key) => !selfFields.has(key))
      )
        allow(ctx, "directory:write", "organization", "northstar");
      const current = company.member(id);
      if (!current) throw new HttpError(404, "not_found", "member not found");
      if (
        id !== ctx.employeeId &&
        ("notifications" in rawPatch || "onCallWindows" in rawPatch)
      )
        throw new HttpError(
          403,
          "consent_required",
          "only the employee can change their alert preferences and accepted on-call coverage",
        );
      const allowedFields =
        id === ctx.employeeId && !company.isOrganizationAdmin(ctx.employeeId)
          ? selfFields
          : new Set([
              "name",
              "departmentId",
              "team",
              "jobFamily",
              "level",
              "title",
              "roleTemplate",
              "managerId",
              "active",
              ...selfFields,
            ]);
      const patch = Object.fromEntries(
        Object.entries(rawPatch).filter(([key]) => allowedFields.has(key)),
      );
      if (Object.keys(patch).length !== Object.keys(rawPatch).length)
        throw new HttpError(
          403,
          "field_forbidden",
          "one or more member fields cannot be changed",
        );
      return company.updateMember(
        id,
        type === "settings.update"
          ? current.revision
          : number(payload.revision, "revision"),
        patch,
      );
    }
    if (type === "member.activate") {
      allow(ctx, "organization:admin", "organization", "northstar");
      const id = string(payload.id, "id", 100);
      const target = company.member(id);
      if (!target) throw new HttpError(404, "not_found", "member not found");
      const result = auth.createEmployeeAccount(token, {
        employeeId: id,
        login: `${id.replace(/^employee-/, "")}@northstar.local`,
      });
      company.updateMember(id, target.revision, { active: true });
      return {
        id,
        login: `${id.replace(/^employee-/, "")}@northstar.local`,
        initialPassword: result.initialPassword,
      };
    }
    if (type === "member.revoke") {
      allow(ctx, "organization:admin", "organization", "northstar");
      const id = string(payload.id, "id", 100);
      auth.revokeEmployeeAccount(token, id);
      return company.updateMember(id, number(payload.revision, "revision"), {
        active: false,
      });
    }
    if (type === "node.create") {
      const admin = company.isOrganizationAdmin(ctx.employeeId);
      if (admin) allow(ctx, "organization:admin", "organization", "northstar");
      else if (!["engineer", "data_science_manager"].includes(ctx.role))
        throw new HttpError(
          403,
          "forbidden",
          "your role cannot create systems",
        );
      const regionId = string(payload.regionId, "regionId", 100);
      if (
        !admin &&
        !company
          .allState()
          .nodes.some(
            (node) =>
              node.regionId === regionId &&
              company.permissionGrants(
                ctx.employeeId,
                { kind: "node", id: node.id },
                "graph:read",
              ).length,
          )
      )
        throw new HttpError(
          403,
          "forbidden",
          "choose a region you can currently access",
        );
      return company.createNode({
        id: `node-${randomUUID()}`,
        name: string(payload.name, "name", 160),
        kind: string(payload.kind, "kind", 40) as CompanyNode["kind"],
        description: string(payload.description, "description", 1000),
        regionId: string(payload.regionId, "regionId", 100),
        ...(!admin
          ? { ownerId: ctx.employeeId }
          : payload.ownerId
            ? { ownerId: string(payload.ownerId, "ownerId", 100) }
            : {}),
        criticality: string(
          payload.criticality,
          "criticality",
          20,
        ) as CompanyNode["criticality"],
        status: "healthy",
        x: Number(payload.x ?? 0),
        y: Number(payload.y ?? 0),
      });
    }
    if (type === "node.update") {
      const id = string(payload.id, "id", 100);
      if (!company.isOrganizationAdmin(ctx.employeeId)) {
        allow(ctx, "graph:write", "node", id);
        const patch = (payload.patch ?? {}) as Record<string, unknown>;
        if ("ownerId" in patch && patch.ownerId !== ctx.employeeId)
          throw new HttpError(
            403,
            "forbidden",
            "only an administrator can change the system owner",
          );
        if (
          "regionId" in patch &&
          !company
            .allState()
            .nodes.some(
              (node) =>
                node.regionId === patch.regionId &&
                company.permissionGrants(
                  ctx.employeeId,
                  { kind: "node", id: node.id },
                  "graph:read",
                ).length,
            )
        )
          throw new HttpError(
            403,
            "forbidden",
            "choose a region you can currently access",
          );
      }
      return company.updateNode(
        id,
        number(payload.semanticRevision, "semanticRevision"),
        (payload.patch ?? {}) as any,
      );
    }
    if (type === "node.move") {
      const id = string(payload.id, "id", 100);
      if (!company.isOrganizationAdmin(ctx.employeeId))
        allow(ctx, "graph:write", "node", id);
      return company.updateNodeLayout(
        id,
        number(payload.layoutRevision, "layoutRevision"),
        Number(payload.x),
        Number(payload.y),
      );
    }
    if (type === "node.delete") {
      const id = string(payload.id, "id", 100);
      if (!company.isOrganizationAdmin(ctx.employeeId))
        allow(ctx, "graph:write", "node", id);
      company.deleteNode(
        id,
        number(payload.semanticRevision, "semanticRevision"),
      );
      return { id, deleted: true };
    }
    if (type === "edge.create") {
      if (company.isOrganizationAdmin(ctx.employeeId))
        allow(ctx, "organization:admin", "organization", "northstar");
      else {
        allow(
          ctx,
          "graph:write",
          "node",
          string(payload.sourceId, "sourceId", 100),
        );
        allow(
          ctx,
          "graph:read",
          "node",
          string(payload.targetId, "targetId", 100),
        );
      }
      return company.createEdge({
        id: `edge-${randomUUID()}`,
        sourceId: string(payload.sourceId, "sourceId", 100),
        targetId: string(payload.targetId, "targetId", 100),
        kind: string(payload.kind, "kind", 40) as any,
        label:
          typeof payload.label === "string" && payload.label.trim()
            ? payload.label.trim()
            : "depends on",
        optional: Boolean(payload.optional),
      });
    }
    if (type === "edge.update") {
      if (company.isOrganizationAdmin(ctx.employeeId))
        allow(ctx, "organization:admin", "organization", "northstar");
      else {
        const edge = company
          .allState()
          .edges.find((item) => item.id === payload.id);
        if (!edge) throw new HttpError(404, "not_found", "edge not found");
        allow(ctx, "graph:write", "node", edge.sourceId);
        allow(ctx, "graph:read", "node", edge.targetId);
      }
      return company.updateEdge(
        string(payload.id, "id", 140),
        number(payload.revision, "revision"),
        (payload.patch ?? {}) as any,
      );
    }
    if (type === "repository.delete") {
      allow(ctx, "organization:admin", "organization", "northstar");
      const id = string(payload.id, "id", 140);
      company.deleteRepositoryReference(
        id,
        number(payload.revisionNumber, "revisionNumber"),
      );
      return { id, deleted: true };
    }
    if (type === "edge.delete") {
      if (company.isOrganizationAdmin(ctx.employeeId))
        allow(ctx, "organization:admin", "organization", "northstar");
      else {
        const edge = company
          .allState()
          .edges.find((item) => item.id === payload.id);
        if (!edge) throw new HttpError(404, "not_found", "edge not found");
        allow(ctx, "graph:write", "node", edge.sourceId);
        allow(ctx, "graph:read", "node", edge.targetId);
      }
      const id = string(payload.id, "id", 140);
      company.deleteEdge(id, number(payload.revision, "revision"));
      return { id, deleted: true };
    }
    if (type === "repository.save" || type === "repository.update") {
      allow(ctx, "organization:admin", "organization", "northstar");
      const sourcePath = string(payload.path, "path", 300),
        sourceRevision = string(payload.revision, "revision", 40);
      if (
        !/^(?:apps|packages|fixtures|integration-tests)\/[A-Za-z0-9._/-]+$/.test(
          sourcePath,
        ) ||
        sourcePath.includes("..") ||
        !/^(?:WORKTREE|[a-f0-9]{7,40})$/.test(sourceRevision)
      )
        throw new HttpError(
          400,
          "invalid_source",
          "source reference is outside the configured repository",
        );
      try {
        if (sourceRevision === "WORKTREE") {
          const real = realpathSync(resolve(projectRoot, sourcePath));
          if (
            !real.startsWith(`${realpathSync(projectRoot)}/`) ||
            !lstatSync(real).isFile()
          )
            throw new Error("outside repository");
        } else
          await execFile(
            "git",
            ["cat-file", "-e", `${sourceRevision}:${sourcePath}`],
            { cwd: projectRoot, timeout: 3000, maxBuffer: 1024 },
          );
      } catch {
        throw new HttpError(
          400,
          "invalid_source",
          "repository file or revision is unavailable",
        );
      }
      allow(
        auth.authenticate(token),
        "organization:admin",
        "organization",
        "northstar",
      );
      return company.addRepositoryReference({
        ...(payload.id === undefined
          ? {}
          : {
              id: string(payload.id, "id", 140),
              revisionNumber: number(payload.revisionNumber, "revisionNumber"),
            }),
        nodeId: string(payload.nodeId, "nodeId", 100),
        repository: "local:hackutd",
        revision: string(payload.revision, "revision", 40),
        path: string(payload.path, "path", 300),
        ...(Number.isSafeInteger(payload.lineStart)
          ? { lineStart: Number(payload.lineStart) }
          : {}),
        ...(Number.isSafeInteger(payload.lineEnd)
          ? { lineEnd: Number(payload.lineEnd) }
          : {}),
      });
    }
    if (type === "import.preview") {
      allow(ctx, "organization:admin", "organization", "northstar");
      return imports.preview(
        string(payload.format, "format", 30) as any,
        string(payload.content, "content", 196_000),
      );
    }
    if (type === "import.commit") {
      allow(ctx, "organization:admin", "organization", "northstar");
      if (
        number(payload.semanticRevision, "semanticRevision") !==
        company.allState().organization.semanticRevision
      )
        throw new HttpError(
          409,
          "revision_conflict",
          "company graph changed since preview",
        );
      const preview = imports.consume(
        string(payload.previewId, "previewId", 100),
      );
      let inserted = 0,
        updated = 0;
      for (const row of preview.rows) {
        if (preview.format === "employees_csv") {
          const parsed = employeeFromImport(row),
            existing = company.member(parsed.id);
          if (existing) {
            company.updateMember(existing.id, existing.revision, {
              name: parsed.name,
              departmentId: parsed.departmentId,
              team: parsed.team,
              jobFamily: parsed.jobFamily,
              level: parsed.level,
              title: parsed.title,
              timezone: parsed.timezone,
            });
            updated += 1;
          } else {
            company.addMember(parsed);
            inserted += 1;
          }
        } else {
          const parsed = nodeFromImport(row),
            existing = company
              .allState()
              .nodes.find((node) => node.id === parsed.id);
          if (existing) {
            company.updateNode(existing.id, existing.semanticRevision, {
              name: parsed.name,
              kind: parsed.kind,
              description: parsed.description,
              regionId: parsed.regionId,
              ...(parsed.ownerId ? { ownerId: parsed.ownerId } : {}),
              criticality: parsed.criticality,
              status: parsed.status,
            });
            updated += 1;
          } else {
            company.createNode(parsed);
            inserted += 1;
          }
        }
      }
      if (preview.format === "catalog_json") {
        const nodeIds = new Set(
          company.allState().nodes.map((node) => node.id),
        );
        for (const row of preview.rows)
          for (const dependency of Array.isArray(row.dependencies)
            ? row.dependencies
            : []) {
            if (
              typeof dependency === "string" &&
              nodeIds.has(dependency) &&
              nodeIds.has(String(row.id))
            ) {
              const edgeId = `catalog-${dependency}-${String(row.id)}`;
              if (!company.allState().edges.some((edge) => edge.id === edgeId))
                company.createEdge({
                  id: edgeId,
                  sourceId: dependency,
                  targetId: String(row.id),
                  kind: "depends_on",
                  label: "catalog dependency",
                  optional: false,
                });
            }
          }
      }
      return { inserted, updated };
    }
    if (type === "incident.create") {
      allow(ctx, "incident:create", "organization", "northstar");
      if (!body.idempotencyKey)
        throw new HttpError(
          400,
          "idempotency_required",
          "incident creation requires idempotencyKey",
        );
      return company.createIncident({
        title: string(payload.title, "title", 180),
        observation: string(payload.observation, "observation", 2000),
        ...(payload.priority === undefined
          ? {}
          : {
              priority: string(
                payload.priority,
                "priority",
                20,
              ) as Incident["priority"],
            }),
        regionId:
          typeof payload.regionId === "string" ? payload.regionId : "global",
        nodeIds: array(payload.nodeIds, "nodeIds", 50),
        memberIds: Array.isArray(payload.memberIds)
          ? array(payload.memberIds, "memberIds", 30)
          : ["employee-noah", "employee-priya"],
        commanderId: ctx.employeeId,
        idempotencyKey: string(body.idempotencyKey, "idempotencyKey", 120),
      });
    }
    if (type === "incident.share_systems") {
      const incidentId = string(payload.incidentId, "incidentId", 100);
      allow(ctx, "organization:admin", "organization", "northstar");
      allow(ctx, "incident:assign", "incident", incidentId);
      return company.shareIncidentSystems(
        incidentId,
        array(payload.memberIds, "memberIds", 100),
        array(payload.nodeIds, "nodeIds", 50),
      );
    }
    if (type === "incident.update") {
      const id = string(payload.id, "id", 100);
      allow(ctx, "incident:assign", "incident", id);
      const patch =
        payload.patch &&
        typeof payload.patch === "object" &&
        !Array.isArray(payload.patch)
          ? payload.patch
          : {};
      return company.updateIncident(
        id,
        number(payload.revision, "revision"),
        patch as any,
      );
    }
    if (type === "incident.acknowledge") {
      const id = string(payload.id, "id", 100);
      allow(ctx, "incident:participate", "incident", id);
      const incident = company
        .allState()
        .incidents.find((item) => item.id === id);
      if (!incident)
        throw new HttpError(404, "not_found", "incident not found");
      return company.updateIncident(id, incident.revision, {
        status: "acknowledged",
      });
    }
    if (type === "assignment.volunteer") {
      const incidentId = string(payload.incidentId, "incidentId", 100);
      allow(ctx, "incident:participate", "incident", incidentId);
      return company.volunteerForAssignments(incidentId, ctx.employeeId);
    }
    if (type === "assignment.plan") {
      const incidentId = string(payload.incidentId, "incidentId", 100);
      const initial = assignmentContext(ctx, incidentId);
      if (activeAssignmentPlans.has(incidentId))
        throw new HttpError(
          409,
          "assignment_planning_in_progress",
          "Planning is already in progress for this incident. Wait for the current plan.",
        );
      if (activeAssignmentPlans.size >= 2)
        throw new HttpError(
          429,
          "assignment_planning_busy",
          "Two assignment plans are already in progress. Try again when one finishes.",
        );
      activeAssignmentPlans.add(incidentId);
      try {
        const mcp = await createCompanyMcpSession({
          organizationId: "northstar",
          incidentId,
          invoke: async (name, _args, signal) => {
            signal.throwIfAborted();
            const current = assignmentContext(
              auth.authenticate(token),
              incidentId,
            );
            if (current.binding !== initial.binding)
              throw new HttpError(
                409,
                "assignment_stale",
                "Assignment context changed during evidence checks",
              );
            if (name === "get_incident")
              return projectIncident(ctx, current.incident, current.state);
            if (name === "analyze_incident_impact")
              return company.impactScoped(current.readable);
            if (name === "get_dependencies")
              return {
                nodes: current.state.nodes.filter((node) =>
                  current.readable.has(node.id),
                ),
                edges: current.state.edges.filter(
                  (edge) =>
                    current.readable.has(edge.sourceId) &&
                    current.readable.has(edge.targetId),
                ),
              };
            if (name === "list_response_tasks")
              return current.state.tasks
                .filter((task) => task.incidentId === incidentId)
                .map((task) =>
                  projectTask(auth.authenticate(token), task, current.state),
                )
                .map(({ title, ownerId, nodeIds, status }) => ({
                  title,
                  ownerId,
                  nodeIds: nodeIds.filter((id) => current.readable.has(id)),
                  status,
                }));
            throw new Error("Tool not permitted for assignment evidence");
          },
        });
        let evidence: unknown;
        try {
          evidence = {
            protocolVersion: mcp.protocolVersion,
            incident: await mcp.callTool("get_incident", {}),
            dependencies: await mcp.callTool("get_dependencies", {}),
            impact: await mcp.callTool("analyze_incident_impact", {}),
            tasks: await mcp.callTool("list_response_tasks", {}),
          };
        } finally {
          await mcp.close();
        }
        const result = await planIncidentAssignments({
          incident: {
            id: incidentId,
            title: initial.incident.title,
            observation: initial.incident.observation,
            nodeIds: [...initial.readable],
          },
          semanticRevision: initial.state.organization.semanticRevision,
          analysis: evidence,
          nodes: initial.state.nodes.filter((node) =>
            initial.readable.has(node.id),
          ),
          existingTasks: initial.state.tasks
            .filter((task) => task.incidentId === incidentId)
            .map((task) => projectTask(ctx, task, initial.state))
            .map(({ title, ownerId, nodeIds, status }) => ({
              title,
              ownerId,
              nodeIds: nodeIds.filter((id) => initial.readable.has(id)),
              status,
            })),
          candidates: initial.candidates,
        });
        const current = assignmentContext(auth.authenticate(token), incidentId);
        if (current.binding !== initial.binding)
          throw new HttpError(
            409,
            "assignment_stale",
            "People, source access, evidence or tasks changed while the plan was prepared. Plan again.",
          );
        result.skipped = [...initial.skipped, ...result.skipped];
        result.steps.unshift({
          stage: "checking_evidence",
          status: "completed",
          detail:
            "Read the current incident, permitted dependencies, dependency impact and existing tasks through the authenticated MCP session.",
        });
        const planId = `assignment-${randomUUID()}`;
        const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
        company.saveAssignmentPlan({
          id: planId,
          actorId: ctx.employeeId,
          incidentId,
          binding: initial.binding,
          expiresAt,
          result,
        });
        return { planId, incidentId, expiresAt, ...result };
      } finally {
        activeAssignmentPlans.delete(incidentId);
      }
    }
    if (type === "assignment.apply") {
      const planId = string(payload.planId, "planId", 100);
      const tasks = company.applyAssignmentPlan(
        planId,
        (plan) => {
          const live = auth.authenticate(token);
          if (plan.actorId !== live.employeeId)
            throw new HttpError(
              403,
              "forbidden",
              "Only the manager who reviewed this plan can apply it",
            );
          const current = assignmentContext(live, plan.incidentId);
          if (plan.taskIds) return; // Durable retries return the original delivery without new writes.
          if (
            Date.parse(plan.expiresAt) <= Date.now() ||
            current.binding !== plan.binding
          )
            throw new HttpError(
              409,
              "assignment_stale",
              "This plan expired or its people, evidence, tasks or access changed. Plan again.",
            );
          if (plan.result.tasks.length > 6)
            throw new HttpError(400, "invalid_plan", "Too many assignments");
          const recipients = new Set<string>();
          for (const task of plan.result.tasks) {
            const candidate = current.candidates.find(
              (entry) => entry.id === task.ownerId,
            );
            if (
              !candidate ||
              recipients.has(task.ownerId) ||
              !task.nodeIds.length ||
              task.nodeIds.some((id) => !candidate.nodeIds.includes(id)) ||
              !task.sourcePaths.length ||
              task.sourcePaths.some(
                (path) =>
                  !candidate.sourcePaths.includes(path) ||
                  !current.state.repositories.some(
                    (ref) =>
                      ref.path === path && task.nodeIds.includes(ref.nodeId),
                  ),
              ) ||
              !task.prompt.trim() ||
              task.prompt.length > 32_000
            )
              throw new HttpError(
                409,
                "assignment_stale",
                "A recipient, system or source path is no longer eligible. Plan again.",
              );
            recipients.add(task.ownerId);
          }
        },
        (task, index) => {
          const plan = company.assignmentPlan(planId)!;
          const draft = plan.result.tasks[index]!;
          const brief = generateTaskBrief({
            state: company.allState(),
            task,
            assignee: company.member(task.ownerId)!,
            permittedPaths: draft.sourcePaths,
            evidence: [],
            unknowns: [],
            tests: [],
            acceptanceCriteria: [],
          });
          return {
            ...brief,
            id: `brief-${task.id}`,
            text: draft.prompt,
            provenance: draft.provenance,
            taskDefinitionDigest: taskDefinitionDigest(task),
          };
        },
      );
      return {
        planId,
        taskIds: tasks.map((task) => task.id),
        tasks: tasks.map((task) =>
          projectTask(auth.authenticate(token), task, company.allState()),
        ),
      };
    }
    if (type === "task.create") {
      allow(
        ctx,
        "incident:assign",
        "incident",
        string(payload.incidentId, "incidentId", 100),
      );
      return company.createTask({
        incidentId: string(payload.incidentId, "incidentId", 100),
        title: string(payload.title, "title", 300),
        ownerId: string(payload.ownerId, "ownerId", 100),
        nodeIds: array(payload.nodeIds ?? [], "nodeIds", 50),
      });
    }
    if (type === "task.update") {
      const id = string(payload.id, "id", 100);
      allow(ctx, "task:write", "task", id);
      const current = company.allState().tasks.find((task) => task.id === id);
      if (!current) throw new HttpError(404, "not_found", "task not found");
      if (
        (payload.ownerId && payload.ownerId !== current.ownerId) ||
        payload.title
      ) {
        const incident = company
          .allState()
          .incidents.find((item) => item.id === current.incidentId)!;
        if (incident.commanderId !== ctx.employeeId)
          throw new HttpError(
            403,
            "assignment_forbidden",
            "only the incident commander can reassign or retitle tasks",
          );
      }
      const updated = company.updateTask(
        id,
        number(payload.revision, "revision"),
        {
          ...(payload.status
            ? { status: string(payload.status, "status", 30) as any }
            : {}),
          ...(payload.ownerId
            ? { ownerId: string(payload.ownerId, "ownerId", 100) }
            : {}),
          ...(payload.title
            ? { title: string(payload.title, "title", 300) }
            : {}),
        },
      );
      return projectTask(ctx, updated, company.allState());
    }
    if (type === "message.send") {
      if (!body.idempotencyKey)
        throw new HttpError(
          400,
          "idempotency_required",
          "message creation requires idempotencyKey",
        );
      const incidentId = string(payload.incidentId, "incidentId", 100);
      allow(ctx, "incident:participate", "incident", incidentId);
      return company.postMessage({
        incidentId,
        authorId: ctx.employeeId,
        text: string(payload.text, "text", 4000),
        idempotencyKey: string(body.idempotencyKey, "idempotencyKey", 120),
        ...(payload.nodeId
          ? { nodeId: string(payload.nodeId, "nodeId", 100) }
          : {}),
        ...(payload.taskId
          ? { taskId: string(payload.taskId, "taskId", 100) }
          : {}),
      });
    }
    if (type === "notification.read")
      return projectNotification(
        company.readNotification(string(payload.id, "id", 120), ctx.employeeId),
      );
    if (type === "delegation.save") {
      allow(ctx, "organization:admin", "organization", "northstar");
      return company.saveDelegation({
        id:
          typeof payload.id === "string"
            ? payload.id
            : `delegation-${randomUUID()}`,
        fromId: string(payload.fromId, "fromId", 100),
        toId: string(payload.toId, "toId", 100),
        startsAt: string(payload.startsAt, "startsAt", 50),
        endsAt: string(payload.endsAt, "endsAt", 50),
        capabilities: array(payload.capabilities, "capabilities", 20),
        resourceIds: array(payload.resourceIds, "resourceIds", 50),
      });
    }
    if (type === "escalation.check") {
      const incidentId = string(payload.incidentId, "incidentId", 100);
      allow(ctx, "incident:assign", "incident", incidentId);
      const state = company.allState(),
        incident = state.incidents.find((item) => item.id === incidentId);
      if (!incident)
        throw new HttpError(404, "not_found", "incident not found");
      const authorizedApproverIds = new Set(
        state.members
          .filter(
            (member) =>
              company.permissionGrants(
                member.id,
                { kind: "incident", id: incidentId },
                "incident:approve",
              ).length,
          )
          .map((member) => member.id),
      );
      return chooseEscalation({
        incident,
        members: state.members,
        delegates: state.delegations,
        authorizedApproverIds,
        at: new Date(),
      });
    }
    if (type === "analysis.run") {
      const incidentId = string(payload.incidentId, "incidentId", 100);
      allow(ctx, "incident:read", "incident", incidentId);
      const state = company.allState(),
        incident = state.incidents.find((i) => i.id === incidentId)!;
      const initialScopeKey = scopeKey(ctx, incident, state);
      const invoke = async (
        name: CompanyMcpTool,
        _args: Record<string, unknown>,
        signal: AbortSignal,
      ) => {
        signal.throwIfAborted();
        const live = auth.authenticate(token);
        allow(live, "incident:read", "incident", incidentId);
        const current = company.allState(),
          currentIncident = current.incidents.find(
            (item) => item.id === incidentId,
          );
        if (!currentIncident) throw new Error("incident no longer exists");
        const scopedNodeIds = readableNodeIds(live, currentIncident, current);
        const scopedNodes = current.nodes.filter((node) =>
            scopedNodeIds.has(node.id),
          ),
          scopedEdges = current.edges.filter(
            (edge) =>
              scopedNodeIds.has(edge.sourceId) &&
              scopedNodeIds.has(edge.targetId),
          );
        const scopedTasks = current.tasks
          .filter((task) => task.incidentId === incidentId)
          .map((task) => projectTask(live, task, current));
        const scopedTaskIds = new Set(scopedTasks.map((task) => task.id));
        if (name === "get_incident") {
          const projected = projectIncident(live, currentIncident, current);
          return { ...projected, memberIds: [] };
        }
        if (name === "get_incident_timeline")
          return current.messages
            .filter(
              (message) =>
                message.incidentId === incidentId &&
                (!message.nodeId || scopedNodeIds.has(message.nodeId)) &&
                (!message.taskId || scopedTaskIds.has(message.taskId)),
            )
            .slice(-50);
        if (name === "get_dependencies")
          return { nodes: scopedNodes, edges: scopedEdges };
        if (name === "analyze_incident_impact")
          return company.impactScoped(scopedNodeIds);
        if (name === "simulate_containment") {
          const supplied =
            _args.overrides &&
            typeof _args.overrides === "object" &&
            !Array.isArray(_args.overrides)
              ? (_args.overrides as Record<string, { availability?: unknown }>)
              : {};
          if (Object.keys(supplied).some((id) => !scopedNodeIds.has(id)))
            throw new Error(
              "simulation override is outside the readable scope",
            );
          const overrides = Object.fromEntries(
            Object.entries(supplied)
              .map(([id, value]) => [id, value.availability])
              .filter(
                (
                  entry,
                ): entry is [string, "satisfied" | "unsatisfied" | "unknown"] =>
                  entry[1] === "satisfied" ||
                  entry[1] === "unsatisfied" ||
                  entry[1] === "unknown",
              ),
          );
          return company.impactScoped(scopedNodeIds, overrides);
        }
        if (name === "list_response_tasks")
          return scopedTasks.filter(
            (task) =>
              task.ownerId === live.employeeId ||
              company.isOrganizationAdmin(live.employeeId),
          );
        if (name === "list_fallback_plans")
          return [
            {
              id: "tenant-safe-retry",
              status: "available_after_verified_containment",
              description:
                "Deny cross-tenant retry while allowing same-tenant work.",
            },
          ];
        throw new Error("tool not allowed");
      };
      const mcp = await createCompanyMcpSession({
        organizationId: "northstar",
        incidentId,
        invoke,
      });
      try {
        const analyzed = await analyzeDemo({
          message:
            typeof payload.message === "string"
              ? payload.message
              : "Analyze the current incident using scoped evidence.",
          context: {
            organizationId: "northstar",
            incidentId,
            observation: incident.observation,
            semanticRevision: state.organization.semanticRevision,
            mcpProtocol: mcp.protocolVersion,
          },
          callTool: (name, args, options) =>
            mcp.callTool(name, args, {
              ...(options?.signal ? { signal: options.signal } : {}),
              ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
            }),
        });
        const live = auth.authenticate(token),
          current = company.allState(),
          currentIncident = current.incidents.find(
            (item) => item.id === incidentId,
          );
        if (!currentIncident)
          throw new HttpError(
            409,
            "analysis_stale",
            "incident changed during analysis",
          );
        allow(live, "incident:read", "incident", incidentId);
        if (scopeKey(live, currentIncident, current) !== initialScopeKey)
          throw new HttpError(
            409,
            "analysis_stale",
            "incident scope or evidence changed during analysis",
          );
        const labels: Record<string, [string, string]> = {
          get_incident: [
            "Incident report",
            "Read the current report and incident scope.",
          ],
          get_dependencies: [
            "Connected systems",
            "Read the systems and connections available to you.",
          ],
          analyze_incident_impact: [
            "Dependency check",
            "Evaluated the recorded dependency states. This does not establish a root cause.",
          ],
          simulate_containment: [
            "Containment simulation",
            "Simulated dependency outcomes without changing any service.",
          ],
          list_response_tasks: [
            "Assigned tasks",
            "Read the current tasks available to you.",
          ],
          get_incident_timeline: [
            "Team updates",
            "Read the persisted incident conversation.",
          ],
          list_fallback_plans: [
            "Fallback plan",
            "Read the configured fallback. It still requires independent verification.",
          ],
        };
        const value = {
          incidentId,
          report: {
            headline:
              analyzed.mode === "live"
                ? "Analysis ready for review"
                : "Evidence review completed",
            observation: currentIncident.observation,
            findings: analyzed.steps.map((step) => ({
              title: labels[step.tool]?.[0] ?? "Evidence check",
              status: step.status,
              detail:
                step.status === "observed" ||
                step.status === "simulated" ||
                step.status === "completed"
                  ? (labels[step.tool]?.[1] ??
                    "A scoped evidence check completed.")
                  : "This check did not return usable evidence. Review the technical details.",
            })),
            nextSteps: [
              "Review the reported issue with the assigned responders.",
              "Check the linked source and tests before choosing a change.",
              "Review the exact proposed action before asking the commander to approve it.",
            ],
            unknowns: [
              "The report and dependency checks alone do not prove a root cause.",
              "Containment and fallback are unverified until their independent checks pass.",
            ],
            limitations:
              analyzed.mode === "scripted"
                ? [
                    "Live model analysis was unavailable; these are scripted evidence checks.",
                  ]
                : [
                    "Model conclusions require human review against the evidence.",
                  ],
          },
          mcp: { protocolVersion: mcp.protocolVersion, tools: mcp.tools },
          ...analyzed,
        };
        analysisByScope.set(scopeKey(live, currentIncident, current), value);
        return value;
      } finally {
        await mcp.close();
      }
    }
    if (type === "brief.generate") {
      const taskId = string(payload.taskId, "taskId", 100);
      allow(ctx, "task:read", "task", taskId);
      const state = company.allState(),
        task = state.tasks.find((t) => t.id === taskId);
      if (!task)
        throw new HttpError(
          403,
          "forbidden",
          "task brief is restricted to its assignee and commander",
        );
      if (task.ownerId !== ctx.employeeId)
        allow(ctx, "incident:assign", "incident", task.incidentId);
      const assignee = company.member(task.ownerId)!;
      const saved = company.assignmentBrief(taskId);
      if (saved) {
        checkBriefAccess(ctx, task, saved.permittedPaths ?? [], state);
        if (briefIsStale(saved, state, task))
          throw new HttpError(
            409,
            "brief_stale",
            "The prepared prompt is stale. Review the current incident and prepare a new assignment.",
          );
        briefs.set(saved.id, saved);
        return saved;
      }
      const paths = state.repositories
        .filter((r) => task.nodeIds.includes(r.nodeId))
        .map((r) => r.path);
      checkBriefAccess(ctx, task, paths, state);
      if (!paths.length)
        throw new HttpError(
          409,
          "source_mapping_required",
          "task nodes need an authorized repository mapping before generating a brief",
        );
      const brief = generateTaskBrief({
        state,
        task,
        assignee,
        permittedPaths: paths,
        evidence: [
          state.incidents.find((i) => i.id === task.incidentId)!.observation,
        ],
        unknowns: ["The exact cause remains a hypothesis until reproduced."],
        tests: ["node --test fixtures/northstar/retry-service.test.ts"],
        acceptanceCriteria: [
          "Same-tenant retry succeeds.",
          "Cross-tenant retry is denied.",
        ],
      });
      briefs.set(brief.id, brief);
      return brief;
    }
    if (type === "brief.copy") {
      const id = string(payload.id, "id", 100),
        brief =
          briefs.get(id) ??
          company
            .allState()
            .tasks.map((task) => company.assignmentBrief(task.id))
            .find((entry) => entry?.id === id);
      if (!brief) throw new HttpError(404, "not_found", "brief not found");
      const state = company.allState(),
        task = state.tasks.find((t) => t.id === brief.taskId);
      if (!task || briefIsStale(brief, state, task))
        throw new HttpError(409, "brief_stale", "task brief is stale");
      checkBriefAccess(
        ctx,
        task,
        brief.permittedPaths ??
          state.repositories
            .filter((ref) => task.nodeIds.includes(ref.nodeId))
            .map((ref) => ref.path),
        state,
      );
      return brief;
    }
    if (type === "response.prepare") {
      const incidentId = string(payload.incidentId, "incidentId", 100);
      allow(ctx, "incident:read", "incident", incidentId);
      const state = company.allState(),
        incident = state.incidents.find((item) => item.id === incidentId);
      if (!incident)
        throw new HttpError(404, "not_found", "incident not found");
      if (!incident.nodeIds.includes("retry-route"))
        throw new HttpError(
          409,
          "automatic_action_unavailable",
          "No automatic action is configured for these systems; continue with assigned tasks.",
        );
      allow(ctx, "graph:read", "node", "retry-route");
      const analysis = analysisByScope.get(scopeKey(ctx, incident, state));
      if (!analysis)
        throw new HttpError(
          409,
          "analysis_required",
          "run analysis with the current scope before preparing a response",
        );
      const contextDigest = createHash("sha256")
        .update(
          JSON.stringify({
            incidentId,
            semanticRevision: state.organization.semanticRevision,
            evidenceRevision: incident.evidenceRevision,
            analysis,
          }),
        )
        .digest("hex");
      const sourceDigest = createHash("sha256")
        .update(JSON.stringify(analysis))
        .digest("hex");
      const policyRevision =
        company.membershipSnapshot(incident.commanderId)?.policyRevision ?? 0;
      const sourceIdDigest = createHash("sha256")
        .update(
          JSON.stringify({
            contextDigest,
            sourceDigest,
            targetGeneration: responseTarget.generation,
            policyRevision,
          }),
        )
        .digest("hex");
      const prepared = response.prepare({
        context: ctx,
        incidentId,
        sourceProposal: {
          id: `source-${incidentId}-${sourceIdDigest.slice(0, 32)}`,
          digest: sourceDigest,
          contextDigest,
        },
        targetGeneration: responseTarget.generation,
        semanticRevision: state.organization.semanticRevision,
        evidenceRevision: incident.evidenceRevision,
        policyRevision,
      });
      responseActions.set(prepared.actionId, prepared);
      return {
        ...prepared,
        id: prepared.actionId,
        digest: prepared.canonicalDigest,
      };
    }
    if (type === "response.approve") {
      const actionId = string(payload.proposalId, "proposalId", 100);
      const action = responseActions.get(actionId);
      if (!action)
        throw new HttpError(404, "not_found", "response proposal not found");
      allow(ctx, "incident:approve", "incident", action.incidentId);
      response.approve({
        context: ctx,
        actionId,
        approvedDigest: string(payload.digest, "digest", 64),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
      const execution = await response.executeApproved(
        actionId,
        responseTarget,
        responseObserver,
      );
      responseExecutions.set(actionId, execution);
      return execution;
    }
    if (type === "response.fallback") {
      const incidentId = string(payload.incidentId, "incidentId", 100);
      allow(ctx, "incident:approve", "incident", incidentId);
      const action = [...responseActions.values()]
          .reverse()
          .find((item) => item.incidentId === incidentId),
        execution = action
          ? responseExecutions.get(action.actionId)
          : undefined;
      if (
        !action ||
        action.target.generation !== responseTarget.generation ||
        !execution ||
        execution.state !== "verified"
      )
        throw new HttpError(
          409,
          "containment_unverified",
          "containment must be independently verified first",
        );
      const verified = await responseObserver.verifyFallback();
      responseChecks.set(incidentId, {
        generation: responseTarget.generation,
        fallback: verified,
      });
      if (verified.verified) fallbackVerified.add(incidentId);
      return verified;
    }
    if (type === "response.resolve") {
      const incidentId = string(payload.incidentId, "incidentId", 100);
      allow(ctx, "incident:approve", "incident", incidentId);
      const action = [...responseActions.values()]
          .reverse()
          .find((item) => item.incidentId === incidentId),
        execution = action
          ? responseExecutions.get(action.actionId)
          : undefined;
      if (
        !action ||
        action.target.generation !== responseTarget.generation ||
        !execution ||
        execution.state !== "verified"
      )
        throw new HttpError(
          409,
          "resolution_unverified",
          "this incident needs recorded verified containment",
        );
      const fallback = await responseObserver.verifyFallback();
      if (!fallback.verified)
        throw new HttpError(
          409,
          "resolution_unverified",
          "the safe fallback is not currently verified",
        );
      const verified = await responseObserver.verifyResolution();
      if (!verified.verified)
        throw new HttpError(
          409,
          "resolution_unverified",
          "resolution checks did not pass",
        );
      const incident = company
        .allState()
        .incidents.find((item) => item.id === incidentId);
      if (!incident)
        throw new HttpError(404, "not_found", "incident not found");
      responseChecks.set(incidentId, {
        generation: responseTarget.generation,
        fallback,
        resolution: verified,
      });
      const resolved = company.resolveIncident(
        incidentId,
        incident.revision,
        `Containment ${execution.executionId} and tenant-isolating fallback were independently verified.`,
      );
      fallbackVerified.add(incidentId);
      return { ...verified, incident: resolved };
    }
    throw new HttpError(400, "unknown_action", `unknown action: ${type}`);
  }

  let actualPort = options.port ?? 4173;
  const server = createServer(async (req, res) => {
    try {
      const address = server.address(),
        port =
          address && typeof address === "object" ? address.port : actualPort;
      const host = req.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        throw new HttpError(403, "host_rejected", "host rejected");
      if (
        req.headers.origin &&
        ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
          req.headers.origin,
        )
      )
        throw new HttpError(403, "origin_rejected", "origin rejected");
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.hash || url.pathname.includes(".."))
        throw new HttpError(404, "not_found", "not found");
      if (req.method === "POST" && url.pathname === "/api/login") {
        const body = await jsonBody(req);
        const result = auth.signIn(
          string(body.email ?? body.login, "email", 200),
          string(body.password, "password", 1024),
          req.socket.remoteAddress ?? "local",
        );
        const member = company.member(result.context.employeeId)!;
        return json(res, 200, {
          token: result.token,
          expiresAt: result.context.sessionExpiresAt,
          user: {
            id: member.id,
            name: member.name,
            email: member.email,
            title: member.title,
            departmentId: member.departmentId,
            role: result.context.role,
          },
        });
      }
      if (req.method === "POST" && url.pathname === "/api/logout") {
        auth.signOut(bearer(req));
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/state")
        return json(res, 200, visibleState(context(req).value));
      if (req.method === "POST" && url.pathname === "/api/actions") {
        const authn = context(req),
          body = await jsonBody(req),
          result = await action(authn.value, authn.token, body);
        return json(res, 200, {
          state: visibleState(auth.authenticate(authn.token)),
          result,
        });
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        const token = bearer(req),
          ctx = auth.authenticate(token),
          cursor = Number(url.searchParams.get("cursor") ?? "0");
        if (!Number.isSafeInteger(cursor) || cursor < 0)
          throw new HttpError(400, "invalid_cursor", "cursor is invalid");
        res.writeHead(
          200,
          securityHeaders({
            "Content-Type": "text/event-stream; charset=utf-8",
            Connection: "keep-alive",
          }),
        );
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let lease: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe = () => {};
        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          clearTimeout(lease);
          unsubscribe();
        };
        const end = () => {
          cleanup();
          if (!res.writableEnded && !res.destroyed) res.end();
        };
        req.once("close", cleanup);
        res.once("close", cleanup);
        res.once("finish", cleanup);
        res.once("error", end);
        let lastCursor = cursor,
          sentInitial = false;
        const send = (force = false) => {
          if (closed) return;
          try {
            const current = auth.authenticate(token);
            const state = visibleState(current);
            const visibleCursor = Number(state.eventCursor ?? 0);
            if (visibleCursor > lastCursor || !sentInitial || force) {
              res.write(
                `id: ${visibleCursor}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`,
              );
              lastCursor = visibleCursor;
              sentInitial = true;
            }
          } catch {
            end();
          }
        };
        unsubscribe = company.subscribe((event: CompanyEvent) => {
          if (closed) return;
          try {
            const current = auth.authenticate(token);
            if (
              event.memberIds.includes(current.employeeId) ||
              company.isOrganizationAdmin(current.employeeId)
            )
              send();
          } catch {
            end();
          }
        });
        let heartbeatCount = 0;
        heartbeat = setInterval(() => {
          if (!closed) {
            try {
              auth.authenticate(token);
              res.write(": heartbeat\n\n");
              if (++heartbeatCount % 4 === 0) send(true);
            } catch {
              end();
            }
          }
        }, 15_000);
        // HTTP/1 browsers share a small connection pool across same-origin tabs.
        // Yield each stream so queued actions can run; the client reconnects after
        // EOF with its cursor and receives a freshly authorized current snapshot.
        lease = setTimeout(end, 10_000);
        send();
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/source") {
        const ctx = context(req).value,
          id = url.searchParams.get("id");
        if (!id)
          throw new HttpError(400, "invalid_input", "source id required");
        allow(ctx, "repository:read", "repository", id);
        const ref = company.allState().repositories.find((r) => r.id === id);
        if (!ref) throw new HttpError(404, "not_found", "source not found");
        let text: string;
        let editorUrl: string | undefined;
        if (ref.revision === "WORKTREE") {
          const candidate = resolve(projectRoot, ref.path),
            realRoot = realpathSync(projectRoot),
            real = realpathSync(candidate);
          if (
            !real.startsWith(`${realRoot}/`) ||
            lstatSync(real).isSymbolicLink()
          )
            throw new HttpError(403, "source_rejected", "source path rejected");
          text = (await readFile(real, "utf8")).slice(0, 64 * 1024);
          editorUrl = `vscode://file${real.split("/").map(encodeURIComponent).join("/")}:${ref.lineStart ?? 1}`;
        } else {
          try {
            const result = await execFile(
              "git",
              ["show", `${ref.revision}:${ref.path}`],
              {
                cwd: projectRoot,
                encoding: "utf8",
                maxBuffer: 64 * 1024,
                timeout: 3000,
              },
            );
            text = result.stdout;
          } catch {
            throw new HttpError(
              404,
              "source_revision_unavailable",
              "pinned source revision or path is unavailable",
            );
          }
        }
        return json(res, 200, {
          path: ref.path,
          revision: ref.revision,
          ...(editorUrl ? { editorUrl } : {}),
          ...(ref.lineStart ? { lineStart: ref.lineStart } : {}),
          ...(ref.lineEnd ? { lineEnd: ref.lineEnd } : {}),
          text,
        });
      }
      const pretextName = url.pathname.startsWith("/pretext/")
        ? url.pathname.slice("/pretext/".length)
        : "";
      const generatedName = url.pathname.startsWith("/pretext/generated/")
        ? url.pathname.slice("/pretext/generated/".length)
        : "";
      const file =
        staticFiles.get(url.pathname) ??
        (pretextFiles.has(pretextName)
          ? `pretext/${pretextName}`
          : pretextGeneratedFiles.has(generatedName)
            ? `pretext/generated/${generatedName}`
            : undefined);
      if (req.method !== "GET" || !file)
        throw new HttpError(404, "not_found", "not found");
      const path = join(publicDir, file);
      await access(path);
      res.writeHead(
        200,
        securityHeaders({
          "Content-Type":
            contentTypes[extname(path)] ?? "application/octet-stream",
        }),
      );
      return createReadStream(path).pipe(res);
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      const status =
        e instanceof AuthError
          ? 401
          : e instanceof PermissionError
            ? 403
            : e instanceof ResponseError
              ? e.code.includes("FORBIDDEN") || e.code.includes("GRANT")
                ? 403
                : 409
              : e instanceof CompanyError
                ? e.status
                : (e.status ?? 400);
      json(res, status, {
        error: e.message || "request failed",
        code: e.code ?? "request_failed",
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4173, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (address && typeof address === "object") actualPort = address.port;
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${actualPort}`,
    runtimeDir,
    company,
    auth,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await responseTarget.close();
      response.close();
      auth.close();
      company.close();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const portIndex = process.argv.indexOf("--port"),
    runtimeIndex = process.argv.indexOf("--runtime");
  const started = await startTetherServer({
    ...(portIndex >= 0 ? { port: Number(process.argv[portIndex + 1]) } : {}),
    ...(runtimeIndex >= 0
      ? { runtimeDir: process.argv[runtimeIndex + 1] }
      : {}),
  });
  process.stdout.write(
    `${JSON.stringify({ ready: true, url: started.url, runtimeDir: started.runtimeDir })}\n`,
  );
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void started.close().then(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
