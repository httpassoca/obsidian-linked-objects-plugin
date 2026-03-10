import { App, ItemView, WorkspaceLeaf } from "obsidian";
import * as d3 from "d3";
import { GraphData, GraphNode, GraphEdge } from "./graph-data";
import { ConfigPanel, GraphConfig, DEFAULT_CONFIG } from "./settings";

export const VIEW_TYPE = "object-links-graph";

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: "object" | "file";
  filePath: string;
  fileLabel: string;
  properties: Record<string, string>;
  startLine: number;
  connections: number;
}

interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  edgeType: "object" | "wiki";
}

export class GraphView extends ItemView {
  private graphData: GraphData | null = null;
  private simulation: d3.Simulation<SimNode, SimEdge> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private configPanel: ConfigPanel | null = null;
  private config: GraphConfig = { ...DEFAULT_CONFIG };
  /** Callback set by the plugin to navigate to an object */
  public navigateToObject:
    | ((filePath: string, startLine: number) => void)
    | null = null;
  /** Callback set by the plugin to navigate to a file */
  public navigateToFile: ((filePath: string) => void) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Object Links";
  }

  getIcon(): string {
    return "git-fork";
  }

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
    if (this.simulation) {
      this.simulation.stop();
      this.simulation = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.configPanel) {
      this.configPanel.destroy();
      this.configPanel = null;
    }
  }

  private applyFilters(data: GraphData): GraphData {
    const c = this.config;
    let nodes = [...data.nodes];
    let edges = [...data.edges];

    // ── Type filters ──
    if (!c.showFiles) {
      const fileIds = new Set(nodes.filter((n) => n.type === "file").map((n) => n.id));
      nodes = nodes.filter((n) => n.type !== "file");
      edges = edges.filter((e) => !fileIds.has(e.source) && !fileIds.has(e.target));
    }
    if (!c.showObjects) {
      const objIds = new Set(nodes.filter((n) => n.type === "object").map((n) => n.id));
      nodes = nodes.filter((n) => n.type !== "object");
      edges = edges.filter((e) => !objIds.has(e.source) && !objIds.has(e.target));
    }

    // ── Edge type filters ──
    if (!c.showWikiEdges) {
      edges = edges.filter((e) => e.edgeType !== "wiki");
    }
    if (!c.showObjectEdges) {
      edges = edges.filter((e) => e.edgeType !== "object");
    }

    // ── Search filter ──
    if (c.search) {
      const q = c.search.toLowerCase();
      const matchedIds = new Set(
        nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id)
      );
      // Also keep nodes connected to matches
      for (const e of edges) {
        if (matchedIds.has(e.source)) matchedIds.add(e.target);
        if (matchedIds.has(e.target)) matchedIds.add(e.source);
      }
      nodes = nodes.filter((n) => matchedIds.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }

    // ── Path filter ──
    if (c.pathFilter) {
      const pf = c.pathFilter.toLowerCase();
      const matchedIds = new Set(
        nodes.filter((n) => n.filePath.toLowerCase().includes(pf)).map((n) => n.id)
      );
      // Keep connected nodes too
      for (const e of edges) {
        if (matchedIds.has(e.source)) matchedIds.add(e.target);
        if (matchedIds.has(e.target)) matchedIds.add(e.source);
      }
      nodes = nodes.filter((n) => matchedIds.has(n.id));
      const nodeIds = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    }

    // ── Source filter (for objects only) ──
    if (c.sourceFilter) {
      const sf = c.sourceFilter.toLowerCase();
      const removedIds = new Set(
        nodes
          .filter(
            (n) =>
              n.type === "object" &&
              !n.fileLabel.toLowerCase().includes(sf)
          )
          .map((n) => n.id)
      );
      nodes = nodes.filter((n) => !removedIds.has(n.id));
      edges = edges.filter(
        (e) => !removedIds.has(e.source) && !removedIds.has(e.target)
      );
    }

    // ── Orphan filter ──
    if (!c.showOrphans) {
      const connectedIds = new Set<string>();
      for (const e of edges) {
        connectedIds.add(e.source);
        connectedIds.add(e.target);
      }
      nodes = nodes.filter((n) => connectedIds.has(n.id));
    }

    // Recalculate connections for the filtered set
    const connCount = new Map<string, number>();
    for (const e of edges) {
      connCount.set(e.source, (connCount.get(e.source) || 0) + 1);
      connCount.set(e.target, (connCount.get(e.target) || 0) + 1);
    }
    for (const n of nodes) {
      n.connections = connCount.get(n.id) || 0;
    }

    return { nodes, edges };
  }

  private renderGraph(): void {
    if (!this.graphData) return;

    const container = this.contentEl;
    container.empty();
    container.addClass("ol-graph-container");

    // ── Config panel ──
    this.configPanel = new ConfigPanel(container, this.config, (newConfig) => {
      this.config = newConfig;
      this.renderGraph();
    });

    const filtered = this.applyFilters(this.graphData);

    if (filtered.nodes.length === 0) {
      container.createEl("div", {
        cls: "ol-empty-state",
        text: "No nodes match the current filters.",
      });
      return;
    }

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Create SVG
    const svg = d3
      .select(container)
      .append("svg")
      .attr("class", "ol-graph-svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width} ${height}`);

    // Background -- click to deselect
    svg
      .append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", "transparent")
      .on("click", () => {
        this.clearSelection(nodeGroup, edgeGroup, labelGroup, container);
      });

    const g = svg.append("g").attr("class", "ol-zoom-group");

    // Zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.03, 12])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);
    svg.call(
      zoom.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(0.7)
    );

    // ── Sim data ──
    const c = this.config;

    const simNodes: SimNode[] = filtered.nodes.map((n) => ({
      ...n,
      x: (Math.random() - 0.5) * width * 0.6,
      y: (Math.random() - 0.5) * height * 0.6,
    }));

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

    const simEdges: SimEdge[] = filtered.edges
      .map((e) => ({
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
        edgeType: e.edgeType,
      }))
      .filter((e) => e.source && e.target);

    // ── Edges ──
    const edgeGroup = g
      .append("g")
      .attr("class", "ol-edges")
      .selectAll("line")
      .data(simEdges)
      .enter()
      .append("line")
      .attr("class", (d) =>
        d.edgeType === "object" ? "ol-edge ol-edge-obj" : "ol-edge ol-edge-wiki"
      );

    // ── Nodes ──
    const self = this;
    let lastClickTime = 0;
    let lastClickId = "";

    const nodeGroup = g
      .append("g")
      .attr("class", "ol-nodes")
      .selectAll("circle")
      .data(simNodes)
      .enter()
      .append("circle")
      .attr("class", (d) =>
        d.type === "object"
          ? "ol-node ol-node-object"
          : "ol-node ol-node-file"
      )
      .attr("r", (d) => this.getNodeRadius(d))
      .on("mouseenter", (_event, d) => {
        this.highlightNode(d, simEdges, nodeGroup, edgeGroup, labelGroup);
        this.showTooltip(d, container);
      })
      .on("mouseleave", () => {
        this.unhighlightAll(nodeGroup, edgeGroup, labelGroup);
        this.hideTooltip(container);
      })
      .on("click", function (_event, d) {
        _event.stopPropagation();

        const now = Date.now();
        // Double-click detection (300ms window)
        if (lastClickId === d.id && now - lastClickTime < 300) {
          // Double click -> navigate
          if (d.type === "object" && self.navigateToObject) {
            self.navigateToObject(d.filePath, d.startLine);
          } else if (d.type === "file" && self.navigateToFile) {
            self.navigateToFile(d.filePath);
          }
          lastClickTime = 0;
          lastClickId = "";
          return;
        }

        lastClickTime = now;
        lastClickId = d.id;

        // Single click -> info panel
        self.selectNode(
          d,
          simEdges,
          nodeGroup,
          edgeGroup,
          labelGroup,
          container
        );
      })
      .call(
        d3
          .drag<SVGCircleElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active && this.simulation)
              this.simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active && this.simulation)
              this.simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // ── Labels ──
    const labelGroup = g
      .append("g")
      .attr("class", "ol-labels")
      .selectAll("text")
      .data(simNodes)
      .enter()
      .append("text")
      .attr("class", "ol-label")
      .text((d) => d.label)
      .attr("dy", (d) => this.getNodeRadius(d) + 14)
      .style("opacity", c.labelOpacity);

    // ── Simulation ──
    this.simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .distance(c.linkDistance)
          .strength(0.6)
      )
      .force(
        "charge",
        d3
          .forceManyBody()
          .strength(-c.repelStrength)
          .distanceMax(c.repelStrength * 1.5)
      )
      .force("center", d3.forceCenter(0, 0).strength(c.centerStrength))
      .force(
        "collision",
        d3
          .forceCollide<SimNode>()
          .radius((d) => this.getNodeRadius(d) + 8)
      )
      .force("x", d3.forceX(0).strength(0.012))
      .force("y", d3.forceY(0).strength(0.012))
      .alphaDecay(0.015)
      .on("tick", () => {
        edgeGroup
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);

        nodeGroup.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);

        labelGroup.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
      });

    // ── Resize ──
    this.resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      svg.attr("viewBox", `0 0 ${w} ${h}`);
    });
    this.resizeObserver.observe(container);
  }

  private getNodeRadius(d: SimNode): number {
    const c = this.config.nodeSizeMultiplier;
    const base = d.type === "file" ? 4 : 5;
    return Math.max(base, Math.min(20, base + d.connections * 1.5)) * c;
  }

  private highlightNode(
    d: SimNode,
    edges: SimEdge[],
    nodeGroup: d3.Selection<SVGCircleElement, SimNode, SVGGElement, unknown>,
    edgeGroup: d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown>,
    labelGroup: d3.Selection<SVGTextElement, SimNode, SVGGElement, unknown>
  ): void {
    const connected = new Set<string>();
    connected.add(d.id);
    edges.forEach((e) => {
      const s = typeof e.source === "object" ? (e.source as SimNode).id : e.source;
      const t = typeof e.target === "object" ? (e.target as SimNode).id : e.target;
      if (s === d.id) connected.add(t as string);
      if (t === d.id) connected.add(s as string);
    });

    nodeGroup.classed("ol-dimmed", (n) => !connected.has(n.id));
    nodeGroup.classed("ol-highlighted", (n) => n.id === d.id);
    edgeGroup.classed("ol-dimmed", (e) => {
      const s = typeof e.source === "object" ? (e.source as SimNode).id : e.source;
      const t = typeof e.target === "object" ? (e.target as SimNode).id : e.target;
      return s !== d.id && t !== d.id;
    });
    edgeGroup.classed("ol-edge-highlighted", (e) => {
      const s = typeof e.source === "object" ? (e.source as SimNode).id : e.source;
      const t = typeof e.target === "object" ? (e.target as SimNode).id : e.target;
      return s === d.id || t === d.id;
    });
    labelGroup.classed("ol-dimmed", (n) => !connected.has(n.id));
    labelGroup.classed("ol-label-visible", (n) => connected.has(n.id));
  }

  private unhighlightAll(
    nodeGroup: d3.Selection<SVGCircleElement, SimNode, SVGGElement, unknown>,
    edgeGroup: d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown>,
    labelGroup: d3.Selection<SVGTextElement, SimNode, SVGGElement, unknown>
  ): void {
    nodeGroup.classed("ol-dimmed", false).classed("ol-highlighted", false);
    edgeGroup.classed("ol-dimmed", false).classed("ol-edge-highlighted", false);
    labelGroup.classed("ol-dimmed", false).classed("ol-label-visible", false);
  }

  private clearSelection(
    nodeGroup: d3.Selection<SVGCircleElement, SimNode, SVGGElement, unknown>,
    edgeGroup: d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown>,
    labelGroup: d3.Selection<SVGTextElement, SimNode, SVGGElement, unknown>,
    container: HTMLElement
  ): void {
    this.unhighlightAll(nodeGroup, edgeGroup, labelGroup);
    const panel = container.querySelector(".ol-info-panel");
    if (panel) panel.remove();
  }

  private selectNode(
    d: SimNode,
    edges: SimEdge[],
    nodeGroup: d3.Selection<SVGCircleElement, SimNode, SVGGElement, unknown>,
    edgeGroup: d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown>,
    labelGroup: d3.Selection<SVGTextElement, SimNode, SVGGElement, unknown>,
    container: HTMLElement
  ): void {
    this.highlightNode(d, edges, nodeGroup, edgeGroup, labelGroup);

    const existing = container.querySelector(".ol-info-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.className = "ol-info-panel";

    // Title
    const title = document.createElement("div");
    title.className = "ol-info-title";
    title.textContent = d.label;
    panel.appendChild(title);

    // Type badge
    const badge = document.createElement("div");
    badge.className = `ol-info-type ol-info-type-${d.type}`;
    badge.textContent = d.type === "object" ? "Object" : "File";
    panel.appendChild(badge);

    // File path
    const filePath = document.createElement("div");
    filePath.className = "ol-info-file";
    filePath.textContent = d.filePath;
    panel.appendChild(filePath);

    // Properties (object nodes only)
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

    // Connections
    const conn = document.createElement("div");
    conn.className = "ol-info-connections";
    conn.textContent = `${d.connections} connection${d.connections !== 1 ? "s" : ""}`;
    panel.appendChild(conn);

    // "Go to" button
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

  private showTooltip(d: SimNode, container: HTMLElement): void {
    let tooltip = container.querySelector(".ol-tooltip") as HTMLElement;
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "ol-tooltip";
      container.appendChild(tooltip);
    }
    tooltip.textContent = d.label;
    tooltip.style.display = "block";

    const onMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      tooltip.style.left = e.clientX - rect.left + 14 + "px";
      tooltip.style.top = e.clientY - rect.top - 10 + "px";
    };
    container.addEventListener("mousemove", onMove);
    (tooltip as any).__moveHandler = onMove;
  }

  private hideTooltip(container: HTMLElement): void {
    const tooltip = container.querySelector(".ol-tooltip") as HTMLElement;
    if (tooltip) {
      tooltip.style.display = "none";
      if ((tooltip as any).__moveHandler) {
        container.removeEventListener("mousemove", (tooltip as any).__moveHandler);
      }
    }
  }
}
