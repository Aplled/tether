import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolve } from "node:path";

export async function connectBoundedMcp(input: {
  authorityConfigPath: string;
  credential: string;
}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("apps/mcp-server/index.ts")],
    cwd: resolve("."),
    env: {
      HACKUTD_AUTHORITY_CONFIG: input.authorityConfigPath,
      HACKUTD_MCP_CREDENTIAL: input.credential,
    },
    stderr: "pipe",
    maxBufferSize: 1024 * 1024,
  });
  const client = new Client(
    { name: "hackutd-bounded-client", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(transport);
  return {
    client,
    transport,
    protocolVersion: client.getNegotiatedProtocolVersion(),
    protocolEra: client.getProtocolEra(),
    async close() {
      await client.close();
    },
  };
}

export function toolResultValue(result: any): any {
  if (result?.isError === true)
    throw new Error(
      result?.content?.find((item: any) => item.type === "text")?.text ??
        "MCP tool returned an error",
    );
  if (result?.structuredContent && "result" in result.structuredContent)
    return result.structuredContent.result;
  const text = result?.content?.find((item: any) => item.type === "text")?.text;
  return text ? JSON.parse(text) : undefined;
}
