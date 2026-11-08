import assert from "node:assert/strict";
import test from "node:test";
import {
  authorize,
  PermissionError,
  type AuthContext,
  type MembershipSnapshot,
  type ResourceGrant,
} from "./permissions.ts";

const membership: MembershipSnapshot = {
  employeeId: "employee-noah",
  organizationId: "northstar",
  role: "engineer",
  active: true,
  policyRevision: 4,
};
const context: AuthContext = {
  ...membership,
  sessionId: "session-noah",
  sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const repositoryGrant: ResourceGrant = {
  id: "grant-retry-repo",
  employeeId: membership.employeeId,
  organizationId: membership.organizationId,
  resourceKind: "repository",
  resourceId: "repo-retry-service",
  capabilities: ["repository:read"],
  policyRevision: 4,
};

function code(expected: string, operation: () => void): void {
  assert.throws(
    operation,
    (error: unknown) =>
      error instanceof PermissionError && error.code === expected,
  );
}

test("resource grants are organization, employee, revision, and capability bound", () => {
  authorize({
    context,
    currentMembership: membership,
    capability: "repository:read",
    resource: {
      organizationId: "northstar",
      kind: "repository",
      id: "repo-retry-service",
    },
    grants: [repositoryGrant],
  });
  code("RESOURCE_GRANT_REQUIRED", () =>
    authorize({
      context,
      currentMembership: membership,
      capability: "repository:read",
      resource: {
        organizationId: "northstar",
        kind: "repository",
        id: "repo-other",
      },
      grants: [repositoryGrant],
    }),
  );
  code("ORGANIZATION_SCOPE_MISMATCH", () =>
    authorize({
      context,
      currentMembership: membership,
      capability: "repository:read",
      resource: {
        organizationId: "other",
        kind: "repository",
        id: "repo-retry-service",
      },
      grants: [repositoryGrant],
    }),
  );
});

test("client-forged roles and stale policy revisions confer no authority", () => {
  code("STALE_AUTH_CONTEXT", () =>
    authorize({
      context: { ...context, role: "senior_manager" },
      currentMembership: membership,
      capability: "organization:admin",
      resource: {
        organizationId: "northstar",
        kind: "organization",
        id: "northstar",
      },
      grants: [],
    }),
  );
  code("STALE_AUTH_CONTEXT", () =>
    authorize({
      context,
      currentMembership: { ...membership, policyRevision: 5 },
      capability: "repository:read",
      resource: {
        organizationId: "northstar",
        kind: "repository",
        id: "repo-retry-service",
      },
      grants: [repositoryGrant],
    }),
  );
});

test("marketing notice access cannot become incident, conversation, or repository access", () => {
  const marketingMembership: MembershipSnapshot = {
    employeeId: "employee-elena",
    organizationId: "northstar",
    role: "marketing",
    active: true,
    policyRevision: 2,
  };
  const marketingContext: AuthContext = {
    ...marketingMembership,
    sessionId: "session-elena",
    sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const noticeGrant: ResourceGrant = {
    id: "grant-notice",
    employeeId: "employee-elena",
    organizationId: "northstar",
    resourceKind: "notice",
    resourceId: "notice-1",
    capabilities: ["notice:read"],
    policyRevision: 2,
  };
  authorize({
    context: marketingContext,
    currentMembership: marketingMembership,
    capability: "notice:read",
    resource: { organizationId: "northstar", kind: "notice", id: "notice-1" },
    grants: [noticeGrant],
  });
  code("CAPABILITY_DENIED", () =>
    authorize({
      context: marketingContext,
      currentMembership: marketingMembership,
      capability: "incident:read",
      resource: {
        organizationId: "northstar",
        kind: "incident",
        id: "incident-1",
      },
      grants: [noticeGrant],
    }),
  );
  code("CAPABILITY_DENIED", () =>
    authorize({
      context: marketingContext,
      currentMembership: marketingMembership,
      capability: "repository:read",
      resource: {
        organizationId: "northstar",
        kind: "repository",
        id: "repo-retry-service",
      },
      grants: [noticeGrant],
    }),
  );
});

test("data science managers read only explicitly granted repositories", () => {
  const currentMembership: MembershipSnapshot = {
    employeeId: "employee-priya",
    organizationId: "northstar",
    role: "data_science_manager",
    active: true,
    policyRevision: 7,
  };
  const managerContext: AuthContext = {
    ...currentMembership,
    sessionId: "session-priya",
    sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const trainingRepository = {
    organizationId: "northstar",
    kind: "repository" as const,
    id: "repo-training-workflow",
  };
  code("RESOURCE_GRANT_REQUIRED", () =>
    authorize({
      context: managerContext,
      currentMembership,
      capability: "repository:read",
      resource: trainingRepository,
      grants: [],
    }),
  );
  authorize({
    context: managerContext,
    currentMembership,
    capability: "repository:read",
    resource: trainingRepository,
    grants: [
      {
        id: "grant-priya-training-repository",
        employeeId: currentMembership.employeeId,
        organizationId: currentMembership.organizationId,
        resourceKind: "repository",
        resourceId: trainingRepository.id,
        capabilities: ["repository:read"],
        policyRevision: currentMembership.policyRevision,
      },
    ],
  });
  code("CAPABILITY_DENIED", () =>
    authorize({
      context: managerContext,
      currentMembership,
      capability: "incident:approve",
      resource: {
        organizationId: "northstar",
        kind: "incident",
        id: "incident-training",
      },
      grants: [
        {
          id: "forged-priya-approval",
          employeeId: currentMembership.employeeId,
          organizationId: currentMembership.organizationId,
          resourceKind: "incident",
          resourceId: "incident-training",
          capabilities: ["incident:approve"],
          policyRevision: currentMembership.policyRevision,
        },
      ],
    }),
  );
});

test("a new member cannot gain write or approval authority from an untrusted display title", () => {
  const currentMembership: MembershipSnapshot = {
    employeeId: "employee-new",
    organizationId: "northstar",
    role: "member",
    active: true,
    policyRevision: 1,
    titleTemplateId: "Senior Operations Manager",
  };
  const memberContext: AuthContext = {
    ...currentMembership,
    sessionId: "session-new",
    sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const forgedAdminGrant: ResourceGrant = {
    id: "forged-admin",
    employeeId: "employee-new",
    organizationId: "northstar",
    resourceKind: "organization",
    resourceId: "northstar",
    capabilities: ["organization:admin", "directory:write"],
    policyRevision: 1,
  };
  const forgedApprovalGrant: ResourceGrant = {
    id: "forged-approval",
    employeeId: "employee-new",
    organizationId: "northstar",
    resourceKind: "incident",
    resourceId: "incident-retry",
    capabilities: ["incident:approve"],
    policyRevision: 1,
  };

  code("CAPABILITY_DENIED", () =>
    authorize({
      context: memberContext,
      currentMembership,
      capability: "organization:admin",
      resource: {
        organizationId: "northstar",
        kind: "organization",
        id: "northstar",
      },
      grants: [forgedAdminGrant],
    }),
  );
  code("CAPABILITY_DENIED", () =>
    authorize({
      context: memberContext,
      currentMembership,
      capability: "incident:approve",
      resource: {
        organizationId: "northstar",
        kind: "incident",
        id: "incident-retry",
      },
      grants: [forgedApprovalGrant],
    }),
  );
  code("STALE_AUTH_CONTEXT", () =>
    authorize({
      context: { ...memberContext, role: "senior_manager" },
      currentMembership,
      capability: "organization:admin",
      resource: {
        organizationId: "northstar",
        kind: "organization",
        id: "northstar",
      },
      grants: [forgedAdminGrant],
    }),
  );
});
