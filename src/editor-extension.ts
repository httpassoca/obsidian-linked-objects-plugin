/**
 * CodeMirror 6 editor extension that highlights {{object links}}
 * in live-preview mode to match the appearance of [[wikilinks]].
 *
 * Uses Obsidian's own CSS variables and classes so the styling
 * is consistent with the native link appearance.
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  keymap,
} from "@codemirror/view";
import { EditorSelection, RangeSetBuilder } from "@codemirror/state";

/* ── Decoration specs ─────────────────────────────────────────────── */

const linkDeco = Decoration.mark({ class: "ol-cm-link" });
const linkEditingDeco = Decoration.mark({ class: "ol-cm-link-editing" });

/* ── Build decorations for visible ranges ─────────────────────────── */

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const cursorHead = view.state.selection.main.head;
  const regex = /\{\{([^}]+)\}\}/g;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const start = from + match.index;
      const end = start + match[0].length;

      // Use a subtler style when the cursor is inside the match
      const cursorInside = cursorHead >= start && cursorHead <= end;
      builder.add(start, end, cursorInside ? linkEditingDeco : linkDeco);
    }
  }

  return builder.finish();
}

/* ── ViewPlugin ───────────────────────────────────────────────────── */

export const objectLinkHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * Keybinding: if you have a selection and press `{`, wrap it in `{{ ... }}`.
 * If there's no selection, let CodeMirror insert `{` normally.
 */
export const objectLinkWrapperKeymap = keymap.of([
  {
    key: "{",
    run: (view) => {
      const sel = view.state.selection;
      if (sel.ranges.every((r) => r.empty)) return false;

      const changes: { from: number; to: number; insert: string }[] = [];
      const newRanges: any[] = [];

      for (const r of sel.ranges) {
        const text = view.state.doc.sliceString(r.from, r.to);
        const insert = `{{${text}}}`;
        changes.push({ from: r.from, to: r.to, insert });
        // Place cursor inside the braces, selecting the original text.
        const start = r.from + 2;
        const end = start + text.length;
        newRanges.push(EditorSelection.range(start, end));
      }

      view.dispatch({
        changes,
        selection: EditorSelection.create(newRanges, sel.mainIndex),
      });
      return true;
    },
  },
]);
