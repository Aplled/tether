#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { ProposalSchema } from "../../packages/contracts/src/index.ts";
import { ApplicationAuthority } from "../authority/index.ts";

const configPath = process.env.HACKUTD_AUTHORITY_CONFIG;
const credential = process.env.HACKUTD_MCP_CREDENTIAL;
if (!configPath || !credential)
  throw new Error("private authority context is required");

const scope = z
  .object({
    organizationId: z.string().min(1).max(120),
    incidentId: z.string().min(1).max(160),
  })
  .strict();
const simulation = scope
  .extend({
    overrides: z
      .record(
        z.string(),
        z
          .object({
            availability: z.enum(["satisfied", "unsatisfied", "unknown"]),
            securityTrust: z.enum(["trusted", "untrusted", "unknown"]),
            freshness: z.enum(["fresh", "stale", "unknown"]),
            reason: z.string().min(1).max(500),
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length <= 64, "too many overrides"),
  })
  .strict();
function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: { result: value } as any,
  };
}
function guarded<T extends Record<string, unknown>>(
  callback: (input: T) => unknown | Promise<unknown>,
) {
  return async (input: T) => {
    try {
      return result(await callback(input));
    } catch {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "request_rejected" }],
      };
    }
  };
}

serveStdio(
  async () => {
    const authority = await ApplicationAuthority.open(configPath);
    const principal = authority.authenticate(credential);
    const server = new McpServer(
      { name: "hackutd-bounded-response", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    server.registerTool(
      "get_incident",
      {
        description: "Read one incident in the authenticated fixed scope.",
        inputSchema: scope,
      },
      guarded((input) =>
        authority.incident(principal, input.organizationId, input.incidentId),
      ),
    );
    server.registerTool(
      "get_incident_timeline",
      {
        description: "Read the persisted incident event timeline.",
        inputSchema: scope,
      },
      guarded((input) =>
        authority.timeline(principal, input.organizationId, input.incidentId),
      ),
    );
    server.registerTool(
      "get_dependencies",
      {
        description:
          "Read the bounded dependency graph for the incident organization.",
        inputSchema: scope,
      },
      guarded((input) =>
        authority.dependencies(
          principal,
          input.organizationId,
          input.incidentId,
        ),
      ),
    );
    server.registerTool(
      "analyze_incident_impact",
      {
        description:
          "Run deterministic impact evaluation without side effects.",
        inputSchema: scope,
      },
      guarded((input) =>
        authority.analyze(principal, input.organizationId, input.incidentId),
      ),
    );
    server.registerTool(
      "simulate_containment",
      {
        description:
          "Run deterministic graph simulation without creating or executing an action.",
        inputSchema: simulation,
      },
      guarded((input) =>
        authority.simulate(
          principal,
          input.organizationId,
          input.incidentId,
          input.overrides,
        ),
      ),
    );
    server.registerTool(
      "list_fallback_plans",
      { description: "Read scoped fallback plans.", inputSchema: scope },
      guarded((input) =>
        authority.fallbacks(principal, input.organizationId, input.incidentId),
      ),
    );
    server.registerTool(
      "list_response_tasks",
      { description: "Read scoped response tasks.", inputSchema: scope },
      guarded((input) =>
        authority.tasks(principal, input.organizationId, input.incidentId),
      ),
    );
    server.registerTool(
      "submit_response_proposal",
      {
        description:
          "Store a strict evidence-linked proposal. This never approves or executes it.",
        inputSchema: ProposalSchema,
      },
      guarded((input) => authority.submitProposal(principal, input)),
    );
    const originalClose = server.close.bind(server);
    server.close = async () => {
      authority.close();
      await originalClose();
    };
    return server;
  },
  { legacy: "reject" },
);
