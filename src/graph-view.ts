import { ItemView, WorkspaceLeaf } from "obsidian";
import { GraphData } from "./graph-data";
import { ConfigPanel, GraphConfig, DEFAULT_CONFIG } from "./settings";
import {
  select,
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  zoom,
  zoomIdentity,
  zoomTransform,
  ZoomBehavior,
  ZoomTransform,
  Simulation,
  SimulationNodeDatum,
  SimulationLinkDatum,
} from "d3";

export const VIEW_TYPE = "object-links-graph";

/* ═══════════════════════════════════════════════════════════════════
   Simulation Node/Edge Types
   ═══════════════════════════════════════════════════════════════════ */

type NodeType = "object" | "file";

type SimNode = SimulationNodeDatum & {
  id: string;
  label: string;
  type: NodeType;
  filePath: string;
  fileLabel: string;
  properties: Record<string, string>;
  startLine: number;
  connections: number;
  radius: number;
  /** True when node had 0 connections in the *base* graph (excluding optional folder edges). */
  isOrphan: boolean;
  /** Current visual alpha (interpolated for smooth transitions) */
  alpha: number;
  /** Target alpha based on highlight state */
  targetAlpha: number;
  /** d3 fixed position */
  fx: number | null;
  fy: number | null;
};

type SimEdge = SimulationLinkDatum<SimNode> & {
  edgeType: "object" | "wiki";
  /** Current visual alpha */
  alpha: number;
  /** Target alpha */
  targetAlpha: number;
};

/* ═══════════════════════════════════════════════════════════════════
   Color Helpers
   ═══════════════════════════════════════════════════════════════════ */

function parseColor(css: string): [number, number, number] {
  if (css.startsWith("#")) {
    const hex = css.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16) / 255,
        parseInt(hex[1] + hex[1], 16) / 255,
        parseInt(hex[2] + hex[2], 16) / 255,
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  const m = css.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (m) return [parseInt(m[1]) / 255, parseInt(m[2]) / 255, parseInt(m[3]) / 255];
  return [0.6, 0.6, 0.6];
}

function getThemeColor(el: HTMLElement, varName: string, fallback: string): [number, number, number] {
  const style = getComputedStyle(el);
  const val = style.getPropertyValue(varName).trim();
  return parseColor(val || fallback);
}

function colorToCSS(c: [number, number, number]): string {
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
}

/* ═══════════════════════════════════════════════════════════════════
   Lerp helper
   ═══════════════════════════════════════════════════════════════════ */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ═══════════════════════════════════════════════════════════════════
   GraphView — Canvas + d3-force
   ═══════════════════════════════════════════════════════════════════ */

export class GraphView extends ItemView {
  private graphData: GraphData | null = null;
  private simulation: Simulation<SimNode, SimEdge> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private configPanel: ConfigPanel | null = null;
  private config: GraphConfig = { ...DEFAULT_CONFIG };

  // Canvas state
  private canvasWrapper: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;

  // d3-zoom
  private zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown> | null = null;
  private zoomTransform: ZoomTransform = zoomIdentity;
  private isSyncingZoom = false;

  // Sim data
  private simNodes: SimNode[] = [];
  private simEdges: SimEdge[] = [];

  // Camera (current = smoothed, target = where we want to be)
  private camX = 0;
  private camY = 0;
  private camScale = 0.7;
  private targetCamX = 0;
  private targetCamY = 0;
  private targetCamScale = 0.7;

  // Interaction state
  private hoveredNode: SimNode | null = null;
  private selectedNode: SimNode | null = null;
  private dragNode: SimNode | null = null;
  private isDragging = false;
  private lastClickTime = 0;
  private lastClickId = "";

  // Render loop
  private renderLoopId: number = 0;
  private needsRedraw = true;

  // Theme colors (cached)
  private colorNodeObject: [number, number, number] = [0.5, 0.5, 1.0];
  private colorNodeFile: [number, number, number] = [0.6, 0.6, 0.6];
  private colorEdgeWiki: [number, number, number] = [0.5, 0.5, 0.5];
  private colorEdgeObj: [number, number, number] = [0.5, 0.5, 1.0];
  private colorHighlight: [number, number, number] = [0.5, 0.5, 1.0];
  private colorBg: [number, number, number] = [0.1, 0.1, 0.1];
  private colorText = "#dcddde";

  // Callbacks
  public navigateToObject: ((filePath: string, startLine: number) => void) | null = null;
  public navigateToFile: ((filePath: string) => void) | null = null;

  // Bound handlers
  private _onWheel: ((e: WheelEvent) => void) | null = null;
  private _onMouseDown: ((e: MouseEvent) => void) | null = null;
  private _onMouseMove: ((e: MouseEvent) => void) | null = null;
  private _onMouseUp: ((e: MouseEvent) => void) | null = null;
  private _onDblClick: ((e: MouseEvent) => void) | null = null;
  private _onContainerMouseDown: ((e: MouseEvent) => void) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Object Links"; }
  getIcon(): string { return "git-fork"; }

  setGraphData(data: GraphData): void {
    this.graphData = data;
    if (this.containerEl) this.renderGraph();
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("ol-graph-container");

    if (this.graphData) {
      this.renderGraph();
    } else {
      container.createEl("div", {
        cls: "ol-empty-state",
        text: "Open the graph using the command palette or ribbon icon.",
      });
    }
  }

  async onClose(): Promise<void> {
    this.cleanup();
  }

  private cleanup(): void {
    this.stopRenderLoop();
    if (this.simulation) {
      this.simulation.stop();
      this.simulation.on("tick", null);
      this.simulation = null;
    }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.configPanel) { this.configPanel.destroy(); this.configPanel = null; }
    this.removeCanvasListeners();
    if (this._onContainerMouseDown) {
      this.contentEl.removeEventListener("mousedown", this._onContainerMouseDown, true);
      this._onContainerMouseDown = null;
    }

    this.simNodes = [];
    this.simEdges = [];

    this.canvasEl?.remove();
    this.canvasEl = null;
    this.ctx = null;
    this.canvasWrapper = null;
  }

  private removeCanvasListeners(): void {
    const c = this.canvasEl;
    if (!c) return;
    if (this._onWheel) c.removeEventListener("wheel", this._onWheel);
    // mousedown was registered with capture:true to intercept before d3-zoom
    if (this._onMouseDown) c.removeEventListener("mousedown", this._onMouseDown, true);
    if (this._onMouseMove) c.removeEventListener("mousemove", this._onMouseMove);
    if (this._onMouseUp) c.removeEventListener("mouseup", this._onMouseUp);
    if (this._onDblClick) c.removeEventListener("dblclick", this._onDblClick);
  }

  /* ── Render loop ───────────────────────────────────────────────── */

  private startRenderLoop(): void {
    if (this.renderLoopId) return;
    const frame = () => {
      this.renderLoopId = requestAnimationFrame(frame);
      this.updateAndDraw();
    };
    this.renderLoopId = requestAnimationFrame(frame);
  }

  private stopRenderLoop(): void {
    if (this.renderLoopId) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = 0;
    }
  }

  private updateAndDraw(): void {
    let animating = false;

    // Smooth camera interpolation
    const camLerp = 0.15;
    if (Math.abs(this.camX - this.targetCamX) > 0.01 ||
        Math.abs(this.camY - this.targetCamY) > 0.01 ||
        Math.abs(this.camScale - this.targetCamScale) > 0.0001) {
      this.camX = lerp(this.camX, this.targetCamX, camLerp);
      this.camY = lerp(this.camY, this.targetCamY, camLerp);
      this.camScale = lerp(this.camScale, this.targetCamScale, camLerp);
      if (Math.abs(this.camScale - this.targetCamScale) < 0.0001) {
        this.camScale = this.targetCamScale;
        this.camX = this.targetCamX;
        this.camY = this.targetCamY;
      }
      animating = true;
    }

    // Smooth alpha interpolation for nodes/edges
    const alphaLerp = 0.12;
    for (const n of this.simNodes) {
      if (Math.abs(n.alpha - n.targetAlpha) > 0.005) {
        n.alpha = lerp(n.alpha, n.targetAlpha, alphaLerp);
        animating = true;
      } else {
        n.alpha = n.targetAlpha;
      }
    }
    for (const e of this.simEdges) {
      if (Math.abs(e.alpha - e.targetAlpha) > 0.005) {
        e.alpha = lerp(e.alpha, e.targetAlpha, alphaLerp);
        animating = true;
      } else {
        e.alpha = e.targetAlpha;
      }
    }

    const simActive = (this.simulation?.alpha() ?? 0) > 0.001;

    if (animating || simActive || this.needsRedraw) {
      this.needsRedraw = false;
      this.draw();
    }
  }

  /* ── Filtering ─────────────────────────────────────────────────── */

  private applyFilters(data: GraphData): GraphData {
    const c = this.config;
    let nodes = [...data.nodes];
    let edges = [...data.edges];

    if (!c.showFiles) {
      const ids = new Set(nodes.filter((n) => n.type === "file").map((n) => n.id));
      nodes = nodes.filter((n) => n.type !== "file");
      edges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
    }
    if (!c.showObjects) {
      const ids = new Set(nodes.filter((n) => n.type === "object").map((n) => n.id));
      nodes = nodes.filter((n) => n.type !== "object");
      edges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
    }
    if (!c.showWikiEdges) edges = edges.filter((e) => e.edgeType !== "wiki");
    if (!c.showObjectEdges) edges = edges.filter((e) => e.edgeType !== "object");
    if (c.search) {
      const q = c.search.toLowerCase();
      const matched = new Set(nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
      for (const e of edges) {
        if (matched.has(e.source)) matched.add(e.target);
        if (matched.has(e.target)) matched.add(e.source);
      }
      nodes = nodes.filter((n) => matched.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }
    if (c.pathFilter) {
      const pf = c.pathFilter.toLowerCase();
      const matched = new Set(nodes.filter((n) => n.filePath.toLowerCase().includes(pf)).map((n) => n.id));
      for (const e of edges) {
        if (matched.has(e.source)) matched.add(e.target);
        if (matched.has(e.target)) matched.add(e.source);
      }
      nodes = nodes.filter((n) => matched.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }
    if (c.sourceFilter) {
      const sf = c.sourceFilter.toLowerCase();
      const removed = new Set(
        nodes.filter((n) => n.type === "object" && !n.fileLabel.toLowerCase().includes(sf)).map((n) => n.id)
      );
      nodes = nodes.filter((n) => !removed.has(n.id));
      edges = edges.filter((e) => !removed.has(e.source) && !removed.has(e.target));
    }
    if (!c.showOrphans) {
      const connected = new Set<string>();
      for (const e of edges) { connected.add(e.source); connected.add(e.target); }
      nodes = nodes.filter((n) => connected.has(n.id));
    }

    const cc = new Map<string, number>();
    for (const e of edges) {
      cc.set(e.source, (cc.get(e.source) || 0) + 1);
      cc.set(e.target, (cc.get(e.target) || 0) + 1);
    }
    for (const n of nodes) n.connections = cc.get(n.id) || 0;

    return { nodes, edges };
  }

  /* ── Node radius ───────────────────────────────────────────────── */

  private getNodeRadius(n: { type: string; connections: number }): number {
    const m = this.config.nodeSizeMultiplier;
    const base = n.type === "file" ? 4.5 : 5.5;
    const deg = Math.max(0, n.connections);
    const bump = Math.min(10, Math.sqrt(deg) * 1.6);
    return (base + bump) * m;
  }

  /* ── Theme colors ──────────────────────────────────────────────── */

  private refreshColors(): void {
    const el = this.contentEl;
    this.colorNodeObject = getThemeColor(el, "--interactive-accent", "#7f6df2");
    this.colorNodeFile = getThemeColor(el, "--text-muted", "#999999");
    this.colorEdgeWiki = getThemeColor(el, "--background-modifier-border", "#555555");
    this.colorEdgeObj = getThemeColor(el, "--interactive-accent", "#7f6df2");
    this.colorHighlight = getThemeColor(el, "--interactive-accent", "#7f6df2");
    this.colorBg = getThemeColor(el, "--background-primary", "#1e1e1e");
    const style = getComputedStyle(el);
    this.colorText = style.getPropertyValue("--text-normal").trim() || "#dcddde";
  }

  /* ── Coordinate transforms ─────────────────────────────────────── */

  private getScreenSize(): { w: number; h: number } {
    const c = this.canvasEl;
    if (!c) return { w: 0, h: 0 };
    // Use CSS pixels; drawing code uses CSS px coordinates.
    return { w: c.clientWidth, h: c.clientHeight };
  }

  private worldToScreen(wx: number, wy: number): [number, number] {
    const { w, h } = this.getScreenSize();
    return [
      (wx - this.camX) * this.camScale + w / 2,
      (wy - this.camY) * this.camScale + h / 2,
    ];
  }

  private screenToWorld(sx: number, sy: number): [number, number] {
    const { w, h } = this.getScreenSize();
    return [
      (sx - w / 2) / this.camScale + this.camX,
      (sy - h / 2) / this.camScale + this.camY,
    ];
  }

  private screenToWorldTarget(sx: number, sy: number): [number, number] {
    const { w, h } = this.getScreenSize();
    return [
      (sx - w / 2) / this.targetCamScale + this.targetCamX,
      (sy - h / 2) / this.targetCamScale + this.targetCamY,
    ];
  }

  /* ── Hit test ──────────────────────────────────────────────────── */

  private hitTestNode(sx: number, sy: number): SimNode | null {
    const [wx, wy] = this.screenToWorld(sx, sy);
    let best: SimNode | null = null;
    let bestDist = Infinity;
    for (const n of this.simNodes) {
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      const dx = nx - wx;
      const dy = ny - wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = Math.max(n.radius + 4, 8 / this.camScale);
      if (dist < hitRadius && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    return best;
  }

  /* ── Update highlight targets ──────────────────────────────────── */

  private updateHighlightTargets(): void {
    const focus = this.hoveredNode || this.selectedNode;
    if (!focus) {
      for (const n of this.simNodes) {
        n.targetAlpha = n.type === "object" ? 0.9 : 0.5;
      }
      for (const e of this.simEdges) {
        e.targetAlpha = e.edgeType === "wiki" ? 0.35 : 0.25;
      }
      return;
    }

    const connected = new Set<string>();
    connected.add(focus.id);
    for (const e of this.simEdges) {
      const s = (e.source as SimNode).id;
      const t = (e.target as SimNode).id;
      if (s === focus.id) connected.add(t);
      if (t === focus.id) connected.add(s);
    }

    for (const n of this.simNodes) {
      if (n === focus) {
        n.targetAlpha = 1.0;
      } else if (connected.has(n.id)) {
        n.targetAlpha = n.type === "object" ? 0.9 : 0.7;
      } else {
        n.targetAlpha = 0.06;
      }
    }

    for (const e of this.simEdges) {
      const s = (e.source as SimNode).id;
      const t = (e.target as SimNode).id;
      if (s === focus.id || t === focus.id) {
        e.targetAlpha = 0.8;
      } else {
        e.targetAlpha = 0.03;
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     Main Render — called once on initial data, and on filter changes
     ══════════════════════════════════════════════════════════════════ */

  private renderGraph(): void {
    if (!this.graphData) return;

    const container = this.contentEl;
    const isFirstRender = !this.canvasEl;

    if (isFirstRender) {
      container.empty();
      container.addClass("ol-graph-container");

      // Config panel
      this.configPanel = new ConfigPanel(container, this.config, (newConfig) => {
        this.handleConfigChange(newConfig);
      });

      // Canvas wrapper
      this.canvasWrapper = document.createElement("div");
      this.canvasWrapper.style.cssText = "position:absolute;inset:0;";
      container.appendChild(this.canvasWrapper);

      this.refreshColors();
      this.initCanvas();
      this.rebuildSimData();
      return;
    }

    this.rebuildSimData();
  }

  private initCanvas(): void {
    const wrapper = this.canvasWrapper!;

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    wrapper.appendChild(canvas);

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Failed to init 2D canvas context");

    this.canvasEl = canvas;
    this.ctx = ctx;

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.needsRedraw = true;
    });
    this.resizeObserver.observe(this.contentEl);

    this.resizeCanvas();
    this.setupInputHandlers();

    // Clicking outside the info panel should close it.
    if (!this._onContainerMouseDown) {
      this._onContainerMouseDown = (e: MouseEvent) => {
        const panel = this.contentEl.querySelector(".ol-info-panel") as HTMLElement | null;
        if (!panel) return;
        const target = e.target as HTMLElement | null;
        if (target && panel.contains(target)) return;

        // If the click was on the canvas, the canvas handlers will decide
        // whether to keep selection (node click) or clear (empty click).
        if (target === this.canvasEl) return;

        this.selectedNode = null;
        this.updateHighlightTargets();
        this.removeInfoPanel(this.contentEl);
        this.needsRedraw = true;
      };
      this.contentEl.addEventListener("mousedown", this._onContainerMouseDown, true);
    }

    this.startRenderLoop();
  }

  private resizeCanvas(): void {
    const canvas = this.canvasEl;
    const wrapper = this.canvasWrapper;
    if (!canvas || !wrapper) return;

    const w = wrapper.clientWidth || this.contentEl.clientWidth || 800;
    const h = wrapper.clientHeight || this.contentEl.clientHeight || 600;

    this.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(w * this.dpr));
    canvas.height = Math.max(1, Math.floor(h * this.dpr));

    // Make drawing commands in CSS pixels
    const ctx = this.ctx!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Rebuild simulation nodes/edges from current graphData + filters */
  private rebuildSimData(): void {
    if (!this.graphData) return;

    const filtered = this.applyFilters(this.graphData);
    const container = this.contentEl;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Show/hide empty state
    const existingEmpty = container.querySelector(".ol-empty-state");
    if (existingEmpty) existingEmpty.remove();

    if (filtered.nodes.length === 0) {
      if (this.canvasWrapper) this.canvasWrapper.style.display = "none";
      container.createEl("div", {
        cls: "ol-empty-state",
        text: "No nodes match the current filters.",
      });
      if (this.simulation) { this.simulation.stop(); this.simulation = null; }
      return;
    }
    if (this.canvasWrapper) this.canvasWrapper.style.display = "";

    // Preserve existing node positions where possible
    const oldPositions = new Map<string, { x: number; y: number }>();
    for (const n of this.simNodes) {
      oldPositions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    }

    // Orphan detection BEFORE optional folder edges.
    const baseOrphans = new Set<string>();
    for (const n of filtered.nodes) {
      if ((n.connections || 0) === 0) baseOrphans.add(n.id);
    }

    // Option: connect orphans to their folder (so they cluster by location).
    // Implemented here (view-level) to avoid changing the base graph model.
    const nodesPlus = [...filtered.nodes] as any[];
    const edgesPlus = [...filtered.edges] as any[];

    if (this.config.connectOrphansToFolders) {
      const folderNodeId = (folder: string) => `folder::${folder}`;
      const folderLabel = (folder: string) => {
        const cleaned = folder.replace(/\/+$/, "");
        if (!cleaned || cleaned === "/") return "/";
        const parts = cleaned.split("/").filter(Boolean);
        return parts[parts.length - 1] || cleaned;
      };

      const existing = new Set(nodesPlus.map((n) => n.id));
      const edgeSet = new Set(edgesPlus.map((e) => [e.source, e.target].sort().join("--")));

      for (const n of filtered.nodes) {
        if (!baseOrphans.has(n.id)) continue;

        const path = n.filePath || "";
        const idx = path.lastIndexOf("/");
        const folder = idx > 0 ? path.slice(0, idx) : "/";
        const fid = folderNodeId(folder);

        if (!existing.has(fid)) {
          existing.add(fid);
          nodesPlus.push({
            id: fid,
            label: folderLabel(folder),
            type: "file",
            filePath: folder + "/",
            fileLabel: folderLabel(folder),
            properties: {},
            startLine: 0,
            connections: 0,
          });
        }

        const edgeId = [n.id, fid].sort().join("--");
        if (!edgeSet.has(edgeId)) {
          edgeSet.add(edgeId);
          edgesPlus.push({ source: n.id, target: fid, edgeType: "wiki" });
        }
      }
    }

    const nodeById = new Map<string, SimNode>();

    this.simNodes = nodesPlus.map((n) => {
      const old = oldPositions.get(n.id);
      const baseAlpha = n.type === "object" ? 0.9 : 0.5;
      const node: SimNode = {
        ...(n as any),
        isOrphan: baseOrphans.has(n.id),
        x: old ? old.x : (Math.random() - 0.5) * width * 0.4,
        y: old ? old.y : (Math.random() - 0.5) * height * 0.4,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        radius: this.getNodeRadius(n),
        alpha: baseAlpha,
        targetAlpha: baseAlpha,
      };
      nodeById.set(node.id, node);
      return node;
    });

    this.simEdges = edgesPlus
      .map((e) => {
        const s = nodeById.get(e.source);
        const t = nodeById.get(e.target);
        if (!s || !t) return null;
        const baseAlpha = e.edgeType === "wiki" ? 0.35 : 0.25;
        const edge: SimEdge = {
          source: s,
          target: t,
          edgeType: e.edgeType,
          alpha: baseAlpha,
          targetAlpha: baseAlpha,
        };
        return edge;
      })
      .filter((e): e is SimEdge => e !== null);

    this.hoveredNode = null;
    this.selectedNode = null;
    this.dragNode = null;

    this.startSimulation();
    this.updateHighlightTargets();
    this.needsRedraw = true;
  }

  private startSimulation(): void {
    // Stop old sim
    if (this.simulation) {
      this.simulation.stop();
      this.simulation.on("tick", null);
      this.simulation = null;
    }

    const sim = forceSimulation<SimNode, SimEdge>(this.simNodes)
      .alpha(1)
      .alphaTarget(0)
      .alphaDecay(0.0228)
      .alphaMin(0.001)
      .velocityDecay(0.4);

    const linkForce = forceLink<SimNode, SimEdge>(this.simEdges)
      .distance(this.config.linkDistance)
      .strength(0.4);

    // Repel. Config is positive, d3 expects negative for repulsion.
    const chargeForce = forceManyBody<SimNode>()
      .strength(-this.config.repelStrength)
      .distanceMax(Math.max(this.config.repelStrength * 2, 600));

    // Centering: use forceX/Y with configurable strength.
    const centerX = forceX<SimNode>(0).strength(this.config.centerStrength);
    const centerY = forceY<SimNode>(0).strength(this.config.centerStrength);

    // Collision: guarantee non-overlap + a little padding.
    const collide = forceCollide<SimNode>((d) => d.radius + 14)
      .strength(0.95)
      .iterations(2);

    sim
      .force("link", linkForce)
      .force("charge", chargeForce)
      .force("centerX", centerX)
      .force("centerY", centerY)
      .force("collide", collide);

    sim.on("tick", () => {
      this.needsRedraw = true;
    });

    this.simulation = sim;
  }

  /** Handle config panel changes without rebuilding the entire view */
  private handleConfigChange(newConfig: GraphConfig): void {
    const old = this.config;
    this.config = newConfig;

    const filterChanged =
      old.showFiles !== newConfig.showFiles ||
      old.showObjects !== newConfig.showObjects ||
      old.showWikiEdges !== newConfig.showWikiEdges ||
      old.showObjectEdges !== newConfig.showObjectEdges ||
      old.showOrphans !== newConfig.showOrphans ||
      old.connectOrphansToFolders !== newConfig.connectOrphansToFolders ||
      old.search !== newConfig.search ||
      old.pathFilter !== newConfig.pathFilter ||
      old.sourceFilter !== newConfig.sourceFilter;

    if (filterChanged) {
      this.rebuildSimData();
      return;
    }

    // Update radii
    for (const n of this.simNodes) {
      n.radius = this.getNodeRadius(n);
    }

    // Update forces
    if (this.simulation) {
      const link = this.simulation.force("link") as any;
      link?.distance?.(newConfig.linkDistance);

      const charge = this.simulation.force("charge") as any;
      charge?.strength?.(-newConfig.repelStrength);
      charge?.distanceMax?.(Math.max(newConfig.repelStrength * 2, 600));

      const cx = this.simulation.force("centerX") as any;
      cx?.strength?.(newConfig.centerStrength);
      const cy = this.simulation.force("centerY") as any;
      cy?.strength?.(newConfig.centerStrength);

      const collide = this.simulation.force("collide") as any;
      collide?.radius?.((d: SimNode) => d.radius + 14);

      this.simulation.alpha(Math.max(this.simulation.alpha(), 0.3)).restart();
    }

    this.updateHighlightTargets();
    this.needsRedraw = true;
  }

  /* ══════════════════════════════════════════════════════════════════
     Canvas Draw
     ══════════════════════════════════════════════════════════════════ */

  private clear(): void {
    const ctx = this.ctx;
    const canvas = this.canvasEl;
    if (!ctx || !canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = colorToCSS(this.colorBg);
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  private draw(): void {
    if (!this.ctx || !this.canvasEl) return;

    // Theme might change during runtime
    this.refreshColors();

    this.clear();

    if (this.simNodes.length === 0) return;

    this.drawEdges();
    this.drawNodes();
    this.drawLabels();
  }

  private drawEdges(): void {
    const ctx = this.ctx!;
    const canvas = this.canvasEl!;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const halfW = w / 2;
    const halfH = h / 2;

    if (this.simEdges.length === 0) return;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.lineCap = "round";

    for (const e of this.simEdges) {
      const s = e.source as SimNode;
      const t = e.target as SimNode;

      const sxw = s.x ?? 0;
      const syw = s.y ?? 0;
      const txw = t.x ?? 0;
      const tyw = t.y ?? 0;

      const sx = (sxw - this.camX) * this.camScale + halfW;
      const sy = (syw - this.camY) * this.camScale + halfH;
      const tx = (txw - this.camX) * this.camScale + halfW;
      const ty = (tyw - this.camY) * this.camScale + halfH;

      const isWiki = e.edgeType === "wiki";
      const col = isWiki ? this.colorEdgeWiki : this.colorEdgeObj;

      ctx.strokeStyle = colorToCSS(col);
      ctx.globalAlpha = e.alpha;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawNodes(): void {
    const ctx = this.ctx!;
    const canvas = this.canvasEl!;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const halfW = w / 2;
    const halfH = h / 2;
    const focus = this.hoveredNode || this.selectedNode;

    ctx.save();

    for (const n of this.simNodes) {
      const nxw = n.x ?? 0;
      const nyw = n.y ?? 0;

      // All nodes use the theme accent color, except *base graph* orphans which are grey.
      const isOrphan = !!n.isOrphan;

      let col: [number, number, number];
      if (focus && n === focus) {
        col = isOrphan ? this.colorNodeFile : this.colorHighlight;
      } else {
        col = isOrphan ? this.colorNodeFile : this.colorNodeObject;
      }

      const cx = (nxw - this.camX) * this.camScale + halfW;
      const cy = (nyw - this.camY) * this.camScale + halfH;

      // Clamp node size on screen so zooming in doesn't create giant balls.
      const maxR = Math.max(2, this.config.nodeMaxScreenRadius);
      const r = Math.min(maxR, n.radius * this.camScale);

      ctx.fillStyle = colorToCSS(col);
      ctx.globalAlpha = n.alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawLabels(): void {
    const ctx = this.ctx!;
    const canvas = this.canvasEl!;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const halfW = w / 2;
    const halfH = h / 2;

    const labelOpacity = this.config.labelOpacity;
    const zoomFactor = this.camScale;

    // Only show labels after a zoom threshold (configurable), and scale font smoothly.
    const baseFontSize = 11;
    const fontSize = Math.max(8, Math.min(16, baseFontSize * Math.sqrt(zoomFactor)));
    const minZoom = Math.max(0, this.config.labelMinZoom);
    const zoomGate = zoomFactor >= minZoom;

    if (!zoomGate) return;

    ctx.save();
    ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.colorText;

    const placedRects: Array<{ x: number; y: number; w: number; h: number }> = [];
    const intersects = (r1: any, r2: any) =>
      r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;

    // Greedy label placement to reduce overlapping labels.
    const orderedNodes = [...this.simNodes].sort((a, b) => {
      if (b.alpha !== a.alpha) return b.alpha - a.alpha;
      return (b.connections || 0) - (a.connections || 0);
    });

    const maxW = Math.max(40, this.config.labelMaxWidth || 160);
    const ellipsis = "…";

    for (const n of orderedNodes) {
      const nxw = n.x ?? 0;
      const nyw = n.y ?? 0;
      const sx = (nxw - this.camX) * this.camScale + halfW;
      const sy = (nyw - this.camY) * this.camScale + halfH;
      const screenY = sy + n.radius * this.camScale + 6;

      // Cull off-screen labels
      if (sx < -100 || sx > w + 100 || sy < -100 || sy > h + 100) continue;

      let alpha: number;
      if (n.targetAlpha < 0.1) {
        alpha = Math.min(labelOpacity, n.alpha) * 0.3;
      } else {
        alpha = labelOpacity * (n.alpha / Math.max(0.0001, n.targetAlpha));
        if (n === (this.hoveredNode || this.selectedNode)) alpha = 1.0;
      }

      if (alpha < 0.01) continue;

      // Truncate label to a max pixel width.
      const full = n.label;
      let shown = full;
      if (ctx.measureText(full).width > maxW) {
        let lo = 0, hi = full.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          const candidate = full.slice(0, mid) + ellipsis;
          if (ctx.measureText(candidate).width <= maxW) lo = mid;
          else hi = mid - 1;
        }
        shown = full.slice(0, Math.max(0, lo)) + ellipsis;
      }

      const metrics = ctx.measureText(shown);
      const textW = metrics.width;
      const textH = fontSize; // good enough for overlap culling

      const pad = 3;
      const rect = {
        x: sx - textW / 2 - pad,
        y: screenY - pad,
        w: textW + pad * 2,
        h: textH + pad * 2,
      };

      let collides = false;
      for (const r of placedRects) {
        if (intersects(rect, r)) { collides = true; break; }
      }

      const isFocus = n === (this.hoveredNode || this.selectedNode);
      if (!isFocus && collides) continue;

      ctx.globalAlpha = alpha;
      ctx.fillText(shown, sx, screenY);
      placedRects.push(rect);
    }

    ctx.restore();
  }

  /* ══════════════════════════════════════════════════════════════════
     Input Handlers
     ══════════════════════════════════════════════════════════════════ */

  private setupInputHandlers(): void {
    const canvas = this.canvasEl!;
    const container = this.contentEl;

    // d3-zoom (pan + wheel zoom) on canvas.
    // We keep our own (camX/camY/camScale) camera, but drive targetCam* from zoom transform.
    const updateTargetFromZoom = (t: any, sourceEvent?: Event | null) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const k = Math.max(0.03, Math.min(12, t.k));
      const x = t.x;
      const y = t.y;

      // screen = world * k + (x, y)
      // our camera: screen = (world - cam) * k + (w/2,h/2)
      // => x = -camX*k + w/2  => camX = (w/2 - x)/k
      const camX = (w / 2 - x) / k;
      const camY = (h / 2 - y) / k;

      this.zoomTransform = t;
      this.targetCamScale = k;
      this.targetCamX = camX;
      this.targetCamY = camY;

      // For drag-panning, avoid camera lag (keep it 1:1).
      const se: any = sourceEvent as any;
      const isWheel = se?.type === "wheel";
      if (!isWheel) {
        this.camScale = this.targetCamScale;
        this.camX = this.targetCamX;
        this.camY = this.targetCamY;
      }

      this.needsRedraw = true;
    };

    // Attach zoom behavior once.
    if (!this.zoomBehavior) {
      this.zoomBehavior = zoom<HTMLCanvasElement, unknown>()
        .scaleExtent([0.03, 12])
        .filter((event: any) => {
          // Disable pan/zoom while dragging a node.
          if (this.dragNode) return false;
          // Only left mouse for drag-pan.
          if (event?.type?.startsWith("mouse") && event.button !== 0) return false;
          return true;
        })
        .on("zoom", (event: any) => {
          if (this.isSyncingZoom) return;
          updateTargetFromZoom(event.transform, event.sourceEvent);
        });

      const sel = select(canvas);
      sel.call(this.zoomBehavior as any);
      // We handle double click ourselves (open node), so disable d3's default zoom-on-dblclick.
      sel.on("dblclick.zoom", null);

      // Initialize transform to match our starting camera.
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const k = this.targetCamScale;
      const x = -this.targetCamX * k + w / 2;
      const y = -this.targetCamY * k + h / 2;
      this.isSyncingZoom = true;
      try {
        sel.call((this.zoomBehavior as any).transform, zoomIdentity.translate(x, y).scale(k));
      } finally {
        this.isSyncingZoom = false;
      }
    }

    // Mouse down: only used for node drag + click selection tracking.
    let downX = 0;
    let downY = 0;
    let downNode: SimNode | null = null;

    this._onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      downX = e.clientX;
      downY = e.clientY;
      downNode = this.hitTestNode(mx, my);

      if (downNode) {
        // Prevent d3-zoom from starting a pan when we intend to drag a node.
        e.stopPropagation();

        this.dragNode = downNode;
        this.isDragging = false;
        downNode.fx = downNode.x ?? 0;
        downNode.fy = downNode.y ?? 0;
        // Keep drag smooth (less aggressive reheating)
        this.simulation?.alphaTarget(0.15).restart();
      }
    };
    canvas.addEventListener("mousedown", this._onMouseDown, { capture: true });

    // Mouse move: update node drag OR hover/tooltip.
    this._onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.dragNode) {
        this.isDragging = true;
        const [wx, wy] = this.screenToWorld(mx, my);
        // Smooth drag: lerp towards the cursor instead of snapping.
        const t = 0.35;
        this.dragNode.fx = lerp(this.dragNode.fx ?? wx, wx, t);
        this.dragNode.fy = lerp(this.dragNode.fy ?? wy, wy, t);
        this.needsRedraw = true;
        return;
      }

      // Hover detection
      const node = this.hitTestNode(mx, my);
      if (node !== this.hoveredNode) {
        this.hoveredNode = node;
        canvas.style.cursor = node ? "pointer" : "default";
        this.updateHighlightTargets();

        if (node) {
          this.showTooltip(node, container);
        } else {
          this.hideTooltip(container);
        }
      } else if (node) {
        this.moveTooltip(e, container);
      }
    };
    canvas.addEventListener("mousemove", this._onMouseMove);

    // Mouse up: drop drag node, handle click/select/dblclick logic.
    this._onMouseUp = (e: MouseEvent) => {
      const upDx = Math.abs(e.clientX - downX);
      const upDy = Math.abs(e.clientY - downY);
      const isClick = upDx < 3 && upDy < 3;

      if (this.dragNode) {
        const wasDragging = this.isDragging;
        this.dragNode.fx = null;
        this.dragNode.fy = null;

        if (!wasDragging) {
          const now = Date.now();
          const node = this.dragNode;

          if (this.lastClickId === node.id && now - this.lastClickTime < 300) {
            if (node.type === "object" && this.navigateToObject) {
              this.navigateToObject(node.filePath, node.startLine);
            } else if (node.type === "file" && this.navigateToFile) {
              this.navigateToFile(node.filePath);
            }
            this.lastClickTime = 0;
            this.lastClickId = "";
          } else {
            this.lastClickTime = now;
            this.lastClickId = node.id;
            this.selectedNode = node;
            this.updateHighlightTargets();
            this.showInfoPanel(node, container);
          }
        }

        this.dragNode = null;
        this.isDragging = false;
        this.simulation?.alphaTarget(0);
        return;
      }

      // Click on empty space clears selection.
      if (isClick && !downNode) {
        this.selectedNode = null;
        this.updateHighlightTargets();
        this.removeInfoPanel(container);
      }
    };
    canvas.addEventListener("mouseup", this._onMouseUp);

    // Prevent browser defaults
    this._onDblClick = (e: MouseEvent) => { e.preventDefault(); };
    canvas.addEventListener("dblclick", this._onDblClick);
  }

  /* ── Tooltip ───────────────────────────────────────────────────── */

  private showTooltip(node: SimNode, container: HTMLElement): void {
    let tooltip = container.querySelector(".ol-tooltip") as HTMLElement;
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "ol-tooltip";
      container.appendChild(tooltip);
    }
    tooltip.textContent = node.label;
    tooltip.style.display = "block";
  }

  private moveTooltip(e: MouseEvent, container: HTMLElement): void {
    const tooltip = container.querySelector(".ol-tooltip") as HTMLElement;
    if (!tooltip) return;
    const rect = container.getBoundingClientRect();
    tooltip.style.left = e.clientX - rect.left + 14 + "px";
    tooltip.style.top = e.clientY - rect.top - 10 + "px";
  }

  private hideTooltip(container: HTMLElement): void {
    const tooltip = container.querySelector(".ol-tooltip") as HTMLElement;
    if (tooltip) tooltip.style.display = "none";
  }

  /* ── Info Panel ────────────────────────────────────────────────── */

  private removeInfoPanel(container: HTMLElement): void {
    const panel = container.querySelector(".ol-info-panel");
    if (panel) panel.remove();
  }

  private showInfoPanel(d: SimNode, container: HTMLElement): void {
    this.removeInfoPanel(container);

    const panel = document.createElement("div");
    panel.className = "ol-info-panel";

    const title = document.createElement("div");
    title.className = "ol-info-title";
    title.textContent = d.label;
    panel.appendChild(title);

    const badge = document.createElement("div");
    badge.className = `ol-info-type ol-info-type-${d.type}`;
    badge.textContent = d.type === "object" ? "Object" : "File";
    panel.appendChild(badge);

    const filePath = document.createElement("div");
    filePath.className = "ol-info-file";
    filePath.textContent = d.filePath;
    panel.appendChild(filePath);

    if (d.type === "object" && Object.keys(d.properties).length > 0) {
      const props = document.createElement("div");
      props.className = "ol-info-props";
      for (const [k, v] of Object.entries(d.properties)) {
        const row = document.createElement("div");
        row.className = "ol-info-prop-row";
        const keyEl = document.createElement("span");
        keyEl.className = "ol-info-prop-key";
        keyEl.textContent = k;
        const valEl = document.createElement("span");
        valEl.className = "ol-info-prop-val";
        valEl.textContent = v;
        row.appendChild(keyEl);
        row.appendChild(valEl);
        props.appendChild(row);
      }
      panel.appendChild(props);
    }

    const conn = document.createElement("div");
    conn.className = "ol-info-connections";
    conn.textContent = `${d.connections} connection${d.connections !== 1 ? "s" : ""}`;
    panel.appendChild(conn);

    const goBtn = document.createElement("button");
    goBtn.className = "ol-info-go-btn";
    goBtn.textContent = d.type === "object" ? "Go to object" : "Open file";
    goBtn.addEventListener("click", () => {
      if (d.type === "object" && this.navigateToObject) {
        this.navigateToObject(d.filePath, d.startLine);
      } else if (this.navigateToFile) {
        this.navigateToFile(d.filePath);
      }
    });
    panel.appendChild(goBtn);

    container.appendChild(panel);
  }
}
