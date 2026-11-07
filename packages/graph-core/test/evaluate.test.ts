import assert from "node:assert/strict";
import test from "node:test";
import type { DependencyGroup, GraphNode } from "../../contracts/src/index.ts";
import { evaluateGraph, simulateGraph } from "../src/index.ts";

const node = (id: string, organizationId = "org_a"): GraphNode => ({
  schemaVersion: 1,
  organizationId,
  id,
  kind: "service",
  name: id,
  criticality: "high",
  revision: 1,
});
const group = (
  id: string,
  dependentNodeId: string,
  mode: "ALL" | "ANY",
  requirements: Array<{ nodeId: string; optional?: boolean }>,
): DependencyGroup => ({
  schemaVersion: 1,
  organizationId: "org_a",
  id,
  dependentNodeId,
  mode,
  requirements: requirements.map((r) => ({
    nodeId: r.nodeId,
    optional: r.optional ?? false,
  })),
  revision: 1,
});
const state = (
  availability: "satisfied" | "unsatisfied" | "unknown",
  reason: string = availability,
) => ({
  availability,
  securityTrust: "trusted" as const,
  freshness: "fresh" as const,
  reason,
});

test("ALL, ANY, optional degradation, and trust remain deterministic", () => {
  const input = {
    organizationId: "org_a",
    nodes: [
      node("operation"),
      node("primary"),
      node("backup"),
      node("optional"),
    ],
    dependencyGroups: [
      group("sources", "operation", "ANY", [
        { nodeId: "primary" },
        { nodeId: "backup" },
      ]),
      group("extras", "operation", "ALL", [
        { nodeId: "optional", optional: true },
      ]),
    ],
    baseStates: {
      primary: state("unsatisfied"),
      backup: state("satisfied"),
      optional: state("unknown"),
    },
  };
  const first = evaluateGraph(input);
  const second = evaluateGraph(input);
  assert.deepEqual(first, second);
  assert.equal(first.evaluations.operation?.availability, "satisfied");
  assert.equal(first.evaluations.operation?.degraded, true);
  assert.equal(first.evaluations.operation?.securityTrust, "trusted");
  assert.match(
    first.evaluations.operation?.reasons.join(" ") ?? "",
    /backup=satisfied/,
  );
});

test("unknown alternatives and unresolved cycles do not manufacture availability", () => {
  const alternative = evaluateGraph({
    organizationId: "org_a",
    nodes: [node("op"), node("a"), node("b")],
    dependencyGroups: [
      group("alternatives", "op", "ANY", [{ nodeId: "a" }, { nodeId: "b" }]),
    ],
    baseStates: { a: state("unsatisfied") },
  });
  assert.equal(alternative.evaluations.op?.availability, "unknown");

  const cyclic = evaluateGraph({
    organizationId: "org_a",
    nodes: [node("a"), node("b")],
    dependencyGroups: [
      group("a-needs-b", "a", "ALL", [{ nodeId: "b" }]),
      group("b-needs-a", "b", "ALL", [{ nodeId: "a" }]),
    ],
    baseStates: {},
  });
  assert.equal(cyclic.evaluations.a?.availability, "unknown");
  assert.match(cyclic.evaluations.a?.reasons.join(" ") ?? "", /cycle/);
});

test("simulation is isolated and cross-organization graph input is rejected", () => {
  const input = {
    organizationId: "org_a",
    nodes: [node("a")],
    dependencyGroups: [],
    baseStates: { a: state("satisfied") },
  };
  assert.equal(
    simulateGraph(input, { a: state("unsatisfied", "simulation") }).evaluations
      .a?.availability,
    "unsatisfied",
  );
  assert.equal(evaluateGraph(input).evaluations.a?.availability, "satisfied");
  assert.throws(
    () => evaluateGraph({ ...input, nodes: [node("a", "org_b")] }),
    /scope_mismatch/,
  );
});

test("ANY chooses one coherent alternative instead of combining trust and freshness", () => {
  const result = evaluateGraph({
    organizationId: "org_a",
    nodes: [node("operation"), node("alt_a"), node("alt_b")],
    dependencyGroups: [
      group("sources", "operation", "ANY", [
        { nodeId: "alt_a" },
        { nodeId: "alt_b" },
      ]),
    ],
    baseStates: {
      alt_a: {
        availability: "satisfied",
        securityTrust: "trusted",
        freshness: "stale",
        reason: "trusted but stale",
      },
      alt_b: {
        availability: "satisfied",
        securityTrust: "untrusted",
        freshness: "fresh",
        reason: "fresh but untrusted",
      },
    },
  });
  assert.deepEqual(
    [
      result.evaluations.operation?.securityTrust,
      result.evaluations.operation?.freshness,
    ],
    ["trusted", "stale"],
  );
});

test("inherited base-state keys are ignored and explanation paths are bounded", () => {
  const inherited = Object.create({
    constructor: state("satisfied"),
  }) as Record<string, ReturnType<typeof state>>;
  const inheritedResult = evaluateGraph({
    organizationId: "org_a",
    nodes: [node("constructor")],
    dependencyGroups: [],
    baseStates: inherited,
  });
  assert.equal(
    Object.entries(inheritedResult.evaluations).find(
      ([id]) => id === "constructor",
    )?.[1].availability,
    "unknown",
  );

  const requirements = Array.from({ length: 40 }, (_, i) => ({
    nodeId: `leaf_${i}`,
  }));
  const nodes = [
    node("operation"),
    ...requirements.map((item) => node(item.nodeId)),
  ];
  const baseStates = Object.fromEntries(
    requirements.map((item) => [item.nodeId, state("satisfied")]),
  ) as Record<string, ReturnType<typeof state>>;
  const result = evaluateGraph({
    organizationId: "org_a",
    nodes,
    dependencyGroups: [group("many", "operation", "ALL", requirements)],
    baseStates,
  });
  assert.equal(result.evaluations.operation?.paths.length, 32);
  assert.ok(
    result.evaluations.operation?.paths.every((path) => path.length <= 16),
  );
});
