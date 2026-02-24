/**
 * Factory for creating CodeMirror decoration extensions
 *
 * Reduces boilerplate for decoration extensions that follow the same pattern:
 * - Create decorations on state creation
 * - Update decorations on document change or selection change
 * - Provide decorations to the editor view
 */

import { type EditorState, type Range, StateField, RangeSet } from "@codemirror/state";
import { type Decoration, type DecorationSet, EditorView } from "@codemirror/view";

type FinderFn = (state: EditorState) => Range<Decoration>[];

/**
 * Create a decoration StateField with the standard update pattern.
 *
 * @param finder - Function that finds and returns decorations for the current state
 * @returns StateField that provides decorations to the editor
 *
 * @example
 * const myDecorations = createDecorationField((state) => {
 *   const decorations: Range<Decoration>[] = [];
 *   // ... find and push decorations
 *   return decorations;
 * });
 *
 * export const myExtension = () => [myDecorations, myTheme];
 */
export const createDecorationField = (finder: FinderFn) => {
  return StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of(finder(state), true);
    },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) {
        return RangeSet.of(finder(tr.state), true);
      }
      return decorations.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
};
