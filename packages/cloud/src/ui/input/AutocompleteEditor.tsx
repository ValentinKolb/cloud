/**
 * Generic single- or multi-line text editor with completion support.
 *
 * Same completion engine as `<MarkdownEditor>` but without any
 * markdown opinions — works for plain text, formulas, code, search
 * builders, mentions, etc.
 *
 * Two visual modes:
 *
 *   1. **Plain textarea (default)** — visible textarea, no overlay.
 *      The dropdown anchors to the textarea's bottom edge (like the
 *      `<Select>` dropdown). Simpler, no glyph-alignment work
 *      needed.
 *
 *   2. **Overlay mode** (when `highlight` is provided) — invisible
 *      textarea on top of a preview div that renders the user's
 *      `highlight(text)` HTML. Overtype pattern: the textarea cursor
 *      sits exactly over the highlighted glyphs. Ghost preview is
 *      injected at the caret in the preview, and the dropdown
 *      anchors there.
 *
 * Async suggestions
 * -----------------
 * Sync `suggest` returns hit the editor synchronously (immediate
 * dropdown/ghost). Async `suggest` (returning a Promise) goes
 * through a debounced AbortController-aware fetch:
 *
 *   - `loading` state shows a spinner row in the dropdown.
 *   - Previous suggestions stay visible (dimmed) while fetching.
 *   - Each keystroke aborts the previous in-flight request.
 *   - Errors surface a Retry button.
 *
 * Focus / keyboard model
 * ----------------------
 * Same contract as MarkdownEditor's completion dropdown — Popover API
 * (top-layer, modal-safe, no focus capture). ArrowUp/Down navigate,
 * Tab/Enter accept, Esc closes. When completions are configured and
 * a dropdown is active, Tab is "trapped" (swallowed if no ghost) so
 * a single Tab press always has a useful effect — see the MarkdownEditor
 * comment on focus-trap rationale.
 */

import { createSignal, createEffect, createMemo, onMount, onCleanup, untrack, For, Show } from "solid-js";
import { timed } from "@valentinkolb/stdlib/solid";
import {
  type Completion,
  type QueryContext,
  type Suggestion,
  applySuggestion,
  buildSuggestContext,
  collectKnownLabels,
  detectQuery,
  displayLabel,
  pickGhost,
  plainTextHighlight,
  renderWithOverlay,
  resetCompletionState,
  resolveSuggestions,
  suggestSync,
  tryExpand,
  tryRestore,
} from "../completion";

export type AutocompleteEditorProps = {
  /** Reactive value accessor — current text. */
  value?: () => string | undefined | null;
  /** Fired on every input event (use this for controlled state). */
  onInput?: (value: string) => void;
  /** Fired on textarea change (commit on blur). */
  onChange?: (value: string) => void;
  /**
   * Fired when the user presses the submit gesture:
   *   - single-line mode: bare Enter
   *   - multi-line mode: Cmd/Ctrl+Enter
   */
  onSubmit?: () => void;

  /** Completion definitions. Each defines a trigger + suggest fn. */
  completions?: Completion[];
  /** Keep abbreviation-style Backspace restore after accepting an expansion. Default true. */
  restoreExpansionOnBackspace?: boolean;

  /**
   * Optional syntax-highlighter: plain text → safe HTML. When
   * provided, the editor switches to overlay mode (invisible
   * textarea + preview div). When omitted, plain textarea.
   *
   * Width-safe requirements: monospace font, no font-weight /
   * font-style changes between tokens (use colour/background only).
   * See `MarkdownEditor`'s highlighter for a reference implementation.
   */
  highlight?: (text: string) => string;

  /**
   * Single-line mode: Enter calls `onSubmit`, no newlines allowed.
   * Default `false` (multi-line textarea).
   */
  singleLine?: boolean;

  /** Approximate visible rows (ignored when `singleLine`). Default 3. */
  lines?: number;

  placeholder?: string;
  disabled?: boolean;
  spellcheck?: boolean;
  id?: string;
  name?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  ariaRequired?: boolean;
  maxLength?: number;
  /** Visual error state — adds red border. */
  error?: boolean;
};

const AutocompleteEditor = (props: AutocompleteEditorProps) => {
  let textareaEl: HTMLTextAreaElement | undefined;
  let previewEl: HTMLDivElement | undefined;
  let dropdownEl: HTMLDivElement | undefined;

  /* ── State ─────────────────────────────────────────────── */

  const [composing, setComposing] = createSignal(false);
  const [localValue, setLocalValue] = createSignal(props.value?.() ?? "");

  type CompletionState = {
    ctx: QueryContext;
    suggestions: Suggestion[];
    selectedIndex: number;
  };
  const [completionState, setCompletionState] = createSignal<CompletionState | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [isDarkTheme, setIsDarkTheme] = createSignal(false);

  const activeSuggestion = (): Suggestion | null => {
    const s = completionState();
    return s ? (s.suggestions[s.selectedIndex] ?? null) : null;
  };

  // Async fetch lifecycle. One AbortController per in-flight request;
  // each new keystroke aborts the previous so stale results never
  // overwrite fresher state.
  let currentAbort: AbortController | null = null;
  let lastAsyncCompletion: Completion | null = null;
  let lastAsyncQuery: string = "";
  let lastAsyncCtx: ReturnType<typeof buildSuggestContext> | null = null;

  /* ── Memoised inputs ──────────────────────────────────── */

  const completions = createMemo(() => props.completions);
  const knownLabels = createMemo(() => collectKnownLabels(completions()));
  const useOverlay = createMemo(() => Boolean(props.highlight));

  /* ── External value sync ──────────────────────────────── */

  createEffect(() => {
    const incoming = props.value?.();
    if (incoming === undefined || incoming === null) return;
    if (incoming !== untrack(localValue)) setLocalValue(incoming);
  });

  /* ── Imperative textarea sync ──────────────────────────── */

  createEffect(() => {
    const target = localValue();
    if (composing()) return;
    if (textareaEl && textareaEl.value !== target) {
      textareaEl.value = target;
    }
  });

  /* ── Overlay preview rendering ─────────────────────────── */

  createEffect(() => {
    if (!useOverlay() || !previewEl) return;
    const state = completionState();
    const active = activeSuggestion();

    const ghostArg =
      state && active
        ? { at: state.ctx.end, text: active.text.slice(state.ctx.text.length) }
        : undefined;

    const highlight = props.highlight ?? plainTextHighlight;
    previewEl.innerHTML = renderWithOverlay(localValue(), highlight, {
      ghost: ghostArg,
    });

    if (textareaEl) {
      previewEl.scrollTop = textareaEl.scrollTop;
      previewEl.scrollLeft = textareaEl.scrollLeft;
    }
  });

  /* ── Completion pipeline ───────────────────────────────── */

  const clearCompletion = (): void => {
    setCompletionState(null);
    setLoading(false);
    setError(null);
    closeDropdown();
    currentAbort?.abort();
    currentAbort = null;
  };

  const recomputeCompletion = (): void => {
    if (!textareaEl) return;
    const ctx = detectQuery(textareaEl, completions());
    if (!ctx) {
      clearCompletion();
      return;
    }

    const suggestCtx = buildSuggestContext(textareaEl, ctx);

    // Spin up an abort signal for THIS attempt — we'll either
    // consume it sync below, or hand it to the async path.
    currentAbort?.abort();
    currentAbort = new AbortController();
    const signal = currentAbort.signal;

    const result = resolveSuggestions(ctx.completion, ctx.query, suggestCtx, signal);

    if (result.kind === "sync") {
      setError(null);
      setLoading(false);
      applySuggestionList(ctx, result.data);
      return;
    }

    // Async path: keep previous suggestions visible (dimmed via
    // `loading` state) and schedule the debounced fetch.
    setError(null);
    setLoading(true);
    lastAsyncCompletion = ctx.completion;
    lastAsyncQuery = ctx.query;
    lastAsyncCtx = suggestCtx;
    debouncedFetch.debouncedFn(ctx, suggestCtx, result.promise, signal);
  };

  /** Take a fresh suggestion list, filter to usable ones, and merge
   *  with the current selection state. */
  const applySuggestionList = (ctx: QueryContext, list: Suggestion[]): void => {
    const lower = ctx.text.toLowerCase();
    const usable = list.filter(
      (s) => s.text.toLowerCase().startsWith(lower) && s.text.length > ctx.text.length,
    );
    if (usable.length === 0) {
      clearCompletion();
      return;
    }

    // Preserve highlight across keystrokes when the same suggestion
    // is still present — less jarring than always resetting.
    const prev = completionState();
    const prevSelected = prev?.suggestions[prev.selectedIndex]?.text;
    const keptIndex = prevSelected ? usable.findIndex((s) => s.text === prevSelected) : -1;
    const selectedIndex = keptIndex >= 0 ? keptIndex : 0;

    setCompletionState({ ctx, suggestions: usable, selectedIndex });

    if (ctx.completion.dropdown) {
      if (!dropdownOpenSignal()) setDropdownOpenSignal(true);
      queueMicrotask(positionDropdown);
    } else if (dropdownOpenSignal()) {
      closeDropdown();
    }
  };

  // Debounced async fetch — kicks off ~180ms after the LAST
  // keystroke. The debounce delays the actual await so we don't
  // hammer remote endpoints on every char.
  const debouncedFetch = timed.debounce(
    (ctx: QueryContext, suggestCtx: ReturnType<typeof buildSuggestContext>, promise: Promise<Suggestion[]>, signal: AbortSignal) => {
      void runFetch(ctx, suggestCtx, promise, signal);
    },
    180,
  );

  const runFetch = async (
    ctx: QueryContext,
    suggestCtx: ReturnType<typeof buildSuggestContext>,
    promise: Promise<Suggestion[]>,
    signal: AbortSignal,
  ): Promise<void> => {
    try {
      const list = await promise;
      if (signal.aborted) return; // newer keystroke superseded us
      setLoading(false);
      applySuggestionList(ctx, list);
    } catch (e: unknown) {
      if (signal.aborted) return;
      if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "AbortError") return;
      setLoading(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Retry the most recent failed async fetch. */
  const retryAsync = (): void => {
    if (!lastAsyncCompletion || !lastAsyncCtx) return;
    setError(null);
    setLoading(true);
    currentAbort?.abort();
    currentAbort = new AbortController();
    const signal = currentAbort.signal;
    const promise = lastAsyncCompletion.suggest(lastAsyncQuery, lastAsyncCtx, signal);
    if (!(promise instanceof Promise)) {
      // Suggest turned sync between calls — treat as direct result.
      setLoading(false);
      // Re-detect ctx so we have a fresh queryContext.
      recomputeCompletion();
      return;
    }
    void runFetch(
      // Reuse prev queryCtx by re-detecting; cheaper than caching it.
      detectQuery(textareaEl!, completions())!,
      lastAsyncCtx,
      promise,
      signal,
    );
  };

  /* ── Dropdown positioning + open/close ─────────────────── */

  const [dropdownOpenSignal, setDropdownOpenSignal] = createSignal(false);

  const positionDropdown = (): void => {
    if (!dropdownEl || !textareaEl) return;
    // The popover may have been unmounted by `<Show>` between the
    // microtask scheduling and this call (e.g. state cleared in a
    // fast keystroke sequence). `showPopover` throws on disconnected
    // elements, so bail when the ref points to a detached node.
    if (!dropdownEl.isConnected) return;
    syncTheme();

    // In overlay mode, anchor to the caret marker in the preview.
    // Otherwise anchor to the textarea's bottom edge.
    let rect: DOMRect;
    if (useOverlay() && previewEl) {
      const anchorEl = previewEl.querySelector<HTMLElement>("[data-completion-anchor]");
      rect = anchorEl ? anchorEl.getBoundingClientRect() : textareaEl.getBoundingClientRect();
    } else {
      rect = textareaEl.getBoundingClientRect();
    }

    const dropdownMaxHeight = 260;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openAbove = spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow;

    const dropdownWidth = 280;
    const margin = 8;
    const left = Math.min(rect.left, window.innerWidth - dropdownWidth - margin);

    dropdownEl.style.left = `${Math.max(margin, left)}px`;
    dropdownEl.style.width = `${dropdownWidth}px`;

    if (openAbove) {
      dropdownEl.style.top = "auto";
      dropdownEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      dropdownEl.style.top = `${rect.bottom + 4}px`;
      dropdownEl.style.bottom = "auto";
    }

    if (!dropdownEl.matches(":popover-open")) {
      dropdownEl.showPopover();
    }
  };

  const closeDropdown = (): void => {
    if (dropdownEl?.matches(":popover-open")) dropdownEl.hidePopover();
    if (dropdownOpenSignal()) setDropdownOpenSignal(false);
  };

  const syncTheme = (): void => {
    if (typeof document === "undefined") return;
    setIsDarkTheme(
      document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"),
    );
  };

  const acceptActiveSuggestion = (): boolean => {
    if (!textareaEl) return false;
    const state = completionState();
    const active = activeSuggestion();
    if (!state || !active) return false;
    if (active.text === state.ctx.text) {
      clearCompletion();
      return false;
    }
    applySuggestion(textareaEl, state.ctx, active, { trackExpansion: props.restoreExpansionOnBackspace ?? true });
    clearCompletion();
    return true;
  };

  const moveSelection = (direction: 1 | -1): void => {
    const state = completionState();
    if (!state) return;
    const len = state.suggestions.length;
    if (len === 0) return;
    const next = (state.selectedIndex + direction + len) % len;
    setCompletionState({ ...state, selectedIndex: next });
  };

  /* ── Event handlers ───────────────────────────────────── */

  onMount(() => {
    const onSelectionChange = (): void => {
      if (document.activeElement === textareaEl) recomputeCompletion();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    onCleanup(() => document.removeEventListener("selectionchange", onSelectionChange));
    onCleanup(() => {
      if (dropdownEl?.matches(":popover-open")) dropdownEl.hidePopover();
      currentAbort?.abort();
    });
  });

  const onInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }): void => {
    if (e.inputType.startsWith("insert") && tryExpand(e.currentTarget, completions())) return;
    const v = e.currentTarget.value;
    setLocalValue(v);
    props.onInput?.(v);
    recomputeCompletion();
  };

  const onChange = (e: Event & { currentTarget: HTMLTextAreaElement }): void => {
    props.onChange?.(e.currentTarget.value);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!textareaEl) return;
    if (e.isComposing) return;

    if ((props.restoreExpansionOnBackspace ?? true) && e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (tryRestore(textareaEl)) {
        e.preventDefault();
        return;
      }
    }

    const hasCompletions = (completions()?.length ?? 0) > 0;
    const state = completionState();
    const hasActive = state !== null;
    const isDropdown = state?.ctx.completion.dropdown === true;

    if (hasActive && isDropdown && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      moveSelection(e.key === "ArrowDown" ? 1 : -1);
      return;
    }

    // Enter: in single-line mode → submit. In multi-line → insert
    // newline (unless dropdown is open, then accept the row).
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (hasActive && isDropdown && dropdownOpenSignal()) {
        e.preventDefault();
        acceptActiveSuggestion();
        return;
      }
      if (props.singleLine) {
        e.preventDefault();
        props.onSubmit?.();
        return;
      }
    }

    // Cmd/Ctrl+Enter submits in multi-line mode.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !props.singleLine) {
      if (props.onSubmit) {
        e.preventDefault();
        props.onSubmit();
        return;
      }
    }

    if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (hasActive) {
        e.preventDefault();
        acceptActiveSuggestion();
        return;
      }
      if (hasCompletions) {
        e.preventDefault();
        return;
      }
    }

    if (e.key === "Escape") {
      if (hasActive) {
        e.preventDefault();
        clearCompletion();
        return;
      }
      if (hasCompletions) {
        e.preventDefault();
        textareaEl.blur();
      }
    }
  };

  const onScroll = (e: Event & { currentTarget: HTMLTextAreaElement }): void => {
    if (!previewEl) return;
    previewEl.scrollTop = e.currentTarget.scrollTop;
    previewEl.scrollLeft = e.currentTarget.scrollLeft;
  };

  /* ── Render ───────────────────────────────────────────── */

  const surfaceStyle = (): string => {
    if (props.singleLine) return `--ac-h: 2.5rem`;
    const lines = props.lines ?? 3;
    return `--ac-h: ${lines * 1.5}rem`;
  };

  return (
    <div
      class="ac-editor"
      data-disabled={props.disabled ? "true" : undefined}
      data-error={props.error ? "true" : undefined}
    >
      <div class="ac-editor-surface" style={surfaceStyle()}>
        <Show when={!localValue() && props.placeholder}>
          <div class="ac-editor-placeholder" aria-hidden="true">
            {props.placeholder}
          </div>
        </Show>
        <Show when={useOverlay()}>
          <div ref={(el) => (previewEl = el)} class="ac-editor-layer ac-editor-preview" aria-hidden="true" />
        </Show>
        <textarea
          ref={(el) => (textareaEl = el)}
          id={props.id}
          name={props.name}
          class={useOverlay() ? "ac-editor-layer ac-editor-input ac-editor-input--overlay" : "ac-editor-layer ac-editor-input"}
          onInput={onInput}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onBlur={(e) => {
            const next = e.relatedTarget as HTMLElement | null;
            if (next && dropdownEl && dropdownEl.contains(next)) return;
            resetCompletionState();
            clearCompletion();
          }}
          disabled={props.disabled}
          spellcheck={props.spellcheck ?? false}
          maxLength={props.maxLength}
          rows={props.singleLine ? 1 : (props.lines ?? 3)}
          aria-label={props.ariaLabel}
          aria-describedby={props.ariaDescribedBy}
          aria-invalid={props.ariaInvalid}
          aria-required={props.ariaRequired}
        />
      </div>

      {/* Dropdown popover — only mounted when there's something to
          show (sync state OR async loading with a previous state).
          Avoids the empty-popover fade-out flicker that the global
          [popover] close transition would cause. */}
      <Show when={completionState() || loading() || error()}>
        <div
          ref={(el) => (dropdownEl = el)}
          popover="manual"
          class="popup fixed inset-auto m-0 border border-zinc-200 p-1 dark:border-zinc-700"
          classList={{ dark: isDarkTheme() }}
          aria-label="Completion suggestions"
        >
          <div
            class="flex max-h-60 flex-col gap-0.5 overflow-y-auto"
            role="listbox"
            aria-label="Suggestions"
          >
            <Show when={loading()}>
              <div class="flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <i class="ti ti-loader-2 animate-spin" /> Loading...
              </div>
            </Show>
            <Show when={error()}>
              <div class="flex items-center gap-2 px-2 py-1.5 text-xs text-red-500">
                <i class="ti ti-alert-triangle shrink-0" />
                <span class="flex-1 truncate">{error()}</span>
                <button
                  type="button"
                  class="text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    retryAsync();
                  }}
                >
                  Retry
                </button>
              </div>
            </Show>
            <Show when={completionState()}>
              {(state) => (
                <For each={state().suggestions}>
                  {(suggestion, index) => {
                    const isSelected = () => index() === state().selectedIndex;
                    return (
                      <div
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setCompletionState({ ...state(), selectedIndex: index() });
                          acceptActiveSuggestion();
                          textareaEl?.focus();
                        }}
                        onMouseEnter={() =>
                          setCompletionState({ ...state(), selectedIndex: index() })
                        }
                        role="option"
                        aria-selected={isSelected()}
                        class={`group flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors ${
                          isSelected()
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                            : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        } ${loading() ? "opacity-60" : ""}`}
                      >
                        <span class="font-mono truncate">{displayLabel(suggestion, state().ctx.completion)}</span>
                        <Show when={suggestion.hint}>
                          <span class="ml-auto text-xs text-zinc-500 dark:text-zinc-400 truncate">
                            {suggestion.hint}
                          </span>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default AutocompleteEditor;
export type { Completion, Suggestion, SuggestContext } from "../completion";
export { abbreviations } from "../completion";
