import { type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, fieldDescribedBy } from "../internal/field";

export type CheckboxProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange" | "type"> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
};

export function Checkbox(props: CheckboxProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "aria-describedby",
    "checked",
    "class",
    "description",
    "error",
    "id",
    "label",
    "onCheckedChange",
  ]);
  const meta = createFieldMeta(local.id);

  return (
    <div class={`k2b-check-field ${local.class ?? ""}`}>
      <label class="k2b-check">
        <input
          {...rest}
          id={meta.controlId}
          type="checkbox"
          checked={local.checked}
          aria-invalid={local.error ? "true" : undefined}
          aria-describedby={fieldDescribedBy(meta, local.description, local.error, local["aria-describedby"])}
          onChange={(event) => local.onCheckedChange?.(event.currentTarget.checked)}
        />
        <span class="k2b-check__control" aria-hidden="true">
          <i class="ti ti-check" />
        </span>
        <span class="k2b-check__content">
          <span class="k2b-check__label">{local.label}</span>
          <Show when={local.description}>
            <span class="k2b-field__description" id={meta.descriptionId}>
              {local.description}
            </span>
          </Show>
        </span>
      </label>
      <Show when={local.error}>
        <p class="k2b-field__error" id={meta.errorId}>
          {local.error}
        </p>
      </Show>
    </div>
  );
}
