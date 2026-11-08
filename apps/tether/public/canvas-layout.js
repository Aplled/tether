/** Deterministic service-flow layout. Cycles are kept as strongly connected groups. */
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 112;
export const edgeSource = (edge) => edge.sourceId ?? edge.from ?? edge.source;
export const edgeTarget = (edge) => edge.targetId ?? edge.to ?? edge.target;
export const laneName = (node) =>
  node.departmentName ||
  node.department ||
  node.groupId ||
  node.regionName ||
  node.regionId ||
  "Services";
const compare = (a, b) => String(a).localeCompare(String(b), "en");

export function organizeGraph(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ids = [...byId.keys()].sort(compare);
  const adjacency = new Map(ids.map((id) => [id, []]));
  for (const edge of edges) {
    const a = edgeSource(edge),
      b = edgeTarget(edge);
    if (byId.has(a) && byId.has(b)) adjacency.get(a).push(b);
  }
  for (const values of adjacency.values()) values.sort(compare);
  let next = 0;
  const indices = new Map(),
    low = new Map(),
    stack = [],
    active = new Set(),
    components = [];
  function visit(id) {
    indices.set(id, next);
    low.set(id, next++);
    stack.push(id);
    active.add(id);
    for (const target of adjacency.get(id)) {
      if (!indices.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id), low.get(target)));
      } else if (active.has(target))
        low.set(id, Math.min(low.get(id), indices.get(target)));
    }
    if (low.get(id) === indices.get(id)) {
      const members = [];
      let member;
      do {
        member = stack.pop();
        active.delete(member);
        members.push(member);
      } while (member !== id);
      components.push(members.sort(compare));
    }
  }
  ids.forEach((id) => {
    if (!indices.has(id)) visit(id);
  });
  const membership = new Map(
    components.flatMap((members, index) => members.map((id) => [id, index])),
  );
  const outgoing = components.map(() => new Set()),
    incoming = components.map(() => 0),
    ranks = components.map(() => 0);
  for (const [source, targets] of adjacency)
    for (const target of targets) {
      const a = membership.get(source),
        b = membership.get(target);
      if (a !== b && !outgoing[a].has(b)) {
        outgoing[a].add(b);
        incoming[b]++;
      }
    }
  const queue = incoming.flatMap((count, index) => (count ? [] : [index]));
  while (queue.length) {
    queue.sort((a, b) => compare(components[a][0], components[b][0]));
    const source = queue.shift();
    for (const target of outgoing[source]) {
      ranks[target] = Math.max(ranks[target], ranks[source] + 1);
      if (--incoming[target] === 0) queue.push(target);
    }
  }
  const lanes = [...new Set(nodes.map(laneName))].sort(compare),
    result = [],
    groups = [];
  let top = 0;
  for (const lane of lanes) {
    const slots = new Map();
    const members = nodes
      .filter((n) => laneName(n) === lane)
      .sort(
        (a, b) =>
          ranks[membership.get(a.id)] - ranks[membership.get(b.id)] ||
          compare(a.name || a.id, b.name || b.id) ||
          compare(a.id, b.id),
      );
    for (const node of members) {
      const rank = ranks[membership.get(node.id)],
        row = slots.get(rank) || 0;
      slots.set(rank, row + 1);
      result.push({
        ...node,
        x: 40 + rank * 344,
        y: top + 58 + row * 152,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    }
    const height = 58 + Math.max(1, ...slots.values()) * 152;
    groups.push({
      id: lane,
      name: lane,
      x: 8,
      y: top + 10,
      width:
        304 +
        Math.max(0, ...members.map((n) => ranks[membership.get(n.id)])) * 344,
      height: height - 18,
      count: members.length,
    });
    top += height + 26;
  }
  return {
    nodes: result,
    edges: [...edges],
    groups,
    ranks: Object.fromEntries(ids.map((id) => [id, ranks[membership.get(id)]])),
  };
}

const simplify = (points) =>
  points.filter(
    (point, i) =>
      !i ||
      i === points.length - 1 ||
      !(
        (points[i - 1].x === point.x && point.x === points[i + 1].x) ||
        (points[i - 1].y === point.y && point.y === points[i + 1].y)
      ),
  );

/** Orthogonal visibility-grid routing avoids all node interiors, including backward edges. */
export function routeEdge(edge, nodes) {
  const a = nodes.find((node) => node.id === edgeSource(edge)),
    b = nodes.find((node) => node.id === edgeTarget(edge));
  if (!a || !b) return [];
  const start = {
    x: a.x + (a.width || NODE_WIDTH),
    y: a.y + (a.height || NODE_HEIGHT) / 2,
  };
  const end = { x: b.x, y: b.y + (b.height || NODE_HEIGHT) / 2 };
  const lead = { x: start.x + 16, y: start.y },
    tail = { x: end.x - 16, y: end.y };
  const boxes = nodes.map((node) => ({
    l: node.x - 12,
    r: node.x + (node.width || NODE_WIDTH) + 12,
    t: node.y - 12,
    b: node.y + (node.height || NODE_HEIGHT) + 12,
  }));
  const xs = [
    ...new Set([lead.x, tail.x, ...boxes.flatMap((box) => [box.l, box.r])]),
  ].sort((x, y) => x - y);
  const ys = [
    ...new Set([lead.y, tail.y, ...boxes.flatMap((box) => [box.t, box.b])]),
  ].sort((x, y) => x - y);
  const width = xs.length,
    key = (x, y) => y * width + x;
  const startKey = key(xs.indexOf(lead.x), ys.indexOf(lead.y)),
    goal = key(xs.indexOf(tail.x), ys.indexOf(tail.y));
  const blocked = (x1, y1, x2, y2) =>
    boxes.some((box) =>
      x1 === x2
        ? x1 > box.l &&
          x1 < box.r &&
          Math.max(y1, y2) > box.t &&
          Math.min(y1, y2) < box.b
        : y1 > box.t &&
          y1 < box.b &&
          Math.max(x1, x2) > box.l &&
          Math.min(x1, x2) < box.r,
    );
  const distance = new Map([[startKey, 0]]),
    previous = new Map(),
    open = [{ id: startKey, score: 0 }],
    closed = new Set();
  function push(item) {
    open.push(item);
    let i = open.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (open[p].score <= item.score) break;
      open[i] = open[p];
      i = p;
    }
    open[i] = item;
  }
  function pop() {
    const first = open[0],
      last = open.pop();
    if (open.length) {
      let i = 0;
      while (i * 2 + 1 < open.length) {
        let child = i * 2 + 1;
        if (
          child + 1 < open.length &&
          open[child + 1].score < open[child].score
        )
          child++;
        if (open[child].score >= last.score) break;
        open[i] = open[child];
        i = child;
      }
      open[i] = last;
    }
    return first;
  }
  while (open.length) {
    const current = pop().id;
    if (closed.has(current)) continue;
    if (current === goal) {
      const points = [];
      let cursor = goal;
      while (cursor !== undefined) {
        points.push({
          x: xs[cursor % width],
          y: ys[Math.floor(cursor / width)],
        });
        cursor = previous.get(cursor);
      }
      return simplify([start, ...points.reverse(), end]);
    }
    closed.add(current);
    const ix = current % width,
      iy = Math.floor(current / width),
      x = xs[ix],
      y = ys[iy];
    for (const [nx, ny] of [
      [ix - 1, iy],
      [ix + 1, iy],
      [ix, iy - 1],
      [ix, iy + 1],
    ]) {
      if (
        nx < 0 ||
        ny < 0 ||
        nx >= xs.length ||
        ny >= ys.length ||
        blocked(x, y, xs[nx], ys[ny])
      )
        continue;
      const id = key(nx, ny),
        cost =
          distance.get(current) + Math.abs(xs[nx] - x) + Math.abs(ys[ny] - y);
      if (cost >= (distance.get(id) ?? Infinity)) continue;
      distance.set(id, cost);
      previous.set(id, current);
      push({
        id,
        score: cost + Math.abs(xs[nx] - tail.x) + Math.abs(ys[ny] - tail.y),
      });
    }
  }
  // Overlapping manually positioned cards can enclose a port. Keep the edge visible.
  const channel = Math.min(a.y, b.y) - 30;
  return simplify([
    start,
    lead,
    { x: lead.x, y: channel },
    { x: tail.x, y: channel },
    tail,
    end,
  ]);
}

export function graphSubset(nodes, edges, filter = {}) {
  let result = nodes.filter(
    (node) =>
      filter.nodeIds != null ||
      !filter.workspaceId ||
      node.workspaceId === filter.workspaceId ||
      node.workspaceIds?.includes(filter.workspaceId),
  );
  if (filter.nodeIds) {
    const ids = new Set(filter.nodeIds);
    result = result.filter((node) => ids.has(node.id));
  }
  if (filter.focusIds) {
    const focus = new Set(filter.focusIds);
    result = result.filter((node) => focus.has(node.id));
  }
  const ids = new Set(result.map((node) => node.id));
  return {
    nodes: result,
    edges: edges.filter(
      (edge) => ids.has(edgeSource(edge)) && ids.has(edgeTarget(edge)),
    ),
  };
}

/** Shared, authority-free proposal shape consumed by the scoped layout MCP tool. */
export function organizeCanvasLayout(nodes, edges) {
  const result = organizeGraph(nodes, edges);
  return {
    positions: result.nodes.map(({ id, x, y }) => ({ id, x, y })),
    groups: result.groups,
  };
}
