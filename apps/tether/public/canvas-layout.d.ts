export interface LayoutNode {
  id: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  departmentName?: string;
  department?: string;
  groupId?: string;
  regionName?: string;
  regionId?: string;
  workspaceId?: string;
  workspaceIds?: string[];
}
export interface LayoutEdge {
  id: string;
  sourceId?: string;
  targetId?: string;
  from?: string;
  to?: string;
  source?: string;
  target?: string;
}
export interface NodePosition {
  id: string;
  x: number;
  y: number;
}
export interface LayoutGroup {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}
export const NODE_WIDTH: number;
export const NODE_HEIGHT: number;
export function edgeSource(edge: LayoutEdge): string | undefined;
export function edgeTarget(edge: LayoutEdge): string | undefined;
export function laneName(node: LayoutNode): string;
export function organizeGraph<N extends LayoutNode, E extends LayoutEdge>(
  nodes: N[],
  edges: E[],
): {
  nodes: Array<N & { x: number; y: number; width: number; height: number }>;
  edges: E[];
  groups: LayoutGroup[];
  ranks: Record<string, number>;
};
export function organizeCanvasLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): { positions: NodePosition[]; groups: LayoutGroup[] };
export function routeEdge(
  edge: LayoutEdge,
  nodes: LayoutNode[],
): Array<{ x: number; y: number }>;
export function graphSubset<N extends LayoutNode, E extends LayoutEdge>(
  nodes: N[],
  edges: E[],
  filter?: {
    workspaceId?: string;
    nodeIds?: string[] | null;
    focusIds?: string[] | null;
  },
): { nodes: N[]; edges: E[] };
