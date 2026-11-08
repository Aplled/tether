import test from "node:test";
import assert from "node:assert/strict";
import {
  organizeGraph,
  organizeCanvasLayout,
  routeEdge,
  graphSubset,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "./public/canvas-layout.js";

const nodes = [
  { id: "intake", name: "Intake", department: "Operations" },
  { id: "compute", name: "Compute", department: "Engineering" },
  { id: "queue", name: "Queue", department: "Engineering" },
  { id: "store", name: "Storage", department: "Data" },
  { id: "orphan", name: "Independent", department: "Data" },
];
const edges = [
  { id: "1", sourceId: "intake", targetId: "compute" },
  { id: "2", sourceId: "compute", targetId: "queue" },
  { id: "3", sourceId: "queue", targetId: "compute" },
  { id: "4", sourceId: "queue", targetId: "store" },
];

test("organization preserves cycles, disconnected nodes and all dependency edges without overlap", () => {
  const result = organizeGraph(nodes, edges);
  assert.equal(result.nodes.length, nodes.length);
  assert.deepEqual(result.edges, edges);
  assert.equal(result.ranks.compute, result.ranks.queue);
  assert.ok(result.ranks.intake! < result.ranks.compute!);
  assert.ok(result.ranks.queue! < result.ranks.store!);
  for (const a of result.nodes)
    for (const b of result.nodes)
      if (a.id !== b.id) {
        assert.ok(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
          `${a.id} overlaps ${b.id}`,
        );
      }
  assert.deepEqual(
    organizeCanvasLayout([...nodes].reverse(), [...edges].reverse()),
    organizeCanvasLayout(nodes, edges),
  );
  assert.ok(
    nodes.every((node) => !("x" in node)),
    "proposal must not mutate canonical state",
  );
});

test("orthogonal routes avoid unrelated cards and retain back edges", () => {
  const arranged = organizeGraph(nodes, edges).nodes;
  for (const edge of edges) {
    const points = routeEdge(edge, arranged);
    assert.ok(points.length >= 2, `edge ${edge.id} must have a route`);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      assert.ok(a.x === b.x || a.y === b.y);
      for (const node of arranged) {
        const intersects =
          a.x === b.x
            ? a.x > node.x &&
              a.x < node.x + node.width &&
              Math.max(a.y, b.y) > node.y &&
              Math.min(a.y, b.y) < node.y + node.height
            : a.y > node.y &&
              a.y < node.y + node.height &&
              Math.max(a.x, b.x) > node.x &&
              Math.min(a.x, b.x) < node.x + node.width;
        assert.equal(intersects, false, `${edge.id} crosses ${node.id}`);
      }
    }
  }
});

test("a middle card blocks a direct edge; routing goes around it", () => {
  const cards = ["a", "blocker", "b"].map((id, index) => ({
    id,
    x: index * 320,
    y: 100,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
  const points = routeEdge({ id: "ac", sourceId: "a", targetId: "b" }, cards);
  assert.ok(points.some((point) => point.y <= 88 || point.y >= 224));
  assert.deepEqual(points[0], { x: 240, y: 156 });
  assert.deepEqual(points.at(-1), { x: 640, y: 156 });
});

test("workspace and incident focus remove unrelated nodes and dangling edges", () => {
  const workspace = graphSubset(nodes, edges, {
    workspaceId: "saved-workspace",
    nodeIds: ["compute", "queue", "store"],
  });
  assert.deepEqual(
    workspace.nodes.map((node) => node.id),
    ["compute", "queue", "store"],
  );
  assert.deepEqual(
    workspace.edges.map((edge) => edge.id),
    ["2", "3", "4"],
  );
  const incident = graphSubset(nodes, edges, { focusIds: ["intake"] });
  assert.deepEqual(
    incident.nodes.map((node) => node.id),
    ["intake"],
  );
  assert.deepEqual(
    incident.edges.map((edge) => edge.id),
    [],
  );
  assert.equal(graphSubset(nodes, edges, { nodeIds: [] }).nodes.length, 0);
  assert.equal(
    graphSubset(nodes, edges, { nodeIds: [], focusIds: ["intake"] }).edges
      .length,
    0,
  );
});

test("service catalog at company scale remains deterministic and every route exists", () => {
  const catalog = Array.from({ length: 38 }, (_, i) => ({
    id: `service-${i}`,
    name: `Service ${i}`,
    department: ["Engineering", "Data", "Operations"][i % 3]!,
  }));
  const dependencies = catalog.slice(1).map((node, i) => ({
    id: `edge-${i}`,
    sourceId: catalog[Math.floor(i / 2)]!.id,
    targetId: node.id,
  }));
  const graph = organizeGraph(catalog, dependencies);
  for (const edge of dependencies)
    assert.ok(routeEdge(edge, graph.nodes).length > 1);
  assert.equal(
    new Set(graph.nodes.map((node) => `${node.x},${node.y}`)).size,
    38,
  );
});
