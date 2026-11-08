import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDemo, getModelStatus } from "./agent.ts";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test("reports and runs deterministic scripted mode without a key", async () => {
  delete process.env.NVIDIA_API_KEY;
  assert.equal(getModelStatus().configured, false);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await analyzeDemo({
    message: "contain everything immediately",
    context: { organizationId: "org-demo", incidentId: "inc-demo" },
    callTool: async (name, args) => {
      calls.push({ name, args });
      return { ok: true };
    },
  });
  assert.equal(result.mode, "scripted");
  assert.equal(calls.length, 6);
  assert.deepEqual(calls[0]?.args, {
    organizationId: "org-demo",
    incidentId: "inc-demo",
  });
  assert.match(result.recommendation, /human approval/i);
});

test("does not claim live provenance without successful tool evidence", async () => {
  process.env.NVIDIA_API_KEY = "test-key-never-logged";
  globalThis.fetch = async (_input, init) => {
    assert.equal(
      (init?.headers as Record<string, string>).authorization,
      "Bearer test-key-never-logged",
    );
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Impact reviewed.",
                steps: [],
                recommendation:
                  "Ask an authorized operator to review the proposal.",
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  const result = await analyzeDemo({ message: "review", context: {} });
  assert.equal(result.mode, "scripted");
  assert.match(result.reason ?? "", /without tool evidence/);
});

test("disables thinking only for the Brev Nemotron 3 Nano request", async () => {
  process.env.NVIDIA_API_KEY = "test-key";
  process.env.NVIDIA_MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16";
  let observed: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    observed = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Reviewed.",
                steps: [],
                recommendation: "Human review required.",
              }),
            },
          },
        ],
      }),
    );
  };
  await analyzeDemo({ message: "review", context: {} });
  assert.deepEqual(observed?.chat_template_kwargs, {
    enable_thinking: false,
  });

  process.env.NVIDIA_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b";
  await analyzeDemo({ message: "review", context: {} });
  assert.equal("chat_template_kwargs" in observed!, false);
});

test("request prompt separates seeded health from authorization evidence", async () => {
  process.env.NVIDIA_API_KEY = "test-key";
  process.env.NVIDIA_MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16";
  let observed: Record<string, any> | undefined;
  globalThis.fetch = async (_input, init) => {
    observed = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "Authorization remains unverified.",
                steps: [],
                recommendation:
                  "Reproduce both same-tenant and cross-tenant retry requests.",
              }),
            },
          },
        ],
      }),
    );
  };
  await analyzeDemo({
    message: "A cross-tenant retry was accepted.",
    context: { organizationId: "northstar", incidentId: "incident-retry" },
  });
  const system =
    observed?.messages?.find((entry: any) => entry.role === "system")
      ?.content ?? "";
  assert.match(
    system,
    /healthy availability.*do not verify tenant authorization/i,
  );
  assert.match(
    system,
    /cannot rule out a reported authorization-boundary defect/i,
  );
  assert.match(system, /same-tenant and cross-tenant requests/i);
  assert.match(
    system,
    /authenticated tenant with the job owner before dispatch/i,
  );
  assert.match(system, /nonempty relevant override/i);
  assert.match(system, /Acquire incident evidence before concluding/i);
  assert.equal(observed?.tool_choice, "required");
  const simulation = observed?.tools?.find(
    (entry: any) => entry.function?.name === "simulate_containment",
  );
  assert.match(
    simulation?.function?.description ?? "",
    /evidence-linked containment hypothesis/i,
  );
  assert.match(
    simulation?.function?.description ?? "",
    /leave the simulation uncertain/i,
  );
});

test("requires initial tool evidence then allows synthesis after a bounded tool result", async () => {
  process.env.NVIDIA_API_KEY = "test-key";
  const choices: unknown[] = [];
  let request = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    choices.push(body.tool_choice);
    request += 1;
    if (request === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "incident-evidence",
                    type: "function",
                    function: { name: "get_incident", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      );
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary:
                  "The reported authorization condition remains under investigation.",
                steps: [],
                recommendation:
                  "Verify tenant ownership before retry dispatch.",
              }),
            },
          },
        ],
      }),
    );
  };
  const result = await analyzeDemo({
    message: "Investigate a reported cross-tenant retry.",
    context: { organizationId: "northstar", incidentId: "incident-retry" },
    callTool: async () => ({ observation: "Cross-tenant retry was reported." }),
  });
  assert.equal(result.mode, "live");
  assert.deepEqual(choices, ["required", "auto"]);
  assert.equal(result.steps[0]?.tool, "get_incident");
});

test("injects trusted scope and rejects model-supplied scope", async () => {
  process.env.NVIDIA_API_KEY = "test-key";
  let request = 0;
  globalThis.fetch = async () => {
    request += 1;
    if (request === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "one",
                    type: "function",
                    function: {
                      name: "get_incident",
                      arguments:
                        '{"organizationId":"attacker","incidentId":"other"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '{"summary":"Reviewed","steps":[{"tool":"get_incident","status":"observed","detail":"Scoped evidence returned"}],"recommendation":"Human review required"}',
            },
          },
        ],
      }),
    );
  };
  let observed: Record<string, unknown> | undefined;
  const result = await analyzeDemo({
    message: "review",
    context: { organizationId: "trusted-org", incidentId: "trusted-incident" },
    callTool: async (_name, args) => {
      observed = args;
      return { incident: "fictional" };
    },
  });
  assert.equal(result.mode, "live");
  assert.equal(result.provider, "NVIDIA NIM");
  assert.equal(result.steps[0]?.detail.includes("fictional"), true);
  assert.deepEqual(observed, {
    organizationId: "trusted-org",
    incidentId: "trusted-incident",
  });
});

test("labels a successful loopback vLLM response as self-hosted", async () => {
  process.env.NVIDIA_API_KEY = "test-key";
  process.env.NVIDIA_BASE_URL = "http://127.0.0.1:8000/v1";
  process.env.NVIDIA_MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16";
  let request = 0;
  globalThis.fetch = async () => {
    request += 1;
    return request === 1
      ? new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "one",
                      type: "function",
                      function: { name: "get_incident", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
        )
      : new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"summary":"Reviewed","steps":[],"recommendation":"Human review required"}',
                },
              },
            ],
          }),
        );
  };
  const result = await analyzeDemo({
    message: "review",
    context: { organizationId: "northstar", incidentId: "incident-retry" },
    callTool: async () => ({ observed: true }),
  });
  assert.equal(result.mode, "live");
  assert.equal(result.provider, "Self-hosted Nemotron");
});

test("shares the six-call budget with fallback and redacts callback errors", async () => {
  process.env.NVIDIA_API_KEY = "test-key";
  let request = 0;
  globalThis.fetch = async () => {
    request += 1;
    if (request === 1) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "one",
                    type: "function",
                    function: {
                      name: "get_incident",
                      arguments: "{}",
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    }
    return new Response("not-json", { status: 200 });
  };
  let calls = 0;
  const result = await analyzeDemo({
    message: "review",
    context: { organizationId: "org", incidentId: "incident" },
    callTool: async () => {
      calls += 1;
      if (calls > 1) throw new Error("secret=never-return-this");
      return { ok: true };
    },
  });
  assert.equal(result.mode, "scripted");
  assert.equal(calls, 6);
  assert.equal(JSON.stringify(result).includes("never-return-this"), false);
});

test("falls back on provider failure without claiming live mode", async () => {
  process.env.NVIDIA_API_KEY = "test-key";
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  const result = await analyzeDemo({ message: "review", context: {} });
  assert.equal(result.mode, "scripted");
  assert.match(result.reason ?? "", /HTTP 503/);
  assert.equal(
    result.steps.every((step) => step.status === "fixture"),
    true,
  );
});

test("bounds provider bodies before buffering and rejects execution claims", async () => {
  process.env.NVIDIA_API_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(new Uint8Array(33 * 1024).fill(120), { status: 200 });
  const oversized = await analyzeDemo({ message: "review", context: {} });
  assert.equal(oversized.mode, "scripted");
  assert.match(oversized.reason ?? "", /output exceeded limit/);

  let request = 0;
  globalThis.fetch = async () => {
    request += 1;
    return request === 1
      ? new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "one",
                      type: "function",
                      function: { name: "get_incident", arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          }),
        )
      : new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Containment succeeded and was executed.",
                    steps: [],
                    recommendation: "Done",
                  }),
                },
              },
            ],
          }),
        );
  };
  const malicious = await analyzeDemo({
    message: "review",
    context: { organizationId: "org", incidentId: "incident" },
    callTool: async () => ({ fictional: true }),
  });
  assert.equal(malicious.mode, "scripted");
  assert.match(malicious.reason ?? "", /unsupported authority/);
});

test("propagates abort into an active tool callback and leaves no pending work", async () => {
  delete process.env.NVIDIA_API_KEY;
  const controller = new AbortController();
  let settled = false;
  const running = analyzeDemo({
    message: "review",
    context: { organizationId: "org", incidentId: "incident" },
    signal: controller.signal,
    callTool: async (_name, _args, options) => {
      assert.ok(options?.signal);
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 30_000);
      try {
        await new Promise<void>((resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(options.signal.reason),
            { once: true },
          );
        });
      } finally {
        settled = true;
      }
    },
  });
  controller.abort(new DOMException("cancelled", "AbortError"));
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(settled, true);
});
