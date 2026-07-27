import { type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, fieldDescribedBy } from "../internal/field";

export type SwitchProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange" | "type"> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
};

export function Switch(props: SwitchProps): JSX.Element {
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
    <div class={`k2b-switch-field ${local.class ?? ""}`}>
      <label class="k2b-switch">
        <span class="k2b-switch__content">
          <span class="k2b-switch__label">
            {local.label}
            <Show when={rest.required}>
              <span class="k2b-field__required" aria-hidden="true">
                *
              </span>
            </Show>
          </span>
          <Show when={local.description}>
            <span class="k2b-field__description" id={meta.descriptionId}>
              {local.description}
            </span>
          </Show>
        </span>
        <input
          {...rest}
          id={meta.controlId}
          type="checkbox"
          role="switch"
          checked={local.checked}
          aria-invalid={local.error ? "true" : undefined}
          aria-describedby={fieldDescribedBy(meta, local.description, local.error, local["aria-describedby"])}
          onChange={(event) => local.onCheckedChange?.(event.currentTarget.checked)}
        />
        <span class="k2b-switch__track" aria-hidden="true">
          <span class="k2b-switch__thumb" />
        </span>
      </label>
      <Show when={local.error}>
        <p class="k2b-field__error" id={meta.errorId} role="alert" aria-live="polite">
          {local.error}
        </p>
      </Show>
    </div>
  );
}
