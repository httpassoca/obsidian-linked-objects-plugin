import {
  MarkdownPostProcessorContext,
  MarkdownView,
  Notice,
  Plugin,
  TextFileView,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import {
  parseMultiObjectFile,
  ParsedFile,
  ParsedObject,
  getSecondProperty,
} from "./parser";
import { buildGraph, GraphData, VaultFile } from "./graph-data";
import { GraphView, VIEW_TYPE } from "./graph-view";
import { ObjectTableView, TABLE_VIEW_TYPE } from "./table-view";
import { ObjectLinkSuggest } from "./suggest";
import { objectLinkHighlighter, objectLinkWrapperKeymap } from "./editor-extension";
import {
  ObjectLinksSettings,
  DEFAULT_SETTINGS,
  ObjectLinksSettingTab,
} from "./settings";

export default class ObjectLinksPlugin extends Plugin {
  settings: ObjectLinksSettings = DEFAULT_SETTINGS;
  private graphData: GraphData | null = null;
  private suggestProvider: ObjectLinkSuggest | null = null;
  private allObjects: ParsedObject[] = [];
  /** Map: lowercase key value -> ParsedObject (for quick lookups) */
  private objectIndex: Map<string, ParsedObject> = new Map();

  async onload(): Promise<void> {
    // ── Load settings ──
    await this.loadSettings();

    // ── Settings tab ──
    this.addSettingTab(new ObjectLinksSettingTab(this.app, this));

    // ── Register view ──
    this.registerView(VIEW_TYPE, (leaf) => {
      const view = new GraphView(leaf);
      view.navigateToObject = (filePath, startLine) =>
        this.goToObject(filePath, startLine);
      view.navigateToFile = (filePath) => this.goToFile(filePath);
      return view;
    });

    // ── Register table view ──
    this.registerView(TABLE_VIEW_TYPE, (leaf) => new ObjectTableView(leaf));

    // ── Register suggest provider ──
    this.suggestProvider = new ObjectLinkSuggest(this.app);
    this.registerEditorSuggest(this.suggestProvider);

    // ── Register CM6 editor extensions: highlighting + selection wrapper ──
    this.registerEditorExtension([objectLinkHighlighter, objectLinkWrapperKeymap]);

    // ── Markdown post-processor: render {{object}} as clickable links ──
    this.registerMarkdownPostProcessor(
      (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        this.processObjectLinks(el);
      }
    );

    // ── Ribbon icon ──
    this.addRibbonIcon("git-fork", "Open Object Links", () => {
      this.activateView();
    });

    // ── Commands ──
    this.addCommand({
      id: "open-ol-graph",
      name: "Open graph view",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "refresh-ol-graph",
      name: "Refresh graph",
      callback: () => this.fullRefresh(),
    });

    this.addCommand({
      id: "open-under-cursor",
      name: "Open link under cursor",
      callback: () => this.openUnderCursor(),
      hotkeys: [{ modifiers: ["Mod"], key: "Enter" }],
    });

    this.addCommand({
      id: "open-as-table",
      name: "Open current file as table",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf) return false;
        if (leaf.view.getViewType() === TABLE_VIEW_TYPE) return false;
        if (checking) return true;
        leaf.setViewState({
          type: TABLE_VIEW_TYPE,
          state: { file: file.path },
        });
        return true;
      },
    });

    this.addCommand({
      id: "open-as-markdown",
      name: "Switch back to editor",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        if (!leaf || leaf.view.getViewType() !== TABLE_VIEW_TYPE) return false;
        if (checking) return true;
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        leaf.setViewState({
          type: "markdown",
          state: { file: file.path },
        });
        return true;
      },
    });

    // ── Auto-open object files in table view ──
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || !(file instanceof TFile) || file.extension !== "md") return;
        if (!this.settings.openObjectFilesInTableView) return;

        const leaf = this.app.workspace.getActiveViewOfType(TextFileView as any)?.leaf
          ?? this.app.workspace.activeLeaf;
        if (!leaf) return;

        // Don't switch if already in table view
        if (leaf.view.getViewType() === TABLE_VIEW_TYPE) return;

        // Check if this is an object-links file (async)
        this.app.vault.read(file).then((content) => {
          const tag = this.settings.objectFileTag.trim();
          if (tag && !this.hasFileTag(content, tag)) return;
          if (!parseMultiObjectFile(content, file.path)) return;

          leaf.setViewState({
            type: TABLE_VIEW_TYPE,
            state: { file: file.path },
          });
        });
      })
    );

    // ── Inject table-view button into markdown leaves for object-links files ──
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.injectTableViewButtons();
      })
    );

    // ── Initial scan on layout ready ──
    this.app.workspace.onLayoutReady(() => {
      this.fullRefresh();
    });

    // ── File watchers ──
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.debounceRefresh();
        }
      })
    );
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(TABLE_VIEW_TYPE);
    // Remove injected buttons
    document.querySelectorAll(".ol-table-view-btn").forEach((el) => el.remove());
  }

  // ── Inject table-view button ─────────────────────────────────────

  /** Set of leaf IDs where the file is known to be an object-links file */
  private knownObjectLeaves = new Set<string>();

  private injectTableViewButtons(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const actions = (leaf.view as any).containerEl?.querySelector(".view-actions") as HTMLElement | null;
      if (!actions || actions.querySelector(".ol-table-view-btn")) continue;

      const file = (leaf.view as any).file as TFile | undefined;
      if (!file || file.extension !== "md") continue;

      // Check if this file is a known object-links file
      const leafId = (leaf as any).id ?? file.path;
      if (!this.knownObjectLeaves.has(leafId)) {
        // Async check, inject on next layout-change if it's an object file
        this.app.vault.read(file).then((content) => {
          const tag = this.settings.objectFileTag.trim();
          if (tag && !this.hasFileTag(content, tag)) return;
          if (!parseMultiObjectFile(content, file.path)) return;
          this.knownObjectLeaves.add(leafId);
          this.injectTableViewButtons();
        });
        continue;
      }

      const btn = document.createElement("button");
      btn.className = "clickable-icon view-action ol-table-view-btn";
      btn.setAttribute("aria-label", "Open as table");
      setIcon(btn, "table");
      btn.addEventListener("click", () => {
        leaf.setViewState({
          type: TABLE_VIEW_TYPE,
          state: { file: file.path },
        });
      });
      actions.insertBefore(btn, actions.firstChild);
    }
  }

  // ── Debounce ────────────────────────────────────────────────────────

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private debounceRefresh(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.fullRefresh(), 800);
  }

  // ── Full refresh: scan, check dupes, update views ──────────────────

  private async fullRefresh(): Promise<void> {
    const parsedFiles = await this.scanMultiObjectFiles();
    const allFiles = await this.getAllVaultFiles();

    // Build index + disambiguate duplicate key values
    this.allObjects = [];
    this.objectIndex = new Map();
    const idDupes: string[] = [];
    /** Track ids per file to detect duplicate ids within a file */
    const fileIdSets: Map<string, Map<number, string>> = new Map();
    /** Map from parsed file path to its keyProperty name */
    const fileKeyProps: Map<string, string> = new Map();

    // ── Phase 1: Collect all objects and check id duplicates ──
    for (const file of parsedFiles) {
      fileKeyProps.set(file.filePath, file.keyProperty);

      if (!fileIdSets.has(file.filePath)) {
        fileIdSets.set(file.filePath, new Map());
      }
      const idSet = fileIdSets.get(file.filePath)!;

      for (const obj of file.objects) {
        this.allObjects.push(obj);

        // Check duplicate ids within the same file
        if (idSet.has(obj.id)) {
          idDupes.push(
            `id ${obj.id} duplicated in ${obj.fileLabel}: "${idSet.get(obj.id)}" and "${obj.keyValue}"`
          );
        }
        idSet.set(obj.id, obj.keyValue);
      }
    }

    // ── Phase 2: Disambiguate duplicate keyValues ──
    // Group objects by lowercase keyValue
    const keyGroups = new Map<string, ParsedObject[]>();
    for (const obj of this.allObjects) {
      const k = obj.keyValue.toLowerCase();
      if (!keyGroups.has(k)) keyGroups.set(k, []);
      keyGroups.get(k)!.push(obj);
    }

    for (const [, group] of keyGroups) {
      if (group.length === 1) {
        // Unique key: displayKey = keyValue (already the default)
        continue;
      }

      // Multiple objects share the same keyValue -- disambiguate
      // Step 1: Try "keyValue (fileLabel)"
      const fileGroups = new Map<string, ParsedObject[]>();
      for (const obj of group) {
        const fk = obj.fileLabel.toLowerCase();
        if (!fileGroups.has(fk)) fileGroups.set(fk, []);
        fileGroups.get(fk)!.push(obj);
      }

      for (const [, fGroup] of fileGroups) {
        if (fGroup.length === 1) {
          // key + filename is unique
          fGroup[0].displayKey = `${fGroup[0].keyValue} (${fGroup[0].fileLabel})`;
        } else {
          // key + filename still collides: use second property
          for (const obj of fGroup) {
            const keyProp = fileKeyProps.get(obj.filePath) || "";
            const secondVal = getSecondProperty(obj, keyProp);
            if (secondVal) {
              obj.displayKey = `${obj.keyValue} (${secondVal})`;
            } else {
              // Fallback: use id
              obj.displayKey = `${obj.keyValue} (#${obj.id})`;
            }
          }
        }
      }
    }

    // ── Phase 3: Build objectIndex using displayKey ──
    // Register each object by its displayKey (primary lookup)
    for (const obj of this.allObjects) {
      this.objectIndex.set(obj.displayKey.toLowerCase(), obj);
    }
    // Also register by plain keyValue for non-ambiguous keys
    // (so existing {{keyValue}} links still resolve when there's no collision)
    for (const [k, group] of keyGroups) {
      if (group.length === 1) {
        this.objectIndex.set(k, group[0]);
      }
    }

    // Warn on duplicate ids
    if (idDupes.length > 0) {
      new Notice(
        `Object Links: Duplicate IDs found:\n${idDupes.join("\n")}`,
        8000
      );
    }

    // Update suggest provider
    if (this.suggestProvider) {
      this.suggestProvider.setObjects(this.allObjects);
    }

    // Build graph
    this.graphData = buildGraph(parsedFiles, allFiles);

    // Update open graph views
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof GraphView) {
        leaf.view.navigateToObject = (fp, sl) => this.goToObject(fp, sl);
        leaf.view.navigateToFile = (fp) => this.goToFile(fp);
        leaf.view.setGraphData(this.graphData!);
      }
    });
  }

  // ── Vault scanning ─────────────────────────────────────────────────

  private async scanMultiObjectFiles(): Promise<ParsedFile[]> {
    const files = this.app.vault.getMarkdownFiles();
    const parsed: ParsedFile[] = [];
    const tag = this.settings.objectFileTag.trim();

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);

        // If a tag is configured, only parse files whose frontmatter
        // includes that tag.
        if (tag) {
          if (!this.hasFileTag(content, tag)) continue;
        }

        const result = parseMultiObjectFile(content, file.path);
        if (result) parsed.push(result);
      } catch {
        /* skip */
      }
    }
    return parsed;
  }

  /**
   * Check if a markdown file contains the given tag.
   * Supports:
   *  1. Bare `#tag` anywhere in the file (e.g. `#object-links` on line 1)
   *  2. YAML frontmatter `tags: [a, b]`, `tags: a`, or list form
   *  3. The `tag:` alias used by some Obsidian setups
   */
  private hasFileTag(content: string, tag: string): boolean {
    const lowerTag = tag.toLowerCase();

    // ── 1. Bare #tag anywhere in the content ──
    // Match #tag as a whole word (not inside another word)
    const bareTagRegex = new RegExp(
      `(?:^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
      "im"
    );
    if (bareTagRegex.test(content)) return true;

    // ── 2. YAML frontmatter tags ──
    if (!content.startsWith("---")) return false;
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx === -1) return false;
    const frontmatter = content.substring(3, endIdx);

    // Match "tags:" or "tag:" lines with inline values
    for (const line of frontmatter.split("\n")) {
      const trimmed = line.trim();
      const match = trimmed.match(/^tags?\s*:\s*(.+)$/i);
      if (!match) continue;

      let value = match[1].trim();

      // Array form: [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1);
      }

      const tags = value.split(",").map((t) => t.trim().toLowerCase());
      if (tags.includes(lowerTag)) return true;
    }

    // YAML list form:
    //   tags:
    //     - tag1
    //     - tag2
    const listRegex = /^tags?\s*:\s*$/im;
    const listMatch = listRegex.exec(frontmatter);
    if (listMatch) {
      const afterTags = frontmatter.substring(
        listMatch.index + listMatch[0].length
      );
      for (const line of afterTags.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("- ")) {
          const tagVal = trimmed.substring(2).trim().toLowerCase();
          if (tagVal === lowerTag) return true;
        } else if (trimmed.length > 0 && !trimmed.startsWith("#")) {
          break;
        }
      }
    }

    return false;
  }

  private async getAllVaultFiles(): Promise<VaultFile[]> {
    const files = this.app.vault.getMarkdownFiles();
    const result: VaultFile[] = [];
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        result.push({ path: file.path, basename: file.basename, content });
      } catch {
        /* skip */
      }
    }
    return result;
  }

  // ── Markdown post-processor for {{object}} links ───────────────────

  private processObjectLinks(el: HTMLElement): void {
    // Walk all text nodes and replace {{...}} with clickable spans
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodesToReplace: { node: Text; matches: RegExpExecArray[] }[] = [];

    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
      const text = textNode.textContent || "";
      const regex = /\{\{([^}]+)\}\}/g;
      const matches: RegExpExecArray[] = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        matches.push({ ...match, index: match.index } as RegExpExecArray);
      }
      if (matches.length > 0) {
        nodesToReplace.push({ node: textNode, matches });
      }
    }

    for (const { node, matches } of nodesToReplace) {
      const text = node.textContent || "";
      const parent = node.parentNode;
      if (!parent) continue;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;

      for (const match of matches) {
        // Text before the match
        if (match.index > lastIndex) {
          frag.appendChild(
            document.createTextNode(text.substring(lastIndex, match.index))
          );
        }

        // The {{link}} itself
        let linkTarget = match[1];
        let displayText = linkTarget;
        const pipeIdx = linkTarget.indexOf("|");
        if (pipeIdx !== -1) {
          displayText = linkTarget.substring(pipeIdx + 1).trim();
          linkTarget = linkTarget.substring(0, pipeIdx).trim();
        }

        const span = document.createElement("span");
        span.className = "ol-inline-link";
        span.textContent = displayText;
        span.setAttribute("data-ol-target", linkTarget);

        const obj = this.objectIndex.get(linkTarget.toLowerCase());
        if (!obj) {
          span.classList.add("ol-inline-link-unresolved");
        }

        // Click -> navigate to the object
        span.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const target = span.getAttribute("data-ol-target") || "";
          const targetObj = this.objectIndex.get(target.toLowerCase());
          if (targetObj) {
            this.goToObject(targetObj.filePath, targetObj.startLine);
          } else {
            new Notice(`Object "${target}" not found`);
          }
        });

        // Hover -> show tooltip with properties
        span.addEventListener("mouseenter", (e) => {
          const target = span.getAttribute("data-ol-target") || "";
          const targetObj = this.objectIndex.get(target.toLowerCase());
          if (targetObj) {
            this.showObjectPopover(span, targetObj);
          }
        });
        span.addEventListener("mouseleave", () => {
          this.hideObjectPopover();
        });

        frag.appendChild(span);
        lastIndex = match.index + match[0].length;
      }

      // Remaining text
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      parent.replaceChild(frag, node);
    }
  }

  // ── Object popover on hover ────────────────────────────────────────

  private popoverEl: HTMLElement | null = null;

  private showObjectPopover(anchor: HTMLElement, obj: ParsedObject): void {
    this.hideObjectPopover();

    const pop = document.createElement("div");
    pop.className = "ol-popover";

    const title = document.createElement("div");
    title.className = "ol-popover-title";
    title.textContent = obj.displayKey;
    pop.appendChild(title);

    const file = document.createElement("div");
    file.className = "ol-popover-file";
    file.textContent = obj.fileLabel;
    pop.appendChild(file);

    for (const [k, v] of Object.entries(obj.properties)) {
      const row = document.createElement("div");
      row.className = "ol-popover-row";
      row.innerHTML = `<span class="ol-popover-key">${k}</span><span class="ol-popover-val">${v}</span>`;
      pop.appendChild(row);
    }

    document.body.appendChild(pop);
    this.popoverEl = pop;

    // Position below the anchor
    const rect = anchor.getBoundingClientRect();
    pop.style.top = rect.bottom + 4 + "px";
    pop.style.left = rect.left + "px";
  }

  private hideObjectPopover(): void {
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
  }

  // ── Navigation helpers ─────────────────────────────────────────────

  private async goToObject(filePath: string, startLine: number): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice(`File not found: ${filePath}`);
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);

    // Scroll to the line
    const view = leaf.view as any;
    if (view && view.editor) {
      // Give the editor a moment to load
      setTimeout(() => {
        try {
          view.editor.setCursor({ line: startLine, ch: 0 });
          view.editor.scrollIntoView(
            { from: { line: startLine, ch: 0 }, to: { line: startLine + 5, ch: 0 } },
            true
          );
        } catch {
          /* editor might not support this */
        }
      }, 100);
    }
  }

  private async goToFile(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice(`File not found: ${filePath}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }

  // ── Activate view ──────────────────────────────────────────────────

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);

    // Build/refresh graph
    await this.fullRefresh();
  }

  // ── Settings persistence ───────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Re-scan after settings change (tag may have changed)
    this.fullRefresh();
  }

  // ── Editor helpers ───────────────────────────────────────────────

  /**
   * Command: open the file/object "under the cursor".
   * - If cursor is inside a wikilink ([[...]]), opens that file.
   * - If cursor is inside an object link ({{...}}), opens the object's source file.
   */
  async openUnderCursor(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor) {
      new Notice("Object Links: No active editor");
      return;
    }

    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line) as string;
    const ch = cursor.ch as number;

    const within = (open: string, close: string): string | null => {
      const left = line.lastIndexOf(open, ch);
      if (left === -1) return null;
      const right = line.indexOf(close, left + open.length);
      if (right === -1) return null;
      if (ch < left + open.length || ch > right) return null;
      return line.substring(left + open.length, right);
    };

    // 1) Wikilink: [[target|alias]]
    const wik = within("[[", "]]");
    if (wik) {
      const target = wik.split("|")[0].trim();
      const dest = this.app.metadataCache.getFirstLinkpathDest(target, view?.file?.path || "");
      if (dest) {
        await this.app.workspace.getLeaf("tab").openFile(dest);
        return;
      }
      new Notice(`File not found: ${target}`);
      return;
    }

    // 2) Object link: {{object|alias}}
    const obj = within("{{", "}}");
    if (obj) {
      const target = obj.split("|")[0].trim();
      const found = this.objectIndex.get(target.toLowerCase());
      if (found) {
        await this.goToObject(found.filePath, found.startLine);
        return;
      }
      new Notice(`Object "${target}" not found`);
      return;
    }

    new Notice("No link under cursor");
  }
}

