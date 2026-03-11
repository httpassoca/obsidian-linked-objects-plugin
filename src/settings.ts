import { App, PluginSettingTab, Setting } from "obsidian";
import type ObjectLinksPlugin from "./main";

/**
 * Persistent plugin settings (saved to data.json).
 */
export interface ObjectLinksSettings {
  objectFileTag: string;
}

export const DEFAULT_SETTINGS: ObjectLinksSettings = {
  objectFileTag: "object-links",
};

/**
 * Plugin settings tab shown in Obsidian's settings panel.
 */
export class ObjectLinksSettingTab extends PluginSettingTab {
  plugin: ObjectLinksPlugin;

  constructor(app: App, plugin: ObjectLinksPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Object Links" });

    new Setting(containerEl)
      .setName("Object file tag")
      .setDesc(
        "Tag used to identify object files. " +
        "Only markdown files that include this tag will be parsed. " +
        "Supports bare #tags (e.g. #object-links on any line) " +
        "and YAML frontmatter tags (e.g. tags: [object-links])."
      )
      .addText((text) =>
        text
          .setPlaceholder("object-links")
          .setValue(this.plugin.settings.objectFileTag)
          .onChange(async (value) => {
            this.plugin.settings.objectFileTag = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}

/**
 * Graph configuration panel -- rendered inside the graph view.
 */

export interface GraphConfig {
  search: string;
  showOrphans: boolean;
  showFiles: boolean;
  showObjects: boolean;
  showWikiEdges: boolean;
  showObjectEdges: boolean;
  pathFilter: string;
  sourceFilter: string;
  // Display
  nodeSizeMultiplier: number;
  nodeMaxScreenRadius: number;
  labelOpacity: number;
  labelMinZoom: number;
  labelMaxWidth: number;
  // Forces
  linkDistance: number;
  centerStrength: number;
  repelStrength: number;
}

export const DEFAULT_CONFIG: GraphConfig = {
  search: "",
  showOrphans: false,
  showFiles: true,
  showObjects: true,
  showWikiEdges: true,
  showObjectEdges: true,
  pathFilter: "",
  sourceFilter: "",
  // Display
  nodeSizeMultiplier: 1,
  nodeMaxScreenRadius: 16,
  labelOpacity: 0.65,
  labelMinZoom: 1.05,
  labelMaxWidth: 160,
  // Forces
  linkDistance: 100,
  centerStrength: 0.03,
  repelStrength: 300,
};

export type ConfigChangeCallback = (config: GraphConfig) => void;

export class ConfigPanel {
  private panelEl: HTMLElement;
  private config: GraphConfig;
  private onChange: ConfigChangeCallback;
  private collapsed: Record<string, boolean> = {
    filter: false,
    display: true,
  };
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    parent: HTMLElement,
    config: GraphConfig,
    onChange: ConfigChangeCallback
  ) {
    this.config = { ...config };
    this.onChange = onChange;

    this.panelEl = document.createElement("div");
    this.panelEl.className = "ol-config-panel";
    parent.appendChild(this.panelEl);

    this.render();
  }

  getConfig(): GraphConfig {
    return { ...this.config };
  }

  destroy(): void {
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
    this.panelEl.remove();
  }

  private render(): void {
    this.panelEl.empty();

    // ── Filter section ─────────────────────────────────
    this.renderSection("filter", "Filters", (contentEl) => {
      // Search
      this.renderTextInput(contentEl, "Search", this.config.search, (v) => {
        this.config.search = v;
        this.emitDebounced("search", 250);
      });

      // Path filter
      this.renderTextInput(contentEl, "Path filter", this.config.pathFilter, (v) => {
        this.config.pathFilter = v;
        this.emitDebounced("pathFilter", 250);
      }, "e.g. 00 Daily");

      // Source filter
      this.renderTextInput(contentEl, "Source filter", this.config.sourceFilter, (v) => {
        this.config.sourceFilter = v;
        this.emitDebounced("sourceFilter", 250);
      }, "e.g. Films");

      // Toggles
      this.renderToggle(contentEl, "Show files", this.config.showFiles, (v) => {
        this.config.showFiles = v;
        this.emit();
      });

      this.renderToggle(contentEl, "Show objects", this.config.showObjects, (v) => {
        this.config.showObjects = v;
        this.emit();
      });

      this.renderToggle(contentEl, "Show orphans", this.config.showOrphans, (v) => {
        this.config.showOrphans = v;
        this.emit();
      });

      this.renderToggle(contentEl, "Wiki links", this.config.showWikiEdges, (v) => {
        this.config.showWikiEdges = v;
        this.emit();
      });

      this.renderToggle(contentEl, "Object links", this.config.showObjectEdges, (v) => {
        this.config.showObjectEdges = v;
        this.emit();
      });
    });

    // ── Display section ────────────────────────────────
    this.renderSection("display", "Display", (contentEl) => {
      this.renderSlider(contentEl, "Node size", this.config.nodeSizeMultiplier, 0.2, 3, 0.1, (v) => {
        this.config.nodeSizeMultiplier = v;
        this.emit();
      });

      this.renderSlider(contentEl, "Node max size (on screen)", this.config.nodeMaxScreenRadius, 6, 40, 1, (v) => {
        this.config.nodeMaxScreenRadius = v;
        this.emit();
      });

      this.renderSlider(contentEl, "Labels appear at zoom", this.config.labelMinZoom, 0.2, 3, 0.05, (v) => {
        this.config.labelMinZoom = v;
        this.emit();
      });

      this.renderSlider(contentEl, "Label max width", this.config.labelMaxWidth, 60, 360, 10, (v) => {
        this.config.labelMaxWidth = v;
        this.emit();
      });

      this.renderSlider(contentEl, "Label opacity", this.config.labelOpacity, 0, 1, 0.05, (v) => {
        this.config.labelOpacity = v;
        this.emit();
      });

      // Forces
      this.renderSlider(contentEl, "Link distance", this.config.linkDistance, 30, 500, 10, (v) => {
        this.config.linkDistance = v;
        this.emit();
      });

      this.renderSlider(contentEl, "Center force", this.config.centerStrength, 0, 0.2, 0.005, (v) => {
        this.config.centerStrength = v;
        this.emit();
      });

      this.renderSlider(contentEl, "Repel force", this.config.repelStrength, 50, 1000, 25, (v) => {
        this.config.repelStrength = v;
        this.emit();
      });
    });
  }

  private renderSection(
    key: string,
    title: string,
    contentFn: (contentEl: HTMLElement) => void
  ): void {
    const section = document.createElement("div");
    section.className = "ol-config-section";

    const header = document.createElement("div");
    header.className = "ol-config-section-header";
    header.addEventListener("click", () => {
      this.collapsed[key] = !this.collapsed[key];
      this.render();
    });

    const arrow = document.createElement("span");
    arrow.className = "ol-config-arrow";
    arrow.textContent = this.collapsed[key] ? "\u25B6" : "\u25BC";
    header.appendChild(arrow);

    const titleEl = document.createElement("span");
    titleEl.textContent = title;
    header.appendChild(titleEl);

    section.appendChild(header);

    if (!this.collapsed[key]) {
      const content = document.createElement("div");
      content.className = "ol-config-section-content";
      section.appendChild(content);
      contentFn(content);
    }

    this.panelEl.appendChild(section);
  }

  private renderTextInput(
    parent: HTMLElement,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder?: string
  ): void {
    const row = document.createElement("div");
    row.className = "ol-config-row ol-config-text-row";

    const labelEl = document.createElement("span");
    labelEl.className = "ol-config-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "ol-config-input";
    input.placeholder = placeholder || "";
    input.value = value;
    input.addEventListener("input", () => onChange(input.value));

    row.appendChild(input);
    parent.appendChild(row);
  }

  private renderToggle(
    parent: HTMLElement,
    label: string,
    value: boolean,
    onChange: (v: boolean) => void
  ): void {
    const row = document.createElement("div");
    row.className = "ol-config-row ol-config-toggle-row";

    const labelEl = document.createElement("span");
    labelEl.className = "ol-config-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const toggle = document.createElement("div");
    toggle.className = `ol-config-toggle ${value ? "is-enabled" : ""}`;

    const knob = document.createElement("div");
    knob.className = "ol-config-toggle-knob";
    toggle.appendChild(knob);

    toggle.addEventListener("click", () => {
      const newVal = !toggle.classList.contains("is-enabled");
      toggle.classList.toggle("is-enabled", newVal);
      onChange(newVal);
    });

    row.appendChild(toggle);
    parent.appendChild(row);
  }

  private renderSlider(
    parent: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void
  ): void {
    const row = document.createElement("div");
    row.className = "ol-config-row ol-config-slider-row";

    const labelEl = document.createElement("span");
    labelEl.className = "ol-config-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "ol-config-slider";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    slider.addEventListener("input", () => {
      onChange(parseFloat(slider.value));
    });

    row.appendChild(slider);
    parent.appendChild(row);
  }

  private emit(): void {
    this.onChange({ ...this.config });
  }

  private emitDebounced(key: string, ms: number): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      this.emit();
    }, ms));
  }
}
