import { createSignal, createEffect, createMemo, type JSX, onMount, onCleanup, untrack, For, Show } from "solid-js";
import { handleShortcut, handleListContinuation, handleSmartPaste } from "./behaviors";
import {
  type Completion,
  type QueryContext,
  type Suggestion,
  abbreviations as abbreviationsCompletion,
  tryExpand,
  tryRestore,
  resetCompletionState,
  detectQuery,
  suggestSync,
  collectKnownLabels,
  applySuggestion,
  renderWithOverlay,
  buildSuggestContext,
  displayLabel,
} from "../../completion";
import { highlightMarkdown } from "./highlight";
import { isInCodeZone } from "./code-zone";
import { computeActiveFormats } from "./active-formats";
import Toolbar from "./Toolbar";

export type { Completion, Suggestion, SuggestContext } from "../../completion";
export { abbreviations } from "../../completion";

export type MarkdownEditorProps = {
  /** Reactive value accessor — current markdown text. */
  value?: () => string | undefined | null;
  /** Fired on every input event (use this for controlled state). */
  onInput?: (value: string) => void;
  /** Fired on textarea change (commit on blur). */
  onChange?: (value: string) => void;
  /** Fired on Ctrl/Cmd+Enter. Bare Enter never submits — markdown
   * editing needs Enter for newlines and list continuation. */
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Approximate visible rows. The wrapper sets `--md-h` from this. */
  lines?: number;
  id?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  ariaRequired?: boolean;
  /** Hide the toolbar (shortcuts and smart features still work). */
  noToolbar?: boolean;
  /** Browser spellcheck. Defaults to ON — overtype issue #98 lesson:
   * non-technical users expect spellcheck in a prose editor. */
  spellcheck?: boolean;
  name?: string;
  maxLength?: number;
  /**
   * AutoText dictionary — convenience shortcut for the most common
   * completion shape: a fixed `{ short: long }` map. Internally
   * wrapped via `abbreviations()` and merged into `completions`.
   * Matching is case-insensitive with exact-case preference; Cmd/Ctrl+Z
   * or an immediate Backspace reverts the expansion. Expansions never
   * fire inside code spans or fenced blocks.
   */
  abbreviations?: Record<string, string>;
  /**
   * Full completion definitions. Each completion provides a suggest
   * function that returns ghost-previewable suggestions for a query,
   * and optionally a `trigger` char (`#`, `@`, `:`) that activates the
   * completion. Sync completions also feed the document-wide blue
   * dotted-underline highlight of recognised labels. A `Suggestion`
   * with an `expansion` field also participates in word-boundary
   * auto-expand (same behaviour as `abbreviations`).
   *
   * If both `abbreviations` and `completions` are provided, they're
   * concatenated — abbreviations first, so a triggered completion
   * with no trigger conflict can sit alongside the abbr dict.
   */
  completions?: Completion[];
  /** Truthy when the surrounding form considers this field invalid.
   * Renders a red border on the editor wrapper. The error MESSAGE is
   * still rendered by `InputWrapper` outside; this prop just signals
   * the editor to visually reflect the state. */
  error?: boolean;
  /** Show the lines/words/chars footer. Defaults to ON. */
  showStats?: boolean;
  /** Visual variant. Defaults to the compact zinc input surface. */
  variant?: "default" | "paper";
  /** Stretch to the parent's height (flex column) instead of the `lines` height — IDE-style hosts. */
  fill?: boolean;
  /** When provided, a save button renders at the toolbar's right edge and Cmd/Ctrl+S saves. */
  onSave?: () => void;
  /** Disables the save button (e.g. while nothing changed). */
  saveDisabled?: () => boolean;
  /** Renders the save button in its busy state. */
  saving?: () => boolean;
  /** Extra controls next to the save button (toolbar right edge). */
  toolbarTrailing?: JSX.Element;
};

/**
 * Markdown editor with the overtype-style invisible-textarea overlay.
 *
 * Two layers stacked inside `.md-editor-surface`:
 *   - `textarea.md-editor-input` (transparent text, visible cursor)
 *   - `div.md-editor-preview` (syntax-highlighted HTML mirror)
 *
 * Both layers share identical typography + box-model settings via the
 * `.md-editor-layer` class so the textarea cursor lines up with the
 * highlighted glyphs in the preview. Scrolling the textarea drives a
 * scroll-sync into the preview.
 *
 * All "smart" behaviours (shortcuts, list continuation, URL paste) hook
 * into the textarea's native events — they never replace `.value`
 * directly, only `document.execCommand("insertText")`, so the browser's
 * built-in undo history stays usable.
 */
export default function MarkdownEditor(props: MarkdownEditorProps) {
  let textareaEl: HTMLTextAreaElement | undefined;
  let previewEl: HTMLDivElement | undefined;
  // Popover (NOT a `<dialog>`) — `<dialog showModal()>` would make
  // the rest of the page `inert`, including the textarea below,
  // breaking typing + arrow-key navigation. The Popover API gives us
  // the same top-layer rendering (modal-safe) WITHOUT focus capture,
  // so the textarea keeps focus and continues to receive keystrokes.
  let dropdownEl: HTMLDivElement | undefined;
  const [taSignal, setTaSignal] = createSignal<HTMLTextAreaElement | null>(null);
  const [activeFormats, setActiveFormats] = createSignal<Set<string>>(new Set());
  // True while the user has an active IME composition (Japanese,
  // Chinese, Korean, dead-key sequences). Writing `textarea.value`
  // during composition collapses the in-progress glyph or cancels the
  // composition outright; we defer external syncs until it ends.
  const [composing, setComposing] = createSignal(false);

  // Active completion run + matching suggestions + which row of the
  // dropdown is highlighted. One state object so every consumer
  // (ghost render, dropdown render, Tab handler, key navigation)
  // reads from a single source of truth.
  //
  // Invariants:
  //   - `suggestions` is non-empty (we clear the whole state when
  //     `suggest()` returns nothing).
  //   - `selectedIndex` is in [0, suggestions.length).
  //   - `ctx.completion.dropdown === true` ⇒ the dropdown is shown;
  //     otherwise only the ghost preview renders.
  //   - The ghost preview always reflects `suggestions[selectedIndex]`
  //     — arrow keys in the dropdown cycle the index AND retarget the
  //     ghost in lockstep.
  type CompletionState = {
    ctx: QueryContext;
    suggestions: Suggestion[];
    selectedIndex: number;
  };
  const [completionState, setCompletionState] = createSignal<CompletionState | null>(null);

  // Convenience: the currently-highlighted suggestion (drives both
  // ghost rendering and Tab insertion).
  const activeSuggestion = (): Suggestion | null => {
    const s = completionState();
    return s ? (s.suggestions[s.selectedIndex] ?? null) : null;
  };

  // Whether the dropdown should be visible. Independent signal so the
  // open/close-side-effect (showModal / close) tracks only this
  // boolean, not the full state object.
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  // Dark-class sync — mirrors the Select pattern: a dialog rendered
  // into the top-layer doesn't inherit ancestor `.dark` classes
  // automatically, so we re-apply the class on the dialog itself.
  const [isDarkTheme, setIsDarkTheme] = createSignal(false);

  // Merge `abbreviations` prop (sugar) with the explicit `completions`
  // array. Memoised on identity of the props — re-runs on swap, not
  // on every render.
  const mergedCompletions = createMemo<Completion[] | undefined>(() => {
    const abbr = props.abbreviations;
    const comps = props.completions;
    if (!abbr && !comps) return undefined;
    const out: Completion[] = [];
    if (abbr && Object.keys(abbr).length > 0) out.push(abbreviationsCompletion(abbr));
    if (comps) out.push(...comps);
    return out.length > 0 ? out : undefined;
  });

  // Set of plain-text labels (across all sync completions) to wrap in
  // `.md-completion-match` during render. Async completions don't
  // contribute here — their suggestions only appear as ghost previews.
  const knownLabels = createMemo(() => collectKnownLabels(mergedCompletions()));

  // Local source of truth for the textarea content. Drives both the
  // textarea's bound value AND the preview. Why local rather than
  // reading `props.value()` directly:
  //
  //   - Uncontrolled mode (`onInput` provided, `value` not): the
  //     textarea would otherwise be bound to "" forever and the user's
  //     typing would only stay visible because of one-way binding
  //     timing — the preview would never reflect the typed text. With
  //     a local signal, both the bound textarea and the preview share
  //     the same truth.
  //   - Controlled mode (`value` + `onInput`): we sync from `props.value`
  //     on external change and from `onInput` on user typing. No double
  //     re-render storm, no stale-preview window between input event
  //     and parent signal update.
  const [localValue, setLocalValue] = createSignal(props.value?.() ?? "");

  // Sync incoming controlled value → local signal. CRITICAL: this
  // effect must depend ONLY on `props.value()`, not on `localValue()`.
  //
  // Why: when the user types, we call `setLocalValue(newValue)` from
  // onInput BEFORE `props.onInput` propagates the new value upward.
  // If this effect tracked `localValue()`, it would re-run inside the
  // same input cycle, read the still-stale `props.value()`, decide
  // "they diverge", and revert localValue to the OLD parent value.
  // The downstream imperative-write effect would then see DOM value
  // (correct, new) vs target (stale, old), write target back into the
  // textarea, and that programmatic assignment collapses the caret to
  // the end on every major browser — i.e. the "Enter jumps to last
  // line" bug. `untrack` reads localValue without registering it as
  // a reactive dep, so this effect only fires when the PARENT pushes
  // a new value (form reset, programmatic edit) — the exact contract
  // we want.
  createEffect(() => {
    const incoming = props.value?.();
    if (incoming === undefined || incoming === null) return;
    if (incoming !== untrack(localValue)) {
      setLocalValue(incoming);
    }
  });

  // Preview is driven solely by the local signal + completion state
  // + known labels. Single source of truth, single update path, no
  // duplicated parse/escape work.
  createEffect(() => {
    if (!previewEl) return;
    const state = completionState();
    const active = activeSuggestion();

    // Ghost preview text: only the tail the user hasn't typed yet.
    // Slice by length (not by `startsWith`) so a case-insensitive
    // match still produces the right cut — the visible characters
    // before the ghost are the user's literal typing, the ghost
    // tail is verbatim from the suggestion. Filter in
    // `recomputeCompletion` guarantees tail.length > 0 when a
    // completion is active, so we never end up with an empty ghost.
    const ghostArg = state && active ? { at: state.ctx.end, text: active.text.slice(state.ctx.text.length) } : undefined;

    // Highlight function for the overlay renderer. Wraps the markdown
    // highlighter so the generic overlay module stays markdown-agnostic
    // — `knownLabels` are markdown-specific (rendered into the preview
    // with `.md-completion-match`), so we pass them through here. The
    // ghost sentinel is injected at the cursor BEFORE highlight runs,
    // travels through the markdown pipeline untouched (PUA char, no
    // regex match), and gets substituted with the ghost span after.
    const labels = knownLabels();
    previewEl.innerHTML = renderWithOverlay(localValue(), (workText) => highlightMarkdown(workText, { knownLabels: labels }), {
      ghost: ghostArg,
    });
    // Re-sync scroll AFTER the preview's content grows: when the user
    // hits Enter at the bottom of the visible area, the browser auto-
    // scrolls the textarea before the input event fires. At that
    // moment, the preview's scrollHeight is still the pre-grow value
    // so `previewEl.scrollTop = ta.scrollTop` gets clamped to a smaller
    // number. Once we've grown the preview here, re-apply the sync so
    // the clamp finally accepts the right value.
    if (textareaEl) {
      previewEl.scrollTop = textareaEl.scrollTop;
      previewEl.scrollLeft = textareaEl.scrollLeft;
    }
  });

  // Manage textarea.value IMPERATIVELY rather than via the JSX
  // `value={x()}` binding. Solid's binding re-writes the DOM property
  // on every reactive tick, even when the string is unchanged — that
  // can disturb the caret in some browser/event-order edge cases (most
  // visibly: every newline reset to the very end of the field). Overtype
  // takes the same approach: it owns the textarea and only ever calls
  // `textarea.value = …` when there's an actual divergence to repair.
  //
  // Guarded by `composing()`: writing the textarea's value during an
  // active IME composition collapses the partially-formed glyph. We
  // skip the write; the effect re-runs when `composing()` flips false
  // (Solid tracks the read), at which point we apply any pending
  // external sync.
  createEffect(() => {
    const target = localValue();
    if (composing()) return;
    if (textareaEl && textareaEl.value !== target) {
      textareaEl.value = target;
    }
  });

  const updateActive = (): void => {
    if (textareaEl) setActiveFormats(computeActiveFormats(textareaEl));
  };

  /**
   * Recompute completion state (ghost + dropdown) based on the
   * current textarea position. Called from every code path that may
   * have moved the caret or changed the content: input, key,
   * focus-change, selection-change.
   *
   * Sync flow only — async `suggest` (returning a Promise) clears
   * the state without waiting, matching the "fast or nothing" UX
   * brief. Future work would hook a debounced fetch in here.
   */
  const recomputeCompletion = (): void => {
    if (!textareaEl) return;
    const ctx = detectQuery(textareaEl, mergedCompletions(), { isExcluded: isInCodeZone });
    if (!ctx) {
      setCompletionState(null);
      closeDropdown();
      return;
    }
    const list = suggestSync(ctx.completion, ctx.query, buildSuggestContext(textareaEl, ctx));
    if (!list) {
      setCompletionState(null);
      closeDropdown();
      return;
    }

    // Keep suggestions whose `text` is a strict prefix of the typed
    // run (case-insensitive) AND strictly longer than what's been
    // typed. Same filter for ghost-only and dropdown paths: once the
    // user has fully typed a suggestion, there's nothing left to
    // offer — so the dropdown closes too. If we kept equal-length
    // matches the dropdown would linger empty-handedly after every
    // accepted completion.
    const lower = ctx.text.toLowerCase();
    const usable = list.filter((s) => s.text.toLowerCase().startsWith(lower) && s.text.length > ctx.text.length);

    if (usable.length === 0) {
      setCompletionState(null);
      closeDropdown();
      return;
    }

    // Preserve the highlighted row across keystrokes when the same
    // suggestion is still present — feels less jarring than always
    // resetting to index 0 mid-typing.
    const prev = completionState();
    const prevSelected = prev?.suggestions[prev.selectedIndex]?.text;
    const keptIndex = prevSelected ? usable.findIndex((s) => s.text === prevSelected) : -1;
    const selectedIndex = keptIndex >= 0 ? keptIndex : 0;

    setCompletionState({ ctx, suggestions: usable, selectedIndex });

    if (ctx.completion.dropdown) {
      // Open or re-position. Re-position even when already open so
      // the dropdown stays glued to the caret as the user types
      // across line wraps.
      if (!dropdownOpen()) {
        setDropdownOpen(true);
      }
      // Wait one microtask for the preview's createEffect to render
      // the new anchor element before we measure.
      queueMicrotask(() => positionDropdown());
    } else if (dropdownOpen()) {
      closeDropdown();
    }
  };

  /**
   * Anchor the dropdown to the caret position in the preview. Uses
   * the `[data-md-caret-anchor]` element (either the visible ghost
   * wrapper or the invisible 1px span — both placed exactly at the
   * caret by the renderer). Falls back to the textarea bottom edge
   * if the anchor isn't found.
   *
   * Auto-flip up/down by comparing viewport space against the max
   * dropdown height — mirrors the Select dropdown pattern so the
   * behaviour is recognisable across the codebase. `showModal()`
   * lifts the dialog into the top-layer so it sits above any
   * surrounding modal.
   */
  const positionDropdown = (): void => {
    if (!dropdownEl || !previewEl || !textareaEl) return;
    syncTheme();

    const anchorEl = previewEl.querySelector<HTMLElement>("[data-md-caret-anchor]");
    const anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : textareaEl.getBoundingClientRect();

    const dropdownMaxHeight = 260;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const openAbove = spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow;

    const dropdownWidth = 280;
    const margin = 8;
    const left = Math.min(anchorRect.left, window.innerWidth - dropdownWidth - margin);

    dropdownEl.style.left = `${Math.max(margin, left)}px`;
    dropdownEl.style.width = `${dropdownWidth}px`;

    if (openAbove) {
      dropdownEl.style.top = "auto";
      dropdownEl.style.bottom = `${window.innerHeight - anchorRect.top + 4}px`;
    } else {
      dropdownEl.style.top = `${anchorRect.bottom + 4}px`;
      dropdownEl.style.bottom = "auto";
    }

    if (!dropdownEl.matches(":popover-open")) {
      dropdownEl.showPopover();
    }
  };

  const closeDropdown = (): void => {
    if (dropdownEl?.matches(":popover-open")) dropdownEl.hidePopover();
    if (dropdownOpen()) setDropdownOpen(false);
  };

  const syncTheme = (): void => {
    if (typeof document === "undefined") return;
    setIsDarkTheme(document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  };

  /** Insert the currently-active suggestion at the caret and clear
   *  completion state. Shared by Tab, Enter-on-dropdown, and click
   *  handlers so the insertion path stays in one place. */
  const acceptActiveSuggestion = (): boolean => {
    if (!textareaEl) return false;
    const state = completionState();
    const active = activeSuggestion();
    if (!state || !active) return false;
    if (active.text === state.ctx.text) {
      // Nothing to insert (typed text already equals the suggestion).
      closeDropdown();
      setCompletionState(null);
      return false;
    }
    applySuggestion(textareaEl, state.ctx, active);
    closeDropdown();
    setCompletionState(null);
    return true;
  };

  /** Move the highlighted row inside the dropdown. The ghost
   *  preview reflects the new selection automatically because both
   *  read from `activeSuggestion()`. */
  const moveSelection = (direction: 1 | -1): void => {
    const state = completionState();
    if (!state) return;
    const len = state.suggestions.length;
    if (len === 0) return;
    const next = (state.selectedIndex + direction + len) % len;
    setCompletionState({ ...state, selectedIndex: next });
  };

  // Lines / words / chars derived from the live local value.
  const stats = createMemo(() => {
    const v = localValue();
    return {
      lines: v.length === 0 ? 0 : v.split("\n").length,
      words: v.match(/\S+/g)?.length ?? 0,
      chars: v.length,
    };
  });

  onMount(() => {
    if (textareaEl) setTaSignal(textareaEl);
    updateActive();

    // Catch cursor moves via arrow keys / mouse click / programmatic
    // setSelectionRange — none of these fire the textarea's `input`
    // event. `selectionchange` on the document is the only reliable
    // signal across all paths.
    const onSelectionChange = (): void => {
      if (document.activeElement === textareaEl) {
        updateActive();
        recomputeCompletion();
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    onCleanup(() => document.removeEventListener("selectionchange", onSelectionChange));
    // Belt-and-braces: ensure the dropdown dialog doesn't outlive
    // the editor (e.g. fast unmount during route change while the
    // dropdown is open).
    onCleanup(() => {
      if (dropdownEl?.matches(":popover-open")) dropdownEl.hidePopover();
    });
  });

  const onInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }): void => {
    // Abbreviation-style auto-expand fires first. If it triggers,
    // the execCommand inside dispatches a fresh `input` event that
    // re-enters this handler with the expanded value — skip the
    // downstream work here so the consumer's onInput callback only
    // sees the final state.
    if (tryExpand(e.currentTarget, mergedCompletions(), { isExcluded: isInCodeZone })) return;
    const v = e.currentTarget.value;
    setLocalValue(v);
    props.onInput?.(v);
    updateActive();
    recomputeCompletion();
  };

  const onChange = (e: Event & { currentTarget: HTMLTextAreaElement }): void => {
    props.onChange?.(e.currentTarget.value);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!textareaEl) return;
    // IME composition in progress — pass everything through. Most
    // browsers fire keydown with `isComposing=true` for the trigger
    // that completes a composition; intercepting it breaks IME UX.
    if (e.isComposing) return;

    // Backspace IMMEDIATELY after an abbreviation expansion reverts it
    // to the original short form. This is the second escape hatch
    // beyond Cmd/Ctrl+Z — non-technical users reach for Backspace
    // when they want to "take that back".
    if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (tryRestore(textareaEl)) {
        e.preventDefault();
        return;
      }
    }

    // Tab / Enter / Escape / Arrows semantics depend on whether
    // there's an active completion (ghost or dropdown) AND whether
    // the editor has any completions registered:
    //
    //   - Active completion → Tab/Enter inserts the highlighted row.
    //     ArrowDown/Up cycle the row (only meaningful with dropdown,
    //     but harmless otherwise). Escape closes the dropdown / ghost
    //     without inserting.
    //   - Completions configured but no active suggestion → Tab is
    //     swallowed (focus trap). Escape blurs the textarea.
    //   - No completions → native browser behaviour.
    const hasCompletions = (mergedCompletions()?.length ?? 0) > 0;
    const state = completionState();
    const hasActive = state !== null;
    const isDropdown = state?.ctx.completion.dropdown === true;

    // Arrow keys cycle the dropdown selection when one is open. We
    // also accept arrow keys when ONLY the ghost is showing — the
    // ghost only ever has one entry there, so the cycle is a no-op,
    // but it costs nothing and keeps the behaviour symmetric.
    if (hasActive && isDropdown && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      moveSelection(e.key === "ArrowDown" ? 1 : -1);
      return;
    }

    // Enter inserts the active suggestion only when the dropdown is
    // open. Bare ghost without dropdown keeps Enter for newline /
    // list continuation — Tab remains the accept gesture there, so
    // we don't pull Enter out from under the user mid-paragraph.
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (hasActive && isDropdown && dropdownOpen()) {
        e.preventDefault();
        acceptActiveSuggestion();
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
        closeDropdown();
        setCompletionState(null);
        return;
      }
      if (hasCompletions) {
        // Blur escapes the trap. Browser default Escape on textarea
        // doesn't move focus, so we do it explicitly. The user gets
        // back to "regular" Tab behaviour from wherever focus lands
        // (usually the document root → next Tab moves to body's
        // first focusable child).
        e.preventDefault();
        textareaEl.blur();
        return;
      }
    }

    // Cmd/Ctrl+Enter submits — bare Enter is reserved for newlines /
    // list continuation. User explicitly requested this convention so
    // multi-line editing works without surprise form submits.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      if (props.onSubmit) {
        e.preventDefault();
        props.onSubmit();
        return;
      }
    }

    // Shortcut dispatch (bold/italic/headings/etc).
    if (handleShortcut(e, textareaEl)) {
      e.preventDefault();
      return;
    }

    // Smart list continuation on bare Enter.
    if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (handleListContinuation(textareaEl)) {
        e.preventDefault();
        return;
      }
    }
  };

  const onPaste = (e: ClipboardEvent): void => {
    if (!textareaEl) return;
    if (handleSmartPaste(e, textareaEl)) {
      e.preventDefault();
    }
  };

  const onScroll = (e: Event & { currentTarget: HTMLTextAreaElement }): void => {
    if (!previewEl) return;
    previewEl.scrollTop = e.currentTarget.scrollTop;
    previewEl.scrollLeft = e.currentTarget.scrollLeft;
  };

  // Tab semantics (handled in onKeyDown above):
  //   - Ghost active → insert it.
  //   - Completions configured but no ghost → swallow Tab (focus trap).
  //   - No completions → native behaviour, moves focus to next field.
  // Escape releases the trap (blurs the textarea). Indentation by
  // Tab is never inserted — lists auto-continue on Enter instead.

  // Height derived from `lines` prop. We use rem because line-height is
  // 1.55 — close enough to 1em-ish; rem keeps it predictable.
  const surfaceStyle = (): string => {
    if (props.fill) return "";
    const lines = props.lines ?? 6;
    return `--md-h: ${lines * 1.5}rem`;
  };

  const saveButton = (): JSX.Element => (
    <>
      {props.toolbarTrailing}
      <Show when={props.onSave}>
        <button
          type="button"
          class="md-editor-tool"
          title="Save (Ctrl/Cmd+S)"
          aria-label="Save"
          tabIndex={-1}
          disabled={props.disabled || props.saveDisabled?.() || props.saving?.()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => props.onSave?.()}
        >
          <i class={props.saving?.() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
        </button>
      </Show>
    </>
  );

  return (
    <div
      class="md-editor"
      data-disabled={props.disabled ? "true" : undefined}
      data-error={props.error ? "true" : undefined}
      data-variant={props.variant === "paper" ? "paper" : undefined}
      data-fill={props.fill ? "true" : undefined}
      onKeyDown={(event) => {
        if (props.onSave && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          if (!props.saveDisabled?.() && !props.saving?.()) props.onSave();
        }
      }}
    >
      <Show when={!props.noToolbar}>
        <Toolbar textarea={taSignal} activeFormats={activeFormats} disabled={props.disabled} trailing={saveButton()} />
      </Show>
      <div class="md-editor-surface" style={surfaceStyle()}>
        <Show when={!localValue() && props.placeholder}>
          <div class="md-editor-placeholder" aria-hidden="true">
            {props.placeholder}
          </div>
        </Show>
        <div ref={(el) => (previewEl = el)} class="md-editor-layer md-editor-preview" aria-hidden="true" />
        <textarea
          ref={(el) => (textareaEl = el)}
          id={props.id}
          name={props.name}
          class="md-editor-layer md-editor-input"
          // value is managed imperatively via the effect above —
          // see the "imperatively rather than via JSX binding" comment.
          // No `value={…}` prop here.
          onInput={onInput}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onScroll={onScroll}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onBlur={(e) => {
            // Don't tear down completion state if focus moved into
            // the dropdown dialog — that's a normal interaction
            // (clicking a row). The dialog itself is in the
            // top-layer; `relatedTarget` will be the clicked option
            // (or the dialog) and we'll get focus back via the
            // option-click handler.
            const next = e.relatedTarget as HTMLElement | null;
            if (next && dropdownEl && dropdownEl.contains(next)) return;
            resetCompletionState();
            // Drop completion state on real blur — keeping it would
            // leave a dim suggestion lingering after the user moved
            // focus, which reads as a glitch rather than a hint.
            setCompletionState(null);
            closeDropdown();
          }}
          disabled={props.disabled}
          spellcheck={props.spellcheck ?? true}
          maxLength={props.maxLength}
          aria-label={props.ariaLabel}
          aria-describedby={props.ariaDescribedBy}
          aria-invalid={props.ariaInvalid}
          aria-required={props.ariaRequired}
        />
      </div>
      <Show when={(props.showStats ?? true) && !props.disabled}>
        {/* Render the row even when empty so the editor's overall
            height never changes — just toggle visibility. Hiding via
            `display: none` would jolt every other field below when the
            user starts/stops typing. */}
        <div class="md-editor-stats" aria-hidden="true" data-empty={stats().chars === 0 ? "true" : undefined}>
          <span>
            {stats().lines} {stats().lines === 1 ? "line" : "lines"}
          </span>
          <span>
            {stats().words} {stats().words === 1 ? "word" : "words"}
          </span>
          <span>
            {stats().chars} {stats().chars === 1 ? "char" : "chars"}
          </span>
        </div>
      </Show>
      {/* Completion dropdown — uses the Popover API instead of
          `<dialog showModal>`. Reasoning: `showModal` makes the rest
          of the page `inert`, which kills typing + arrow-key
          navigation in the textarea. The Popover API renders in the
          same top-layer (so we still sit above modals) but DOES NOT
          capture focus, so the textarea keeps it.

          `popover="manual"` because we drive open/close ourselves —
          arrow keys, click outside (via blur), Tab, Esc are all
          handled in the textarea's onKeyDown so we don't want the
          browser's built-in light-dismiss to fight us.

          Mounted only when there IS a completion state, so the
          element + its `[popover]` close-transition don't outlive
          the data. Otherwise the global `[popover]` close transition
          (~200ms `display allow-discrete`) would leave an empty box
          fading out after the last completion vanished. Ref binds
          on mount via the `(el) => …` callback. `positionDropdown`
          runs the next microtask, so the ref is ready in time.

          `popup` provides the paper surface; `dark` class is mirrored
          from the host theme because top-layer elements don't inherit
          ancestor classes. `inset-auto` clears the UA default
          `inset: 0` so our explicit left/top take effect (otherwise
          the popover would stretch to viewport edges). */}
      <Show when={completionState()}>
        {(state) => (
          <div
            ref={(el) => (dropdownEl = el)}
            popover="manual"
            class="popup fixed inset-auto m-0 border border-zinc-200 p-1 dark:border-zinc-700"
            classList={{ dark: isDarkTheme() }}
            role="presentation"
            aria-label="Completion suggestions"
          >
            <div class="flex max-h-60 flex-col gap-0.5 overflow-y-auto" role="listbox" aria-label="Suggestions">
              <For each={state().suggestions}>
                {(suggestion, index) => {
                  const isSelected = () => index() === state().selectedIndex;
                  return (
                    <div
                      // mousedown rather than click so we beat the
                      // textarea's blur — clicking an option must
                      // insert + keep editor focus, not blur away.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setCompletionState({ ...state(), selectedIndex: index() });
                        acceptActiveSuggestion();
                        textareaEl?.focus();
                      }}
                      onMouseEnter={() => setCompletionState({ ...state(), selectedIndex: index() })}
                      role="option"
                      aria-selected={isSelected()}
                      class={`group flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors ${
                        isSelected()
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <span class="font-mono truncate">{displayLabel(suggestion, state().ctx.completion)}</span>
                      <Show when={suggestion.hint}>
                        <span class="ml-auto text-xs text-zinc-500 dark:text-zinc-400 truncate">{suggestion.hint}</span>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
