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
  type Suggestion,
  type SuggestContext,
  type Completion,
  type QueryContext,
  type DetectOptions,
  type ResolveResult,
  TRIGGER_CHARS,
  WORD_CHAR,
  GHOST_SENTINEL,
  abbreviations,
  detectQuery,
  resolveSuggestions,
  suggestSync,
  pickGhost,
  collectKnownLabels,
  buildSuggestContext,
  displayLabel,
} from "./engine";

export {
  type TryExpandOptions,
  resetCompletionState,
  tryExpand,
  tryRestore,
  applySuggestion,
} from "./behaviors";

export { type RenderOptions, plainTextHighlight, renderWithOverlay } from "./overlay";
