import { createSignal, createEffect, createMemo, onMount, onCleanup, untrack, Show } from "solid-js";
import { highlightMarkdown } from "./highlight";
import { handleShortcut, handleListContinuation, handleSmartPaste } from "./behaviors";
import { tryExpand as tryExpandAbbr, tryRestore as tryRestoreAbbr, resetAbbreviationState } from "./abbreviations";
import { computeActiveFormats } from "./active-formats";
import Toolbar from "./Toolbar";

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
   * AutoText dictionary. When the user types a word-boundary character
   * after one of these keys, the key is replaced by its value (verbatim,
   * not re-cased). Matching is case-insensitive with exact-case
   * preference. Native Cmd/Ctrl+Z or an immediate Backspace reverts the
   * expansion. Expansions never fire inside code spans / fenced blocks.
   */
  abbreviations?: Record<string, string>;
  /** Truthy when the surrounding form considers this field invalid.
   * Renders a red border on the editor wrapper. The error MESSAGE is
   * still rendered by `InputWrapper` outside; this prop just signals
   * the editor to visually reflect the state. */
  error?: boolean;
  /** Show the lines/words/chars footer. Defaults to ON. */
  showStats?: boolean;
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
  const [taSignal, setTaSignal] = createSignal<HTMLTextAreaElement | null>(null);
  const [activeFormats, setActiveFormats] = createSignal<Set<string>>(new Set());
  // True while the user has an active IME composition (Japanese,
  // Chinese, Korean, dead-key sequences). Writing `textarea.value`
  // during composition collapses the in-progress glyph or cancels the
  // composition outright; we defer external syncs until it ends.
  const [composing, setComposing] = createSignal(false);

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

  // Preview is driven solely by the local signal — single source of
  // truth, single update path, no duplicated parse/escape work.
  createEffect(() => {
    if (!previewEl) return;
    previewEl.innerHTML = highlightMarkdown(localValue());
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
      if (document.activeElement === textareaEl) updateActive();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    onCleanup(() => document.removeEventListener("selectionchange", onSelectionChange));
  });

  const onInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }): void => {
    // Abbreviation expansion fires first. If it triggers, the
    // execCommand inside dispatches a fresh `input` event that re-enters
    // this handler with the expanded value — skip the downstream work
    // here so the consumer's onInput callback only sees the final state.
    if (tryExpandAbbr(e.currentTarget, props.abbreviations)) return;
    const v = e.currentTarget.value;
    setLocalValue(v);
    props.onInput?.(v);
    updateActive();
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
      if (tryRestoreAbbr(textareaEl)) {
        e.preventDefault();
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

  // Tab is left to its native behaviour — moves focus to the next
  // form control. Intercepting Tab to insert spaces would create a
  // keyboard trap for non-technical users filling out a form. Users
  // who want indentation type spaces; lists auto-continue on Enter.

  // Height derived from `lines` prop. We use rem because line-height is
  // 1.55 — close enough to 1em-ish; rem keeps it predictable.
  const surfaceStyle = (): string => {
    const lines = props.lines ?? 6;
    return `--md-h: ${lines * 1.5}rem`;
  };

  return (
    <div
      class="md-editor"
      data-disabled={props.disabled ? "true" : undefined}
      data-error={props.error ? "true" : undefined}
    >
      <Show when={!props.noToolbar}>
        <Toolbar textarea={taSignal} activeFormats={activeFormats} disabled={props.disabled} />
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
          onBlur={() => resetAbbreviationState()}
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
    </div>
  );
}
