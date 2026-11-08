export type TetherRole =
  | "senior_manager"
  | "engineer"
  | "data_science_manager"
  | "marketing"
  | "member";

export type Capability =
  | "organization:admin"
  | "directory:read"
  | "directory:write"
  | "graph:read"
  | "graph:write"
  | "incident:create"
  | "incident:read"
  | "incident:participate"
  | "incident:assign"
  | "incident:approve"
  | "repository:read"
  | "task:read"
  | "task:write"
  | "notice:read";

export type ResourceKind =
  | "organization"
  | "workspace"
  | "region"
  | "node"
  | "repository"
  | "incident"
  | "task"
  | "notice";

export interface MembershipSnapshot {
  employeeId: string;
  organizationId: string;
  role: TetherRole;
  active: boolean;
  policyRevision: number;
  departmentId?: string;
  titleTemplateId?: string;
}

export interface AuthContext extends MembershipSnapshot {
  sessionId: string;
  sessionExpiresAt: string;
}

export interface ResourceGrant {
  id: string;
  organizationId: string;
  employeeId: string;
  resourceKind: ResourceKind;
  resourceId: string;
  capabilities: Capability[];
  policyRevision: number;
  expiresAt?: string;
}

export interface ResourceRef {
  organizationId: string;
  kind: ResourceKind;
  id: string;
}

export class PermissionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PermissionError";
  }
}

const ROLE_TEMPLATES: Readonly<Record<TetherRole, ReadonlySet<Capability>>> = {
  senior_manager: new Set([
    "organization:admin",
    "directory:read",
    "directory:write",
    "graph:read",
    "graph:write",
    "incident:create",
    "incident:read",
    "incident:participate",
    "incident:assign",
    "incident:approve",
    "repository:read",
    "task:read",
    "task:write",
    "notice:read",
  ]),
  engineer: new Set([
    "directory:read",
    "graph:read",
    "graph:write",
    "incident:read",
    "incident:participate",
    "repository:read",
    "task:read",
    "task:write",
    "notice:read",
  ]),
  data_science_manager: new Set([
    "directory:read",
    "graph:read",
    "graph:write",
    "incident:read",
    "incident:participate",
    "repository:read",
    "task:read",
    "task:write",
    "notice:read",
  ]),
  marketing: new Set(["notice:read"]),
  member: new Set(["directory:read", "graph:read", "task:read", "notice:read"]),
};

export function roleTemplate(role: TetherRole): ReadonlySet<Capability> {
  return ROLE_TEMPLATES[role];
}

export function authorize(input: {
  context: AuthContext;
  currentMembership: MembershipSnapshot;
  capability: Capability;
  resource: ResourceRef;
  grants: readonly ResourceGrant[];
  now?: Date;
}): void {
  const now = input.now ?? new Date();
  const { context, currentMembership, capability, resource } = input;
  if (!currentMembership.active)
    throw new PermissionError("MEMBERSHIP_INACTIVE", "membership is inactive");
  if (
    context.employeeId !== currentMembership.employeeId ||
    context.organizationId !== currentMembership.organizationId
  )
    throw new PermissionError(
      "IDENTITY_MISMATCH",
      "session identity is not current membership",
    );
  if (resource.organizationId !== currentMembership.organizationId)
    throw new PermissionError(
      "ORGANIZATION_SCOPE_MISMATCH",
      "resource belongs to another organization",
    );
  if (
    context.policyRevision !== currentMembership.policyRevision ||
    context.role !== currentMembership.role
  )
    throw new PermissionError(
      "STALE_AUTH_CONTEXT",
      "membership or grant policy changed",
    );

  const baseline = roleTemplate(currentMembership.role);
  if (!baseline.has(capability))
    throw new PermissionError(
      "CAPABILITY_DENIED",
      "role template does not include capability",
    );

  if (capability === "organization:admin") {
    if (
      resource.kind !== "organization" ||
      resource.id !== currentMembership.organizationId
    )
      throw new PermissionError(
        "RESOURCE_SCOPE_DENIED",
        "organization administration is organization-bound",
      );
  }

  // Marketing receives only explicit, low-detail notices. A notice grant cannot
  // be reused to read the incident, repository, tasks, or responder conversation.
  if (currentMembership.role === "marketing" && resource.kind !== "notice")
    throw new PermissionError(
      "MARKETING_SCOPE_DENIED",
      "marketing access is restricted to notices",
    );

  const grant = input.grants.find(
    (candidate) =>
      candidate.employeeId === currentMembership.employeeId &&
      candidate.organizationId === currentMembership.organizationId &&
      candidate.resourceKind === resource.kind &&
      candidate.resourceId === resource.id &&
      candidate.policyRevision === currentMembership.policyRevision &&
      candidate.capabilities.includes(capability) &&
      (!candidate.expiresAt ||
        new Date(candidate.expiresAt).getTime() > now.getTime()),
  );
  if (!grant)
    throw new PermissionError(
      "RESOURCE_GRANT_REQUIRED",
      "no current resource grant permits this action",
    );
}

export function canAccess(input: Parameters<typeof authorize>[0]): boolean {
  try {
    authorize(input);
    return true;
  } catch (error) {
    if (error instanceof PermissionError) return false;
    throw error;
  }
}

export function filterVisible<T>(
  values: readonly T[],
  resource: (value: T) => ResourceRef,
  permission: Omit<Parameters<typeof authorize>[0], "resource">,
): T[] {
  return values.filter((value) =>
    canAccess({ ...permission, resource: resource(value) }),
  );
}

export interface MarketingNotice {
  id: string;
  status: "investigating" | "verified" | "resolved";
  generalArea: string;
  contactRoute: string;
  avoidInterrupting: string[];
  message: string;
}

export function projectMarketingNotice(
  notice: MarketingNotice,
): MarketingNotice {
  return {
    id: notice.id,
    status: notice.status,
    generalArea: notice.generalArea,
    contactRoute: notice.contactRoute,
    avoidInterrupting: [...notice.avoidInterrupting],
    message: notice.message,
  };
}
