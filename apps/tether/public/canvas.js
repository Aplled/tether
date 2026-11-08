import {
  NODE_WIDTH,
  NODE_HEIGHT,
  organizeGraph,
  routeEdge,
  graphSubset,
  laneName,
  edgeSource,
  edgeTarget,
} from "./canvas-layout.js";

/**
 * Interaction adaptation from Graphite (read-only audit): flowstate/src/hooks/useCanvas.ts,
 * src/components/canvas/Canvas.tsx and CanvasContextMenu.tsx. Preserves cursor-anchored
 * exponential shift-wheel zoom, RAF wheel batching, middle/space pan, additive marquee,
 * world-coordinate multi-drag, viewport culling and contextual actions. No Flowstate files changed.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const editable = (target) =>
  target?.closest?.('input,textarea,select,[contenteditable="true"]');
const human = (value = "") => String(value).replace(/[_-]+/g, " ");
const symbols = {
  service: "◇",
  component: "▣",
  workflow: "↗",
  dataset: "▤",
  resource: "▦",
  team: "◎",
  person: "◉",
};
let instance = 0;

export class TetherCanvas {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.nodes = [];
    this.edges = [];
    this.viewport = { x: 70, y: 60, zoom: 0.85 };
    this.selection = new Set();
    this.selectedEdgeId = null;
    this.activity = null;
    this.filter = {};
    this.focusPositions = new Map();
    this.focusLayoutKey = null;
    this.beforeFocusViewport = null;
    this.explicitCameraPending = false;
    this.showEdgeLabels = false;
    this.space = false;
    this.drag = null;
    this.marquee = null;
    this.connectFrom = null;
    this.connectKind = "depends_on";
    this.touches = new Map();
    this.pinch = null;
    this.frame = 0;
    this.dirty = true;
    this.pending = { dx: 0, dy: 0, factor: 1, mx: 0, my: 0 };
    this.routeCache = new Map();
    this.markerId = `tether-arrow-${++instance}`;
    root.classList.add("tether-canvas");
    root.tabIndex = 0;
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Company service map");
    root.innerHTML =
      '<div class="canvas-transform"><div class="canvas-lanes"></div><svg class="edge-layer" aria-label="Relationships"></svg><div class="canvas-cards"></div><div class="canvas-marquee" hidden></div><svg class="canvas-connection-preview"></svg></div><div class="canvas-empty" hidden>No nodes in this view</div><div class="canvas-connect-hint" hidden></div><div class="zoom-readout" aria-hidden="true"></div>';
    this.world = root.querySelector(".canvas-transform");
    this.cards = root.querySelector(".canvas-cards");
    this.edgeLayer = root.querySelector(".edge-layer");
    this.lanes = root.querySelector(".canvas-lanes");
    this.marqueeEl = root.querySelector(".canvas-marquee");
    this.handlers = {
      wheel: (event) => this.onWheel(event),
      down: (event) => this.onDown(event),
      move: (event) => this.onMove(event),
      up: (event) => this.onUp(event),
      context: (event) => this.onContextMenu(event),
      double: (event) => this.onDoubleClick(event),
      keydown: (event) => this.onKey(event),
      keyup: (event) => {
        if (event.code === "Space") {
          this.space = false;
          this.root.classList.remove("is-panning");
        }
      },
      blur: () => {
        this.space = false;
        this.drag = null;
        this.touches.clear();
        this.pinch = null;
        this.root.classList.remove("is-panning");
      },
    };
    root.addEventListener("wheel", this.handlers.wheel, { passive: false });
    root.addEventListener("pointerdown", this.handlers.down);
    root.addEventListener("contextmenu", this.handlers.context);
    root.addEventListener("dblclick", this.handlers.double);
    window.addEventListener("pointermove", this.handlers.move);
    window.addEventListener("pointerup", this.handlers.up);
    window.addEventListener("pointercancel", this.handlers.up);
    window.addEventListener("keydown", this.handlers.keydown);
    window.addEventListener("keyup", this.handlers.keyup);
    window.addEventListener("blur", this.handlers.blur);
    this.resizeObserver = new ResizeObserver(() => this.schedule());
    this.resizeObserver.observe(root);
  }
  dispose() {
    const h = this.handlers;
    this.root.removeEventListener("wheel", h.wheel);
    this.root.removeEventListener("pointerdown", h.down);
    this.root.removeEventListener("contextmenu", h.context);
    this.root.removeEventListener("dblclick", h.double);
    window.removeEventListener("pointermove", h.move);
    window.removeEventListener("pointerup", h.up);
    window.removeEventListener("pointercancel", h.up);
    window.removeEventListener("keydown", h.keydown);
    window.removeEventListener("keyup", h.keyup);
    window.removeEventListener("blur", h.blur);
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.idleTimer);
  }
  setData(nodes = [], edges = []) {
    this.nodes = nodes.map((node) => ({
      ...node,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }));
    this.edges = [...edges];
    if (
      this.nodes.some(
        (node) => !Number.isFinite(node.x) || !Number.isFinite(node.y),
      )
    )
      this.nodes = organizeGraph(this.nodes, this.edges).nodes;
    this.invalidate();
    this.pruneSelection();
    this.render();
  }
  getVisibleGraph() {
    const graph = graphSubset(this.nodes, this.edges, this.filter);
    if (this.filter.focusIds == null) return graph;
    const key = JSON.stringify([
      graph.nodes.map((node) => node.id).sort(),
      graph.edges
        .map((edge) => [edge.id, edgeSource(edge), edgeTarget(edge)])
        .sort(),
    ]);
    if (key !== this.focusLayoutKey) {
      const compact = organizeGraph(
        graph.nodes.map((node) => ({
          ...node,
          departmentName: "Incident systems",
        })),
        graph.edges,
      );
      this.focusPositions = new Map(
        compact.nodes.map(({ id, x, y }) => [id, { x, y }]),
      );
      this.focusLayoutKey = key;
    }
    return {
      nodes: graph.nodes.map((node) => ({
        ...node,
        ...this.focusPositions.get(node.id),
        departmentName: "Incident systems",
      })),
      edges: graph.edges,
    };
  }
  setFilter(filter = {}) {
    this.filter = { ...filter };
    this.invalidate();
    this.pruneSelection();
    this.render();
  }
  setFocus(ids = null) {
    const changed =
      JSON.stringify(this.filter.focusIds || null) !== JSON.stringify(ids);
    if (!changed) return;
    const wasFocused = this.filter.focusIds != null;
    if (!wasFocused && ids != null)
      this.beforeFocusViewport = { ...this.viewport };
    this.filter = { ...this.filter, focusIds: ids };
    this.explicitCameraPending = false;
    this.focusLayoutKey = null;
    this.focusPositions.clear();
    this.invalidate();
    this.pruneSelection();
    this.render();
    if (ids != null) this.initializeView({ minZoom: 0.65 });
    else if (this.beforeFocusViewport) {
      this.viewport = this.beforeFocusViewport;
      this.beforeFocusViewport = null;
      this.markViewport();
      this.render();
    }
  }
  setActivity(activity = null) {
    this.activity = activity
      ? {
          nodeIds: new Set(activity.nodeIds || []),
          activeNodeId: activity.activeNodeId || null,
          completedNodeIds: new Set(activity.completedNodeIds || []),
        }
      : null;
    this.render();
  }
  setEdgeLabels(show) {
    this.showEdgeLabels = !!show;
    this.dirty = true;
    this.render();
  }
  invalidate() {
    this.dirty = true;
    this.routeCache.clear();
  }
  pruneSelection() {
    const graph = this.getVisibleGraph(),
      ids = new Set(graph.nodes.map((node) => node.id));
    const before = [...this.selection].join("\0"),
      previousEdge = this.selectedEdgeId;
    this.selection = new Set([...this.selection].filter((id) => ids.has(id)));
    if (!graph.edges.some((edge) => edge.id === this.selectedEdgeId))
      this.selectedEdgeId = null;
    if (
      before !== [...this.selection].join("\0") ||
      previousEdge !== this.selectedEdgeId
    )
      this.emitSelection();
  }
  organize({ persist = true, fit = true } = {}) {
    const graph = this.getVisibleGraph(),
      arranged = organizeGraph(graph.nodes, graph.edges),
      positions = new Map(arranged.nodes.map((node) => [node.id, node]));
    if (this.filter.focusIds != null)
      this.focusPositions = new Map(
        arranged.nodes.map(({ id, x, y }) => [id, { x, y }]),
      );
    else this.nodes = this.nodes.map((node) => positions.get(node.id) || node);
    this.invalidate();
    this.render();
    if (fit) this.fit();
    const updates = arranged.nodes.map(({ id, x, y }) => ({ id, x, y }));
    if (
      persist &&
      this.options.canEdit !== false &&
      this.filter.focusIds == null
    ) {
      if (this.options.onLayout) this.options.onLayout(updates);
      else updates.forEach(({ id, x, y }) => this.options.onMove?.(id, x, y));
    }
    return updates;
  }
  screenToCanvas(x, y) {
    const rect = this.root.getBoundingClientRect();
    return {
      x: (x - rect.left - this.viewport.x) / this.viewport.zoom,
      y: (y - rect.top - this.viewport.y) / this.viewport.zoom,
    };
  }
  emitSelection() {
    this.options.onSelect?.(
      this.selection.size === 1
        ? this.nodes.find((node) => this.selection.has(node.id))
        : null,
    );
    this.options.onSelectionChange?.([...this.selection]);
    this.options.onEdgeSelect?.(
      this.edges.find((edge) => edge.id === this.selectedEdgeId) || null,
    );
  }
  canEditNode(node) {
    return (
      !!node &&
      this.options.canEdit !== false &&
      (!this.options.canEditNode || this.options.canEditNode(node))
    );
  }
  editNode(node) {
    if (this.canEditNode(node))
      (
        this.options.onEditNode ||
        this.options.onEdit ||
        this.options.onInspect
      )?.(node);
    else this.options.onInspect?.(node);
  }
  setSelection(ids = []) {
    this.selection = new Set(ids);
    this.selectedEdgeId = null;
    this.pruneSelection();
    this.emitSelection();
    this.render();
  }
  /** Call once after a view's data/filter is mounted; SSE setData never moves the camera. */
  initializeView({ viewport, minZoom = 0.65 } = {}) {
    // Node creation may reveal synchronously while mount initialization awaits RAF.
    // The explicit reveal takes priority over that older saved camera.
    if (this.explicitCameraPending) {
      this.explicitCameraPending = false;
      this.render();
      return;
    }
    if (this.filter.focusIds != null) {
      if (
        viewport &&
        [viewport.x, viewport.y, viewport.zoom].every(Number.isFinite)
      )
        this.beforeFocusViewport = { ...viewport };
      viewport = null;
    }
    const nodes = this.getVisibleGraph().nodes,
      rect = this.root.getBoundingClientRect();
    if (!nodes.length || rect.width < 1 || rect.height < 1) return;
    if (
      viewport &&
      [viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) &&
      viewport.zoom >= 0.12 &&
      viewport.zoom <= 2.4
    ) {
      const visible = nodes.some((node) => {
        const left = node.x * viewport.zoom + viewport.x,
          top = node.y * viewport.zoom + viewport.y;
        return (
          left + node.width * viewport.zoom > 24 &&
          left < rect.width - 24 &&
          top + node.height * viewport.zoom > 24 &&
          top < rect.height - 24
        );
      });
      if (visible) {
        this.viewport = { ...viewport };
        this.markViewport();
        this.render();
        return;
      }
    }
    this.fit();
    if (this.viewport.zoom < minZoom) {
      // A large company graph starts at its first flow nodes at readable scale.
      // Explicit Fit remains the complete overview, including small overview scales.
      const first = [...nodes].sort(
        (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
      )[0];
      const zoom = clamp(minZoom, 0.12, 1.15);
      this.viewport = { x: 48 - first.x * zoom, y: 70 - first.y * zoom, zoom };
      this.markViewport();
      this.render();
    }
  }
  /** Reveal a newly created or searched node without changing workspace scope. */
  revealNode(id, { select = true, zoom = 1 } = {}) {
    const node = this.getVisibleGraph().nodes.find((item) => item.id === id);
    if (!node) return false;
    const rect = this.root.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const scale = clamp(zoom, 0.65, 1.35);
    this.viewport = {
      x: rect.width / 2 - (node.x + node.width / 2) * scale,
      y: rect.height / 2 - (node.y + node.height / 2) * scale,
      zoom: scale,
    };
    this.explicitCameraPending = true;
    if (select) this.setSelection([id]);
    this.markViewport();
    this.render();
    return true;
  }
  /** Fixed screen-pixel hit tolerance outside cards, even when SVG paths are zoomed out. */
  edgeAt(event) {
    const point = this.screenToCanvas(event.clientX, event.clientY),
      graph = this.getVisibleGraph();
    if (
      graph.nodes.some(
        (node) =>
          point.x >= node.x &&
          point.x <= node.x + node.width &&
          point.y >= node.y &&
          point.y <= node.y + node.height,
      )
    )
      return null;
    const direct = event.target.closest?.("[data-edge]")?.dataset.edge;
    if (direct) return graph.edges.find((edge) => edge.id === direct) || null;
    let nearest = null,
      distance = 8 / this.viewport.zoom;
    for (const edge of graph.edges) {
      const points = this.routeCache.get(edge.id) || [];
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1],
          b = points[index],
          dx = b.x - a.x,
          dy = b.y - a.y;
        const ratio = clamp(
          ((point.x - a.x) * dx + (point.y - a.y) * dy) /
            (dx * dx + dy * dy || 1),
          0,
          1,
        );
        const candidate = Math.hypot(
          point.x - a.x - ratio * dx,
          point.y - a.y - ratio * dy,
        );
        if (candidate < distance) {
          distance = candidate;
          nearest = edge;
        }
      }
    }
    return nearest;
  }
  clearSelection() {
    this.selection.clear();
    this.selectedEdgeId = null;
    this.emitSelection();
    this.render();
  }
  selectNode(id, additive = false) {
    if (additive) {
      if (this.selection.has(id)) this.selection.delete(id);
      else this.selection.add(id);
    } else this.selection = new Set([id]);
    this.selectedEdgeId = null;
    this.emitSelection();
    this.render();
  }
  deleteSelection() {
    if (this.options.canEdit === false) return;
    if (this.selectedEdgeId) {
      if (this.options.onDeleteEdge)
        this.options.onDeleteEdge(this.selectedEdgeId);
      else
        this.options.onEdgeDelete?.(
          this.edges.find((edge) => edge.id === this.selectedEdgeId),
        );
    } else if (this.selection.size) {
      const nodes = this.nodes.filter(
        (node) => this.selection.has(node.id) && this.canEditNode(node),
      );
      if (!nodes.length) return;
      if (this.options.onDeleteNodes)
        this.options.onDeleteNodes(nodes.map((node) => node.id));
      else nodes.forEach((node) => this.options.onDelete?.(node));
    }
  }
  beginConnect(id, kind = "depends_on") {
    if (!this.canEditNode(this.nodes.find((node) => node.id === id))) return;
    this.connectFrom = id;
    this.connectKind = kind;
    this.connectionPoint = null;
    this.render();
  }
  finishConnect(id) {
    if (id && id !== this.connectFrom) {
      const from = this.connectFrom;
      this.connectFrom = null;
      this.connectionPoint = null;
      this.render();
      this.options.onConnect?.(from, id, this.connectKind);
      return true;
    }
    return false;
  }
  schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.flushWheel();
        this.render();
      });
  }
  markViewport() {
    this.world.style.willChange = "transform";
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.world.style.willChange = "";
    }, 180);
    this.options.onViewportChange?.({ ...this.viewport });
  }
  onWheel(event) {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    if (event.shiftKey) {
      const rect = this.root.getBoundingClientRect();
      this.pending.factor *= Math.exp(-event.deltaY * scale * 0.0015);
      this.pending.mx = event.clientX - rect.left;
      this.pending.my = event.clientY - rect.top;
    } else if (!event.ctrlKey) {
      this.pending.dx += event.deltaX * scale;
      this.pending.dy += event.deltaY * scale;
    }
    this.schedule();
  }
  flushWheel() {
    const p = this.pending,
      v = this.viewport;
    if (p.factor !== 1) {
      const zoom = clamp(v.zoom * p.factor, 0.12, 2.4),
        ratio = zoom / v.zoom;
      v.x = p.mx - (p.mx - v.x) * ratio;
      v.y = p.my - (p.my - v.y) * ratio;
      v.zoom = zoom;
      this.markViewport();
    } else if (p.dx || p.dy) {
      v.x -= p.dx;
      v.y -= p.dy;
      this.markViewport();
    }
    this.pending = { dx: 0, dy: 0, factor: 1, mx: 0, my: 0 };
  }
  zoomBy(factor) {
    const rect = this.root.getBoundingClientRect();
    this.pending.factor *= factor;
    this.pending.mx = rect.width / 2;
    this.pending.my = rect.height / 2;
    this.flushWheel();
    this.render();
  }
  fit(ids) {
    const nodes = this.getVisibleGraph().nodes.filter(
      (node) => !ids?.length || ids.includes(node.id),
    );
    if (!nodes.length) return;
    const rect = this.root.getBoundingClientRect(),
      minX = Math.min(...nodes.map((node) => node.x)) - 30,
      minY = Math.min(...nodes.map((node) => node.y)) - 55;
    const width =
        Math.max(...nodes.map((node) => node.x + node.width)) - minX + 30,
      height =
        Math.max(...nodes.map((node) => node.y + node.height)) - minY + 30;
    const zoom = clamp(
      Math.min((rect.width - 72) / width, (rect.height - 100) / height),
      0.12,
      1.15,
    );
    this.viewport = {
      x: (rect.width - width * zoom) / 2 - minX * zoom,
      y: (rect.height - height * zoom) / 2 - minY * zoom,
      zoom,
    };
    this.markViewport();
    this.render();
  }
  onDown(event) {
    if (editable(event.target) || (event.button !== 0 && event.button !== 1))
      return;
    this.root.focus({ preventScroll: true });
    if (event.pointerType === "touch") {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.root.setPointerCapture?.(event.pointerId);
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()],
          center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: this.viewport.zoom,
          anchor: this.screenToCanvas(center.x, center.y),
        };
        this.drag = null;
        this.marquee = null;
        event.preventDefault();
        return;
      }
    }
    const card = event.target.closest(".canvas-node"),
      port = event.target.closest(".node-port"),
      edge = this.edgeAt(event);
    if (
      this.space ||
      event.button === 1 ||
      (event.pointerType === "touch" && !card && !edge)
    ) {
      this.drag = {
        kind: "pan",
        sx: event.clientX,
        sy: event.clientY,
        x: this.viewport.x,
        y: this.viewport.y,
      };
      this.root.classList.add("is-panning");
    } else if (card) {
      const id = card.dataset.id;
      if (this.connectFrom && this.finishConnect(id)) {
        event.preventDefault();
        return;
      }
      if (port) {
        this.beginConnect(id, this.connectKind);
        this.connectionDown = { x: event.clientX, y: event.clientY };
        event.preventDefault();
        return;
      }
      const additive = event.shiftKey || event.metaKey;
      if (additive || !this.selection.has(id)) this.selectNode(id, additive);
      if (
        this.selection.has(id) &&
        this.canEditNode(this.nodes.find((node) => node.id === id))
      )
        this.drag = {
          kind: "nodes",
          sx: event.clientX,
          sy: event.clientY,
          moved: false,
          origins: new Map(
            this.getVisibleGraph()
              .nodes.filter(
                (node) => this.selection.has(node.id) && this.canEditNode(node),
              )
              .map((node) => [node.id, { x: node.x, y: node.y }]),
          ),
        };
    } else if (edge) {
      this.selectedEdgeId = edge.id;
      this.selection.clear();
      this.emitSelection();
    } else {
      if (this.connectFrom) {
        this.connectFrom = null;
        this.connectionPoint = null;
      }
      const point = this.screenToCanvas(event.clientX, event.clientY);
      this.marquee = {
        start: point,
        end: point,
        prior:
          event.shiftKey || event.metaKey ? new Set(this.selection) : new Set(),
      };
      this.selection = new Set(this.marquee.prior);
      this.selectedEdgeId = null;
      this.emitSelection();
    }
    event.preventDefault();
    this.render();
  }
  onMove(event) {
    if (event.pointerType === "touch" && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size >= 2 && this.pinch) {
        const [a, b] = [...this.touches.values()],
          rect = this.root.getBoundingClientRect();
        const zoom = clamp(
          (this.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
            Math.max(1, this.pinch.distance),
          0.12,
          2.4,
        );
        this.viewport = {
          x: (a.x + b.x) / 2 - rect.left - this.pinch.anchor.x * zoom,
          y: (a.y + b.y) / 2 - rect.top - this.pinch.anchor.y * zoom,
          zoom,
        };
        this.markViewport();
        this.schedule();
        return;
      }
    }
    if (this.connectFrom) {
      this.connectionPoint = this.screenToCanvas(event.clientX, event.clientY);
      this.schedule();
    }
    const drag = this.drag;
    if (drag?.kind === "pan") {
      this.viewport.x = drag.x + event.clientX - drag.sx;
      this.viewport.y = drag.y + event.clientY - drag.sy;
      this.markViewport();
      this.schedule();
    } else if (drag?.kind === "nodes") {
      const dx = (event.clientX - drag.sx) / this.viewport.zoom,
        dy = (event.clientY - drag.sy) / this.viewport.zoom;
      if (
        Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) < 4 &&
        !drag.moved
      )
        return;
      drag.moved = true;
      for (const node of this.nodes) {
        const origin = drag.origins.get(node.id);
        if (origin) {
          if (this.filter.focusIds != null)
            this.focusPositions.set(node.id, {
              x: origin.x + dx,
              y: origin.y + dy,
            });
          else {
            node.x = origin.x + dx;
            node.y = origin.y + dy;
          }
        }
      }
      this.invalidate();
      this.schedule();
    } else if (this.marquee) {
      this.marquee.end = this.screenToCanvas(event.clientX, event.clientY);
      const { start, end, prior } = this.marquee,
        left = Math.min(start.x, end.x),
        right = Math.max(start.x, end.x),
        top = Math.min(start.y, end.y),
        bottom = Math.max(start.y, end.y);
      this.selection = new Set([
        ...prior,
        ...this.getVisibleGraph()
          .nodes.filter(
            (node) =>
              node.x < right &&
              node.x + node.width > left &&
              node.y < bottom &&
              node.y + node.height > top,
          )
          .map((node) => node.id),
      ]);
      this.schedule();
    }
  }
  onUp(event) {
    if (this.connectFrom && this.connectionDown) {
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest(".canvas-node");
      if (
        Math.hypot(
          event.clientX - this.connectionDown.x,
          event.clientY - this.connectionDown.y,
        ) > 4
      )
        this.finishConnect(target?.dataset.id);
      this.connectionDown = null;
    }
    if (
      this.drag?.kind === "nodes" &&
      this.drag.moved &&
      this.filter.focusIds == null
    ) {
      const updates = this.nodes
        .filter((node) => this.drag.origins.has(node.id))
        .map(({ id, x, y }) => ({ id, x: Math.round(x), y: Math.round(y) }));
      if (this.options.onLayout) this.options.onLayout(updates);
      else updates.forEach(({ id, x, y }) => this.options.onMove?.(id, x, y));
    }
    if (this.marquee) this.emitSelection();
    this.drag = null;
    this.marquee = null;
    this.root.classList.remove("is-panning");
    if (event.pointerType === "touch") {
      this.touches.delete(event.pointerId);
      this.pinch = null;
      if (this.touches.size === 1) {
        const [point] = this.touches.values();
        this.drag = {
          kind: "pan",
          sx: point.x,
          sy: point.y,
          x: this.viewport.x,
          y: this.viewport.y,
        };
      }
    }
    this.render();
  }
  onContextMenu(event) {
    event.preventDefault();
    this.drag = null;
    this.marquee = null;
    const card = event.target.closest(".canvas-node");
    const node = this.nodes.find((item) => item.id === card?.dataset.id),
      edge = this.edgeAt(event);
    if (node && !this.selection.has(node.id)) this.selectNode(node.id);
    else if (edge) {
      this.selection.clear();
      this.selectedEdgeId = edge.id;
      this.emitSelection();
      this.render();
    }
    const point = this.screenToCanvas(event.clientX, event.clientY);
    this.options.onContextMenu?.({
      kind: node ? "node" : edge ? "edge" : "blank",
      node,
      edge,
      x: event.clientX,
      y: event.clientY,
      canvasX: point.x,
      canvasY: point.y,
      selection: [...this.selection],
    });
  }
  onDoubleClick(event) {
    const card = event.target.closest(".canvas-node"),
      edge = this.edgeAt(event);
    if (event.target.closest(".node-port")) return;
    if (card)
      this.editNode(this.nodes.find((node) => node.id === card.dataset.id));
    else if (edge && this.options.canEdit !== false)
      (this.options.onEditEdge || this.options.onEdgeEdit)?.(edge);
  }
  onKey(event) {
    if (editable(event.target) || !this.root.contains(document.activeElement))
      return;
    if (event.code === "Space") {
      this.space = true;
      this.root.classList.add("is-panning");
      event.preventDefault();
    } else if (event.key === "Escape") {
      this.connectFrom = null;
      this.connectionPoint = null;
      this.clearSelection();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteSelection();
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "a"
    ) {
      event.preventDefault();
      this.selection = new Set(
        this.getVisibleGraph().nodes.map((node) => node.id),
      );
      this.selectedEdgeId = null;
      this.emitSelection();
      this.render();
    } else if (event.key === "Enter" && this.selection.size === 1)
      this.editNode(this.nodes.find((node) => this.selection.has(node.id)));
    else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.fit();
    }
  }
  render() {
    const graph = this.getVisibleGraph(),
      { x, y, zoom } = this.viewport,
      rect = this.root.getBoundingClientRect();
    this.world.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
    this.root.style.backgroundPosition = `${x}px ${y}px`;
    const grid = 24 * zoom * (zoom < 0.35 ? 4 : zoom < 0.65 ? 2 : 1);
    this.root.style.backgroundSize = `${grid}px ${grid}px`;
    this.root.querySelector(".zoom-readout").textContent =
      `${Math.round(zoom * 100)}%`;
    this.root.querySelector(".canvas-empty").hidden = !!graph.nodes.length;
    if (this.dirty) {
      const groups = new Map();
      graph.nodes.forEach((node) => {
        const name = laneName(node);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(node);
      });
      this.lanes.innerHTML = [...groups]
        .map(([name, nodes]) => {
          const left = Math.min(...nodes.map((node) => node.x)) - 24,
            top = Math.min(...nodes.map((node) => node.y)) - 44;
          const width =
              Math.max(...nodes.map((node) => node.x + node.width)) - left + 24,
            height =
              Math.max(...nodes.map((node) => node.y + node.height)) - top + 22;
          return `<div class="canvas-lane" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px"><span>${esc(human(name))}</span><small>${nodes.length} ${nodes.length === 1 ? "node" : "nodes"}</small></div>`;
        })
        .join("");
      this.edgeLayer.innerHTML =
        `<defs><marker id="${this.markerId}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3.5 L0,7 Z" fill="context-stroke"/></marker></defs>` +
        graph.edges
          .map((edge) => {
            let points = this.routeCache.get(edge.id);
            if (!points) {
              points = routeEdge(edge, graph.nodes);
              this.routeCache.set(edge.id, points);
            }
            if (!points.length) return "";
            const d = points
              .map(
                (point, index) => `${index ? "L" : "M"}${point.x},${point.y}`,
              )
              .join(" ");
            let labelA = points[0],
              labelB = points[1],
              longest = 0;
            points.slice(1).forEach((point, index) => {
              const before = points[index],
                length = Math.hypot(point.x - before.x, point.y - before.y);
              if (length > longest) {
                longest = length;
                labelA = before;
                labelB = point;
              }
            });
            const label = human(edge.label || edge.kind || "depends on");
            const sourceName =
              graph.nodes.find((node) => node.id === edgeSource(edge))?.name ||
              edgeSource(edge);
            const targetName =
              graph.nodes.find((node) => node.id === edgeTarget(edge))?.name ||
              edgeTarget(edge);
            const accessibleLabel = `${sourceName} → ${targetName}: ${label}`;
            return `<g class="edge" data-edge="${esc(edge.id)}" role="button" aria-label="${esc(accessibleLabel)}"><title>${esc(accessibleLabel)}</title><path class="edge-hit" d="${d}"/><path class="edge-line" d="${d}" marker-end="url(#${this.markerId})"/>${this.showEdgeLabels ? `<text x="${(labelA.x + labelB.x) / 2}" y="${(labelA.y + labelB.y) / 2 - 8}" text-anchor="middle">${esc(label)}</text>` : ""}</g>`;
          })
          .join("");
      this.dirty = false;
    }
    for (const element of this.edgeLayer.querySelectorAll("[data-edge]")) {
      const edge = graph.edges.find((item) => item.id === element.dataset.edge);
      element.classList.toggle(
        "selected",
        element.dataset.edge === this.selectedEdgeId,
      );
      element.classList.toggle(
        "active",
        this.selection.has(edgeSource(edge)) ||
          this.selection.has(edgeTarget(edge)),
      );
      element.classList.toggle(
        "safety-context",
        graph.nodes.some(
          (node) =>
            node.safetyMode === "unsafe_route_disabled" &&
            (node.id === edgeSource(edge) || node.id === edgeTarget(edge)),
        ),
      );
      const observed = this.activity?.completedNodeIds;
      element.classList.toggle(
        "evidence-complete",
        !!observed?.has(edgeSource(edge)) && !!observed?.has(edgeTarget(edge)),
      );
      element.classList.toggle(
        "evidence-active",
        !!this.activity?.activeNodeId &&
          ((edgeSource(edge) === this.activity.activeNodeId &&
            this.activity.nodeIds.has(edgeTarget(edge))) ||
            (edgeTarget(edge) === this.activity.activeNodeId &&
              this.activity.nodeIds.has(edgeSource(edge)))),
      );
    }
    const padding = 300 / zoom,
      visible = graph.nodes.filter(
        (node) =>
          this.selection.has(node.id) ||
          (node.x + node.width > -x / zoom - padding &&
            node.x < (rect.width - x) / zoom + padding &&
            node.y + node.height > -y / zoom - padding &&
            node.y < (rect.height - y) / zoom + padding),
      );
    const mounted = new Map(
      [...this.cards.children].map((element) => [element.dataset.id, element]),
    );
    for (const node of visible) {
      let card = mounted.get(node.id);
      if (!card) {
        card = document.createElement("article");
        card.className = "canvas-node";
        card.dataset.id = node.id;
        card.setAttribute("role", "button");
        this.cards.append(card);
      }
      mounted.delete(node.id);
      card.style.left = `${node.x}px`;
      card.style.top = `${node.y}px`;
      card.style.width = `${node.width}px`;
      card.style.height = `${node.height}px`;
      card.classList.toggle("selected", this.selection.has(node.id));
      card.classList.toggle("read-only", !this.canEditNode(node));
      const restricted = node.safetyMode === "unsafe_route_disabled";
      card.classList.toggle("safety-restricted", restricted);
      card.classList.toggle("connect-source", this.connectFrom === node.id);
      card.classList.toggle(
        "evidence-scope",
        !!this.activity?.nodeIds.has(node.id),
      );
      card.classList.toggle(
        "evidence-active",
        this.activity?.activeNodeId === node.id,
      );
      card.classList.toggle(
        "evidence-complete",
        !!this.activity?.completedNodeIds.has(node.id),
      );
      card.setAttribute("aria-selected", String(this.selection.has(node.id)));
      card.setAttribute(
        "aria-label",
        `${node.name}, ${human(node.kind || "service")}${restricted ? `, ${node.safetyLabel || "Unsafe restart blocked"}, ${node.safetyDetail || "Normal jobs not yet verified"}, availability ${node.status || node.state || "unknown"}` : ""}`,
      );
      const status = node.status || node.state || "unknown",
        owner = node.ownerName || "Unassigned",
        kind = node.kind || node.type || "service";
      const signature = JSON.stringify([
        node.name,
        kind,
        status,
        owner,
        node.criticality,
        node.safetyMode,
        node.safetyLabel,
        node.safetyDetail,
        this.canEditNode(node),
      ]);
      if (card.dataset.signature !== signature) {
        card.dataset.signature = signature;
        card.innerHTML = `<div class="node-heading"><span class="node-symbol" aria-hidden="true">${symbols[kind] || "◇"}</span><span class="node-kind">${esc(human(kind))}</span><span class="node-status ${restricted ? "status-restricted" : `status-${esc(status)}`}" title="${esc(restricted ? "The unsafe restart route is disabled. Service availability is shown separately." : status)}"><i></i>${esc(restricted ? node.safetyLabel || "Unsafe restart blocked" : human(status))}</span></div><h3 title="${esc(node.name)}">${esc(node.name)}</h3>${restricted ? `<p class="node-safety-detail">${esc(node.safetyDetail || "Normal jobs not yet verified")}</p>` : ""}<footer><span class="avatar">${esc(
          owner
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2),
        )}</span><span class="node-owner" title="${esc(owner)}">${esc(owner)}</span>${restricted ? `<span class="node-availability" title="Canonical service availability: ${esc(status)}">Availability: ${esc(human(status))}</span>` : node.criticality === "critical" ? '<span class="node-critical">Critical</span>' : ""}</footer>${!this.canEditNode(node) ? "" : `<button class="node-port out" title="Connect from ${esc(node.name)}" aria-label="Connect from ${esc(node.name)}">+</button>`}`;
      }
    }
    for (const element of mounted.values()) element.remove();
    this.marqueeEl.hidden = !this.marquee;
    if (this.marquee) {
      const { start, end } = this.marquee;
      Object.assign(this.marqueeEl.style, {
        left: `${Math.min(start.x, end.x)}px`,
        top: `${Math.min(start.y, end.y)}px`,
        width: `${Math.abs(start.x - end.x)}px`,
        height: `${Math.abs(start.y - end.y)}px`,
      });
    }
    const hint = this.root.querySelector(".canvas-connect-hint");
    hint.hidden = !this.connectFrom;
    hint.textContent = `Choose a target · ${human(this.connectKind)} · Esc to cancel`;
    const source = graph.nodes.find((node) => node.id === this.connectFrom),
      point = this.connectionPoint;
    this.root.querySelector(".canvas-connection-preview").innerHTML =
      source && point
        ? `<path d="M${source.x + source.width},${source.y + source.height / 2} L${point.x},${point.y}"/>`
        : "";
  }
}
