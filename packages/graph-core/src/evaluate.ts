import type {
  DependencyGroup,
  DependencyState,
  FreshnessState,
  GraphNode,
  NodeEvaluation,
  TrustState,
} from "../../contracts/src/index.ts";

export type BaseNodeState = {
  availability: DependencyState;
  securityTrust: TrustState;
  freshness: FreshnessState;
  reason: string;
};

export type EvaluateGraphInput = {
  organizationId: string;
  nodes: GraphNode[];
  dependencyGroups: DependencyGroup[];
  baseStates: Readonly<Record<string, BaseNodeState>>;
};

export type GraphEvaluation = {
  organizationId: string;
  algorithmVersion: "dependency-v1";
  graphRevision: number;
  evaluations: Readonly<Record<string, NodeEvaluation>>;
};

const trustRank: Record<TrustState, number> = {
  untrusted: 0,
  unknown: 1,
  trusted: 2,
};
const freshnessRank: Record<FreshnessState, number> = {
  stale: 0,
  unknown: 1,
  fresh: 2,
};

function weakest<T extends string>(
  values: T[],
  ranks: Record<T, number>,
  fallback: T,
): T {
  if (values.length === 0) return fallback;
  return values.reduce((a, b) => (ranks[a] <= ranks[b] ? a : b));
}

function strongest<T extends string>(
  values: T[],
  ranks: Record<T, number>,
  fallback: T,
): T {
  if (values.length === 0) return fallback;
  return values.reduce((a, b) => (ranks[a] >= ranks[b] ? a : b));
}

function availabilityFor(
  mode: "ALL" | "ANY",
  values: DependencyState[],
): DependencyState {
  if (mode === "ALL") {
    if (values.includes("unsatisfied")) return "unsatisfied";
    if (values.includes("unknown")) return "unknown";
    return "satisfied";
  }
  if (values.includes("satisfied")) return "satisfied";
  if (values.includes("unknown")) return "unknown";
  return "unsatisfied";
}

function validateScope(input: EvaluateGraphInput): void {
  const nodeIds = new Set<string>();
  for (const node of input.nodes) {
    if (node.organizationId !== input.organizationId)
      throw new Error(`scope_mismatch:node:${node.id}`);
    if (nodeIds.has(node.id)) throw new Error(`duplicate_node:${node.id}`);
    nodeIds.add(node.id);
  }
  for (const group of input.dependencyGroups) {
    if (group.organizationId !== input.organizationId)
      throw new Error(`scope_mismatch:group:${group.id}`);
    if (!nodeIds.has(group.dependentNodeId))
      throw new Error(`missing_dependent:${group.dependentNodeId}`);
    for (const requirement of group.requirements) {
      if (!nodeIds.has(requirement.nodeId))
        throw new Error(`missing_requirement:${requirement.nodeId}`);
    }
  }
  for (const nodeId of Object.keys(input.baseStates)) {
    if (!nodeIds.has(nodeId))
      throw new Error(`base_state_unknown_node:${nodeId}`);
  }
}

function baseFor(
  input: EvaluateGraphInput,
  nodeId: string,
): BaseNodeState | undefined {
  return Object.hasOwn(input.baseStates, nodeId)
    ? input.baseStates[nodeId]
    : undefined;
}

function sameEvaluation(a: NodeEvaluation, b: NodeEvaluation): boolean {
  return (
    a.availability === b.availability &&
    a.securityTrust === b.securityTrust &&
    a.freshness === b.freshness &&
    a.degraded === b.degraded
  );
}

function boundedPaths(paths: string[][]): string[][] {
  const unique = new Map<string, string[]>();
  for (const path of paths) {
    const bounded = path.slice(0, 16);
    unique.set(bounded.join("\u0000"), bounded);
  }
  return [...unique.values()]
    .sort((a, b) => a.join("/").localeCompare(b.join("/")))
    .slice(0, 32);
}

export function evaluateGraph(input: EvaluateGraphInput): GraphEvaluation {
  validateScope(input);
  const nodes = [...input.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const groupsByNode = new Map<string, DependencyGroup[]>();
  for (const group of [...input.dependencyGroups].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const list = groupsByNode.get(group.dependentNodeId) ?? [];
    list.push(group);
    groupsByNode.set(group.dependentNodeId, list);
  }

  let current: Record<string, NodeEvaluation> = Object.create(null) as Record<
    string,
    NodeEvaluation
  >;
  for (const node of nodes) {
    const base = baseFor(input, node.id);
    current[node.id] = {
      nodeId: node.id,
      availability: base?.availability ?? "unknown",
      securityTrust: base?.securityTrust ?? "unknown",
      freshness: base?.freshness ?? "unknown",
      degraded: false,
      reasons: [
        base?.reason ?? "No external evidence or resolved dependency basis",
      ],
      paths: [[node.id]],
    };
  }

  const maxIterations = Math.max(1, nodes.length * 2);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const next: Record<string, NodeEvaluation> = Object.create(null) as Record<
      string,
      NodeEvaluation
    >;
    let changed = false;
    for (const node of nodes) {
      const base = baseFor(input, node.id);
      const groups = groupsByNode.get(node.id) ?? [];
      if (groups.length === 0) {
        next[node.id] = current[node.id]!;
        continue;
      }

      const groupResults = groups.map((group) => {
        const required = group.requirements.filter((r) => !r.optional);
        const optional = group.requirements.filter((r) => r.optional);
        const requiredEvaluations = required.map((r) => current[r.nodeId]!);
        const availability =
          required.length === 0
            ? ("satisfied" as const)
            : availabilityFor(
                group.mode,
                requiredEvaluations.map((e) => e.availability),
              );
        const candidates = required.map((requirement, index) => ({
          requirement,
          evaluation: requiredEvaluations[index]!,
        }));
        const viable =
          availability === "satisfied"
            ? candidates.filter(
                (candidate) =>
                  candidate.evaluation.availability === "satisfied",
              )
            : availability === "unknown"
              ? candidates.filter(
                  (candidate) =>
                    candidate.evaluation.availability === "unknown",
                )
              : candidates;
        const coherentAnyCandidate = [...viable].sort((a, b) => {
          const aJoint = Math.min(
            trustRank[a.evaluation.securityTrust],
            freshnessRank[a.evaluation.freshness],
          );
          const bJoint = Math.min(
            trustRank[b.evaluation.securityTrust],
            freshnessRank[b.evaluation.freshness],
          );
          if (aJoint !== bJoint) return bJoint - aJoint;
          const aSum =
            trustRank[a.evaluation.securityTrust] +
            freshnessRank[a.evaluation.freshness];
          const bSum =
            trustRank[b.evaluation.securityTrust] +
            freshnessRank[b.evaluation.freshness];
          return aSum !== bSum
            ? bSum - aSum
            : a.requirement.nodeId.localeCompare(b.requirement.nodeId);
        })[0];
        const selected =
          group.mode === "ANY"
            ? coherentAnyCandidate
              ? [coherentAnyCandidate.evaluation]
              : []
            : requiredEvaluations;
        const securityTrust =
          required.length === 0
            ? ("trusted" as const)
            : group.mode === "ANY"
              ? strongest(
                  selected.map((e) => e.securityTrust),
                  trustRank,
                  "unknown",
                )
              : weakest(
                  selected.map((e) => e.securityTrust),
                  trustRank,
                  "unknown",
                );
        const freshness =
          required.length === 0
            ? ("fresh" as const)
            : group.mode === "ANY"
              ? strongest(
                  selected.map((e) => e.freshness),
                  freshnessRank,
                  "unknown",
                )
              : weakest(
                  selected.map((e) => e.freshness),
                  freshnessRank,
                  "unknown",
                );
        const degraded = optional.some(
          (r) => current[r.nodeId]!.availability !== "satisfied",
        );
        const reasonParts = required.map(
          (r) => `${r.nodeId}=${current[r.nodeId]!.availability}`,
        );
        const optionalParts = optional.map(
          (r) => `${r.nodeId}=${current[r.nodeId]!.availability}(optional)`,
        );
        const paths = boundedPaths(
          selected.flatMap((e) =>
            e.paths.map((path) => {
              const cycleAt = path.indexOf(node.id);
              return cycleAt >= 0
                ? [node.id, ...path.slice(0, cycleAt + 1)]
                : [node.id, ...path];
            }),
          ),
        );
        return {
          availability,
          securityTrust,
          freshness,
          degraded,
          reason: `${group.id}[${group.mode}]: ${[...reasonParts, ...optionalParts].join(", ")}`,
          paths,
        };
      });

      let availability = availabilityFor(
        "ALL",
        groupResults.map((r) => r.availability),
      );
      let securityTrust = weakest(
        groupResults.map((r) => r.securityTrust),
        trustRank,
        "unknown",
      );
      let freshness = weakest(
        groupResults.map((r) => r.freshness),
        freshnessRank,
        "unknown",
      );
      if (base) {
        availability = availabilityFor("ALL", [
          base.availability,
          availability,
        ]);
        securityTrust = weakest(
          [base.securityTrust, securityTrust],
          trustRank,
          "unknown",
        );
        freshness = weakest(
          [base.freshness, freshness],
          freshnessRank,
          "unknown",
        );
      }
      const candidate: NodeEvaluation = {
        nodeId: node.id,
        availability,
        securityTrust,
        freshness,
        degraded: groupResults.some((r) => r.degraded),
        reasons: [
          ...(base ? [base.reason] : []),
          ...groupResults.map((r) => r.reason),
        ].sort(),
        paths: boundedPaths(groupResults.flatMap((r) => r.paths)),
      };
      next[node.id] = candidate;
      if (!sameEvaluation(candidate, current[node.id]!)) changed = true;
    }
    current = next;
    if (!changed) {
      break;
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const group of input.dependencyGroups) {
    adjacency
      .get(group.dependentNodeId)!
      .push(
        ...group.requirements.filter((r) => !r.optional).map((r) => r.nodeId),
      );
  }
  const isCyclic = (start: string): boolean => {
    const seen = new Set<string>();
    const pending = [...(adjacency.get(start) ?? [])];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (id === start) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(adjacency.get(id) ?? []));
    }
    return false;
  };
  for (const node of nodes) {
    if (
      !baseFor(input, node.id) &&
      isCyclic(node.id) &&
      current[node.id]!.availability === "unknown" &&
      !current[node.id]!.reasons.some((reason) => reason.includes("cycle"))
    ) {
      current[node.id] = {
        ...current[node.id]!,
        reasons: [
          ...current[node.id]!.reasons,
          "Unresolved dependency cycle; no trusted external basis",
        ].sort(),
      };
    }
  }

  const graphRevision =
    input.nodes.reduce((sum, node) => sum + node.revision, 0) +
    input.dependencyGroups.reduce((sum, group) => sum + group.revision, 0);
  return {
    organizationId: input.organizationId,
    algorithmVersion: "dependency-v1",
    graphRevision,
    evaluations: current,
  };
}

export function simulateGraph(
  input: EvaluateGraphInput,
  overrides: Readonly<Record<string, BaseNodeState>>,
): GraphEvaluation {
  return evaluateGraph({
    ...input,
    baseStates: { ...input.baseStates, ...overrides },
  });
}
