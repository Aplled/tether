import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

export const COMPANY_MCP_TOOLS = [
  "get_incident",
  "get_incident_timeline",
  "get_dependencies",
  "analyze_incident_impact",
  "simulate_containment",
  "list_fallback_plans",
  "list_response_tasks",
] as const;
export type CompanyMcpTool = (typeof COMPANY_MCP_TOOLS)[number];
const allowed = new Set<string>(COMPANY_MCP_TOOLS);
const MAX_OUTPUT_BYTES = 32 * 1024,
  MAX_CALLS = 6,
  DEADLINE_MS = 30_000;
const scope = z
  .object({
    organizationId: z.literal("northstar"),
    incidentId: z.string().min(1).max(160),
  })
  .strict();
const simulation = scope
  .extend({
    overrides: z
      .record(
        z.string().min(1).max(100),
        z
          .object({
            availability: z.enum(["satisfied", "unsatisfied", "unknown"]),
            securityTrust: z.enum(["trusted", "untrusted", "unknown"]),
            freshness: z.enum(["fresh", "stale", "unknown"]),
            reason: z.string().min(1).max(500),
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length <= 50),
  })
  .strict();
function result(value: unknown) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_OUTPUT_BYTES)
    throw new Error("MCP tool output exceeded 32 KiB");
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { result: value } as any,
  };
}

export async function createCompanyMcpSession(input: {
  organizationId: "northstar";
  incidentId: string;
  invoke: (
    name: CompanyMcpTool,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<unknown>;
}): Promise<{
  protocolVersion: string | undefined;
  tools: readonly string[];
  callTool: (
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ) => Promise<unknown>;
  close: () => Promise<void>;
}> {
  const buildServer = () => {
    const server = new McpServer(
      { name: "tether-company-tools", version: "0.1.0" },
      {
        capabilities: { tools: {} },
        supportedProtocolVersions: ["2026-07-28"],
      },
    );
    const register = (
      name: CompanyMcpTool,
      schema: typeof scope | typeof simulation,
    ) =>
      server.registerTool(
        name,
        {
          description: `Bounded company incident tool: ${name}`,
          inputSchema: schema,
        },
        async (args: Record<string, unknown>, ctx: ServerContext) => {
          try {
            return result(await input.invoke(name, args, ctx.mcpReq.signal));
          } catch {
            return {
              isError: true,
              content: [{ type: "text" as const, text: "request_rejected" }],
            };
          }
        },
      );
    for (const name of COMPANY_MCP_TOOLS)
      register(name, name === "simulate_containment" ? simulation : scope);
    return server;
  };
  const handler = createMcpHandler(() => buildServer(), { legacy: "reject" });
  const clientTransport = new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1/tether-company-mcp"),
    { fetch: (resource, init) => handler.fetch(new Request(resource, init)) },
  );
  const client = new Client(
    { name: "tether-company-client", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(clientTransport);
  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  if (
    toolNames.length !== COMPANY_MCP_TOOLS.length ||
    toolNames.some((name) => !allowed.has(name))
  )
    throw new Error("company MCP tool allowlist mismatch");
  let calls = 0,
    closed = false;
  const deadline = Date.now() + DEADLINE_MS;
  return {
    protocolVersion: client.getNegotiatedProtocolVersion(),
    tools: toolNames,
    async callTool(name, args, options = {}) {
      if (closed) throw new Error("company MCP session is closed");
      if (!allowed.has(name)) throw new Error("MCP tool is not allowed");
      if (++calls > MAX_CALLS)
        throw new Error("company MCP tool-call budget exceeded");
      const remaining = Math.min(
        options.timeoutMs ?? DEADLINE_MS,
        deadline - Date.now(),
      );
      if (remaining <= 0)
        throw new DOMException("company MCP deadline", "TimeoutError");
      const signal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(remaining)])
        : AbortSignal.timeout(remaining);
      const response = await client.callTool(
        {
          name,
          arguments: {
            ...args,
            organizationId: input.organizationId,
            incidentId: input.incidentId,
          },
        },
        { signal, timeout: remaining },
      );
      if (response.isError) throw new Error("company MCP request rejected");
      const value = (
        response.structuredContent as { result?: unknown } | undefined
      )?.result;
      const text = response.content.find((item) => item.type === "text")?.text;
      const output = value ?? (text ? JSON.parse(text) : undefined);
      if (Buffer.byteLength(JSON.stringify(output)) > MAX_OUTPUT_BYTES)
        throw new Error("MCP tool output exceeded 32 KiB");
      return output;
    },
    async close() {
      if (closed) return;
      closed = true;
      await client.close();
      await handler.close();
    },
  };
}
