export type DemoNode = { id: string; kind: string; name: string; x: number; y: number; status: string; criticality: string; ownerId: string; description?: string };
export type DemoEdge = { id: string; source: string; target: string; kind: string; label: string };
export type DemoPerson = { id: string; name: string; initials: string; role: string; canApprove: boolean };
export type DemoTask = { id: string; title: string; ownerId: string; state: string };
export type DemoMessage = { id: string; text: string; actorId: string; createdAt: string; channel: string };
export type TimelineItem = { id: string; title: string; detail: string; createdAt: string; kind: string };
export type DemoProposal = { id: string; title: string; summary: string; steps: Array<{ tool: string; status: string; detail: string }>; mode: string; requiresApproval: boolean; actionDigest?: string };
export type DemoState = {
  workspace: { id: string; name: "Northstar Compute" };
  revision: number;
  source: "live-backend" | "fixture-preview";
  nodes: DemoNode[];
  edges: DemoEdge[];
  people: DemoPerson[];
  incident: { id: string; title: string; status: string; summary: string; affectedNodeIds: string[] } | null;
  tasks: DemoTask[];
  messages: DemoMessage[];
  timeline: TimelineItem[];
  proposal: DemoProposal | null;
  model: { configured: boolean; model: string; mode: string; lastError?: string };
  mesh: { status: string; label: string; proofSummary?: string };
};

export type DemoAction = { type: string; payload?: Record<string, unknown> };
