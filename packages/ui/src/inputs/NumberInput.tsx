import { type JSX, splitProps } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";

export type NumberInputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "onInput" | "type" | "value"> & {
  value?: number | null;
  onValueChange?: (value: number | null) => void;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
};

export function NumberInput(props: NumberInputProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "aria-describedby",
    "class",
    "description",
    "error",
    "id",
    "label",
    "onValueChange",
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
      <div class="k2b-input-shell" data-invalid={local.error ? "true" : undefined}>
        <input
          {...rest}
          id={meta.controlId}
          class="k2b-input"
          type="number"
          value={local.value ?? ""}
          required={local.required}
          aria-invalid={local.error ? "true" : undefined}
          aria-describedby={fieldDescribedBy(meta, local.description, local.error, local["aria-describedby"])}
          onInput={(event) => {
            const value = event.currentTarget.valueAsNumber;
            local.onValueChange?.(Number.isNaN(value) ? null : value);
          }}
        />
      </div>
    </Field>
  );
}
