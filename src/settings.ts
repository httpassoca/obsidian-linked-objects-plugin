import { App, PluginSettingTab, Setting } from "obsidian";
import type ObjectLinksPlugin from "./main";

/**
 * Persistent plugin settings (saved to data.json).
 */
export interface ObjectLinksSettings {
  /**
   * Frontmatter tag used to identify object files.
   * Only markdown files whose frontmatter contains this tag will be parsed.
   * Example: if set to "object-file", a file needs `tags: [object-file]` in
   * its YAML frontmatter to be recognised by the plugin.
   */
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
 * Mirrors the style and layout of Obsidian's native graph controls.
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
  linkDistance: number;
  centerStrength: number;
  repelStrength: number;
  labelOpacity: number;
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
  nodeSizeMultiplier: 1,
  linkDistance: 150,
  centerStrength: 0.04,
  repelStrength: 400,
  labelOpacity: 0.65,
};

export type ConfigChangeCallback = (config: GraphConfig) => void;

export class ConfigPanel {
  private containerEl: HTMLElement;
  private config: GraphConfig;
  private onChange: ConfigChangeCallback;
  private collapsed: Record<string, boolean> = {
    filter: false,
    display: true,
  };

  constructor(
    parent: HTMLElement,
    config: GraphConfig,
    onChange: ConfigChangeCallback
  ) {
    this.config = { ...config };
    this.onChange = onChange;

    this.containerEl = document.createElement("div");
    this.containerEl.className = "ol-config-panel";
    parent.appendChild(this.containerEl);

    this.render();
  }

  getConfig(): GraphConfig {
    return { ...this.config };
  }

  destroy(): void {
    this.containerEl.remove();
  }

  private render(): void {
    this.containerEl.empty();

    // ── Filter section ─────────────────────────────────
    this.renderSection("filter", "Filters", () => {
      // Search
      this.renderTextInput("Search", this.config.search, (v) => {
        this.config.search = v;
        this.emit();
      });

      // Path filter
      this.renderTextInput("Path filter", this.config.pathFilter, (v) => {
        this.config.pathFilter = v;
        this.emit();
      }, "e.g. 00 Daily");

      // Source filter
      this.renderTextInput("Source filter", this.config.sourceFilter, (v) => {
        this.config.sourceFilter = v;
        this.emit();
      }, "e.g. Films");

      // Toggles
      this.renderToggle("Show files", this.config.showFiles, (v) => {
        this.config.showFiles = v;
        this.emit();
      });

      this.renderToggle("Show objects", this.config.showObjects, (v) => {
        this.config.showObjects = v;
        this.emit();
      });

      this.renderToggle("Show orphans", this.config.showOrphans, (v) => {
        this.config.showOrphans = v;
        this.emit();
      });

      this.renderToggle("Wiki links", this.config.showWikiEdges, (v) => {
        this.config.showWikiEdges = v;
        this.emit();
      });

      this.renderToggle("Object links", this.config.showObjectEdges, (v) => {
        this.config.showObjectEdges = v;
        this.emit();
      });
    });

    // ── Display section ────────────────────────────────
    this.renderSection("display", "Display", () => {
      this.renderSlider("Node size", this.config.nodeSizeMultiplier, 0.2, 3, 0.1, (v) => {
        this.config.nodeSizeMultiplier = v;
        this.emit();
      });

      this.renderSlider("Link distance", this.config.linkDistance, 30, 500, 10, (v) => {
        this.config.linkDistance = v;
        this.emit();
      });

      this.renderSlider("Center force", this.config.centerStrength, 0, 0.2, 0.005, (v) => {
        this.config.centerStrength = v;
        this.emit();
      });

      this.renderSlider("Repel force", this.config.repelStrength, 50, 1000, 25, (v) => {
        this.config.repelStrength = v;
        this.emit();
      });

      this.renderSlider("Label opacity", this.config.labelOpacity, 0, 1, 0.05, (v) => {
        this.config.labelOpacity = v;
        this.emit();
      });
    });
  }

  private renderSection(
    key: string,
    title: string,
    contentFn: () => void
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

      // Temporarily set containerEl to content for helpers
      const savedContainer = this.containerEl;
      this.containerEl = content;
      contentFn();
      this.containerEl = savedContainer;
    }

    // Append to the real container (the panel)
    // We need to use the actual panel element
    const panel = document.querySelector(".ol-config-panel");
    if (panel) {
      panel.appendChild(section);
    }
  }

  private renderTextInput(
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder?: string
  ): void {
    const row = document.createElement("div");
    row.className = "ol-config-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "ol-config-input";
    input.placeholder = placeholder || label;
    input.value = value;
    input.addEventListener("input", () => onChange(input.value));

    row.appendChild(input);
    this.containerEl.appendChild(row);
  }

  private renderToggle(
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
    toggle.addEventListener("click", () => {
      const newVal = !value;
      onChange(newVal);
    });

    const knob = document.createElement("div");
    knob.className = "ol-config-toggle-knob";
    toggle.appendChild(knob);

    row.appendChild(toggle);
    this.containerEl.appendChild(row);
  }

  private renderSlider(
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
    this.containerEl.appendChild(row);
  }

  private emit(): void {
    this.onChange({ ...this.config });
  }
}
