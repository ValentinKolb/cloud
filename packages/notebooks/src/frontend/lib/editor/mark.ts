/**
 * Mark / Highlight extension for CodeMirror.
 *
 * Detects `==text==` spans and decorates them with a yellow textmarker
 * background. The lezer markdown parser does NOT recognise this syntax
 * (it's not in CommonMark / GFM), so we scan the doc with a regex and
 * apply `Decoration.mark` for each match. For typical note sizes the
 * full-doc scan is microseconds — well within tick budget.
 */

import { RangeSet, StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

const MARK_REGEX = /==(?!=)([^\s=][^=]*?[^\s=]|[^\s=])==(?!=)/g;

const markDecoration = Decoration.mark({ class: "cm-mark-highlight" });

const findMarks = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const text = state.doc.toString();
  for (const match of text.matchAll(MARK_REGEX)) {
    if (match.index === undefined) continue;
    const from = match.index;
    const to = from + match[0].length;
    decorations.push(markDecoration.range(from, to));
  }
  return decorations;
};

export const markExtension = (): Extension => {
  const stateField = StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of(findMarks(state), true);
    },
    update(decorations, tr) {
      if (tr.docChanged) {
        return RangeSet.of(findMarks(tr.state), true);
      }
      return decorations.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  // Match the renderer's `<mark>` styling so edit-mode and read-mode look
  // the same. Neon-yellow textmarker — saturated yellow-300 with dark text
  // for the punchy real-highlighter feel (the previous yellow-100 read as
  // muted cream / sand).
  const theme = EditorView.theme({
    ".cm-mark-highlight": {
      backgroundColor: "rgb(253 224 71)", // yellow-300
      color: "rgb(24 24 27)", // zinc-900
      borderRadius: "2px",
      padding: "0 2px",
    },
    ".dark .cm-mark-highlight": {
      backgroundColor: "rgba(250 204 21 / 0.4)", // yellow-400 @ 40%
      color: "rgb(254 252 232)", // yellow-50
    },
  });

  return [stateField, theme];
};
