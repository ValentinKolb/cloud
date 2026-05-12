import { createSignal, createEffect, onMount, Show } from "solid-js";
import { highlightMarkdown } from "./highlight";
import { handleShortcut } from "./shortcuts";
import { handleListContinuation } from "./list-continue";
import { handleSmartPaste } from "./paste";
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
  const currentValue = (): string => props.value?.() ?? "";

  const updatePreview = (): void => {
    if (!previewEl) return;
    previewEl.innerHTML = highlightMarkdown(currentValue());
  };

  // Keep preview in sync whenever the bound value changes externally
  // (e.g. form reset). The internal text-input pathway also fires this
  // via the `input` event handler below.
  createEffect(() => {
    currentValue();
    updatePreview();
  });

  onMount(() => {
    if (textareaEl) setTaSignal(textareaEl);
    updatePreview();
  });

  const onInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }): void => {
    const v = e.currentTarget.value;
    props.onInput?.(v);
    updatePreview();
  };

  const onChange = (e: Event & { currentTarget: HTMLTextAreaElement }): void => {
    props.onChange?.(e.currentTarget.value);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!textareaEl) return;

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

  // Tab inserts two spaces. Shift+Tab still moves focus (a11y — see
  // overtype issue #75). Don't intercept Shift+Tab.
  const onTab = (e: KeyboardEvent): void => {
    if (e.key !== "Tab" || e.shiftKey) return;
    if (!textareaEl) return;
    e.preventDefault();
    const ta = textareaEl;
    ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
    document.execCommand("insertText", false, "  ");
  };

  // Combined keydown handler — order matters: Tab handling must run
  // even if no shortcut matched.
  const onKeyDownCombined = (e: KeyboardEvent): void => {
    onTab(e);
    if (!e.defaultPrevented) onKeyDown(e);
  };

  // Height derived from `lines` prop. We use rem because line-height is
  // 1.55 — close enough to 1em-ish; rem keeps it predictable.
  const surfaceStyle = (): string => {
    const lines = props.lines ?? 6;
    return `--md-h: ${lines * 1.5}rem`;
  };

  return (
    <div class="md-editor" data-disabled={props.disabled ? "true" : undefined}>
      <Show when={!props.noToolbar}>
        <Toolbar textarea={taSignal} disabled={props.disabled} />
      </Show>
      <div class="md-editor-surface" style={surfaceStyle()}>
        <Show when={!currentValue() && props.placeholder}>
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
          value={currentValue()}
          onInput={onInput}
          onChange={onChange}
          onKeyDown={onKeyDownCombined}
          onPaste={onPaste}
          onScroll={onScroll}
          disabled={props.disabled}
          spellcheck={props.spellcheck ?? true}
          maxLength={props.maxLength}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          aria-label={props.ariaLabel}
          aria-describedby={props.ariaDescribedBy}
          aria-invalid={props.ariaInvalid}
          aria-required={props.ariaRequired}
        />
      </div>
    </div>
  );
}
