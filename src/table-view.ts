import { TextFileView, WorkspaceLeaf, setIcon } from "obsidian";
import { parseMultiObjectFile, ParsedObject } from "./parser";

export const TABLE_VIEW_TYPE = "object-links-table";

type SortDir = "asc" | "desc";
type FilterOp = "contains" | "not_contains" | "equals" | "not_equals" | "is_empty" | "is_not_empty";

interface PropertyFilter {
  column: string;
  op: FilterOp;
  value: string;
}

const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

export class ObjectTableView extends TextFileView {
  private objects: ParsedObject[] = [];
  private columns: string[] = [];
  private sortCol: string | null = null;
  private sortDir: SortDir = "asc";
  private filters: PropertyFilter[] = [];
  private colWidths: Map<string, number> = new Map();
  private tbodyEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private filterPanelEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.addAction("edit", "Edit as markdown", () => {
      if (!this.file) return;
      this.leaf.setViewState({
        type: "markdown",
        state: { file: this.file.path },
      });
    });
  }

  getViewType(): string {
    return TABLE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Object Table";
  }

  getIcon(): string {
    return "table";
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;

    const parsed = parseMultiObjectFile(data, this.file?.path ?? "");
    if (parsed) {
      this.objects = parsed.objects;
      const colSet = new Set<string>();
      for (const obj of parsed.objects) {
        for (const prop of obj.propertyOrder) {
          colSet.add(prop);
        }
      }
      this.columns = Array.from(colSet);
    } else {
      this.objects = [];
      this.columns = [];
    }

    if (clear) {
      this.sortCol = null;
      this.sortDir = "asc";
      this.filters = [];
      this.colWidths = new Map();
    }

    this.renderTable();
  }

  getViewData(): string {
    return this.data;
  }

  clear(): void {
    this.data = "";
    this.objects = [];
    this.columns = [];
    this.contentEl.empty();
  }

  /* ── Rendering ──────────────────────────────────────────────────── */

  private renderTable(): void {
    this.contentEl.empty();
    this.contentEl.addClass("ol-table-view");

    if (this.objects.length === 0) {
      this.contentEl.createDiv({
        cls: "ol-table-empty",
        text: "No objects found in this file.",
      });
      return;
    }

    // ── Toolbar ──
    const toolbar = this.contentEl.createDiv({ cls: "ol-table-toolbar" });

    const addFilterBtn = toolbar.createEl("button", {
      cls: "ol-table-add-filter clickable-icon",
    });
    setIcon(addFilterBtn, "filter");
    addFilterBtn.addEventListener("click", () => this.addFilter());

    this.countEl = toolbar.createDiv({ cls: "ol-table-count" });

    // ── Filter panel ──
    this.filterPanelEl = this.contentEl.createDiv({ cls: "ol-filter-panel" });
    this.renderFilterPanel();

    // ── Table ──
    const wrapper = this.contentEl.createDiv({ cls: "ol-table-wrapper" });
    const table = wrapper.createEl("table", { cls: "ol-table" });
    table.style.tableLayout = "fixed";

    // Header
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");

    for (const col of this.columns) {
      const th = headerRow.createEl("th");
      th.dataset.col = col;
      const storedWidth = this.colWidths.get(col);
      if (storedWidth) th.style.width = storedWidth + "px";

      const inner = th.createDiv({ cls: "ol-th-inner" });
      inner.createSpan({ cls: "ol-th-label", text: col });

      const arrow = inner.createSpan({ cls: "ol-th-arrow" });
      if (this.sortCol === col) {
        arrow.textContent = this.sortDir === "asc" ? " ▲" : " ▼";
        th.addClass("ol-th-sorted");
      }

      // Sort on click (but not when dragging the resize handle)
      let didResize = false;
      inner.addEventListener("click", () => {
        if (didResize) { didResize = false; return; }
        if (this.sortCol === col) {
          this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
        } else {
          this.sortCol = col;
          this.sortDir = "asc";
        }
        headerRow.querySelectorAll("th").forEach((el) => {
          el.removeClass("ol-th-sorted");
          const a = el.querySelector(".ol-th-arrow") as HTMLElement;
          if (a) a.textContent = "";
        });
        th.addClass("ol-th-sorted");
        arrow.textContent = this.sortDir === "asc" ? " ▲" : " ▼";
        this.renderRows();
      });

      // Resize handle
      const handle = th.createDiv({ cls: "ol-th-resize" });
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = th.offsetWidth;

        const onMove = (ev: MouseEvent) => {
          const newW = Math.max(50, startW + ev.clientX - startX);
          th.style.width = newW + "px";
          didResize = true;
        };

        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          this.colWidths.set(col, th.offsetWidth);
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }

    // Body
    this.tbodyEl = table.createEl("tbody");
    this.renderRows();
  }

  private renderRows(): void {
    if (!this.tbodyEl) return;
    this.tbodyEl.empty();

    let rows = [...this.objects];

    // Apply property filters
    for (const f of this.filters) {
      rows = rows.filter((obj) => this.matchesFilter(obj, f));
    }

    // Sort
    if (this.sortCol) {
      const col = this.sortCol;
      const dir = this.sortDir === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        const va = a.properties[col] || "";
        const vb = b.properties[col] || "";
        const na = Number(va);
        const nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
        return va.localeCompare(vb) * dir;
      });
    }

    for (const obj of rows) {
      const tr = this.tbodyEl.createEl("tr");
      for (const col of this.columns) {
        const td = tr.createEl("td");
        const span = td.createSpan({ cls: "ol-td-text" });
        span.textContent = obj.properties[col] || "";
        span.title = obj.properties[col] || "";
      }
    }

    if (this.countEl) {
      this.countEl.textContent = `${rows.length} of ${this.objects.length}`;
    }
  }

  /* ── Property Filters (Notion-style) ────────────────────────────── */

  private addFilter(): void {
    if (this.columns.length === 0) return;
    this.filters.push({
      column: this.columns[0],
      op: "contains",
      value: "",
    });
    this.renderFilterPanel();
  }

  private renderFilterPanel(): void {
    if (!this.filterPanelEl) return;
    this.filterPanelEl.empty();

    if (this.filters.length === 0) {
      this.filterPanelEl.style.display = "none";
      return;
    }
    this.filterPanelEl.style.display = "";

    for (let i = 0; i < this.filters.length; i++) {
      const f = this.filters[i];
      const row = this.filterPanelEl.createDiv({ cls: "ol-filter-row" });

      // Column select
      const colSelect = row.createEl("select", { cls: "ol-filter-select" });
      for (const col of this.columns) {
        const opt = colSelect.createEl("option", { text: col, value: col });
        if (col === f.column) opt.selected = true;
      }
      colSelect.addEventListener("change", () => {
        f.column = colSelect.value;
        this.renderRows();
      });

      // Operator select
      const opSelect = row.createEl("select", { cls: "ol-filter-select" });
      for (const op of FILTER_OPS) {
        const opt = opSelect.createEl("option", { text: op.label, value: op.value });
        if (op.value === f.op) opt.selected = true;
      }
      opSelect.addEventListener("change", () => {
        f.op = opSelect.value as FilterOp;
        this.renderFilterPanel();
        this.renderRows();
      });

      // Value input (hidden for is_empty / is_not_empty)
      if (f.op !== "is_empty" && f.op !== "is_not_empty") {
        const valInput = row.createEl("input", {
          cls: "ol-filter-input",
          type: "text",
          placeholder: "value…",
        });
        valInput.value = f.value;
        valInput.addEventListener("input", () => {
          f.value = valInput.value;
          this.renderRows();
        });
      }

      // Remove button
      const removeBtn = row.createEl("button", {
        cls: "ol-filter-remove clickable-icon",
      });
      setIcon(removeBtn, "x");
      const idx = i;
      removeBtn.addEventListener("click", () => {
        this.filters.splice(idx, 1);
        this.renderFilterPanel();
        this.renderRows();
      });
    }
  }

  private matchesFilter(obj: ParsedObject, f: PropertyFilter): boolean {
    const val = (obj.properties[f.column] || "").toLowerCase();
    const fv = f.value.toLowerCase();
    switch (f.op) {
      case "contains": return val.includes(fv);
      case "not_contains": return !val.includes(fv);
      case "equals": return val === fv;
      case "not_equals": return val !== fv;
      case "is_empty": return val === "";
      case "is_not_empty": return val !== "";
    }
  }
}
