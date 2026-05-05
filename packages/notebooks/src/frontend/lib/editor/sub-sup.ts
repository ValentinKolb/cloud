/**
 * Subscript and Superscript extension for CodeMirror.
 *
 *     H~2~O           ← `~2~` rendered with `vertical-align: sub`
 *     E=mc^2^         ← `^2^` rendered with `vertical-align: super`
 *
 * The lezer markdown parser doesn't model these, so we scan the doc with
 * regex and decorate inner spans. Markers stay visible (KISS — same as
 * `==mark==`); the visual sub/super-shift is enough signal.
 *
 * Carefully scoped regexes:
 *  - subscript: a single `~`, the inner content has no whitespace or `~`,
 *    closing `~` not adjacent to another `~`. Avoids stomping on
 *    GFM strikethrough (`~~text~~`).
 *  - superscript: a single `^`, no whitespace, closing `^`.
 */

import { RangeSet, StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

const SUB_REGEX = /(?<!~)~(?!~)([^~\s]+)~(?!~)/g;
const SUP_REGEX = /\^([^\^\s]+)\^/g;

const subDecoration = Decoration.mark({ class: "cm-subscript" });
const supDecoration = Decoration.mark({ class: "cm-superscript" });

const findSubSup = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const text = state.doc.toString();
  for (const match of text.matchAll(SUB_REGEX)) {
    if (match.index === undefined) continue;
    decorations.push(subDecoration.range(match.index, match.index + match[0].length));
  }
  for (const match of text.matchAll(SUP_REGEX)) {
    if (match.index === undefined) continue;
    decorations.push(supDecoration.range(match.index, match.index + match[0].length));
  }
  // Decorations must be in document order for RangeSet.of(..., true).
  decorations.sort((a, b) => a.from - b.from);
  return decorations;
};

export const subSupExtension = (): Extension => {
  const stateField = StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of(findSubSup(state), true);
    },
    update(decorations, tr) {
      if (tr.docChanged) {
        return RangeSet.of(findSubSup(tr.state), true);
      }
      return decorations.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const theme = EditorView.theme({
    ".cm-subscript": {
      verticalAlign: "sub",
      fontSize: "0.75em",
    },
    ".cm-superscript": {
      verticalAlign: "super",
      fontSize: "0.75em",
    },
  });

  return [stateField, theme];
};
