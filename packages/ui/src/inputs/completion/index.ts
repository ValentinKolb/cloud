export {
  createCompletionBehaviorState,
  type TryExpandOptions,
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
export {
  plainTextHighlight,
  type RenderOptions,
  renderWithOverlay,
} from "./overlay";
