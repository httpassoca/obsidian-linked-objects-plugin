import { ItemView, WorkspaceLeaf } from "obsidian";
import { GraphData, GraphNode, GraphEdge } from "./graph-data";
import { ConfigPanel, GraphConfig, DEFAULT_CONFIG } from "./settings";
import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";

export const VIEW_TYPE = "object-links-graph";

/* ═══════════════════════════════════════════════════════════════════
   Simulation Node/Edge Types
   ═══════════════════════════════════════════════════════════════════ */

interface SimNode {
  id: string;
  label: string;
  type: "object" | "file";
  filePath: string;
  fileLabel: string;
  properties: Record<string, string>;
  startLine: number;
  connections: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
  radius: number;
  /** Current visual alpha (interpolated for smooth transitions) */
  alpha: number;
  /** Target alpha based on highlight state */
  targetAlpha: number;
}

interface SimEdge {
  source: number;
  target: number;
  edgeType: "object" | "wiki";
  /** Current visual alpha */
  alpha: number;
  /** Target alpha */
  targetAlpha: number;
}

/* ═══════════════════════════════════════════════════════════════════
   Force Simulation — tuned to match Obsidian native graph
   ═══════════════════════════════════════════════════════════════════ */

class ForceSimulation {
  nodes: SimNode[];
  edges: SimEdge[];
  alpha: number = 1.0;
  alphaTarget: number = 0;
  alphaDecay: number = 0.0228;
  alphaMin: number = 0.001;
  velocityDecay: number = 0.4;

  linkDistance: number;
  linkStrength: number = 0.4;
  chargeStrength: number;
  chargeDistMax: number;
  centerStrength: number;
  running = false;
  private animFrameId: number = 0;
  private onTick: (() => void) | null = null;

  private linkStrengths: number[] = [];
  private degreeCount: Map<number, number> = new Map();

  constructor(nodes: SimNode[], edges: SimEdge[], config: GraphConfig) {
    this.nodes = nodes;
    this.edges = edges;
    this.linkDistance = config.linkDistance;
    this.chargeStrength = config.repelStrength;
    this.chargeDistMax = Math.max(config.repelStrength * 2, 600);
    this.centerStrength = config.centerStrength;
    this.computeDegreeStrengths();
  }

  private computeDegreeStrengths(): void {
    this.degreeCount.clear();
    for (const e of this.edges) {
      this.degreeCount.set(e.source, (this.degreeCount.get(e.source) || 0) + 1);
      this.degreeCount.set(e.target, (this.degreeCount.get(e.target) || 0) + 1);
    }
    this.linkStrengths = this.edges.map((e) => {
      const ds = this.degreeCount.get(e.source) || 1;
      const dt = this.degreeCount.get(e.target) || 1;
      return 1 / Math.min(ds, dt);
    });
  }

  updateParams(config: GraphConfig): void {
    this.linkDistance = config.linkDistance;
    this.chargeStrength = config.repelStrength;
    this.chargeDistMax = Math.max(config.repelStrength * 2, 600);
    this.centerStrength = config.centerStrength;
    this.alpha = Math.max(this.alpha, 0.3);
    if (!this.running) this.start();
  }

  setOnTick(fn: () => void) { this.onTick = fn; }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
  }

  setAlphaTarget(t: number) {
    this.alphaTarget = t;
    if (t > 0) this.alpha = Math.max(this.alpha, t);
    if (!this.running) this.start();
  }

  private loop = () => {
    if (!this.running) return;

    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;

    if (this.alpha < this.alphaMin && this.alphaTarget === 0) {
      this.running = false;
      if (this.onTick) this.onTick();
      return;
    }

    this.applyForces();
    this.integratePositions();
    if (this.onTick) this.onTick();

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  private applyForces() {
    const nodes = this.nodes;
    const edges = this.edges;
    const alpha = this.alpha;

    // Link force
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const s = nodes[e.source];
      const t = nodes[e.target];
      let dx = t.x - s.x + (Math.random() - 0.5) * 0.01;
      let dy = t.y - s.y + (Math.random() - 0.5) * 0.01;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const str = this.linkStrengths[i] * this.linkStrength * alpha;
      const force = (dist - this.linkDistance) / dist * str;
      dx *= force;
      dy *= force;
      const bias = (this.degreeCount.get(e.source) || 1) /
        ((this.degreeCount.get(e.source) || 1) + (this.degreeCount.get(e.target) || 1));
      s.vx += dx * (1 - bias);
      s.vy += dy * (1 - bias);
      t.vx -= dx * bias;
      t.vy -= dy * bias;
    }

    // Many-body (charge) force
    const chargeStr = this.chargeStrength;
    const distMax2 = this.chargeDistMax * this.chargeDistMax;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 > distMax2) continue;
        if (dist2 < 4) dist2 = 4;
        const dist = Math.sqrt(dist2);
        const force = -chargeStr * alpha / dist2;
        const fx = dx / dist * force;
        const fy = dy / dist * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    // Center force
    let cx = 0, cy = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; }
    cx /= nodes.length || 1;
    cy /= nodes.length || 1;
    const cs = this.centerStrength * alpha;
    for (const n of nodes) {
      n.vx -= cx * cs;
      n.vy -= cy * cs;
    }

    // Collision force
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = a.radius + b.radius + 4;
        if (dist < minDist) {
          const strength = (minDist - dist) / dist * 0.35 * alpha;
          const ox = dx * strength;
          const oy = dy * strength;
          a.vx -= ox;
          a.vy -= oy;
          b.vx += ox;
          b.vy += oy;
        }
      }
    }
  }

  private integratePositions() {
    const decay = this.velocityDecay;
    for (const n of this.nodes) {
      if (n.fx !== null) {
        n.x = n.fx;
        n.vx = 0;
      } else {
        n.vx *= decay;
        n.x += n.vx;
      }
      if (n.fy !== null) {
        n.y = n.fy;
        n.vy = 0;
      } else {
        n.vy *= decay;
        n.y += n.vy;
      }
    }
  }
}

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

/** Convert [r,g,b] floats (0-1) to a hex number like 0xRRGGBB */
function colorToHex(c: [number, number, number]): number {
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
}

/** Convert [r,g,b] floats to CSS string */
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
   GraphView — PixiJS WebGL Renderer
   ═══════════════════════════════════════════════════════════════════ */

export class GraphView extends ItemView {
  private graphData: GraphData | null = null;
  private simulation: ForceSimulation | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private configPanel: ConfigPanel | null = null;
  private config: GraphConfig = { ...DEFAULT_CONFIG };

  // PixiJS state
  private pixiApp: Application | null = null;
  private worldContainer: Container | null = null;
  private edgeGraphics: Graphics | null = null;
  private nodeGraphics: Graphics | null = null;
  private labelContainer: Container | null = null;
  private labelTexts: Map<string, Text> = new Map();
  private pixiCanvas: HTMLCanvasElement | null = null;

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
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panStartCamX = 0;
  private panStartCamY = 0;
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

  // Canvas wrapper
  private canvasWrapper: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Object Links"; }
  getIcon(): string { return "git-fork"; }

  setGraphData(data: GraphData): void {
    this.graphData = data;
    if (this.containerEl) {
      this.renderGraph();
    }
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
    if (this.simulation) { this.simulation.stop(); this.simulation = null; }
    if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    if (this.configPanel) { this.configPanel.destroy(); this.configPanel = null; }
    this.removeCanvasListeners();

    // Destroy PixiJS
    if (this.pixiApp) {
      this.pixiApp.destroy(true, { children: true, texture: true });
      this.pixiApp = null;
    }
    this.worldContainer = null;
    this.edgeGraphics = null;
    this.nodeGraphics = null;
    this.labelContainer = null;
    this.labelTexts.clear();
    this.pixiCanvas = null;
    this.canvasWrapper = null;
  }

  private removeCanvasListeners(): void {
    const c = this.pixiCanvas;
    if (!c) return;
    if (this._onWheel) c.removeEventListener("wheel", this._onWheel);
    if (this._onMouseDown) c.removeEventListener("mousedown", this._onMouseDown);
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

    const simActive = this.simulation?.running || false;

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
    const base = n.type === "file" ? 4 : 5;
    return Math.max(base, Math.min(18, base + Math.sqrt(n.connections) * 2.5)) * m;
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

  private worldToScreen(wx: number, wy: number): [number, number] {
    const app = this.pixiApp;
    if (!app) return [0, 0];
    const w = app.screen.width;
    const h = app.screen.height;
    return [
      (wx - this.camX) * this.camScale + w / 2,
      (wy - this.camY) * this.camScale + h / 2,
    ];
  }

  private screenToWorld(sx: number, sy: number): [number, number] {
    const app = this.pixiApp;
    if (!app) return [0, 0];
    const w = app.screen.width;
    const h = app.screen.height;
    return [
      (sx - w / 2) / this.camScale + this.camX,
      (sy - h / 2) / this.camScale + this.camY,
    ];
  }

  private screenToWorldTarget(sx: number, sy: number): [number, number] {
    const app = this.pixiApp;
    if (!app) return [0, 0];
    const w = app.screen.width;
    const h = app.screen.height;
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
      const dx = n.x - wx;
      const dy = n.y - wy;
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
      const sId = this.simNodes[e.source].id;
      const tId = this.simNodes[e.target].id;
      if (sId === focus.id) connected.add(tId);
      if (tId === focus.id) connected.add(sId);
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
      const sId = this.simNodes[e.source].id;
      const tId = this.simNodes[e.target].id;
      if (sId === focus.id || tId === focus.id) {
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
    const isFirstRender = !this.pixiApp;

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

      // Initialize PixiJS — async but we handle it
      this.initPixi().then(() => {
        this.rebuildSimData();
      });
      return;
    }

    // Already initialized — just rebuild sim data
    this.rebuildSimData();
  }

  private async initPixi(): Promise<void> {
    const container = this.contentEl;
    const wrapper = this.canvasWrapper!;
    const width = wrapper.clientWidth || container.clientWidth || 800;
    const height = wrapper.clientHeight || container.clientHeight || 600;

    const app = new Application();
    await app.init({
      width,
      height,
      antialias: true,
      backgroundAlpha: 1,
      backgroundColor: colorToHex(this.colorBg),
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: "webgl",
    });

    // Get the canvas from the PixiJS app
    this.pixiCanvas = app.canvas as HTMLCanvasElement;
    this.pixiCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    wrapper.appendChild(this.pixiCanvas);

    this.pixiApp = app;

    // Create world container (holds all graph elements)
    this.worldContainer = new Container();
    app.stage.addChild(this.worldContainer);

    // Edge layer
    this.edgeGraphics = new Graphics();
    this.worldContainer.addChild(this.edgeGraphics);

    // Node layer
    this.nodeGraphics = new Graphics();
    this.worldContainer.addChild(this.nodeGraphics);

    // Label layer
    this.labelContainer = new Container();
    this.worldContainer.addChild(this.labelContainer);

    // Resize handling
    this.resizeObserver = new ResizeObserver(() => {
      this.resizePixi();
      this.needsRedraw = true;
    });
    this.resizeObserver.observe(container);

    // Input handlers
    this.setupInputHandlers();

    // Start render loop
    this.startRenderLoop();
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
      oldPositions.set(n.id, { x: n.x, y: n.y });
    }

    const nodeIdToIdx = new Map<string, number>();
    this.simNodes = filtered.nodes.map((n, i) => {
      nodeIdToIdx.set(n.id, i);
      const old = oldPositions.get(n.id);
      const baseAlpha = n.type === "object" ? 0.9 : 0.5;
      return {
        ...n,
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
    });

    this.simEdges = filtered.edges
      .map((e) => {
        const si = nodeIdToIdx.get(e.source);
        const ti = nodeIdToIdx.get(e.target);
        if (si === undefined || ti === undefined) return null;
        const baseAlpha = e.edgeType === "wiki" ? 0.35 : 0.25;
        return {
          source: si,
          target: ti,
          edgeType: e.edgeType,
          alpha: baseAlpha,
          targetAlpha: baseAlpha,
        } as SimEdge;
      })
      .filter((e): e is SimEdge => e !== null);

    // Stop old sim, start new one
    if (this.simulation) this.simulation.stop();
    this.simulation = new ForceSimulation(this.simNodes, this.simEdges, this.config);
    this.simulation.setOnTick(() => { this.needsRedraw = true; });
    this.simulation.start();

    this.hoveredNode = null;
    this.selectedNode = null;
    this.dragNode = null;
    this.updateHighlightTargets();
    this.needsRedraw = true;
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
      old.search !== newConfig.search ||
      old.pathFilter !== newConfig.pathFilter ||
      old.sourceFilter !== newConfig.sourceFilter;

    if (filterChanged) {
      this.rebuildSimData();
    } else {
      if (this.simulation) {
        this.simulation.updateParams(newConfig);
      }
      for (const n of this.simNodes) {
        n.radius = this.getNodeRadius(n);
      }
      this.updateHighlightTargets();
      this.needsRedraw = true;
    }
  }

  /* ── PixiJS resize ─────────────────────────────────────────────── */

  private resizePixi(): void {
    if (!this.pixiApp || !this.canvasWrapper) return;
    const w = this.canvasWrapper.clientWidth;
    const h = this.canvasWrapper.clientHeight;
    if (w > 0 && h > 0) {
      this.pixiApp.renderer.resize(w, h);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     PixiJS Draw
     ══════════════════════════════════════════════════════════════════ */

  private draw(): void {
    if (!this.pixiApp || !this.worldContainer) return;

    // Update background color
    this.pixiApp.renderer.background.color = colorToHex(this.colorBg);

    if (this.simNodes.length === 0) {
      if (this.edgeGraphics) this.edgeGraphics.clear();
      if (this.nodeGraphics) this.nodeGraphics.clear();
      if (this.labelContainer) {
        this.labelContainer.removeChildren();
        this.labelTexts.clear();
      }
      return;
    }

    this.drawEdges();
    this.drawNodes();
    this.drawLabels();
  }

  private drawEdges(): void {
    const g = this.edgeGraphics;
    if (!g) return;
    g.clear();

    if (this.simEdges.length === 0) return;

    const app = this.pixiApp!;
    const halfW = app.screen.width / 2;
    const halfH = app.screen.height / 2;

    for (const e of this.simEdges) {
      const s = this.simNodes[e.source];
      const t = this.simNodes[e.target];
      const isWiki = e.edgeType === "wiki";
      const col = isWiki ? this.colorEdgeWiki : this.colorEdgeObj;
      const alpha = e.alpha;

      const sx = (s.x - this.camX) * this.camScale + halfW;
      const sy = (s.y - this.camY) * this.camScale + halfH;
      const tx = (t.x - this.camX) * this.camScale + halfW;
      const ty = (t.y - this.camY) * this.camScale + halfH;

      g.setStrokeStyle({ width: 1, color: colorToHex(col), alpha });
      g.moveTo(sx, sy);
      g.lineTo(tx, ty);
      g.stroke();
    }
  }

  private drawNodes(): void {
    const g = this.nodeGraphics;
    if (!g) return;
    g.clear();

    if (this.simNodes.length === 0) return;

    const app = this.pixiApp!;
    const halfW = app.screen.width / 2;
    const halfH = app.screen.height / 2;
    const focus = this.hoveredNode || this.selectedNode;

    for (const n of this.simNodes) {
      const isObj = n.type === "object";
      let col: [number, number, number];

      if (focus && n === focus) {
        col = isObj ? this.colorHighlight : parseColor(this.colorText);
      } else {
        col = isObj ? this.colorNodeObject : this.colorNodeFile;
      }

      const cx = (n.x - this.camX) * this.camScale + halfW;
      const cy = (n.y - this.camY) * this.camScale + halfH;
      const r = n.radius * this.camScale;

      g.setFillStyle({ color: colorToHex(col), alpha: n.alpha });
      g.circle(cx, cy, r);
      g.fill();
    }
  }

  private drawLabels(): void {
    const lc = this.labelContainer;
    if (!lc || !this.pixiApp) return;

    const app = this.pixiApp;
    const halfW = app.screen.width / 2;
    const halfH = app.screen.height / 2;
    const labelOpacity = this.config.labelOpacity;

    const baseFontSize = 11;
    const fontSize = Math.max(8, Math.min(16, baseFontSize * Math.sqrt(this.camScale)));

    // Track which node IDs are still present
    const activeIds = new Set<string>();

    for (const n of this.simNodes) {
      activeIds.add(n.id);

      const sx = (n.x - this.camX) * this.camScale + halfW;
      const sy = (n.y - this.camY) * this.camScale + halfH;
      const screenY = sy + n.radius * this.camScale + 6;

      // Cull off-screen labels
      if (sx < -100 || sx > app.screen.width + 100 ||
          sy < -100 || sy > app.screen.height + 100) {
        const existing = this.labelTexts.get(n.id);
        if (existing) existing.visible = false;
        continue;
      }

      // Alpha based on highlight state
      let alpha: number;
      if (n.targetAlpha < 0.1) {
        alpha = Math.min(labelOpacity, n.alpha) * 0.3;
      } else {
        alpha = labelOpacity * (n.alpha / n.targetAlpha);
        if (n === (this.hoveredNode || this.selectedNode)) alpha = 1.0;
      }

      if (alpha < 0.01) {
        const existing = this.labelTexts.get(n.id);
        if (existing) existing.visible = false;
        continue;
      }

      let text = this.labelTexts.get(n.id);
      if (!text) {
        text = new Text({
          text: n.label,
          style: new TextStyle({
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize,
            fill: this.colorText,
            align: "center",
          }),
        });
        text.anchor.set(0.5, 0);
        lc.addChild(text);
        this.labelTexts.set(n.id, text);
      }

      // Update text properties
      text.visible = true;
      text.text = n.label;
      (text.style as TextStyle).fontSize = fontSize;
      (text.style as TextStyle).fill = this.colorText;
      text.x = sx;
      text.y = screenY;
      text.alpha = alpha;
    }

    // Remove labels for nodes that no longer exist
    for (const [id, text] of this.labelTexts) {
      if (!activeIds.has(id)) {
        lc.removeChild(text);
        text.destroy();
        this.labelTexts.delete(id);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     Input Handlers
     ══════════════════════════════════════════════════════════════════ */

  private setupInputHandlers(): void {
    const canvas = this.pixiCanvas!;
    const container = this.contentEl;

    // Wheel (smooth zoom)
    this._onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const [wx, wy] = this.screenToWorldTarget(mx, my);

      const factor = e.deltaY > 0 ? 0.92 : 1.0 / 0.92;
      this.targetCamScale = Math.max(0.03, Math.min(12, this.targetCamScale * factor));

      const app = this.pixiApp!;
      const w = app.screen.width;
      const h = app.screen.height;
      this.targetCamX = wx - (mx - w / 2) / this.targetCamScale;
      this.targetCamY = wy - (my - h / 2) / this.targetCamScale;
    };
    canvas.addEventListener("wheel", this._onWheel, { passive: false });

    // Mouse down
    this._onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = this.hitTestNode(mx, my);

      if (node) {
        this.dragNode = node;
        this.isDragging = false;
        node.fx = node.x;
        node.fy = node.y;
        if (this.simulation) this.simulation.setAlphaTarget(0.3);
      } else {
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.panStartCamX = this.targetCamX;
        this.panStartCamY = this.targetCamY;
      }
    };
    canvas.addEventListener("mousedown", this._onMouseDown);

    // Mouse move
    this._onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.dragNode) {
        this.isDragging = true;
        const [wx, wy] = this.screenToWorld(mx, my);
        this.dragNode.fx = wx;
        this.dragNode.fy = wy;
        this.needsRedraw = true;
        return;
      }

      if (this.isPanning) {
        const dx = (e.clientX - this.panStartX) / this.targetCamScale;
        const dy = (e.clientY - this.panStartY) / this.targetCamScale;
        this.targetCamX = this.panStartCamX - dx;
        this.targetCamY = this.panStartCamY - dy;
        this.camX = this.targetCamX;
        this.camY = this.targetCamY;
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

    // Mouse up
    this._onMouseUp = (e: MouseEvent) => {
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
        if (this.simulation) this.simulation.setAlphaTarget(0);
        return;
      }

      if (this.isPanning) {
        this.isPanning = false;
        const dx = Math.abs(e.clientX - this.panStartX);
        const dy = Math.abs(e.clientY - this.panStartY);
        if (dx < 3 && dy < 3) {
          this.selectedNode = null;
          this.updateHighlightTargets();
          this.removeInfoPanel(container);
        }
      }
    };
    canvas.addEventListener("mouseup", this._onMouseUp);

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
