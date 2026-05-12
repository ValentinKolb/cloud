/**
 * Cursor-zone StateField — shared by editor decoration pipelines
 * that rebuild on doc changes OR when the cursor crosses a "zone"
 * boundary (entered, left, or moved between zones).
 *
 * Each caller (images, links, tag-pill, info-blocks) tracks the
 * source-byte ranges where editing should reveal the raw markdown
 * source instead of the rendered widget. Without the cursor-zone
 * gate, every plain cursor move through prose would re-walk the
 * syntax tree / re-scan the doc text — visibly laggy on long notes.
 *
 * Callers supply a `build(state)` function returning
 * `{ decorations, ranges }`; this helper wires the standard
 * StateField with the docChanged / selection-key logic and provides
 * the decorations to the view.
 *
 * NOTE: `tables.ts` does NOT use this helper — it carries extra
 * state (block-widget decorations cached separately) that doesn't
 * fit the two-field shape. Keep the helper minimal; if a fifth
 * caller appears with similar shape, fold it in.
 */
import { StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

export type CursorZoneRange = { from: number; to: number };

export type CursorZoneState<R extends CursorZoneRange = CursorZoneRange> = {
  decorations: DecorationSet;
  /** Source-byte ranges where the cursor "activates" the source
   *  (i.e. hides the widget so the user can edit raw markdown). */
  ranges: R[];
};

/** Return the `from` of the range the cursor currently sits inside,
 *  or null if no range contains the cursor. The `from` doubles as a
 *  stable identity key — a rebuild is needed only when this answer
 *  changes between transactions. */
const cursorKey = <R extends CursorZoneRange>(
  state: EditorState,
  ranges: R[],
): number | null => {
  if (ranges.length === 0) return null;
  const cursor = state.selection.main;
  for (const r of ranges) {
    if (cursor.from >= r.from && cursor.to <= r.to) return r.from;
  }
  return null;
};

export const cursorZoneStateField = <R extends CursorZoneRange>(
  build: (state: EditorState) => CursorZoneState<R>,
): Extension => {
  return StateField.define<CursorZoneState<R>>({
    create: build,
    update(value, tr) {
      if (tr.docChanged) return build(tr.state);
      if (!tr.selection) return value;
      const oldKey = cursorKey(tr.startState, value.ranges);
      const newKey = cursorKey(tr.state, value.ranges);
      if (oldKey === newKey) return value;
      return build(tr.state);
    },
    provide(field) {
      return EditorView.decorations.from(field, (v) => v.decorations);
    },
  });
};
