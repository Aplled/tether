#!/usr/bin/env node
import {
  connectBoundedMcp,
  toolResultValue,
} from "../apps/agent-runtime/mcp-client.ts";

const configIndex = process.argv.indexOf("--config"),
  toolIndex = process.argv.indexOf("--tool"),
  argsIndex = process.argv.indexOf("--args");
const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : undefined,
  tool = toolIndex >= 0 ? process.argv[toolIndex + 1] : undefined,
  credential = process.env.HACKUTD_MCP_CREDENTIAL;
if (!configPath || !tool || !credential)
  throw new Error(
    "usage: HACKUTD_MCP_CREDENTIAL=<private> node scripts/mcp-tool.ts --config <path> --tool <name|list> [--args <json>]",
  );
const connection = await connectBoundedMcp({
  authorityConfigPath: configPath,
  credential,
});
try {
  if (tool === "list") {
    const listed = await connection.client.listTools();
    process.stdout.write(
      `${JSON.stringify({ protocolVersion: connection.protocolVersion, protocolEra: connection.protocolEra, tools: listed.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }, null, 2)}\n`,
    );
  } else {
    const args =
      argsIndex >= 0 && process.argv[argsIndex + 1]
        ? JSON.parse(process.argv[argsIndex + 1]!)
        : {};
    const result = await connection.client.callTool({
      name: tool,
      arguments: args,
    });
    process.stdout.write(
      `${JSON.stringify({ protocolVersion: connection.protocolVersion, protocolEra: connection.protocolEra, result: toolResultValue(result) }, null, 2)}\n`,
    );
  }
} finally {
  await connection.close();
}
