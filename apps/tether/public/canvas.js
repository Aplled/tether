import { prepare, layout } from "./pretext/layout.js";

/**
 * Canvas interaction adapter derived from Graphite sources at
 * /Users/vyomsingh/Projects/flowstate/src/lib/wheel-zoom.ts,
 * hooks/useCanvas.ts, hooks/useNodeInteraction.ts and Canvas.tsx.
 * Copied behavior: delta normalization, exponential cursor zoom, RAF batching,
 * scaled multi-drag, marquee hit testing, viewport culling and group bounds.
 */
const RATE = 0.0015;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const deltaPx = (value, mode) =>
  mode === 1 ? value * 16 : mode === 2 ? value * 100 : value;
const esc = (v = "") =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export class TetherCanvas {
  constructor(root, options) {
    this.root = root;
    this.options = options;
    this.nodes = [];
    this.edges = [];
    this.viewport = { x: 100, y: 80, zoom: 0.84 };
    this.selection = new Set();
    this.pending = { dx: 0, dy: 0, zoom: 1, mx: 0, my: 0 };
    this.frame = 0;
    this.space = false;
    this.marquee = null;
    this.drag = null;
    this.connectFrom = null;
    this.touches = new Map();
    this.pinch = null;
    this.bind();
  }
  setData(nodes = [], edges = []) {
    this.nodes = nodes.map((n) => {
      let textHeight = 30;
      try {
        textHeight = layout(
          prepare(n.description || "", "11px system-ui"),
          198,
          15,
        ).height;
      } catch {}
      return {
        ...n,
        height: n.height || Math.max(112, 82 + Math.min(45, textHeight)),
      };
    });
    this.edges = edges;
    this.render();
  }
  bind() {
    this.handlers = {
      wheel: (e) => this.onWheel(e),
      down: (e) => this.onDown(e),
      move: (e) => this.onMove(e),
      up: (e) => this.onUp(e),
      keydown: (e) => {
        if (
          e.code === "Space" &&
          !e.target.matches("input,textarea,select,[contenteditable]")
        ) {
          this.space = true;
          e.preventDefault();
        }
      },
      keyup: (e) => {
        if (e.code === "Space") this.space = false;
      },
    };
    this.root.addEventListener("wheel", this.handlers.wheel, {
      passive: false,
    });
    this.root.addEventListener("pointerdown", this.handlers.down);
    window.addEventListener("pointermove", this.handlers.move);
    window.addEventListener("pointerup", this.handlers.up);
    window.addEventListener("keydown", this.handlers.keydown);
    window.addEventListener("keyup", this.handlers.keyup);
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.root);
  }
  dispose() {
    if (!this.handlers) return;
    this.root.removeEventListener("wheel", this.handlers.wheel);
    this.root.removeEventListener("pointerdown", this.handlers.down);
    window.removeEventListener("pointermove", this.handlers.move);
    window.removeEventListener("pointerup", this.handlers.up);
    window.removeEventListener("keydown", this.handlers.keydown);
    window.removeEventListener("keyup", this.handlers.keyup);
    this.resizeObserver?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.handlers = null;
  }
  screenToCanvas(x, y) {
    const r = this.root.getBoundingClientRect();
    return {
      x: (x - r.left - this.viewport.x) / this.viewport.zoom,
      y: (y - r.top - this.viewport.y) / this.viewport.zoom,
    };
  }
  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
  }
  flush() {
    this.frame = 0;
    const p = this.pending,
      v = this.viewport;
    if (p.zoom !== 1) {
      const z = clamp(v.zoom * p.zoom, 0.22, 2.4);
      v.x = p.mx - (p.mx - v.x) * (z / v.zoom);
      v.y = p.my - (p.my - v.y) * (z / v.zoom);
      v.zoom = z;
    } else {
      v.x -= p.dx;
      v.y -= p.dy;
    }
    this.pending = { dx: 0, dy: 0, zoom: 1, mx: 0, my: 0 };
    this.render();
  }
  onWheel(e) {
    e.preventDefault();
    const r = this.root.getBoundingClientRect(),
      dx = deltaPx(e.deltaX, e.deltaMode),
      dy = deltaPx(e.deltaY, e.deltaMode);
    if (e.shiftKey) {
      this.pending.zoom *= Math.exp(-dy * RATE);
      this.pending.mx = e.clientX - r.left;
      this.pending.my = e.clientY - r.top;
      this.pending.dx = 0;
      this.pending.dy = 0;
    } else if (!e.ctrlKey) {
      this.pending.dx += dx;
      this.pending.dy += dy;
    }
    this.schedule();
  }
  onDown(e) {
    if (e.pointerType === "touch") {
      this.root.setPointerCapture?.(e.pointerId);
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 1)
        this.drag = {
          kind: "touchpan",
          sx: e.clientX,
          sy: e.clientY,
          x: this.viewport.x,
          y: this.viewport.y,
        };
      else if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()],
          r = this.root.getBoundingClientRect();
        this.pinch = {
          distance: Math.hypot(b.x - a.x, b.y - a.y),
          zoom: this.viewport.zoom,
          mx: (a.x + b.x) / 2 - r.left,
          my: (a.y + b.y) / 2 - r.top,
          x: this.viewport.x,
          y: this.viewport.y,
        };
        this.drag = null;
      }
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    const card = e.target.closest(".canvas-node"),
      port = e.target.closest(".node-port");
    if (port) {
      e.stopPropagation();
      this.connectFrom = port.closest(".canvas-node").dataset.id;
      return;
    }
    if (card) {
      const id = card.dataset.id,
        n = this.nodes.find((x) => x.id === id);
      if (!n) return;
      const additive = e.shiftKey || e.metaKey;
      if (!this.selection.has(id))
        this.selection = additive
          ? new Set([...this.selection, id])
          : new Set([id]);
      else if (additive) {
        this.selection.delete(id);
        this.render();
        return;
      }
      const origins = new Map(
        this.nodes
          .filter((x) => this.selection.has(x.id))
          .map((x) => [x.id, { x: x.x, y: x.y }]),
      );
      this.drag = {
        kind: "nodes",
        sx: e.clientX,
        sy: e.clientY,
        origins,
        moved: false,
      };
      this.render();
      e.preventDefault();
      return;
    }
    if (this.space || e.button === 1)
      this.drag = {
        kind: "pan",
        sx: e.clientX,
        sy: e.clientY,
        x: this.viewport.x,
        y: this.viewport.y,
      };
    else {
      const p = this.screenToCanvas(e.clientX, e.clientY);
      this.marquee = {
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
        prior: e.shiftKey || e.metaKey ? new Set(this.selection) : new Set(),
      };
      this.selection = new Set(this.marquee.prior);
    }
    e.preventDefault();
    this.render();
  }
  onMove(e) {
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2 && this.pinch) {
        const [a, b] = [...this.touches.values()],
          distance = Math.hypot(b.x - a.x, b.y - a.y),
          z = clamp(
            (this.pinch.zoom * distance) / Math.max(1, this.pinch.distance),
            0.22,
            2.4,
          ),
          ratio = z / this.pinch.zoom;
        this.viewport.zoom = z;
        this.viewport.x =
          this.pinch.mx - (this.pinch.mx - this.pinch.x) * ratio;
        this.viewport.y =
          this.pinch.my - (this.pinch.my - this.pinch.y) * ratio;
        this.render();
      } else if (this.drag?.kind === "touchpan") {
        this.viewport.x = this.drag.x + e.clientX - this.drag.sx;
        this.viewport.y = this.drag.y + e.clientY - this.drag.sy;
        this.render();
      }
      return;
    }
    if (this.drag?.kind === "pan") {
      this.viewport.x = this.drag.x + e.clientX - this.drag.sx;
      this.viewport.y = this.drag.y + e.clientY - this.drag.sy;
      this.render();
      return;
    }
    if (this.drag?.kind === "nodes") {
      const dx = (e.clientX - this.drag.sx) / this.viewport.zoom,
        dy = (e.clientY - this.drag.sy) / this.viewport.zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.drag.moved = true;
      for (const [id, o] of this.drag.origins) {
        const n = this.nodes.find((x) => x.id === id);
        if (n) {
          n.x = o.x + dx;
          n.y = o.y + dy;
        }
      }
      this.render();
      return;
    }
    if (this.marquee) {
      const p = this.screenToCanvas(e.clientX, e.clientY);
      this.marquee.x2 = p.x;
      this.marquee.y2 = p.y;
      const a = {
        x: Math.min(this.marquee.x1, p.x),
        y: Math.min(this.marquee.y1, p.y),
        r: Math.max(this.marquee.x1, p.x),
        b: Math.max(this.marquee.y1, p.y),
      };
      this.selection = new Set([
        ...this.marquee.prior,
        ...this.nodes
          .filter(
            (n) =>
              n.x < a.r &&
              n.x + (n.width || 230) > a.x &&
              n.y < a.b &&
              n.y + (n.height || 112) > a.y,
          )
          .map((n) => n.id),
      ]);
      this.render();
    }
  }
  onUp(e) {
    if (e.pointerType === "touch") {
      this.touches.delete(e.pointerId);
      this.pinch = null;
      if (this.touches.size === 1) {
        const [p] = this.touches.values();
        this.drag = {
          kind: "touchpan",
          sx: p.x,
          sy: p.y,
          x: this.viewport.x,
          y: this.viewport.y,
        };
      } else this.drag = null;
      return;
    }
    const target = e.target.closest?.(".canvas-node");
    if (this.connectFrom) {
      const to = target?.dataset.id;
      if (to && to !== this.connectFrom)
        this.options.onConnect?.(this.connectFrom, to);
      this.connectFrom = null;
      return;
    }
    if (this.drag?.kind === "nodes" && this.drag.moved) {
      for (const id of this.drag.origins.keys()) {
        const n = this.nodes.find((x) => x.id === id);
        this.options.onMove?.(id, n.x, n.y);
      }
    }
    if (this.drag?.kind === "nodes" && !this.drag.moved && target)
      this.options.onSelect?.(
        this.nodes.find((n) => n.id === target.dataset.id),
      );
    if (this.marquee) this.options.onSelectionChange?.([...this.selection]);
    this.drag = null;
    this.marquee = null;
    this.render();
  }
  fit(ids) {
    const items = ids?.length
      ? this.nodes.filter((n) => ids.includes(n.id))
      : this.nodes;
    if (!items.length) return;
    const r = this.root.getBoundingClientRect(),
      minX = Math.min(...items.map((n) => n.x)),
      minY = Math.min(...items.map((n) => n.y)),
      maxX = Math.max(...items.map((n) => n.x + (n.width || 230))),
      maxY = Math.max(...items.map((n) => n.y + (n.height || 112)));
    this.viewport.zoom = clamp(
      Math.min(
        (r.width - 120) / (maxX - minX),
        (r.height - 120) / (maxY - minY),
      ),
      0.22,
      1.35,
    );
    this.viewport.x =
      (r.width - (maxX - minX) * this.viewport.zoom) / 2 -
      minX * this.viewport.zoom;
    this.viewport.y =
      (r.height - (maxY - minY) * this.viewport.zoom) / 2 -
      minY * this.viewport.zoom;
    this.render();
  }
  groupBounds() {
    const groups = new Map();
    for (const n of this.nodes) {
      if (!n.groupId) continue;
      const a = groups.get(n.groupId) || [];
      a.push(n);
      groups.set(n.groupId, a);
    }
    return [...groups].map(([id, ns]) => ({
      id,
      x: Math.min(...ns.map((n) => n.x)) - 24,
      y: Math.min(...ns.map((n) => n.y)) - 48,
      r: Math.max(...ns.map((n) => n.x + (n.width || 230))) + 24,
      b: Math.max(...ns.map((n) => n.y + (n.height || 112))) + 24,
    }));
  }
  render() {
    const { x, y, zoom } = this.viewport,
      r = this.root.getBoundingClientRect(),
      pad = 280 / zoom;
    const visible = this.nodes.filter(
      (n) =>
        this.selection.has(n.id) ||
        (n.x + (n.width || 230) > -x / zoom - pad &&
          n.x < (-x + r.width) / zoom + pad &&
          n.y + (n.height || 112) > -y / zoom - pad &&
          n.y < (-y + r.height) / zoom + pad),
    );
    const map = new Map(this.nodes.map((n) => [n.id, n]));
    const edges = this.edges
      .map((e) => {
        const a = map.get(e.sourceId || e.from),
          b = map.get(e.targetId || e.to);
        if (!a || !b) return "";
        const x1 = a.x + (a.width || 230),
          y1 = a.y + (a.height || 112) / 2,
          x2 = b.x,
          y2 = b.y + (b.height || 112) / 2,
          c = Math.max(54, Math.abs(x2 - x1) * 0.45),
          active = this.selection.has(a.id) || this.selection.has(b.id);
        return `<g class="edge ${active ? "active" : ""}" data-edge="${esc(e.id)}"><path d="M${x1} ${y1} C${x1 + c} ${y1},${x2 - c} ${y2},${x2} ${y2}"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 9}" text-anchor="middle">${esc(e.label || e.kind || e.type || "depends on")}</text></g>`;
      })
      .join("");
    const groups = this.groupBounds()
      .map(
        (g) =>
          `<div class="group-outline" style="left:${g.x}px;top:${g.y}px;width:${g.r - g.x}px;height:${g.b - g.y}px"><b>${esc(g.id)}</b></div>`,
      )
      .join("");
    const nodes = visible
      .map(
        (n) =>
          `<article class="canvas-node type-${esc(n.kind || n.type || "service")} ${this.selection.has(n.id) ? "selected" : ""}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;width:${n.width || 230}px;min-height:${n.height || 112}px"><button class="node-port in" aria-label="Connect into ${esc(n.name)}"></button><div class="node-kind">${esc(n.kind || n.type || "service")}</div><h3>${esc(n.name)}</h3><p>${esc(n.description || n.status || "")}</p><footer><span class="avatar">${esc(
            (n.ownerName || "?")
              .split(" ")
              .map((s) => s[0])
              .join("")
              .slice(0, 2),
          )}</span><span>${esc(n.ownerName || "Unassigned")}</span><span class="node-state ${esc(n.state || "healthy")}">${esc(n.state || "healthy")}</span></footer><button class="node-port out" aria-label="Connect from ${esc(n.name)}"></button></article>`,
      )
      .join("");
    const marquee = this.marquee
      ? `<div class="marquee" style="left:${Math.min(this.marquee.x1, this.marquee.x2)}px;top:${Math.min(this.marquee.y1, this.marquee.y2)}px;width:${Math.abs(this.marquee.x2 - this.marquee.x1)}px;height:${Math.abs(this.marquee.y2 - this.marquee.y1)}px"></div>`
      : "";
    this.root.innerHTML = `<div class="canvas-transform" style="transform:translate(${x}px,${y}px) scale(${zoom})"><svg class="edge-layer">${edges}</svg>${groups}${nodes}${marquee}</div><div class="zoom-readout">${Math.round(zoom * 100)}%</div>`;
  }
}
