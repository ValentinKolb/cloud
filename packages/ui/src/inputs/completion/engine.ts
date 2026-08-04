export type Suggestion = {
  text: string;
  label?: string;
  expansion?: string;
  appendSpace?: boolean;
  hint?: string;
  textEdit?: {
    start: number;
    end: number;
    text: string;
  };
};

export type SuggestContext = {
  fullText: string;
  caret: number;
  tokenStart: number;
};

export type Completion = {
  trigger?: string;
  suggest: (query: string, context: SuggestContext, signal: AbortSignal) => readonly Suggestion[] | Promise<readonly Suggestion[]>;
  /** Static labels used by editor highlighting. Providers are never invoked to derive metadata. */
  knownLabels?: readonly string[];
  debounceMs?: number;
  dropdown?: boolean;
  allowAfterWord?: boolean;
};

export type QueryContext = {
  start: number;
  end: number;
  text: string;
  query: string;
  completion: Completion;
};

export type DetectOptions = {
  isExcluded?: (text: string, position: number) => boolean;
};

export type ResolveResult = { kind: "sync"; data: readonly Suggestion[] } | { kind: "async"; promise: Promise<readonly Suggestion[]> };

export const TRIGGER_CHARS = new Set([" ", "\t", "\n", ",", ".", "!", "?", ";", ":", ")", "]", "}", '"', "'"]);
export const WORD_CHAR = /[\p{L}\p{N}_]/u;
export const GHOST_SENTINEL = String.fromCharCode(0xe010);

export const abbreviations = (dictionary: Record<string, string>): Completion => {
  const suggestions = Object.entries(dictionary).map(([text, expansion]) => ({ text, expansion }));
  return {
    knownLabels: suggestions.map((suggestion) => suggestion.text),
    suggest: (query) => {
      if (query === "") return suggestions;
      const normalized = query.toLowerCase();
      return suggestions
        .filter((suggestion) => suggestion.text === query || suggestion.text.toLowerCase().startsWith(normalized))
        .sort((left, right) => Number(!left.text.startsWith(query)) - Number(!right.text.startsWith(query)));
    },
  };
};

export const detectQuery = (
  textarea: HTMLTextAreaElement,
  completions: readonly Completion[] | undefined,
  options: DetectOptions = {},
): QueryContext | null => {
  if (!completions || completions.length === 0) return null;
  if (textarea.selectionStart !== textarea.selectionEnd) return null;

  const value = textarea.value;
  const caret = textarea.selectionStart;
  if (caret === 0 || options.isExcluded?.(value, caret)) return null;
  const afterCaret = value[caret];
  if (afterCaret !== undefined && WORD_CHAR.test(afterCaret)) return null;

  let wordStart = caret;
  while (wordStart > 0 && WORD_CHAR.test(value[wordStart - 1]!)) wordStart--;
  const trigger = wordStart > 0 ? value[wordStart - 1] : undefined;

  if (trigger) {
    const completion = completions.find((candidate) => candidate.trigger === trigger);
    if (completion) {
      const beforeTrigger = wordStart >= 2 ? value[wordStart - 2] : undefined;
      if (!beforeTrigger || !WORD_CHAR.test(beforeTrigger) || completion.allowAfterWord) {
        const query = value.slice(wordStart, caret);
        return {
          start: wordStart - 1,
          end: caret,
          text: trigger + query,
          query,
          completion,
        };
      }
    }
  }

  if (caret > wordStart) {
    const completion = completions.find((candidate) => candidate.trigger === undefined);
    if (completion) {
      const query = value.slice(wordStart, caret);
      return { start: wordStart, end: caret, text: query, query, completion };
    }
  }
  return null;
};

export const resolveSuggestions = (completion: Completion, query: string, context: SuggestContext, signal: AbortSignal): ResolveResult => {
  const result = completion.suggest(query, context, signal);
  return result instanceof Promise ? { kind: "async", promise: result } : { kind: "sync", data: result };
};

export const suggestSync = (completion: Completion, query: string, context: SuggestContext): readonly Suggestion[] | null => {
  const controller = new AbortController();
  let result: readonly Suggestion[] | Promise<readonly Suggestion[]>;
  try {
    result = completion.suggest(query, context, controller.signal);
  } catch {
    return null;
  }
  if (!(result instanceof Promise)) return result;
  controller.abort();
  void result.catch(() => undefined);
  return null;
};

export const pickGhost = (suggestions: readonly Suggestion[], typed: string): Suggestion | null => {
  const normalized = typed.toLowerCase();
  return (
    suggestions.find((suggestion) => suggestion.text.length > typed.length && suggestion.text.toLowerCase().startsWith(normalized)) ?? null
  );
};

export const collectKnownLabels = (completions: readonly Completion[] | undefined): Set<string> => {
  const labels = new Set<string>();
  for (const completion of completions ?? []) {
    for (const label of completion.knownLabels ?? []) labels.add(label);
  }
  return labels;
};

export const displayLabel = (suggestion: Suggestion, completion: Completion): string => {
  if (suggestion.label !== undefined) return suggestion.label;
  return completion.trigger && suggestion.text.startsWith(completion.trigger)
    ? suggestion.text.slice(completion.trigger.length)
    : suggestion.text;
};

export const buildSuggestContext = (textarea: HTMLTextAreaElement, context: QueryContext): SuggestContext => ({
  fullText: textarea.value,
  caret: textarea.selectionStart,
  tokenStart: context.start,
});
