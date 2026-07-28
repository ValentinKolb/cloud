import { createSignal, type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";
import { type Completion, MarkdownEditor } from "./Editors";

export type TextInputProps = Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "onInput" | "prefix" | "suffix" | "type" | "value"
> & {
  value?: string | null;
  onValueChange?: (value: string) => void;
  onChange?: (value: string) => void;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  type?: "text" | "search" | "email" | "url" | "tel";
  variant?: "default" | "ai";
  icon?: string;
  activeIcon?: string;
  prefix?: JSX.Element;
  suffix?: JSX.Element;
  clearable?: boolean;
  onClear?: () => void;
  clearLabel?: string;
  multiline?: boolean;
  monospace?: boolean;
  password?: boolean;
  markdown?: boolean;
  onSubmit?: () => void;
  lines?: number;
  abbreviations?: Record<string, string>;
  completions?: readonly Completion[];
};

export function TextInput(props: TextInputProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "activeIcon",
    "aria-describedby",
    "class",
    "clearLabel",
    "clearable",
    "completions",
    "description",
    "error",
    "icon",
    "id",
    "label",
    "lines",
    "markdown",
    "monospace",
    "multiline",
    "onChange",
    "onClear",
    "onSubmit",
    "onValueChange",
    "password",
    "prefix",
    "required",
    "suffix",
    "type",
    "value",
    "variant",
    "abbreviations",
  ]);
  const meta = createFieldMeta(local.id);
  const [passwordVisible, setPasswordVisible] = createSignal(false);
  const multiline = () => Boolean(local.multiline || local.markdown);
  const icon = () =>
    local.icon ?? (local.variant === "ai" ? "ti ti-sparkles" : local.markdown ? "ti ti-markdown" : "ti ti-cursor-text");
  const activeIcon = () => local.activeIcon ?? (local.variant === "ai" ? "ti ti-sparkles" : "ti ti-pencil");
  const describedBy = () => fieldDescribedBy(meta, local.description, local.error, local["aria-describedby"]);
  const clear = () => {
    if (local.onClear) local.onClear();
    else local.onValueChange?.("");
    local.onChange?.("");
  };

  return (
    <Field
      class={local.class}
      label={local.label}
      description={local.description}
      error={local.error}
      meta={meta}
      required={local.required}
    >
      <Show
        when={!local.markdown}
        fallback={
          <MarkdownEditor
            id={meta.controlId}
            name={rest.name}
            value={local.value}
            onValueChange={local.onValueChange}
            onChange={local.onChange}
            onSubmit={local.onSubmit}
            placeholder={rest.placeholder}
            disabled={rest.disabled}
            required={local.required}
            lines={local.lines}
            maxLength={rest.maxlength === undefined ? undefined : Number(rest.maxlength)}
            spellcheck={rest.spellcheck === undefined ? undefined : rest.spellcheck === true || rest.spellcheck === "true"}
            abbreviations={local.abbreviations}
            completions={local.completions}
            error={local.error}
            aria-describedby={describedBy()}
          />
        }
      >
        <div
          class="k2b-input-shell k2b-text-input"
          data-invalid={local.error ? "true" : undefined}
          data-ai={local.variant === "ai" ? "true" : undefined}
          data-multiline={multiline() ? "true" : undefined}
          data-monospace={local.monospace ? "true" : undefined}
        >
          <span class="k2b-input-shell__icon k2b-text-input__icon" aria-hidden="true">
            <i class={icon()} />
            <i class={activeIcon()} />
          </span>
          <Show when={local.prefix}>
            <span class="k2b-input-shell__affix">{local.prefix}</span>
          </Show>
          <Show
            when={multiline()}
            fallback={
              <input
                {...rest}
                id={meta.controlId}
                class="k2b-input"
                type={local.password && !passwordVisible() ? "password" : (local.type ?? "text")}
                value={local.value ?? ""}
                required={local.required}
                aria-invalid={local.error ? "true" : undefined}
                aria-describedby={describedBy()}
                onInput={(event) => local.onValueChange?.(event.currentTarget.value)}
                onChange={(event) => local.onChange?.(event.currentTarget.value)}
              />
            }
          >
            <textarea
              id={meta.controlId}
              class="k2b-input k2b-text-input__textarea"
              name={rest.name}
              value={local.value ?? ""}
              rows={local.lines ?? 3}
              placeholder={rest.placeholder}
              disabled={rest.disabled}
              readOnly={rest.readOnly}
              required={local.required}
              maxlength={rest.maxlength}
              spellcheck={rest.spellcheck}
              autocomplete={rest.autocomplete}
              autocapitalize={rest.autocapitalize}
              aria-invalid={local.error ? "true" : undefined}
              aria-describedby={describedBy()}
              onInput={(event) => local.onValueChange?.(event.currentTarget.value)}
              onChange={(event) => local.onChange?.(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (local.onSubmit && event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault();
                  local.onSubmit();
                }
              }}
            />
          </Show>
          <Show when={local.suffix}>
            <span class="k2b-input-shell__affix">{local.suffix}</span>
          </Show>
          <Show when={local.clearable && local.value && !multiline() && !local.password && !rest.disabled && !rest.readOnly}>
            <button type="button" class="k2b-input-shell__clear" aria-label={local.clearLabel ?? "Clear"} onClick={clear}>
              <i class="ti ti-x" aria-hidden="true" />
            </button>
          </Show>
          <Show when={local.password && !multiline()}>
            <button
              type="button"
              class="k2b-input-shell__clear"
              aria-label={passwordVisible() ? "Hide password" : "Show password"}
              aria-pressed={passwordVisible()}
              disabled={rest.disabled}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              <i class={passwordVisible() ? "ti ti-eye-off" : "ti ti-eye"} aria-hidden="true" />
            </button>
          </Show>
        </div>
      </Show>
    </Field>
  );
}
