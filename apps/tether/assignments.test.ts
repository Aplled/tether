import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planIncidentAssignments,
  type AssignmentInput,
} from "./assignments.ts";

function fixture(): AssignmentInput {
  return {
    incident: {
      id: "inc-1",
      title: "Manager-only incident title",
      observation: "A retry returned another tenant's job.",
    },
    semanticRevision: 4,
    analysis: { privateManagerAnalysis: "SECRET_MANAGER_CONTEXT" },
    nodes: [
      { id: "api", name: "API", description: "Tenant request handling" },
      { id: "data", name: "Data pipeline", description: "SECRET_DATA_CONTEXT" },
    ],
    existingTasks: [],
    candidates: [
      {
        id: "engineer",
        name: "Engineer",
        title: "Software engineer",
        nodeIds: ["api"],
        sourcePaths: ["apps/api"],
        nodeSourcePaths: { api: ["apps/api"] },
        availability: "available",
        active: true,
      },
      {
        id: "data-owner",
        name: "Data owner",
        title: "Data scientist",
        nodeIds: ["data"],
        sourcePaths: ["packages/data"],
        nodeSourcePaths: { data: ["packages/data"] },
        availability: "on_call",
        active: true,
      },
    ],
  };
}
const allocation = {
  ownerId: "engineer",
  nodeIds: ["api"],
  sourcePaths: ["apps/api"],
  reason: "Compare tenant ownership during retry.",
};
const draft = {
  title: "Check retry tenant ownership",
  objective:
    "Trace the retry request and compare its authenticated tenant with the job owner.",
  steps: ["Inspect apps/api for the retry handler and tenant comparison."],
  tests: ["Check same-tenant success and cross-tenant denial for retries."],
  acceptanceCriteria: [
    "Show test evidence for both tenant cases and document uncertainty.",
  ],
  unknowns: ["The relevant code and root cause have not been verified."],
};
function response(value: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { role: "assistant", content: JSON.stringify(value) } },
      ],
    }),
  );
}
async function configured(
  run: () => Promise<void>,
  key: string | null = "test-key",
) {
  const before = {
    key: process.env.NVIDIA_API_KEY,
    model: process.env.NVIDIA_MODEL,
    base: process.env.NVIDIA_BASE_URL,
    label: process.env.NVIDIA_PROVIDER_LABEL,
  };
  if (key) process.env.NVIDIA_API_KEY = key;
  else delete process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_MODEL = "nvidia/nemotron-3-nano-30b-a3b";
  process.env.NVIDIA_BASE_URL = "http://localhost:8000/v1";
  delete process.env.NVIDIA_PROVIDER_LABEL;
  try {
    await run();
  } finally {
    for (const [name, value] of Object.entries({
      NVIDIA_API_KEY: before.key,
      NVIDIA_MODEL: before.model,
      NVIDIA_BASE_URL: before.base,
      NVIDIA_PROVIDER_LABEL: before.label,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("planner chooses allocations and writer receives only recipient context; Nano semantics retained", () =>
  configured(async () => {
    const bodies: any[] = [];
    const result = await planIncidentAssignments(fixture(), {
      fetch: (async (url, init) => {
        assert.equal(url, "http://localhost:8000/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
        assert.equal(body.tools, undefined);
        return response(
          bodies.length === 1 ? { assignments: [allocation] } : draft,
        );
      }) as typeof fetch,
    });
    assert.equal(result.mode, "live");
    assert.equal(result.tasks[0]?.title, draft.title);
    assert.equal(result.tasks[0]?.provenance.provider, "Self-hosted Nemotron");
    const writer = JSON.stringify(bodies[1]);
    for (const hidden of [
      "SECRET_MANAGER_CONTEXT",
      "SECRET_DATA_CONTEXT",
      "data-owner",
      "packages/data",
      "Manager-only incident title",
      allocation.reason,
    ])
      assert.ok(!writer.includes(hidden), hidden);
    assert.ok(result.tasks[0]?.prompt.includes("cross-tenant denial"));
    assert.ok(
      result.tasks[0]?.prompt.includes(
        "External coding-agent execution is not configured",
      ),
    );
  }));

test("unconfigured fallback is useful and makes no requests", () =>
  configured(async () => {
    const result = await planIncidentAssignments(fixture(), {
      fetch: (async () => {
        throw new Error("must not run");
      }) as typeof fetch,
    });
    assert.equal(result.mode, "fallback");
    assert.equal(result.tasks.length, 2);
    assert.match(result.steps[1]!.detail, /NVIDIA_API_KEY is not configured/);
    assert.match(result.tasks[0]!.prompt, /Deterministic fallback/);
    assert.match(result.tasks[0]!.prompt, /Acceptance criteria/);
  }, null));

test("scope violations and unexpected plan fields never become model assignments", () =>
  configured(async () => {
    const invalid = [
      { ...allocation, ownerId: "unknown-person" },
      { ...allocation, nodeIds: ["unknown-node"] },
      { ...allocation, sourcePaths: ["packages/secret"] },
      { ...allocation, grantAccess: true },
      { ...allocation, reason: "Root cause is confirmed" },
    ];
    for (const value of invalid) {
      let calls = 0;
      const result = await planIncidentAssignments(fixture(), {
        fetch: (async () => {
          calls++;
          return response({ assignments: [value] });
        }) as typeof fetch,
      });
      assert.equal(calls, 1);
      assert.equal(result.mode, "fallback");
      assert.ok(result.tasks.every((t) => t.provenance.mode === "fallback"));
      assert.ok(
        result.tasks.every(
          (t) =>
            t.ownerId !== "unknown-person" &&
            !t.sourcePaths.includes("packages/secret"),
        ),
      );
    }
  }));

test("node subset paths are derived from server mappings, never another node's model path", () =>
  configured(async () => {
    const input = fixture();
    input.candidates[0]!.nodeIds.push("data");
    input.candidates[0]!.sourcePaths.push("packages/data");
    input.candidates[0]!.nodeSourcePaths!.data = ["packages/data"];
    let calls = 0;
    const result = await planIncidentAssignments(input, {
      fetch: (async () =>
        response(
          ++calls === 1
            ? {
                assignments: [
                  { ...allocation, sourcePaths: ["packages/data"] },
                ],
              }
            : draft,
        )) as typeof fetch,
    });
    assert.equal(result.mode, "live");
    assert.deepEqual(result.tasks[0]!.sourcePaths, ["apps/api"]);
    assert.ok(!result.tasks[0]!.prompt.includes("packages/data"));
  }));

test("inactive/off-hours people excluded and existing work not duplicated", () =>
  configured(async () => {
    const input = fixture();
    input.candidates[1]!.availability = "off_hours";
    input.candidates.push({
      ...input.candidates[0]!,
      id: "inactive",
      active: false,
    });
    input.existingTasks.push({
      ...allocation,
      title: "Current investigation",
      status: "investigating",
    });
    const result = await planIncidentAssignments(input);
    assert.equal(result.tasks.length, 0);
    assert.equal(result.skipped.length, 3);
  }, null));

test("draft failures are individual and model output cannot request tools or unknown paths", () =>
  configured(async () => {
    let calls = 0;
    const other = {
      ownerId: "data-owner",
      nodeIds: ["data"],
      sourcePaths: ["packages/data"],
      reason: "Review affected data path.",
    };
    const result = await planIncidentAssignments(fixture(), {
      fetch: (async () => {
        calls++;
        if (calls === 1) return response({ assignments: [allocation, other] });
        return response(
          calls === 2
            ? draft
            : { ...draft, steps: ["Read apps/secret/admin.ts"] },
        );
      }) as typeof fetch,
    });
    assert.equal(result.mode, "mixed");
    assert.equal(result.tasks[0]!.provenance.mode, "live");
    assert.equal(result.tasks[1]!.provenance.mode, "fallback");
    assert.ok(!result.tasks[1]!.prompt.includes("apps/secret"));
    const toolResult = await planIncidentAssignments(fixture(), {
      fetch: (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [{ function: { name: "execute_shell" } }],
                },
              },
            ],
          }),
        )) as typeof fetch,
    });
    assert.equal(toolResult.mode, "fallback");
  }));

test("at most two prompt writers and six tasks; excess candidates skipped", () =>
  configured(async () => {
    const input = fixture();
    input.candidates = Array.from({ length: 8 }, (_, i) => ({
      ...input.candidates[0]!,
      id: `owner-${i}`,
      nodeIds: [`api-${i}`],
      nodeSourcePaths: { [`api-${i}`]: ["apps/api"] },
    }));
    input.nodes = input.candidates.map((candidate, i) => ({
      id: `api-${i}`,
      name: `API ${i}`,
      ownerId: candidate.id,
    }));
    let active = 0,
      peak = 0,
      calls = 0;
    const result = await planIncidentAssignments(input, {
      fetch: (async () => {
        calls++;
        if (calls === 1)
          return response({
            assignments: input.candidates.slice(0, 6).map((c) => ({
              ...allocation,
              ownerId: c.id,
              nodeIds: c.nodeIds,
            })),
          });
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return response(draft);
      }) as typeof fetch,
    });
    assert.equal(result.tasks.length, 6);
    assert.equal(result.skipped.length, 2);
    assert.equal(calls, 7);
    assert.equal(peak, 2);
  }));

test("shared deadline returns fallback even when a transport ignores cancellation", () =>
  configured(async () => {
    const result = await planIncidentAssignments(fixture(), {
      deadlineMs: 5,
      fetch: (async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return response({ assignments: [allocation] });
      }) as typeof fetch,
    });
    assert.equal(result.mode, "fallback");
    assert.match(result.steps[1]!.detail, /deadline/);
  }));

test("caller cancellation propagates and never returns deliverable fallback", () =>
  configured(async () => {
    const controller = new AbortController();
    const input = fixture();
    input.signal = controller.signal;
    const pending = planIncidentAssignments(input, {
      fetch: (async () => {
        controller.abort(new Error("caller cancelled"));
        return response({ assignments: [allocation] });
      }) as typeof fetch,
    });
    await assert.rejects(pending, /caller cancelled/);
  }));

test("oversized output fails closed without leaking raw provider errors", () =>
  configured(async () => {
    const result = await planIncidentAssignments(fixture(), {
      fetch: (async () =>
        new Response("SECRET_PROVIDER_BODY".repeat(2000))) as typeof fetch,
    });
    assert.equal(result.mode, "fallback");
    assert.ok(!JSON.stringify(result).includes("SECRET_PROVIDER_BODY"));
  }));

test("duplicate planner owners merge and existing investigations are pruned before writers", () =>
  configured(async () => {
    let calls = 0;
    let result = await planIncidentAssignments(fixture(), {
      fetch: (async () =>
        response(
          ++calls === 1 ? { assignments: [allocation, allocation] } : draft,
        )) as typeof fetch,
    });
    assert.equal(result.mode, "live");
    assert.equal(result.tasks.length, 1);
    assert.match(
      result.steps.find((step) => step.stage === "scope-normalization")!.detail,
      /merged 1 repeated/,
    );
    const input = fixture();
    input.existingTasks.push({
      ...allocation,
      title: "already doing this",
      status: "assigned",
    });
    result = await planIncidentAssignments(input, {
      fetch: (async () =>
        response({ assignments: [allocation] })) as typeof fetch,
    });
    assert.equal(result.mode, "live");
    assert.equal(result.tasks.length, 0);
  }));

test("no eligible candidates truthfully reports no model run", () =>
  configured(async () => {
    const input = fixture();
    input.candidates = [];
    const result = await planIncidentAssignments(input, {
      fetch: (async () => {
        throw new Error("must not call");
      }) as typeof fetch,
    });
    assert.equal(result.provider, "not invoked");
    assert.equal(result.steps[1]?.status, "skipped");
    assert.match(result.summary, /No model request was made/);
  }));

test("ordinary technical slash wording and unknown root cause remain valid", () =>
  configured(async () => {
    let calls = 0;
    const result = await planIncidentAssignments(fixture(), {
      fetch: (async () =>
        response(
          ++calls === 1
            ? { assignments: [allocation] }
            : {
                ...draft,
                objective:
                  "The root cause is unconfirmed. Check HTTP/1.1 retry behavior and same-tenant/cross-tenant ownership.",
              },
        )) as typeof fetch,
    });
    assert.equal(result.mode, "live");
  }));

test("draft execution claims are rejected and replaced with explicitly unverified work", () =>
  configured(async () => {
    let calls = 0;
    const result = await planIncidentAssignments(fixture(), {
      fetch: (async () =>
        response(
          ++calls === 1
            ? { assignments: [allocation] }
            : { ...draft, objective: "The service has been repaired." },
        )) as typeof fetch,
    });
    assert.equal(result.tasks[0]?.provenance.mode, "fallback");
    assert.ok(!result.tasks[0]?.prompt.includes("service has been repaired"));
  }));

test("oversized server context is rejected before model transmission", () =>
  configured(async () => {
    const input = fixture();
    input.analysis = "x".repeat(100000);
    await assert.rejects(
      planIncidentAssignments(input, {
        fetch: (async () => {
          throw new Error("must not call");
        }) as typeof fetch,
      }),
      /server bounds/,
    );
  }));

function broadManager(input: AssignmentInput) {
  input.candidates.unshift({
    id: "manager",
    name: "Ava",
    title: "Senior manager",
    active: true,
    availability: "on_call",
    nodeIds: ["api", "data"],
    sourcePaths: ["apps/api", "packages/data"],
    nodeSourcePaths: { api: ["apps/api"], data: ["packages/data"] },
  });
}

test("fallback partitions by actual ownership and does not give broad manager all work", () =>
  configured(async () => {
    const input = fixture();
    broadManager(input);
    input.nodes[0]!.ownerId = "engineer";
    input.nodes[1]!.ownerId = "data-owner";
    const result = await planIncidentAssignments(input);
    assert.deepEqual(
      result.tasks.map((t) => [t.ownerId, t.nodeIds]),
      [
        ["engineer", ["api"]],
        ["data-owner", ["data"]],
      ],
    );
    assert.equal(result.tasks.flatMap((t) => t.nodeIds).length, 2);
    assert.match(result.summary, /2 of 2 incident systems/);
  }, null));

test("fallback prefers narrow relevant scope when actual node owner is unavailable", () =>
  configured(async () => {
    const input = fixture();
    broadManager(input);
    input.nodes[0]!.ownerId = "unavailable-owner";
    const result = await planIncidentAssignments(input);
    assert.equal(
      result.tasks.find((t) => t.nodeIds.includes("api"))?.ownerId,
      "engineer",
    );
    assert.ok(!result.tasks.some((t) => t.ownerId === "manager"));
  }, null));

test("actual owner preference precedes narrow scope preference", () =>
  configured(async () => {
    const input = fixture();
    broadManager(input);
    input.nodes[0]!.ownerId = "manager";
    const result = await planIncidentAssignments(input);
    assert.equal(
      result.tasks.find((t) => t.nodeIds.includes("api"))?.ownerId,
      "manager",
    );
    assert.equal(
      result.tasks.find((t) => t.nodeIds.includes("data"))?.ownerId,
      "data-owner",
    );
  }, null));

test("overlapping live proposals are explicitly arbitrated while preserving live drafts", () =>
  configured(async () => {
    const input = fixture();
    broadManager(input);
    let calls = 0;
    const result = await planIncidentAssignments(input, {
      fetch: (async () => {
        if (++calls === 1)
          return response({
            assignments: [
              {
                ...allocation,
                ownerId: "manager",
                nodeIds: ["api", "data"],
                sourcePaths: ["apps/api", "packages/data"],
              },
              allocation,
            ],
          });
        return response({
          ...draft,
          steps: ["Inspect only the permitted source for the assigned system."],
        });
      }) as typeof fetch,
    });
    assert.equal(result.mode, "live");
    assert.match(
      result.steps.find((s) => s.stage === "ownership")!.detail,
      /Removed 1 overlapping/,
    );
    assert.deepEqual(
      result.tasks.map((t) => [t.ownerId, t.nodeIds, t.sourcePaths]),
      [
        ["manager", ["data"], ["packages/data"]],
        ["engineer", ["api"], ["apps/api"]],
      ],
    );
    assert.equal(
      new Set(result.tasks.flatMap((t) => t.nodeIds)).size,
      result.tasks.flatMap((t) => t.nodeIds).length,
    );
  }));

test("unmapped incident systems are explicit in plan summary and coverage step", () =>
  configured(async () => {
    const input = fixture();
    input.nodes.push({ id: "billing", name: "Billing export" });
    input.incident.nodeIds = ["api", "data", "billing"];
    const result = await planIncidentAssignments(input);
    assert.match(result.summary, /2 of 3 incident systems/);
    assert.match(result.summary, /Not covered: Billing export/);
    assert.match(
      result.steps.find((s) => s.stage === "coverage")!.detail,
      /permitted repository paths/,
    );
  }, null));

test("another responder's existing investigation prevents duplicate node work", () =>
  configured(async () => {
    const input = fixture();
    broadManager(input);
    input.existingTasks.push({
      ownerId: "previous-responder",
      nodeIds: ["api"],
      title: "Existing retry investigation",
      status: "investigating",
    });
    const result = await planIncidentAssignments(input);
    assert.ok(result.tasks.every((t) => !t.nodeIds.includes("api")));
    assert.match(result.summary, /1 already have unfinished work/);
  }, null));

test("request token limits are bounded and harmless code fences and path punctuation parse", () =>
  configured(async () => {
    let calls = 0;
    const result = await planIncidentAssignments(fixture(), {
      fetch: (async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        assert.equal(request.max_tokens, ++calls === 1 ? 1000 : 800);
        const value =
          calls === 1
            ? { assignments: [allocation] }
            : { ...draft, steps: ["Inspect apps/api."] };
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: "```json\n" + JSON.stringify(value) + "\n```",
                },
              },
            ],
          }),
        );
      }) as typeof fetch,
    });
    assert.equal(result.mode, "live");
  }));

test("truncation, JSON and schema failures have precise safe diagnostics", () =>
  configured(async () => {
    for (const [message, finishReason, expected] of [
      ["{", "length", /token limit/],
      ["{", "stop", /complete JSON/],
      ["{}", "stop", /required assignment format/],
    ] as const) {
      const result = await planIncidentAssignments(fixture(), {
        fetch: (async () =>
          new Response(
            JSON.stringify({
              choices: [
                { finish_reason: finishReason, message: { content: message } },
              ],
            }),
          )) as typeof fetch,
      });
      assert.match(
        result.steps.find((s) => s.stage === "planner")!.detail,
        expected,
      );
    }
  }));

test("exact observed API routes are allowed as evidence without becoming repository grants", () =>
  configured(async () => {
    const input = fixture();
    input.nodes[0]!.description = "POST /api/v1/jobs/:jobId/retry";
    let calls = 0;
    const result = await planIncidentAssignments(input, {
      fetch: (async () =>
        response(
          ++calls === 1
            ? {
                assignments: [
                  {
                    ...allocation,
                    reason: "Check POST /api/v1/jobs/:jobId/retry.",
                  },
                ],
              }
            : {
                ...draft,
                steps: [
                  "Reproduce POST /api/v1/jobs/:jobId/retry with two tenant identities.",
                ],
              },
        )) as typeof fetch,
    });
    assert.equal(result.mode, "live");
    assert.deepEqual(result.tasks[0]!.sourcePaths, ["apps/api"]);
    assert.match(
      result.tasks[0]!.prompt,
      /POST \/api\/v1\/jobs\/:jobId\/retry/,
    );
  }));

test("invented API routes, other recipients' routes and filesystem paths stay rejected", () =>
  configured(async () => {
    for (const path of ["/etc/passwd", "/api/invented", "/api/private-data"]) {
      const input = fixture();
      input.nodes[0]!.description = "POST /api/v1/jobs/:jobId/retry";
      input.nodes[1]!.description = "GET /api/private-data";
      let calls = 0;
      const result = await planIncidentAssignments(input, {
        fetch: (async () =>
          response(
            ++calls === 1
              ? { assignments: [allocation] }
              : { ...draft, steps: [`Read ${path}`] },
          )) as typeof fetch,
      });
      assert.equal(result.tasks[0]!.provenance.mode, "fallback");
      assert.match(
        result.tasks[0]!.provenance.reason!,
        /unapproved repository path/,
      );
    }
  }));

test("recorded live dirname plus basename phrasing resolves only to the approved file", () =>
  configured(async () => {
    for (const [step, mode] of [
      ["Locate seed.ts in apps/tether", "live"],
      ["Read every file in apps/tether", "fallback"],
      ["Locate secret.ts in apps/tether", "fallback"],
      ["Locate seed.ts.other in apps/tether", "fallback"],
    ] as const) {
      const input = fixture();
      input.candidates[0]!.sourcePaths = ["apps/tether/seed.ts"];
      input.candidates[0]!.nodeSourcePaths = { api: ["apps/tether/seed.ts"] };
      let calls = 0;
      const result = await planIncidentAssignments(input, {
        fetch: (async () =>
          response(
            ++calls === 1
              ? {
                  assignments: [
                    { ...allocation, sourcePaths: ["apps/tether/seed.ts"] },
                  ],
                }
              : { ...draft, steps: [step] },
          )) as typeof fetch,
      });
      assert.equal(result.tasks[0]!.provenance.mode, mode);
      assert.deepEqual(result.tasks[0]!.sourcePaths, ["apps/tether/seed.ts"]);
    }
  }));

test("recorded live invented node eval example is explicitly rejected", () =>
  configured(async () => {
    let calls = 0;
    const result = await planIncidentAssignments(fixture(), {
      fetch: (async () =>
        response(
          ++calls === 1
            ? { assignments: [allocation] }
            : {
                ...draft,
                tests: [
                  "node -e \"require('fixtures/northstar/retry-service').handler({method:'POST',url:'/api/v1/jobs/123/retry'})\"",
                ],
              },
        )) as typeof fetch,
    });
    assert.equal(result.tasks[0]!.provenance.mode, "fallback");
    assert.match(
      result.tasks[0]!.provenance.reason!,
      /invented an executable example/,
    );
  }));

test("known broader node proposals are intersected while unknown owners nodes and paths fail closed", () =>
  configured(async () => {
    let calls = 0;
    const input = fixture();
    input.nodes.push({ id: "unmapped", name: "Unmapped system" });
    const requestBodies: string[] = [];
    const result = await planIncidentAssignments(input, {
      fetch: (async (_url, init) => {
        requestBodies.push(String(init?.body));
        return response(
          ++calls === 1
            ? {
                assignments: [
                  {
                    ...allocation,
                    nodeIds: ["api", "data", "unmapped"],
                    sourcePaths: ["packages/data"],
                  },
                ],
              }
            : draft,
        );
      }) as typeof fetch,
    });
    assert.equal(result.mode, "live");
    assert.deepEqual(result.tasks[0]!.nodeIds, ["api"]);
    assert.deepEqual(result.tasks[0]!.sourcePaths, ["apps/api"]);
    assert.match(
      result.steps.find((step) => step.stage === "scope-normalization")!.detail,
      /removed 2/,
    );
    assert.ok(!requestBodies[1]!.includes("packages/data"));
    assert.ok(!requestBodies[1]!.includes("SECRET_DATA_CONTEXT"));
    assert.match(result.summary, /Not covered: Unmapped system/);
  }));

test("planner may omit sourcePaths because approved paths come only from server mapping", () =>
  configured(async () => {
    let calls = 0;
    const { sourcePaths: _, ...proposal } = allocation;
    const result = await planIncidentAssignments(fixture(), {
      fetch: (async () =>
        response(
          ++calls === 1 ? { assignments: [proposal] } : draft,
        )) as typeof fetch,
    });
    assert.equal(result.mode, "live");
    assert.deepEqual(result.tasks[0]!.sourcePaths, ["apps/api"]);
  }));
