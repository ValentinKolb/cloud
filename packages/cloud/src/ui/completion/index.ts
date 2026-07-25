/**
 * Generic completion system used by both `<MarkdownEditor>` and
 * `<AutocompleteEditor>`. Engine is pure logic, behaviours touch the
 * DOM via `execCommand`, overlay renders ghost + anchor for editors
 * that mirror their textarea in a preview div.
 *
 * For most callers, the high-level entrypoint is `<AutocompleteEditor>`
 * (see `../input/AutocompleteEditor.tsx`). Direct engine access here
 * is for editors that compose their own UI on top.
 */

export {
  applySuggestion,
  resetCompletionState,
  type TryExpandOptions,
  tryExpand,
  tryRestore,
} from "./behaviors";
export {
  abbreviations,
  buildSuggestContext,
  type Completion,
  collectKnownLabels,
  type DetectOptions,
  detectQuery,
  displayLabel,
  GHOST_SENTINEL,
  pickGhost,
  type QueryContext,
  type ResolveResult,
  resolveSuggestions,
  type SuggestContext,
  type Suggestion,
  suggestSync,
  TRIGGER_CHARS,
  WORD_CHAR,
} from "./engine";

export { plainTextHighlight, type RenderOptions, renderWithOverlay } from "./overlay";
