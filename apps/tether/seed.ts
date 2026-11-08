import type {
  CompanyEdge,
  CompanyNode,
  Member,
  RepositoryReference,
  ResourceGrant,
} from "./types.ts";

export const departments = [
  ["engineering", "Engineering", 36],
  ["data-science", "Data Science and ML", 24],
  ["infrastructure", "Infrastructure and SRE", 14],
  ["security", "Security", 8],
  ["product", "Product and Design", 6],
  ["marketing", "Marketing", 5],
  ["sales", "Sales and Customer Success", 5],
  ["operations", "People, Finance, and Legal", 2],
] as const;

const named = [
  [
    "employee-ava",
    "Ava Patel",
    "ava@northstar.example",
    "infrastructure",
    "Operations",
    "Operations",
    "M5",
    "Senior Operations Manager",
  ],
  [
    "employee-noah",
    "Noah Kim",
    "noah@northstar.example",
    "engineering",
    "Job Platform",
    "Software Engineering",
    "IC2",
    "Software Engineer",
  ],
  [
    "employee-priya",
    "Priya Raman",
    "priya@northstar.example",
    "data-science",
    "Training Systems",
    "Data Science",
    "M4",
    "Data Science Manager",
  ],
  [
    "employee-elena",
    "Elena Torres",
    "elena@northstar.example",
    "marketing",
    "Corporate Marketing",
    "Marketing",
    "IC3",
    "Marketing Manager",
  ],
] as const;

const firstNames = [
  "Maya",
  "Liam",
  "Zoe",
  "Ethan",
  "Sofia",
  "Lucas",
  "Nina",
  "Owen",
  "Iris",
  "Mateo",
  "Leah",
  "Arjun",
  "Chloe",
  "David",
  "Mina",
  "Kai",
];
const lastNames = [
  "Chen",
  "Williams",
  "Nguyen",
  "Garcia",
  "Johnson",
  "Shah",
  "Brown",
  "Lee",
  "Davis",
  "Wilson",
  "Martinez",
  "Taylor",
  "Anderson",
  "Thomas",
  "Moore",
  "Jackson",
];
const titleByDepartment: Record<string, Array<[string, string, string]>> = {
  engineering: [
    ["Software Engineering", "IC1", "Associate Software Engineer"],
    ["Software Engineering", "IC2", "Software Engineer"],
    ["Software Engineering", "IC3", "Senior Software Engineer"],
    ["Software Engineering", "IC4", "Staff Software Engineer"],
    ["Software Engineering", "M3", "Engineering Manager"],
    ["Software Engineering", "IC3", "Backend Engineer"],
    ["Software Engineering", "IC3", "Frontend Engineer"],
  ],
  "data-science": [
    ["Data Science", "IC2", "Data Scientist"],
    ["Data Science", "IC3", "Senior Data Scientist"],
    ["Machine Learning", "IC2", "Machine Learning Engineer"],
    ["Data Engineering", "IC2", "Data Engineer"],
    ["Data Science", "M3", "Data Science Manager"],
  ],
  infrastructure: [
    ["Reliability", "IC2", "Site Reliability Engineer"],
    ["Infrastructure", "IC2", "Cloud Infrastructure Engineer"],
    ["Platform", "IC3", "Platform Engineer"],
  ],
  security: [
    ["Security", "IC2", "Security Engineer"],
    ["Application Security", "IC3", "Application Security Engineer"],
    ["Incident Response", "IC2", "Incident Response Analyst"],
    ["Security Operations", "M3", "Security Operations Manager"],
  ],
  product: [
    ["Design", "IC2", "Product Designer"],
    ["Research", "IC2", "UX Researcher"],
    ["Content", "IC2", "Content Designer"],
    ["Product", "M3", "Product Manager"],
  ],
  marketing: [
    ["Marketing", "IC2", "Content Marketing Specialist"],
    ["Marketing", "M3", "Marketing Manager"],
  ],
  sales: [
    ["Customer Success", "IC2", "Customer Success Manager"],
    ["Sales", "IC2", "Account Executive"],
  ],
  operations: [
    ["People", "IC3", "People Operations Partner"],
    ["Finance", "IC3", "Finance Manager"],
  ],
};

const hours = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start: "09:00",
  end: "17:00",
}));

export function seedMembers(): Member[] {
  const result: Member[] = named.map((item) => ({
    id: item[0],
    name: item[1],
    email: item[2],
    departmentId: item[3],
    team: item[4],
    jobFamily: item[5],
    level: item[6],
    title: item[7],
    active: true,
    loginProvisioned: true,
    roleTemplate:
      item[0] === "employee-ava"
        ? "senior_manager"
        : item[0] === "employee-noah"
          ? "engineer"
          : item[0] === "employee-priya"
            ? "data_science_manager"
            : "marketing",
    timezone: "America/Chicago",
    workingHours: hours,
    availability: item[0] === "employee-ava" ? "on_call" : "available",
    notifications: {
      routineInHours: true,
      afterHours: item[0] === "employee-ava",
      channels: ["in_app"],
      severities: ["high", "critical"],
    },
    onCallWindows:
      item[0] === "employee-ava"
        ? [
            {
              startsAt: "2026-11-08T00:00:00.000Z",
              endsAt: "2026-11-09T00:00:00.000Z",
              accepted: true,
            },
          ]
        : [],
    revision: 1,
  }));
  let index = 0;
  for (const [departmentId, , count] of departments) {
    const already = result.filter(
      (m) => m.departmentId === departmentId,
    ).length;
    for (let i = already; i < count; i += 1) {
      const catalog = titleByDepartment[departmentId]!;
      const title = catalog[i % catalog.length]!;
      const first = firstNames[index % firstNames.length]!;
      const last =
        lastNames[Math.floor(index / firstNames.length) % lastNames.length]!;
      const id = `${departmentId}-${String(i + 1).padStart(2, "0")}`;
      const managerId =
        departmentId === "engineering"
          ? "engineering-05"
          : departmentId === "data-science"
            ? "employee-priya"
            : undefined;
      result.push({
        id,
        name: `${first} ${last}`,
        email: `${id}@northstar.example`,
        departmentId,
        team:
          departmentId === "engineering"
            ? ["Job Platform", "Customer Console", "Core Services"][i % 3]!
            : departmentId === "data-science"
              ? ["Training Systems", "Model Delivery", "Data Quality"][i % 3]!
              : title[0],
        jobFamily: title[0],
        level: title[1],
        title: title[2],
        roleTemplate: "member",
        ...(managerId ? { managerId } : {}),
        active: true,
        loginProvisioned: false,
        timezone: i % 4 === 0 ? "America/Los_Angeles" : "America/Chicago",
        workingHours: hours,
        availability: i % 17 === 0 ? "away" : "available",
        notifications: {
          routineInHours: true,
          afterHours: false,
          channels: ["in_app"],
          severities: ["high", "critical"],
        },
        onCallWindows: [],
        revision: 1,
      });
      index += 1;
    }
  }
  return result;
}

const nodeSpecs: Array<
  [
    string,
    string,
    CompanyNode["kind"],
    string,
    string,
    string,
    CompanyNode["criticality"],
  ]
> = [
  [
    "customer-console",
    "Customer Console",
    "service",
    "Customer submission and workload status UI",
    "global",
    "engineering-01",
    "high",
  ],
  [
    "job-api",
    "GPU Job API",
    "service",
    "Accepts and validates customer GPU jobs",
    "global",
    "employee-noah",
    "critical",
  ],
  [
    "tenant-auth",
    "Tenant Authorization",
    "component",
    "Binds authenticated tenants to job ownership",
    "global",
    "employee-noah",
    "critical",
  ],
  [
    "retry-route",
    "Job Retry Route",
    "component",
    "POST /api/v1/jobs/:jobId/retry",
    "global",
    "employee-noah",
    "critical",
  ],
  [
    "retry-queue",
    "Retry Queue",
    "resource",
    "Durable queue for authorized retry requests",
    "dfw",
    "infrastructure-02",
    "critical",
  ],
  [
    "scheduler",
    "GPU Scheduler",
    "service",
    "Places queued workloads into regional worker pools",
    "dfw",
    "infrastructure-03",
    "critical",
  ],
  [
    "dfw-worker-pool",
    "DFW GPU Worker Pool",
    "resource",
    "Isolated DFW training and inference capacity",
    "dfw",
    "infrastructure-04",
    "critical",
  ],
  [
    "results-storage",
    "Customer Results Storage",
    "resource",
    "Tenant-scoped workload outputs",
    "dfw",
    "infrastructure-05",
    "high",
  ],
  [
    "customer-dashboard",
    "Customer Dashboard",
    "service",
    "Shows workload progress and output availability",
    "global",
    "engineering-02",
    "high",
  ],
  [
    "dataset-upload",
    "Dataset Upload",
    "service",
    "Receives tenant dataset objects",
    "global",
    "data-science-02",
    "high",
  ],
  [
    "dataset-validation",
    "Dataset Validation",
    "workflow",
    "Scans schema, size, and training suitability",
    "dfw",
    "employee-priya",
    "high",
  ],
  [
    "training-catalog",
    "Training Dataset Catalog",
    "dataset",
    "Approved dataset metadata and ownership",
    "dfw",
    "employee-priya",
    "high",
  ],
  [
    "training-dispatch",
    "DFW Training Dispatch",
    "workflow",
    "Routes approved training jobs to DFW capacity",
    "dfw",
    "employee-priya",
    "critical",
  ],
  [
    "capacity-reporting",
    "Capacity Reporting",
    "workflow",
    "Regional utilization and queue estimates",
    "dfw",
    "infrastructure-06",
    "high",
  ],
  [
    "model-registry",
    "Model Registry",
    "resource",
    "Versioned model artifacts and ownership",
    "global",
    "data-science-03",
    "high",
  ],
  [
    "model-delivery",
    "Model Delivery",
    "workflow",
    "Publishes completed models to customer destinations",
    "global",
    "employee-priya",
    "high",
  ],
  [
    "audit-log",
    "Security Audit Log",
    "resource",
    "Immutable application authorization evidence",
    "global",
    "security-01",
    "critical",
  ],
  [
    "identity",
    "Customer Identity",
    "service",
    "Validates customer access tokens",
    "global",
    "security-02",
    "critical",
  ],
  [
    "billing-meter",
    "GPU Usage Meter",
    "service",
    "Records billable GPU runtime",
    "dfw",
    "engineering-03",
    "medium",
  ],
  [
    "notification-service",
    "Customer Notifications",
    "service",
    "Delivers workload state changes",
    "global",
    "engineering-04",
    "medium",
  ],
  [
    "support-console",
    "Customer Support Console",
    "service",
    "Authorized workload troubleshooting",
    "global",
    "sales-01",
    "medium",
  ],
  [
    "dfw-network",
    "DFW Service Network",
    "resource",
    "Private connectivity for DFW workers",
    "dfw",
    "infrastructure-07",
    "critical",
  ],
  [
    "dfw-cache",
    "DFW Dataset Cache",
    "resource",
    "Validated training dataset cache",
    "dfw",
    "data-science-04",
    "high",
  ],
  [
    "dfw-checkpoint",
    "Training Checkpoints",
    "resource",
    "Restartable training state",
    "dfw",
    "data-science-05",
    "high",
  ],
  [
    "iad-worker-pool",
    "IAD GPU Worker Pool",
    "resource",
    "Secondary regional compute capacity",
    "iad",
    "infrastructure-08",
    "high",
  ],
  [
    "iad-network",
    "IAD Service Network",
    "resource",
    "Private connectivity for IAD workers",
    "iad",
    "infrastructure-09",
    "high",
  ],
  [
    "queue-priority",
    "Queue Priority Policy",
    "component",
    "Applies customer tier and safety constraints",
    "global",
    "employee-priya",
    "high",
  ],
  [
    "job-state-db",
    "Job State Database",
    "resource",
    "Tenant jobs, ownership, and lifecycle state",
    "global",
    "engineering-06",
    "critical",
  ],
  [
    "object-store",
    "Dataset Object Store",
    "resource",
    "Tenant dataset objects and retention",
    "global",
    "data-science-06",
    "critical",
  ],
  [
    "artifact-scanner",
    "Artifact Scanner",
    "service",
    "Scans model and dataset artifacts",
    "global",
    "security-03",
    "high",
  ],
  [
    "release-gate",
    "Model Release Gate",
    "workflow",
    "Requires scan and owner approval before delivery",
    "global",
    "security-04",
    "high",
  ],
  [
    "status-page",
    "Customer Status Page",
    "service",
    "Approved high-level service notices",
    "global",
    "employee-elena",
    "medium",
  ],
  [
    "incident-operations",
    "Incident Operations",
    "team",
    "Coordinates operational response",
    "global",
    "employee-ava",
    "critical",
  ],
  [
    "job-platform-team",
    "Job Platform Team",
    "team",
    "Owns submission and authorization services",
    "global",
    "engineering-05",
    "high",
  ],
  [
    "training-systems-team",
    "Training Systems Team",
    "team",
    "Owns dataset and training continuity",
    "global",
    "employee-priya",
    "high",
  ],
  [
    "noah-node",
    "Noah Kim",
    "person",
    "Software engineer for job platform",
    "global",
    "employee-noah",
    "medium",
  ],
  [
    "priya-node",
    "Priya Raman",
    "person",
    "Manager for data science continuity",
    "global",
    "employee-priya",
    "medium",
  ],
  [
    "ava-node",
    "Ava Patel",
    "person",
    "Senior operations manager",
    "global",
    "employee-ava",
    "medium",
  ],
];

export function seedNodes(): CompanyNode[] {
  return nodeSpecs.map((n, i) => ({
    id: n[0],
    name: n[1],
    kind: n[2],
    description: n[3],
    regionId: n[4],
    ownerId: n[5],
    criticality: n[6],
    status: "healthy",
    x: 120 + (i % 8) * 260,
    y: 100 + Math.floor(i / 8) * 190,
    semanticRevision: 1,
    layoutRevision: 1,
  }));
}

const chain = [
  "customer-console",
  "job-api",
  "tenant-auth",
  "retry-route",
  "retry-queue",
  "scheduler",
  "dfw-worker-pool",
  "results-storage",
  "customer-dashboard",
];
export function seedEdges(): CompanyEdge[] {
  const edges: CompanyEdge[] = chain.slice(0, -1).map((sourceId, i) => ({
    id: `edge-${sourceId}-${chain[i + 1]}`,
    sourceId,
    targetId: chain[i + 1]!,
    kind: "depends_on",
    label: "depends on",
    optional: false,
    revision: 1,
  }));
  const extras: Array<[string, string, CompanyEdge["kind"], string]> = [
    ["dataset-upload", "dataset-validation", "feeds", "validated by"],
    [
      "dataset-validation",
      "training-catalog",
      "stores_in",
      "records approved metadata",
    ],
    [
      "training-catalog",
      "training-dispatch",
      "feeds",
      "supplies training input",
    ],
    ["training-dispatch", "scheduler", "depends_on", "requests capacity"],
    ["capacity-reporting", "queue-priority", "feeds", "supplies utilization"],
    ["queue-priority", "scheduler", "authorizes", "sets priority"],
    ["dfw-worker-pool", "dfw-network", "depends_on", "uses network"],
    ["dfw-worker-pool", "dfw-cache", "depends_on", "reads datasets"],
    ["dfw-worker-pool", "dfw-checkpoint", "stores_in", "writes checkpoints"],
    ["results-storage", "model-registry", "feeds", "registers artifacts"],
    ["model-registry", "artifact-scanner", "depends_on", "requires scan"],
    ["artifact-scanner", "release-gate", "feeds", "supplies scan result"],
    ["release-gate", "model-delivery", "authorizes", "approves delivery"],
    ["job-api", "identity", "depends_on", "validates token"],
    ["tenant-auth", "job-state-db", "depends_on", "checks ownership"],
    ["job-api", "audit-log", "feeds", "records request"],
    ["scheduler", "billing-meter", "feeds", "reports runtime"],
    ["scheduler", "notification-service", "feeds", "publishes state"],
    ["support-console", "job-state-db", "depends_on", "reads permitted job"],
    [
      "incident-operations",
      "status-page",
      "delivers_to",
      "approves public notice",
    ],
    ["job-platform-team", "job-api", "operated_by", "owns"],
    ["training-systems-team", "training-dispatch", "operated_by", "owns"],
  ];
  return edges.concat(
    extras.map(([sourceId, targetId, kind, label]) => ({
      id: `edge-${sourceId}-${targetId}`,
      sourceId,
      targetId,
      kind,
      label,
      optional: false,
      revision: 1,
    })),
  );
}

export const seedRepositories: RepositoryReference[] = [
  {
    id: "repo-retry-route",
    nodeId: "retry-route",
    repository: "local:hackutd",
    revision: "WORKTREE",
    path: "fixtures/northstar/retry-service.ts",
    lineStart: 1,
    revisionNumber: 1,
  },
  {
    id: "repo-tenant-test",
    nodeId: "tenant-auth",
    repository: "local:hackutd",
    revision: "WORKTREE",
    path: "fixtures/northstar/retry-service.test.ts",
    lineStart: 1,
    revisionNumber: 1,
  },
  {
    id: "repo-scheduler",
    nodeId: "scheduler",
    repository: "local:hackutd",
    revision: "WORKTREE",
    path: "fixtures/northstar/retry-service.ts",
    lineStart: 1,
    revisionNumber: 1,
  },
  {
    id: "repo-training-catalog",
    nodeId: "training-catalog",
    repository: "local:hackutd",
    revision: "WORKTREE",
    path: "apps/tether/seed.ts",
    lineStart: 1,
    revisionNumber: 1,
  },
];

export const seedGrants: ResourceGrant[] = [
  {
    id: "grant-ava-org",
    memberId: "employee-ava",
    resourceType: "organization",
    resourceId: "northstar",
    capabilities: [
      "admin",
      "directory:write",
      "graph:write",
      "grant:write",
      "incident:create",
      "incident:approve",
      "repository:read",
    ],
    revision: 1,
  },
  {
    id: "grant-noah-job",
    memberId: "employee-noah",
    resourceType: "region",
    resourceId: "job-platform",
    capabilities: [
      "graph:read",
      "node:write",
      "repository:read",
      "incident:participate",
    ],
    revision: 1,
  },
  {
    id: "grant-priya-data",
    memberId: "employee-priya",
    resourceType: "region",
    resourceId: "training",
    capabilities: [
      "graph:read",
      "node:write",
      "repository:read",
      "incident:participate",
      "task:assign",
    ],
    revision: 1,
  },
  {
    id: "grant-elena-marketing",
    memberId: "employee-elena",
    resourceType: "region",
    resourceId: "marketing",
    capabilities: ["graph:read", "notice:read"],
    revision: 1,
  },
];
