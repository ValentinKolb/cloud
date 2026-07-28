import { highlight } from "@k2b/stdlib";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";
import {
  abbreviations,
  applyCompletion,
  type Completion,
  collectKnownLabels,
  detectCompletion,
  displayLabel,
  renderWithOverlay,
  resolveCompletion,
  type Suggestion,
  tryExpand,
  tryRestore,
} from "./completion";

type EditorFieldProps = {
  value?: string | null;
  onValueChange?: (value: string) => void;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  class?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  lines?: number;
  fill?: boolean;
  spellcheck?: boolean;
  maxLength?: number;
  required?: boolean;
  textareaRef?: (element: HTMLTextAreaElement) => void;
  onEditorKeyDown?: (event: KeyboardEvent, textarea: HTMLTextAreaElement) => boolean | void;
  onEditorPaste?: (event: ClipboardEvent, textarea: HTMLTextAreaElement) => boolean | void;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

export type AutocompleteEditorProps = EditorFieldProps & {
  completions?: readonly Completion[];
  highlight?: (text: string) => string;
  singleLine?: boolean;
  restoreExpansionOnBackspace?: boolean;
  variant?: "default" | "paper";
};

type CompletionState = {
  context: NonNullable<ReturnType<typeof detectCompletion>>;
  suggestions: readonly Suggestion[];
  selected: number;
};

export function AutocompleteEditor(props: AutocompleteEditorProps): JSX.Element {
  const meta = createFieldMeta(props.id);
  const [state, setState] = createSignal<CompletionState | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [completionError, setCompletionError] = createSignal<string>();
  const [composing, setComposing] = createSignal(false);
  const listboxId = `${meta.controlId}-${createUniqueId()}-suggestions`;
  let textarea: HTMLTextAreaElement | undefined;
  let preview: HTMLDivElement | undefined;
  let dropdown: HTMLDivElement | undefined;
  let abort: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const active = () => {
    const current = state();
    return current?.suggestions[current.selected];
  };

  const clear = () => {
    abort?.abort();
    abort = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
    setState(null);
    setLoading(false);
    setCompletionError();
    if (dropdown?.matches(":popover-open")) dropdown.hidePopover();
  };

  const positionDropdown = () => {
    if (!dropdown || !textarea || !dropdown.isConnected) return;
    const anchor = preview?.querySelector<HTMLElement>("[data-completion-anchor]");
    const rect = anchor?.getBoundingClientRect() ?? textarea.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 16);
    dropdown.style.width = `${width}px`;
    dropdown.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    dropdown.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - Math.min(280, dropdown.offsetHeight) - 8)}px`;
    if ("showPopover" in dropdown && !dropdown.matches(":popover-open")) dropdown.showPopover();
  };

  const accept = (suggestion = active()) => {
    const current = state();
    if (!textarea || !current || !suggestion) return false;
    const result = applyCompletion(textarea.value, current.context, suggestion);
    textarea.value = result.value;
    textarea.setSelectionRange(result.caret, result.caret);
    props.onValueChange?.(result.value);
    clear();
    queueMicrotask(recompute);
    return true;
  };

  const resolve = (context: CompletionState["context"]) => {
    abort?.abort();
    if (timer) clearTimeout(timer);
    abort = new AbortController();
    const signal = abort.signal;
    const run = async () => {
      setLoading(true);
      setCompletionError();
      try {
        const suggestions = (await resolveCompletion(context, textarea?.value ?? "", signal)).filter((suggestion) => {
          if (suggestion.textEdit) return suggestion.textEdit.text !== (textarea?.value ?? "").slice(suggestion.textEdit.start, suggestion.textEdit.end);
          return suggestion.text.toLowerCase().startsWith(context.text.toLowerCase()) && suggestion.text.length > context.text.length;
        });
        if (signal.aborted) return;
        setLoading(false);
        if (suggestions.length === 0) {
          setState(null);
          return;
        }
        const previous = active()?.text;
        const selected = Math.max(0, suggestions.findIndex((suggestion) => suggestion.text === previous));
        setState({ context, suggestions, selected });
        if (context.completion.dropdown) queueMicrotask(positionDropdown);
      } catch (error) {
        if (signal.aborted) return;
        setLoading(false);
        setCompletionError(error instanceof Error ? error.message : "Suggestions could not be loaded.");
        queueMicrotask(positionDropdown);
      }
    };
    const delay = Math.max(0, context.completion.debounceMs ?? 0);
    if (delay) timer = setTimeout(() => void run(), delay);
    else void run();
  };

  const recompute = () => {
    if (!textarea || composing()) return;
    const context = detectCompletion(textarea.value, textarea.selectionStart, props.completions ?? []);
    if (!context) return clear();
    resolve(context);
  };

  createEffect(() => {
    const value = props.value ?? "";
    if (!composing() && textarea && textarea.value !== value) textarea.value = value;
  });

  createEffect(() => {
    if (!preview) return;
    const current = state();
    const suggestion = active();
    const ghost =
      current && suggestion && !suggestion.textEdit
        ? { at: current.context.end, text: suggestion.text.slice(current.context.text.length) }
        : undefined;
    preview.innerHTML = renderWithOverlay(props.value ?? "", props.highlight ?? ((text) => text), {
      ghost,
      anchor: current ? { at: current.context.end } : undefined,
    });
  });

  onMount(() => {
    const selection = () => {
      if (document.activeElement === textarea) recompute();
    };
    document.addEventListener("selectionchange", selection);
    window.addEventListener("resize", positionDropdown);
    onCleanup(() => {
      document.removeEventListener("selectionchange", selection);
      window.removeEventListener("resize", positionDropdown);
    });
  });
  onCleanup(clear);

  const update = (event: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    if (event.inputType.startsWith("insert") && tryExpand(event.currentTarget, props.completions)) return;
    props.onValueChange?.(event.currentTarget.value);
    recompute();
  };

  const keydown = (event: KeyboardEvent) => {
    if (!textarea || event.isComposing) return;
    if (props.onEditorKeyDown?.(event, textarea)) return;
    const current = state();
    if (
      (props.restoreExpansionOnBackspace ?? true) &&
      event.key === "Backspace" &&
      !event.metaKey &&
      !event.ctrlKey &&
      tryRestore(textarea)
    ) {
      event.preventDefault();
      props.onValueChange?.(textarea.value);
      return;
    }
    if (current?.context.completion.dropdown && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setState({ ...current, selected: (current.selected + direction + current.suggestions.length) % current.suggestions.length });
      return;
    }
    if ((event.key === "Tab" && current) || (event.key === "Enter" && current?.context.completion.dropdown)) {
      event.preventDefault();
      accept();
      return;
    }
    if (event.key === "Escape" && current) {
      event.preventDefault();
      clear();
      return;
    }
    if (
      event.key === "Enter" &&
      ((props.singleLine && !event.shiftKey && !event.metaKey && !event.ctrlKey) ||
        (!props.singleLine && (event.metaKey || event.ctrlKey)))
    ) {
      event.preventDefault();
      props.onSubmit?.();
    }
  };

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error}
      meta={meta}
      required={props.required}
    >
      <div
        class="k2b-autocomplete"
        data-overlay={props.highlight ? "true" : undefined}
        data-fill={props.fill ? "true" : undefined}
        data-variant={props.variant}
        data-invalid={props.error ? "true" : undefined}
        style={{ "--k2b-editor-lines": String(props.singleLine ? 1 : (props.lines ?? 3)) }}
      >
        <Show when={props.highlight}>
          <div ref={preview} class="k2b-autocomplete__preview" aria-hidden="true" />
        </Show>
        <textarea
          ref={(element) => {
            textarea = element;
            props.textareaRef?.(element);
          }}
          id={meta.controlId}
          name={props.name}
          class="k2b-autocomplete__input"
          rows={props.singleLine ? 1 : (props.lines ?? 3)}
          value={props.value ?? ""}
          placeholder={props.placeholder}
          disabled={props.disabled}
          required={props.required}
          maxlength={props.maxLength}
          spellcheck={props.spellcheck}
          aria-label={props["aria-label"]}
          aria-describedby={fieldDescribedBy(meta, props.description, props.error, props["aria-describedby"])}
          aria-invalid={props.error ? "true" : undefined}
          role="textbox"
          aria-multiline={!props.singleLine}
          aria-controls={state()?.context.completion.dropdown ? listboxId : undefined}
          aria-activedescendant={active() ? `${listboxId}-${state()?.selected}` : undefined}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setComposing(false);
            props.onValueChange?.(event.currentTarget.value);
            recompute();
          }}
          onInput={update}
          onChange={(event) => props.onChange?.(event.currentTarget.value)}
          onKeyDown={keydown}
          onPaste={(event) => {
            if (textarea) props.onEditorPaste?.(event, textarea);
          }}
          onScroll={(event) => {
            if (!preview) return;
            preview.scrollTop = event.currentTarget.scrollTop;
            preview.scrollLeft = event.currentTarget.scrollLeft;
          }}
        />
        <Show when={state()?.context.completion.dropdown || loading() || completionError()}>
          <div
            ref={dropdown}
            popover="manual"
            id={listboxId}
            class="k2b-autocomplete__options"
            role="listbox"
          >
            <Show when={loading()}>
              <div class="k2b-autocomplete__status">
                <i class="ti ti-loader-2 k2b-spin" aria-hidden="true" /> Loading…
              </div>
            </Show>
            <Show when={completionError()}>
              {(message) => (
                <button type="button" class="k2b-autocomplete__status" onClick={recompute}>
                  {message()} Retry
                </button>
              )}
            </Show>
            <For each={state()?.suggestions ?? []}>
              {(suggestion, index) => (
                <button
                  id={`${listboxId}-${index()}`}
                  type="button"
                  role="option"
                  aria-selected={index() === state()?.selected}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => accept(suggestion)}
                >
                  <span>{displayLabel(suggestion, state()!.context.completion)}</span>
                  <Show when={suggestion.hint}>{(hint) => <small>{hint()}</small>}</Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Field>
  );
}

type MarkdownFormat = "bold" | "italic" | "code" | "link" | "quote" | "bullet" | "number";

const formatSelection = (textarea: HTMLTextAreaElement, format: MarkdownFormat): string => {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  const formats: Record<MarkdownFormat, [string, string]> = {
    bold: ["**", "**"],
    italic: ["_", "_"],
    code: ["`", "`"],
    link: ["[", "](https://)"],
    quote: ["> ", ""],
    bullet: ["- ", ""],
    number: ["1. ", ""],
  };
  const [before, after] = formats[format];
  const insert = `${before}${selected}${after}`;
  const next = `${textarea.value.slice(0, start)}${insert}${textarea.value.slice(end)}`;
  textarea.value = next;
  const selectionStart = start + before.length;
  textarea.setSelectionRange(selectionStart, selectionStart + selected.length);
  textarea.focus();
  return next;
};

const continueMarkdownList = (textarea: HTMLTextAreaElement): string | null => {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
  if (!match) return null;
  const marker = match[2] ?? "-";
  if (!(match[3] ?? "").trim()) return null;
  const nextMarker = /^\d+\.$/.test(marker) ? `${Number.parseInt(marker, 10) + 1}.` : marker;
  const insert = `\n${match[1] ?? ""}${nextMarker} `;
  const start = textarea.selectionStart;
  textarea.value = `${textarea.value.slice(0, start)}${insert}${textarea.value.slice(textarea.selectionEnd)}`;
  textarea.setSelectionRange(start + insert.length, start + insert.length);
  return textarea.value;
};

export type MarkdownEditorProps = EditorFieldProps & {
  abbreviations?: Record<string, string>;
  completions?: readonly Completion[];
  noToolbar?: boolean;
  showStats?: boolean;
  variant?: "default" | "paper";
  onSave?: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
  toolbarTrailing?: JSX.Element;
  knownLabels?: ReadonlySet<string>;
};

export function MarkdownEditor(props: MarkdownEditorProps): JSX.Element {
  let editor: HTMLTextAreaElement | undefined;
  const merged = createMemo<readonly Completion[]>(() => [
    ...(props.abbreviations ? [abbreviations(props.abbreviations)] : []),
    ...(props.completions ?? []),
  ]);
  const labels = createMemo(() => props.knownLabels ?? collectKnownLabels(merged()));
  const words = () => (props.value ?? "").trim().split(/\s+/).filter(Boolean).length;
  const update = (value: string) => props.onValueChange?.(value);
  const apply = (format: MarkdownFormat) => {
    if (editor) update(formatSelection(editor, format));
  };
  const toolbarItems: readonly [MarkdownFormat, string, string][] = [
    ["bold", "ti ti-bold", "Bold"],
    ["italic", "ti ti-italic", "Italic"],
    ["code", "ti ti-code", "Inline code"],
    ["link", "ti ti-link", "Link"],
    ["quote", "ti ti-quote", "Quote"],
    ["bullet", "ti ti-list", "Bulleted list"],
    ["number", "ti ti-list-numbers", "Numbered list"],
  ];

  return (
    <div class={`k2b-markdown-editor ${props.class ?? ""}`} data-fill={props.fill ? "true" : undefined}>
      <Show when={!props.noToolbar}>
        <div class="k2b-markdown-editor__toolbar" role="toolbar" aria-label="Markdown formatting">
          <For each={toolbarItems}>
            {([format, icon, label]) => (
              <button type="button" aria-label={label} title={label} disabled={props.disabled} onClick={() => apply(format)}>
                <i class={icon} aria-hidden="true" />
              </button>
            )}
          </For>
          <span class="k2b-markdown-editor__toolbar-spacer" />
          {props.toolbarTrailing}
          <Show when={props.onSave}>
            <button
              type="button"
              aria-label="Save"
              disabled={props.disabled || props.saveDisabled || props.saving}
              onClick={props.onSave}
            >
              <i class={props.saving ? "ti ti-loader-2 k2b-spin" : "ti ti-device-floppy"} aria-hidden="true" />
            </button>
          </Show>
        </div>
      </Show>
      <AutocompleteEditor
        {...props}
        class={undefined}
        completions={merged()}
        highlight={(text) => highlight.markdown(text, { knownLabels: labels() })}
        textareaRef={(element) => {
          editor = element;
          props.textareaRef?.(element);
        }}
        onValueChange={update}
        onSubmit={props.onSubmit}
        onChange={props.onChange}
        onEditorKeyDown={(event, textarea) => {
          if (props.onSave && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (!props.saveDisabled && !props.saving) props.onSave();
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && ["b", "i", "k"].includes(event.key.toLowerCase())) {
            event.preventDefault();
            const format = event.key.toLowerCase() === "b" ? "bold" : event.key.toLowerCase() === "i" ? "italic" : "link";
            update(formatSelection(textarea, format));
            return true;
          }
          if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
            const next = continueMarkdownList(textarea);
            if (next !== null) {
              event.preventDefault();
              update(next);
              return true;
            }
          }
          return props.onEditorKeyDown?.(event, textarea);
        }}
        onEditorPaste={(event, textarea) => {
          const pasted = event.clipboardData?.getData("text/plain") ?? "";
          const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
          if (selected && /^https?:\/\/\S+$/.test(pasted)) {
            event.preventDefault();
            const start = textarea.selectionStart;
            const next = `${textarea.value.slice(0, start)}[${selected}](${pasted})${textarea.value.slice(textarea.selectionEnd)}`;
            textarea.value = next;
            textarea.setSelectionRange(start + selected.length + pasted.length + 4, start + selected.length + pasted.length + 4);
            update(next);
            return true;
          }
          return props.onEditorPaste?.(event, textarea);
        }}
      />
      <Show when={(props.showStats ?? true) && !props.disabled}>
        <footer class="k2b-markdown-editor__stats" aria-live="polite">
          {props.value?.split("\n").length ?? 1} lines · {words()} words · {props.value?.length ?? 0} chars
        </footer>
      </Show>
    </div>
  );
}

export type TemplateVariableKind = "string" | "email" | "url" | "number" | "boolean" | "array" | "object";
export type TemplateVariable = { name: string; kind?: TemplateVariableKind; description?: string };
export type TemplateEditorProps = Omit<AutocompleteEditorProps, "completions" | "highlight"> & {
  variables: readonly TemplateVariable[];
};
export type TemplatePreviewProps = { html: string; title?: string; class?: string };
export type TemplateSampleDataProps = {
  variables: readonly TemplateVariable[];
  values: Readonly<Record<string, string>>;
  onValueChange: (name: string, value: string) => void;
  class?: string;
};

export type TemplateEditorLayoutValue = {
  root: {
    type: "split";
    id: string;
    direction: "horizontal";
    sizes: [number, number];
    children: readonly {
      type: "leaf";
      id: string;
      presentation: "tabs";
      elementIds: readonly string[];
      activeElementId: string;
    }[];
  };
};

export const createTemplateEditorPanesValue = (): TemplateEditorLayoutValue => ({
  root: {
    type: "split",
    id: "template-editor-root",
    direction: "horizontal",
    sizes: [50, 50],
    children: [
      {
        type: "leaf",
        id: "template-editor-source",
        presentation: "tabs",
        elementIds: ["html"],
        activeElementId: "html",
      },
      {
        type: "leaf",
        id: "template-editor-output",
        presentation: "tabs",
        elementIds: ["preview", "sample-data"],
        activeElementId: "preview",
      },
    ],
  },
});

const escapeTemplate = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const templateHighlight = (text: string) =>
  escapeTemplate(text)
    .replace(/({{[\s\S]*?}}|{%[\s\S]*?%})/g, '<span class="k2b-template-token">$1</span>')
    .replace(/(&lt;\/?)([\w:-]+)/g, '$1<span class="k2b-template-tag">$2</span>');

const templateCompletions = (variables: readonly TemplateVariable[]): Completion[] => [
  {
    trigger: "{",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query) =>
      variables
        .filter((variable) => variable.name.toLowerCase().startsWith(query.toLowerCase()))
        .map((variable) => ({
          text: `{{ ${variable.name} }}`,
          label: variable.name,
          hint: variable.kind ?? "string",
          appendSpace: false,
        })),
  },
  {
    trigger: "<",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query) =>
      [
        ["p", "<p></p>"],
        ["a", '<a href="{{ URL }}">Link</a>'],
        ["strong", "<strong></strong>"],
        ["em", "<em></em>"],
        ["br", "<br>"],
        ["ul", "<ul>\n  <li></li>\n</ul>"],
        ["table", "<table>\n  <tr><td></td></tr>\n</table>"],
      ]
        .filter(([name]) => name!.startsWith(query.toLowerCase()))
        .map(([name, text]) => ({ text: text!, label: name, hint: "HTML", appendSpace: false })),
  },
];

export function TemplateEditor(props: TemplateEditorProps): JSX.Element {
  return (
    <AutocompleteEditor
      {...props}
      lines={props.lines ?? 22}
      spellcheck={props.spellcheck ?? false}
      placeholder={props.placeholder ?? "Write HTML with Liquid values like {{ APP_NAME }}…"}
      highlight={templateHighlight}
      completions={templateCompletions(props.variables)}
    />
  );
}

export function TemplatePreview(props: TemplatePreviewProps): JSX.Element {
  return (
    <section class={`k2b-template-preview ${props.class ?? ""}`}>
      <iframe sandbox="" srcdoc={props.html} title={props.title ?? "Template preview"} />
    </section>
  );
}

export function TemplateSampleData(props: TemplateSampleDataProps): JSX.Element {
  return (
    <section class={`k2b-template-sample ${props.class ?? ""}`}>
      <For each={props.variables}>
        {(variable) => (
          <label>
            <span>{`{{ ${variable.name} }}`}</span>
            <input
              class="k2b-control"
              value={props.values[variable.name] ?? ""}
              onInput={(event) => props.onValueChange(variable.name, event.currentTarget.value)}
            />
          </label>
        )}
      </For>
    </section>
  );
}

export type { Completion, SuggestContext, Suggestion } from "./completion";
export { abbreviations } from "./completion";
