export type Suggestion = {
  text: string;
  label?: string;
  hint?: string;
  expansion?: string;
  appendSpace?: boolean;
  textEdit?: { start: number; end: number; text: string };
};

export type SuggestContext = {
  fullText: string;
  caret: number;
  tokenStart: number;
};

export type Completion = {
  trigger?: string;
  suggest: (
    query: string,
    context: SuggestContext,
    signal: AbortSignal,
  ) => readonly Suggestion[] | Promise<readonly Suggestion[]>;
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

export type ResolveResult =
  | { kind: "sync"; data: readonly Suggestion[] }
  | { kind: "async"; promise: Promise<readonly Suggestion[]> };

export const TRIGGER_CHARS = new Set([" ", "\t", "\n", ",", ".", "!", "?", ";", ":", ")", "]", "}", '"', "'"]);
export const WORD_CHAR = /[\p{L}\p{N}_]/u;
export const GHOST_SENTINEL = String.fromCharCode(0xe010);

export const abbreviations = (values: Record<string, string>): Completion => {
  const suggestions = Object.entries(values).map(([text, expansion]) => ({ text, expansion }));
  return {
    suggest: (query) => {
      const normalized = query.toLowerCase();
      return suggestions
        .filter((suggestion) => suggestion.text.toLowerCase().startsWith(normalized))
        .sort((left, right) => Number(!left.text.startsWith(query)) - Number(!right.text.startsWith(query)));
    },
  };
};

export const detectCompletion = (
  value: string,
  caret: number,
  completions: readonly Completion[],
  options: DetectOptions = {},
): QueryContext | null => {
  if (caret <= 0 || options.isExcluded?.(value, caret)) return null;
  if (value[caret] && WORD_CHAR.test(value[caret] ?? "")) return null;

  let start = caret;
  while (start > 0 && WORD_CHAR.test(value[start - 1] ?? "")) start -= 1;
  const trigger = start > 0 ? value[start - 1] : undefined;
  const triggered = completions.find((completion) => completion.trigger === trigger);
  if (triggered) {
    const before = start > 1 ? value[start - 2] : undefined;
    if (!before || !WORD_CHAR.test(before) || triggered.allowAfterWord) {
      return {
        start: start - 1,
        end: caret,
        text: value.slice(start - 1, caret),
        query: value.slice(start, caret),
        completion: triggered,
      };
    }
  }

  const plain = completions.find((completion) => completion.trigger === undefined);
  return plain && start < caret
    ? { start, end: caret, text: value.slice(start, caret), query: value.slice(start, caret), completion: plain }
    : null;
};

export const detectQuery = (
  textarea: HTMLTextAreaElement,
  completions: readonly Completion[] | undefined,
  options: DetectOptions = {},
): QueryContext | null => {
  if (!completions || textarea.selectionStart !== textarea.selectionEnd) return null;
  return detectCompletion(textarea.value, textarea.selectionStart, completions, options);
};

export const buildSuggestContext = (textarea: HTMLTextAreaElement, context: QueryContext): SuggestContext => ({
  fullText: textarea.value,
  caret: textarea.selectionStart,
  tokenStart: context.start,
});

export const resolveSuggestions = (
  completion: Completion,
  query: string,
  context: SuggestContext,
  signal: AbortSignal,
): ResolveResult => {
  const result = completion.suggest(query, context, signal);
  return result instanceof Promise ? { kind: "async", promise: result } : { kind: "sync", data: result };
};

export const resolveCompletion = async (
  context: QueryContext,
  fullText: string,
  signal: AbortSignal,
): Promise<readonly Suggestion[]> =>
  context.completion.suggest(
    context.query,
    { fullText, caret: context.end, tokenStart: context.start },
    signal,
  );

export const suggestSync = (
  completion: Completion,
  query: string,
  context: SuggestContext,
): readonly Suggestion[] | null => {
  const controller = new AbortController();
  try {
    const result = completion.suggest(query, context, controller.signal);
    if (result instanceof Promise) {
      controller.abort();
      void result.catch(() => undefined);
      return null;
    }
    return result;
  } catch {
    return null;
  }
};

export const pickGhost = (suggestions: readonly Suggestion[], typed: string): Suggestion | null => {
  const normalized = typed.toLowerCase();
  return suggestions.find(
    (suggestion) =>
      suggestion.text.length > typed.length && suggestion.text.toLowerCase().startsWith(normalized),
  ) ?? null;
};

export const collectKnownLabels = (completions: readonly Completion[] | undefined): Set<string> => {
  const labels = new Set<string>();
  for (const completion of completions ?? []) {
    for (const suggestion of suggestSync(completion, "", { fullText: "", caret: 0, tokenStart: 0 }) ?? []) {
      labels.add(suggestion.text);
    }
  }
  return labels;
};

export const displayLabel = (suggestion: Suggestion, completion: Completion): string => {
  if (suggestion.label !== undefined) return suggestion.label;
  return completion.trigger && suggestion.text.startsWith(completion.trigger)
    ? suggestion.text.slice(completion.trigger.length)
    : suggestion.text;
};

const replacement = (value: string, context: QueryContext, suggestion: Suggestion) => {
  const edit = suggestion.textEdit;
  const start = edit?.start ?? context.start;
  const end = edit?.end ?? context.end;
  const base = edit?.text ?? suggestion.expansion ?? suggestion.text;
  const separated = /\s/.test(value[end] ?? "");
  const insert = suggestion.appendSpace === false || separated || /[([{]$/.test(base) ? base : `${base} `;
  return { start, end, insert };
};

export const applyCompletion = (
  value: string,
  context: QueryContext,
  suggestion: Suggestion,
): { value: string; caret: number } => {
  const edit = replacement(value, context, suggestion);
  return {
    value: `${value.slice(0, edit.start)}${edit.insert}${value.slice(edit.end)}`,
    caret: edit.start + edit.insert.length,
  };
};

export const applySuggestion = (
  textarea: HTMLTextAreaElement,
  context: QueryContext,
  suggestion: Suggestion,
): boolean => {
  const edit = replacement(textarea.value, context, suggestion);
  if (edit.start < 0 || edit.end < edit.start || edit.end > textarea.value.length) return false;
  if (textarea.value.slice(edit.start, edit.end) === edit.insert) return false;
  textarea.setSelectionRange(edit.start, edit.end);
  document.execCommand("insertText", false, edit.insert);
  return true;
};

type LastExpansion = {
  textarea: HTMLTextAreaElement;
  start: number;
  original: string;
  expansion: string;
  boundary: string;
};

let lastExpansion: LastExpansion | null = null;
let suppressExpansion = false;

export const resetCompletionState = (): void => {
  lastExpansion = null;
  suppressExpansion = false;
};

export const tryExpand = (
  textarea: HTMLTextAreaElement,
  completions: readonly Completion[] | undefined,
  options: DetectOptions = {},
): boolean => {
  if (suppressExpansion) {
    suppressExpansion = false;
    return false;
  }
  const caret = textarea.selectionStart;
  if (!completions || caret !== textarea.selectionEnd || caret === 0) return false;
  const boundary = textarea.value[caret - 1];
  if (!boundary || !TRIGGER_CHARS.has(boundary)) return false;

  let start = caret - 1;
  while (start > 0 && WORD_CHAR.test(textarea.value[start - 1] ?? "")) start -= 1;
  if (start === caret - 1 || options.isExcluded?.(textarea.value, start)) return false;
  const original = textarea.value.slice(start, caret - 1);
  const context = { fullText: textarea.value, caret, tokenStart: start };
  for (const completion of completions) {
    if (completion.trigger !== undefined) continue;
    const suggestion = (suggestSync(completion, original, context) ?? []).find(
      (candidate) =>
        candidate.expansion &&
        candidate.expansion !== original &&
        candidate.text.toLowerCase() === original.toLowerCase(),
    );
    if (!suggestion?.expansion) continue;
    textarea.setSelectionRange(start, caret);
    document.execCommand("insertText", false, `${suggestion.expansion}${boundary}`);
    lastExpansion = { textarea, start, original, expansion: suggestion.expansion, boundary };
    suppressExpansion = true;
    return true;
  }
  return false;
};

export const tryRestore = (textarea: HTMLTextAreaElement): boolean => {
  const last = lastExpansion;
  if (!last || last.textarea !== textarea) return false;
  const end = last.start + last.expansion.length + last.boundary.length;
  if (textarea.selectionStart !== end || textarea.selectionEnd !== end) return false;
  if (textarea.value.slice(last.start, end) !== `${last.expansion}${last.boundary}`) return false;
  textarea.setSelectionRange(last.start, end);
  document.execCommand("insertText", false, `${last.original}${last.boundary}`);
  lastExpansion = null;
  suppressExpansion = true;
  return true;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const plainTextHighlight = escapeHtml;

export type RenderOptions = {
  ghost?: { at: number; text: string };
  anchor?: { at: number };
};

export const renderWithOverlay = (
  text: string,
  highlighter: (text: string) => string,
  options: RenderOptions = {},
): string => {
  const injection = options.ghost ?? options.anchor;
  const highlighted = highlighter(
    injection ? `${text.slice(0, injection.at)}${GHOST_SENTINEL}${text.slice(injection.at)}` : text,
  );
  if (options.ghost) {
    return highlighted
      .split(GHOST_SENTINEL)
      .join(
        `<span class="k2b-completion-ghost" data-completion-anchor>${escapeHtml(options.ghost.text)}<span aria-hidden="true">→</span></span>`,
      );
  }
  if (options.anchor) {
    return highlighted
      .split(GHOST_SENTINEL)
      .join('<span class="k2b-completion-anchor" data-completion-anchor aria-hidden="true">\u200b</span>');
  }
  return highlighted;
};
