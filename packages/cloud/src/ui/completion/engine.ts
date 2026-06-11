/**
 * Generic completion engine — pure logic, no DOM mutation, no timers.
 *
 * Used by `<MarkdownEditor>` for markdown autocompletion and by the
 * standalone `<AutocompleteEditor>` for any plain-text use case
 * (formulas, code, search builders, mentions, etc.). The engine has
 * no opinions on syntax: it walks a textarea-like state, classifies
 * the current "token" at the caret, and delegates to user-supplied
 * `suggest` functions for the actual data.
 *
 * Three behaviours drive the same `Completion` type:
 *
 *   1. **Auto-expand** — Plain (trigger-less) completions whose
 *      suggestions have an `expansion` field. Typing a word-boundary
 *      char after a matching word replaces it verbatim (handled by
 *      `behaviors.tryExpand`).
 *   2. **Ghost preview** — The closest matching suggestion is shown
 *      inline at the caret in dim text. Tab inserts it.
 *   3. **Dropdown** — Per-completion opt-in via `dropdown: true`.
 *      Lists all matches; arrow keys cycle; Enter/Tab insert.
 *
 * Sync and async resolution
 * -------------------------
 * `Completion.suggest` may return either `Suggestion[]` or
 * `Promise<Suggestion[]>`. Sync callers should use `suggestSync` (fast
 * path — returns `null` for async results). Editors that need to
 * support async fetches use `resolveSuggestions` and orchestrate
 * debounce + AbortController themselves.
 *
 * The engine deliberately does NOT debounce or abort — those are
 * UI-level concerns. Keeping the engine free of timers makes it
 * trivially testable and reusable.
 */

/* ── Public types ────────────────────────────────────────── */

export type Suggestion = {
  /** Shown in the ghost preview and inserted when the user accepts.
   * For triggered completions, includes the trigger char (e.g.
   * `"#alice"`, not `"alice"`). */
  text: string;
  /** Optional override for the dropdown's display label. When not
   * set, the dropdown shows `text` with the active trigger char
   * stripped (so `(revenue` displays as `revenue`, `@alice` as
   * `alice`). Set explicitly if you want the trigger visible in the
   * row (`label: text`) or want a completely different label. */
  label?: string;
  /** Optional auto-expand target. When set, the engine replaces a
   * verbatim word match with this on word boundary, and Tab-accept
   * inserts `expansion` instead of `text`. */
  expansion?: string;
  /** Whether accepting the suggestion should append a separating space. Default true. */
  appendSpace?: boolean;
  /** Optional sub-label for dropdown rows (e.g. type hint, category). */
  hint?: string;
};

/**
 * Context passed to a `Completion.suggest` call. Lets advanced consumers
 * reach beyond the typed query (e.g. detect surrounding tokens, check
 * for "inside SUM()" state in a formula, look up surrounding markdown
 * context, etc.) without the engine knowing about any of it.
 */
export type SuggestContext = {
  /** Full text content of the editor at the moment `suggest` was called. */
  fullText: string;
  /** Cursor position (`selectionStart`) at the moment of the call. */
  caret: number;
  /** Where the active token begins in `fullText` — the trigger char's
   * position for triggered completions, or the word start for plain. */
  tokenStart: number;
};

export type Completion = {
  /** Character that activates this completion. Omit for the trigger-less
   * "plain word" mode (abbreviation-style). At most one plain completion
   * is honoured per editor; additional ones are ignored. */
  trigger?: string;
  /**
   * Return suggestions for `query`. May be sync or async. Called with
   * empty `query` when the editor scans for "known labels" (document
   * highlight). Sync callers fast-path; async callers go through the
   * debounced path. The `signal` is set up by the caller — abort it
   * yourself in long-running fetches to avoid races.
   */
  suggest: (
    query: string,
    ctx: SuggestContext,
    signal: AbortSignal,
  ) => Suggestion[] | Promise<Suggestion[]>;
  /** When `true`, the editor opens a caret-anchored dropdown listing
   * all matches. Default `false` — only the inline ghost preview shows. */
  dropdown?: boolean;
  /** By default a triggered completion only activates when the
   * trigger char is NOT preceded by another word char — so `foo@bar`
   * doesn't fire the `@` completion mid-email. Set `true` to allow
   * activation even directly after a word, e.g. `SUM(` should fire
   * the `(` completion to autocomplete column references. */
  allowAfterWord?: boolean;
};

/** Returned by `detectQuery` — describes what completion run the caret
 *  is currently inside. */
export type QueryContext = {
  /** Where the matched run begins in the editor text. Includes the
   * trigger char position for triggered completions. */
  start: number;
  /** Where the run ends (== caret). */
  end: number;
  /** The typed run as it appears in the text (`"@al"`, `"mfg"`). For
   * triggered completions this includes the trigger character. */
  text: string;
  /** Query passed to `suggest` — for triggered completions this is the
   * part AFTER the trigger; for plain it equals `text`. */
  query: string;
  /** Which completion this run belongs to. */
  completion: Completion;
};

/* ── Helpers ────────────────────────────────────────────── */

/**
 * Convenience: turn a `{ short: long }` dictionary into a plain
 * (trigger-less) `Completion`. Each entry becomes a suggestion with
 * `expansion` set, so it participates in both ghost preview and
 * word-boundary auto-expand.
 *
 * Case-insensitive lookup with exact-case preference.
 */
export const abbreviations = (dict: Record<string, string>): Completion => {
  const keys = Object.keys(dict);
  const suggestions: Suggestion[] = keys.map((key) => ({ text: key, expansion: dict[key]! }));

  return {
    suggest: (query: string) => {
      if (query === "") return suggestions;
      const lowerQ = query.toLowerCase();
      const out: Suggestion[] = [];
      for (const s of suggestions) {
        if (s.text === query || s.text.toLowerCase().startsWith(lowerQ)) out.push(s);
      }
      out.sort((a, b) => {
        const aExact = a.text.startsWith(query) ? 0 : 1;
        const bExact = b.text.startsWith(query) ? 0 : 1;
        return aExact - bExact;
      });
      return out;
    },
  };
};

/* ── Constants ──────────────────────────────────────────── */

/** Characters that close a word and may trigger an abbreviation
 *  expansion. Anything "punctuation-y" outside the word body counts. */
export const TRIGGER_CHARS = new Set([
  " ", "\t", "\n", ",", ".", "!", "?", ";", ":", ")", "]", "}", '"', "'",
]);

/** Unicode word-char regex — letters, numbers, underscore. */
export const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Sentinel placed at the cursor when rendering an overlay preview so
 * ghost / anchor HTML can be substituted in post-render. PUA codepoint
 * so it can't appear in user input or be matched by any text regex.
 */
export const GHOST_SENTINEL = String.fromCharCode(0xe010);

/* ── Query detection ────────────────────────────────────── */

export type DetectOptions = {
  /** Optional predicate: when it returns true for `(text, pos)`, the
   * engine skips that position entirely (used by MarkdownEditor to
   * disable completions inside code spans / fences). Default: never
   * exclude. */
  isExcluded?: (text: string, pos: number) => boolean;
};

/**
 * Inspect the textarea state and figure out which completion (if any)
 * is currently being typed at the caret. Returns null when nothing
 * matches OR when the caret sits mid-word (so `m|ittag` doesn't
 * suggest things just because `m` is a prefix).
 *
 * Priority: a triggered completion (its trigger char directly before
 * the word) wins over the plain (trigger-less) completion.
 */
export const detectQuery = (
  textarea: HTMLTextAreaElement,
  completions: Completion[] | undefined,
  options: DetectOptions = {},
): QueryContext | null => {
  if (!completions || completions.length === 0) return null;
  if (textarea.selectionStart !== textarea.selectionEnd) return null;

  const value = textarea.value;
  const caret = textarea.selectionStart;
  if (caret === 0) return null;
  if (options.isExcluded?.(value, caret)) return null;

  // Only fire when the caret sits at the END of a word — never
  // mid-word. End-of-buffer counts as "after a word".
  const charAfterCaret = value[caret];
  if (charAfterCaret !== undefined && WORD_CHAR.test(charAfterCaret)) return null;

  // Walk back from caret over word chars to find the run start.
  let wordStart = caret;
  while (wordStart > 0 && WORD_CHAR.test(value[wordStart - 1]!)) wordStart--;
  const triggerCandidate = wordStart > 0 ? value[wordStart - 1] : undefined;

  // Triggered completion: trigger char directly before the word AND
  // (by default) not preceded by another word char — so `foo#bar`
  // doesn't activate `#`. Completions that legitimately fire after
  // a word (e.g. `SUM(` for formula args) opt in via `allowAfterWord`.
  if (triggerCandidate) {
    const triggered = completions.find((c) => c.trigger === triggerCandidate);
    if (triggered) {
      const beforeTrigger = wordStart >= 2 ? value[wordStart - 2] : undefined;
      const boundaryOk = !beforeTrigger || !WORD_CHAR.test(beforeTrigger);
      if (boundaryOk || triggered.allowAfterWord) {
        const query = value.slice(wordStart, caret);
        return {
          start: wordStart - 1,
          end: caret,
          text: triggerCandidate + query,
          query,
          completion: triggered,
        };
      }
    }
  }

  // Plain completion. Requires at least one word char and that the
  // char before the word isn't itself a word char.
  if (caret > wordStart) {
    const plain = completions.find((c) => c.trigger === undefined);
    if (plain) {
      const query = value.slice(wordStart, caret);
      return { start: wordStart, end: caret, text: query, query, completion: plain };
    }
  }

  return null;
};

/* ── Suggestion resolution ──────────────────────────────── */

/**
 * Discriminated-union result of resolving a completion's `suggest`.
 * Lets the caller fast-path on `kind === "sync"` and await the
 * promise on `kind === "async"`.
 */
export type ResolveResult =
  | { kind: "sync"; data: Suggestion[] }
  | { kind: "async"; promise: Promise<Suggestion[]> };

/**
 * Call `completion.suggest` and discriminate between sync and async
 * results. The caller owns the `AbortController`; abort it when the
 * query changes mid-flight to drop the stale response.
 */
export const resolveSuggestions = (
  completion: Completion,
  query: string,
  ctx: SuggestContext,
  signal: AbortSignal,
): ResolveResult => {
  const r = completion.suggest(query, ctx, signal);
  if (r instanceof Promise) return { kind: "async", promise: r };
  return { kind: "sync", data: r };
};

/**
 * Sync-only convenience: returns suggestions if the completion is
 * synchronous, `null` otherwise (caller handles async via the
 * debounced/abort path). Used by helpers like `collectKnownLabels`
 * and the auto-expand lookup that can't wait for a promise.
 *
 * When the suggest returns a Promise, we abort the controller (so
 * the user code can short-circuit if it checks the signal) AND
 * attach a no-op `.catch` to suppress the eventual rejection. Without
 * this, async suggests that reject would surface as unhandled
 * promise rejections — in some runtimes (notably Bun during SSR
 * rendering) this aborts the render and triggers a dev-server
 * reload. The promise here is dead-end by design (we don't want
 * its value), so silently dropping any rejection is correct.
 */
export const suggestSync = (
  completion: Completion,
  query: string,
  ctx: SuggestContext,
): Suggestion[] | null => {
  const ctrl = new AbortController();
  let result: Suggestion[] | Promise<Suggestion[]>;
  try {
    result = completion.suggest(query, ctx, ctrl.signal);
  } catch {
    // User suggest threw synchronously — treat as "no result".
    return null;
  }
  if (Array.isArray(result)) return result;
  ctrl.abort();
  result.catch(() => {
    /* intentionally swallowed — caller didn't await this promise */
  });
  return null;
};

/**
 * Pick the best ghost suggestion. Compares against the full typed
 * string (`typed`), which for triggered completions INCLUDES the
 * trigger char so the prefix check aligns with `suggestion.text`.
 * Skips suggestions equal in length to the typed text (nothing to
 * ghost).
 */
export const pickGhost = (suggestions: Suggestion[], typed: string): Suggestion | null => {
  const lower = typed.toLowerCase();
  for (const s of suggestions) {
    if (s.text.length <= typed.length) continue;
    if (s.text.toLowerCase().startsWith(lower)) return s;
  }
  return null;
};

/**
 * Walk all sync completions, ask each one for its full suggestion
 * list (`suggest("")`), and return a flat set of `text` values. The
 * MarkdownEditor uses this set to highlight known labels in the
 * rendered preview. Async completions are silently skipped (we can't
 * pause document rendering for a fetch).
 *
 * A "scan ctx" with empty `fullText`/`caret`/`tokenStart` is passed —
 * `suggest` implementations should treat `query === ""` as a scan
 * call.
 */
export const collectKnownLabels = (completions: Completion[] | undefined): Set<string> => {
  const labels = new Set<string>();
  if (!completions) return labels;
  const scanCtx: SuggestContext = { fullText: "", caret: 0, tokenStart: 0 };
  for (const c of completions) {
    const result = suggestSync(c, "", scanCtx);
    if (!result) continue;
    for (const s of result) labels.add(s.text);
  }
  return labels;
};

/**
 * Resolve what to show for a suggestion in the dropdown row. Order
 * of precedence:
 *   1. Explicit `suggestion.label` if set (caller takes full control).
 *   2. `suggestion.text` with the active completion's trigger char
 *      stripped, when present — so `(revenue` displays as `revenue`,
 *      `@alice` as `alice`. Avoids visually doubling the trigger
 *      since the user already typed it.
 *   3. `suggestion.text` as-is when there's no trigger to strip.
 */
export const displayLabel = (suggestion: Suggestion, completion: Completion): string => {
  if (suggestion.label !== undefined) return suggestion.label;
  const trigger = completion.trigger;
  if (trigger && suggestion.text.startsWith(trigger)) {
    return suggestion.text.slice(trigger.length);
  }
  return suggestion.text;
};

/**
 * Build a `SuggestContext` from a textarea + query context. The
 * editor builds this before calling `suggest` (sync or async) — the
 * engine doesn't, because it doesn't own the textarea state.
 */
export const buildSuggestContext = (
  textarea: HTMLTextAreaElement,
  queryCtx: QueryContext,
): SuggestContext => ({
  fullText: textarea.value,
  caret: textarea.selectionStart,
  tokenStart: queryCtx.start,
});
