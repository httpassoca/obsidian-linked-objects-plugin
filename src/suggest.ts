import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import { ParsedObject } from "./parser";

export interface ObjectSuggestion {
  /** The disambiguated key used for {{}} links */
  displayKey: string;
  /** The original key value (for display/search) */
  keyValue: string;
  fileLabel: string;
  filePath: string;
  properties: Record<string, string>;
}

export class ObjectLinkSuggest extends EditorSuggest<ObjectSuggestion> {
  private objects: ObjectSuggestion[] = [];

  constructor(app: any) {
    super(app);

    // Make suggestions accept with Tab (in addition to Enter).
    // Obsidian's PopoverSuggest uses an internal "chooser"; we call it best-effort.
    this.setInstructions([
      { command: "↑↓", purpose: "to navigate" },
      { command: "Enter", purpose: "to insert" },
      { command: "Tab", purpose: "to insert" },
      { command: "Esc", purpose: "to dismiss" },
    ]);

    this.scope.register([], "Tab", (evt) => {
      const e = evt as KeyboardEvent;
      e.preventDefault();
      e.stopPropagation();
      const chooser = (this as any).chooser;
      if (chooser && typeof chooser.useSelectedItem === "function") {
        chooser.useSelectedItem(e);
        return true;
      }
      // Fallback: simulate Enter
      if (chooser && typeof chooser.onEnter === "function") {
        chooser.onEnter(e);
        return true;
      }
      return true;
    });
  }

  setObjects(objects: ParsedObject[]): void {
    this.objects = objects.map((o) => ({
      displayKey: o.displayKey,
      keyValue: o.keyValue,
      fileLabel: o.fileLabel,
      filePath: o.filePath,
      properties: o.properties,
    }));
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null
  ): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    const sub = line.substring(0, cursor.ch);

    // Find the last {{ that isn't closed
    const lastOpen = sub.lastIndexOf("{{");
    if (lastOpen === -1) return null;

    // Check it's not already closed
    const afterOpen = sub.substring(lastOpen + 2);
    if (afterOpen.includes("}}")) return null;

    const query = afterOpen;

    return {
      start: { line: cursor.line, ch: lastOpen + 2 },
      end: cursor,
      query,
    };
  }

  getSuggestions(context: EditorSuggestContext): ObjectSuggestion[] {
    const query = context.query.toLowerCase();
    if (!query) return this.objects.slice(0, 20);

    return this.objects
      .filter(
        (o) =>
          o.displayKey.toLowerCase().includes(query) ||
          o.keyValue.toLowerCase().includes(query)
      )
      .slice(0, 20);
  }

  renderSuggestion(suggestion: ObjectSuggestion, el: HTMLElement): void {
    const container = el.createDiv({ cls: "ol-suggestion" });

    const titleEl = container.createDiv({ cls: "ol-suggestion-title" });
    titleEl.textContent = suggestion.displayKey;

    const fileEl = container.createDiv({ cls: "ol-suggestion-file" });
    fileEl.textContent = suggestion.fileLabel;
  }

  selectSuggestion(
    suggestion: ObjectSuggestion,
    _evt: MouseEvent | KeyboardEvent
  ): void {
    if (!this.context) return;

    const editor = this.context.editor;
    const start = this.context.start;
    const end = this.context.end;

    // Check if }} already exists right after the cursor (auto-closed by Obsidian)
    const lineText = editor.getLine(end.line);
    const afterCursor = lineText.substring(end.ch);
    const hasClosing = afterCursor.startsWith("}}");

    // Replace the query text with the display key, consuming existing }} if present
    const replaceTo = hasClosing
      ? { line: end.line, ch: end.ch + 2 }
      : end;
    editor.replaceRange(suggestion.displayKey + "}}", start, replaceTo);
  }
}
