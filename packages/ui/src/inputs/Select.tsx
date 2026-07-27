import { For, type JSX, splitProps } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type SelectProps<T extends string = string> = Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  options: readonly SelectOption<T>[];
  value?: T | null;
  onValueChange?: (value: T) => void;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  placeholder?: string;
};

export function Select<T extends string = string>(props: SelectProps<T>): JSX.Element {
  const [local, rest] = splitProps(props, [
    "aria-describedby",
    "class",
    "description",
    "error",
    "id",
    "label",
    "onValueChange",
    "options",
    "placeholder",
    "required",
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
      <div class="k2b-select-shell" data-invalid={local.error ? "true" : undefined}>
        <select
          {...rest}
          id={meta.controlId}
          class="k2b-select"
          value={local.value ?? ""}
          required={local.required}
          aria-invalid={local.error ? "true" : undefined}
          aria-describedby={fieldDescribedBy(meta, local.description, local.error, local["aria-describedby"])}
          onChange={(event) => local.onValueChange?.(event.currentTarget.value as T)}
        >
          <option value="" disabled={local.required} selected={!local.value}>
            {local.placeholder ?? "Select…"}
          </option>
          <For each={local.options}>
            {(option) => (
              <option value={option.value} disabled={option.disabled} selected={local.value === option.value}>
                {option.label}
              </option>
            )}
          </For>
        </select>
        <i class="ti ti-chevron-down" aria-hidden="true" />
      </div>
    </Field>
  );
}
