import { type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";

export type TextInputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onInput" | "prefix" | "value"> & {
  value?: string | null;
  onValueChange?: (value: string) => void;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  icon?: string;
  prefix?: JSX.Element;
  suffix?: JSX.Element;
  clearable?: boolean;
};

export function TextInput(props: TextInputProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "aria-describedby",
    "class",
    "clearable",
    "description",
    "error",
    "icon",
    "id",
    "label",
    "onValueChange",
    "prefix",
    "required",
    "suffix",
    "type",
    "value",
  ]);
  const meta = createFieldMeta(local.id);

  return (
    <Field
      class={local.class}
      label={local.label}
      description={local.description}
      error={local.error}
      meta={meta}
      required={local.required}
    >
      <div class="k2b-input-shell" data-invalid={local.error ? "true" : undefined}>
        <Show when={local.icon}>{(icon) => <i class={`k2b-input-shell__icon ${icon()}`} aria-hidden="true" />}</Show>
        <Show when={local.prefix}>
          <span class="k2b-input-shell__affix">{local.prefix}</span>
        </Show>
        <input
          {...rest}
          id={meta.controlId}
          class="k2b-input"
          type={local.type ?? "text"}
          value={local.value ?? ""}
          required={local.required}
          aria-invalid={local.error ? "true" : undefined}
          aria-describedby={fieldDescribedBy(meta, local.description, local.error, local["aria-describedby"])}
          onInput={(event) => local.onValueChange?.(event.currentTarget.value)}
        />
        <Show when={local.clearable && local.value && !rest.disabled && !rest.readOnly}>
          <button type="button" class="k2b-input-shell__clear" aria-label="Clear" onClick={() => local.onValueChange?.("")}>
            <i class="ti ti-x" aria-hidden="true" />
          </button>
        </Show>
        <Show when={local.suffix}>
          <span class="k2b-input-shell__affix">{local.suffix}</span>
        </Show>
      </div>
    </Field>
  );
}
