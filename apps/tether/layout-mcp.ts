import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { organizeCanvasLayout } from "./public/canvas-layout.js";
import type {
  LayoutEdge,
  LayoutNode,
  LayoutGroup,
  NodePosition,
} from "./public/canvas-layout.js";

export async function proposeCanvasLayoutViaMcp(input: {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  authorize: () => void | Promise<void>;
}): Promise<{
  positions: NodePosition[];
  groups: LayoutGroup[];
  protocolVersion: string;
  tool: "organize_canvas";
}> {
  if (
    !input.nodes.length ||
    input.nodes.length > 500 ||
    input.edges.length > 3_000
  )
    throw new Error("Choose between 1 and 500 systems to organize.");
  const ids = input.nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Layout system IDs must be unique.");
  const selected = new Set(ids);
  if (
    input.edges.some(
      (edge) =>
        !selected.has(edge.sourceId ?? edge.from ?? edge.source ?? "") ||
        !selected.has(edge.targetId ?? edge.to ?? edge.target ?? ""),
    )
  )
    throw new Error(
      "Layout connections must stay inside the selected systems.",
    );
  await input.authorize();
  const schema = z
    .object({
      organizationId: z.literal("northstar"),
      nodeIds: z.array(z.string().min(1).max(100)).min(1).max(500),
    })
    .strict();
  let calls = 0;
  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "tether-canvas-layout", version: "1.0.0" },
        {
          capabilities: { tools: {} },
          supportedProtocolVersions: ["2026-07-28"],
        },
      );
      server.registerTool(
        "organize_canvas",
        {
          description:
            "Propose an organized map for the exact authorized system snapshot. Returns positions only; cannot save, grant access or control a service.",
          inputSchema: schema,
        },
        async (args) => {
          try {
            if (++calls > 1) throw new Error("layout request already used");
            await input.authorize();
            if (
              args.nodeIds.length !== ids.length ||
              new Set(args.nodeIds).size !== ids.length ||
              args.nodeIds.some((id) => !selected.has(id))
            )
              throw new Error("layout scope changed");
            const layout = organizeCanvasLayout(input.nodes, input.edges);
            if (
              layout.positions.length !== ids.length ||
              layout.positions.some(
                (position) =>
                  !selected.has(position.id) ||
                  !Number.isFinite(position.x) ||
                  !Number.isFinite(position.y),
              )
            )
              throw new Error("invalid layout result");
            const text = JSON.stringify(layout);
            if (Buffer.byteLength(text) > 128 * 1024)
              throw new Error("layout result exceeded limit");
            return {
              content: [{ type: "text" as const, text }],
              structuredContent: { layout },
            };
          } catch {
            return {
              isError: true,
              content: [
                { type: "text" as const, text: "layout_request_rejected" },
              ],
            };
          }
        },
      );
      return server;
    },
    { legacy: "reject" },
  );
  const client = new Client(
    { name: "tether-layout-client", version: "1.0.0" },
    {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL("http://127.0.0.1/tether-layout-mcp"),
        {
          fetch: (resource, init) => handler.fetch(new Request(resource, init)),
        },
      ),
    );
    const listed = await client.listTools();
    if (
      listed.tools.length !== 1 ||
      listed.tools[0]?.name !== "organize_canvas"
    )
      throw new Error("Unexpected layout tool.");
    const response = await client.callTool(
      {
        name: "organize_canvas",
        arguments: { organizationId: "northstar", nodeIds: ids },
      },
      {
        signal: AbortSignal.timeout(5_000),
        timeout: 5_000,
      },
    );
    if (response.isError)
      throw new Error(
        "Your map could not be organized with the current access. Refresh and try again.",
      );
    const layout = (
      response.structuredContent as
        | { layout?: { positions: NodePosition[]; groups: LayoutGroup[] } }
        | undefined
    )?.layout;
    if (!layout) throw new Error("The layout tool returned no organized map.");
    await input.authorize();
    return {
      ...layout,
      protocolVersion: client.getNegotiatedProtocolVersion() ?? "unknown",
      tool: "organize_canvas",
    };
  } finally {
    await Promise.allSettled([client.close(), handler.close()]);
  }
}
