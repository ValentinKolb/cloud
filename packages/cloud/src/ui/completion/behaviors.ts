/**
 * DOM-bound completion behaviours. Each function mutates a textarea
 * via `document.execCommand("insertText", …)` so the native undo
 * stack stays usable.
 *
 * State lives at module scope (`lastExpansion`, `suppressNextExpansion`)
 * because only one cursor / one expansion exists at a time. Module
 * scope keeps the API stateless from the caller's perspective.
 *
 * Re-entrancy: `execCommand` fires a synchronous `input` event. If
 * `tryExpand` runs in that handler and itself calls `execCommand`, we
 * arm `suppressNextExpansion` so the NEXT input event (the one
 * triggered by the expansion's own insertion) skips the expand check
 * — otherwise an expansion's tail could cascade into another match.
 */

import {
  type Completion,
  type QueryContext,
  type Suggestion,
  type SuggestContext,
  TRIGGER_CHARS,
  WORD_CHAR,
  suggestSync,
} from "./engine";

type LastExpansion = {
  textarea: HTMLTextAreaElement;
  startOffset: number;
  originalWord: string;
  triggerChar: string;
  expansion: string;
};

let lastExpansion: LastExpansion | null = null;
let suppressNextExpansion = false;

/** Reset module-level state. Call on editor blur or unmount so a
 *  stale expansion record doesn't leak across editor instances. */
export const resetCompletionState = (): void => {
  lastExpansion = null;
  suppressNextExpansion = false;
};

/** Find the first sync suggestion whose `text === word` and that
 *  carries an `expansion`. Returns null when nothing matches OR when
 *  no plain completion provides a sync result. */
const findExpansion = (
  word: string,
  completions: Completion[],
  ctx: SuggestContext,
): { suggestion: Suggestion; completion: Completion } | null => {
  for (const c of completions) {
    if (c.trigger !== undefined) continue;
    const list = suggestSync(c, word, ctx);
    if (!list) continue;
    const exact = list.find((s) => s.text === word && s.expansion);
    if (exact) return { suggestion: exact, completion: c };
    const lower = word.toLowerCase();
    const ci = list.find((s) => s.text.toLowerCase() === lower && s.expansion);
    if (ci) return { suggestion: ci, completion: c };
  }
  return null;
};

export type TryExpandOptions = {
  /** Optional predicate to suppress expansion at a position (e.g.
   *  markdown code spans). Default: never suppress. */
  isExcluded?: (text: string, pos: number) => boolean;
};

/**
 * If the user just typed a word-boundary char AND the preceding word
 * has a registered `expansion` AND the position passes `isExcluded`,
 * replace the word with its expansion via `execCommand`. Returns true
 * if an expansion happened — caller should treat that as "consumed"
 * and not run the normal input pipeline.
 */
export const tryExpand = (
  textarea: HTMLTextAreaElement,
  completions: Completion[] | undefined,
  options: TryExpandOptions = {},
): boolean => {
  if (suppressNextExpansion) {
    suppressNextExpansion = false;
    return false;
  }
  if (!completions || completions.length === 0) return false;

  const value = textarea.value;
  const caret = textarea.selectionStart;
  if (caret === 0 || caret !== textarea.selectionEnd) return false;

  const triggerChar = value[caret - 1];
  if (!triggerChar || !TRIGGER_CHARS.has(triggerChar)) return false;

  let wordEnd = caret - 1;
  let wordStart = wordEnd;
  while (wordStart > 0 && WORD_CHAR.test(value[wordStart - 1]!)) wordStart--;
  if (wordStart === wordEnd) return false;

  const word = value.slice(wordStart, wordEnd);
  if (options.isExcluded?.(value, wordStart)) return false;

  const ctx: SuggestContext = { fullText: value, caret, tokenStart: wordStart };
  const hit = findExpansion(word, completions, ctx);
  if (!hit) return false;
  const { suggestion } = hit;
  if (!suggestion.expansion) return false;

  const replacement = suggestion.expansion + triggerChar;
  textarea.setSelectionRange(wordStart, caret);
  document.execCommand("insertText", false, replacement);

  lastExpansion = {
    textarea,
    startOffset: wordStart,
    originalWord: word,
    triggerChar,
    expansion: suggestion.expansion,
  };
  suppressNextExpansion = true;
  return true;
};

/**
 * Backspace IMMEDIATELY after an expansion reverts to the original
 * short form + trigger. Returns true if a restore happened — caller
 * should `preventDefault` to suppress the native backspace.
 */
export const tryRestore = (textarea: HTMLTextAreaElement): boolean => {
  const last = lastExpansion;
  if (!last || last.textarea !== textarea) return false;

  const value = textarea.value;
  const tail = last.startOffset + last.expansion.length + last.triggerChar.length;
  if (textarea.selectionStart !== tail || textarea.selectionEnd !== tail) return false;

  const expected = last.expansion + last.triggerChar;
  if (value.slice(last.startOffset, tail) !== expected) return false;

  suppressNextExpansion = true;
  textarea.setSelectionRange(last.startOffset, tail);
  document.execCommand("insertText", false, last.originalWord + last.triggerChar);

  lastExpansion = null;
  return true;
};

/**
 * Insert a selected suggestion at the query position. Replaces the
 * typed prefix with either `suggestion.expansion` (when present —
 * abbreviation-style: Tab is shortcut for "type the rest + space")
 * or `suggestion.text` (triggered completions).
 *
 * Always appends a space UNLESS the next char is already a literal
 * space / tab. Records `lastExpansion` for direct expansions so
 * Backspace afterwards reverts to the short form, matching the
 * contract of manual word-boundary expansion.
 *
 * The expansion is done as a SINGLE `execCommand` rather than
 * inserting the abbreviation and waiting for `tryExpand` to fire on
 * the trailing space — nested execCommand inside an input handler is
 * unreliable in some browsers (the inner call's selection-replace can
 * be silently dropped, leaving the abbreviation selected).
 */
export const applySuggestion = (
  textarea: HTMLTextAreaElement,
  ctx: QueryContext,
  suggestion: Suggestion,
  options: { trackExpansion?: boolean } = {},
): boolean => {
  const baseText = suggestion.expansion ?? suggestion.text;
  if (baseText === ctx.text) return false;

  // Don't append a space when the suggestion ends with an opening
  // bracket — that's a signal the user wants to keep typing INSIDE
  // (e.g. `=SUM(` → cursor right after `(`, not after a space). A
  // trailing space would also break chained completions: `=SUM( r`
  // can't activate the `(` trigger because the trigger char is no
  // longer directly before the word.
  const nextChar = textarea.value[ctx.end];
  const alreadySeparated = nextChar === " " || nextChar === "\t";
  const opensScope = /[([{]$/.test(baseText);
  const insertText = alreadySeparated || opensScope ? baseText : baseText + " ";

  textarea.setSelectionRange(ctx.start, ctx.end);
  document.execCommand("insertText", false, insertText);

  if ((options.trackExpansion ?? true) && suggestion.expansion !== undefined && suggestion.expansion !== suggestion.text) {
    lastExpansion = {
      textarea,
      startOffset: ctx.start,
      originalWord: suggestion.text,
      triggerChar: alreadySeparated || opensScope ? "" : " ",
      expansion: suggestion.expansion,
    };
    suppressNextExpansion = true;
  }
  return true;
};
