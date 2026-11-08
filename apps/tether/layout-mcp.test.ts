import assert from "node:assert/strict";
import test from "node:test";
import { proposeCanvasLayoutViaMcp } from "./layout-mcp.ts";

test("real layout MCP proposes every scoped system without changing its source snapshot", async () => {
  const nodes = [
    { id: "retry", name: "Retry request", departmentName: "Software" },
    { id: "owner", name: "Check job owner", departmentName: "Software" },
    { id: "queue", name: "Waiting jobs", departmentName: "Operations" },
  ];
  const edges = [
    { id: "ownership", sourceId: "owner", targetId: "retry" },
    { id: "dispatch", sourceId: "retry", targetId: "queue" },
  ];
  const before = JSON.stringify({ nodes, edges });
  let checks = 0;
  const proposal = await proposeCanvasLayoutViaMcp({
    nodes,
    edges,
    authorize: () => {
      checks += 1;
    },
  });
  assert.equal(proposal.protocolVersion, "2026-07-28");
  assert.equal(proposal.tool, "organize_canvas");
  assert.deepEqual(proposal.positions.map((position) => position.id).sort(), [
    "owner",
    "queue",
    "retry",
  ]);
  assert.equal(JSON.stringify({ nodes, edges }), before);
  assert.equal(checks, 3);
  assert.ok(proposal.groups.some((group) => group.name === "Software"));
});

test("layout MCP rejects lost authority and an edge outside the selected scope", async () => {
  let checks = 0;
  await assert.rejects(
    proposeCanvasLayoutViaMcp({
      nodes: [{ id: "allowed" }],
      edges: [],
      authorize: () => {
        if (++checks > 1) throw new Error("revoked");
      },
    }),
    /current access/,
  );
  await assert.rejects(
    proposeCanvasLayoutViaMcp({
      nodes: [{ id: "allowed" }],
      edges: [{ id: "hidden", sourceId: "allowed", targetId: "hidden" }],
      authorize: () => {},
    }),
    /inside the selected/,
  );
});
