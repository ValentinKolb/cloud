import { type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, fieldControlAria } from "../internal/field";
import type { ValueFieldProps } from "./field-contract";
import { commitFieldValue, resolveMaybeAccessor } from "./field-contract";

export type SwitchProps = ValueFieldProps<boolean> & {
  name?: string;
};

export function Switch(props: SwitchProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "label",
    "onValueChange",
    "onValueCommit",
    "value",
  ]);
  const meta = createFieldMeta(props.id);
  const checked = () => resolveMaybeAccessor(local.value) ?? false;
  const error = () => resolveMaybeAccessor(props.error);

  return (
    <div
      class={`k2b-switch-field ${props.class ?? ""}`}
      data-disabled={rest.disabled ? "true" : undefined}
      data-invalid={error() ? "true" : undefined}
    >
      <label class="k2b-switch">
        <input
          id={meta.controlId}
          name={props.name}
          type="checkbox"
          role="switch"
          checked={checked()}
          disabled={rest.disabled}
          required={rest.required}
          {...fieldControlAria(meta, props)}
          onChange={(event) => commitFieldValue(local, event.currentTarget.checked)}
        />
        <span class="k2b-switch__track" aria-hidden="true">
          <span class="k2b-switch__thumb" />
        </span>
        {local.label && (
          <span id={meta.labelId} class="k2b-switch__label">
            {local.label}
            <Show when={rest.required}>
              <span class="k2b-field__required" aria-hidden="true">*</span>
            </Show>
          </span>
        )}
      </label>
      <Show when={props.description}>
        <span id={meta.descriptionId} class="k2b-field__description">{props.description}</span>
      </Show>
      <Show when={error()}>
        <p id={meta.errorId} class="k2b-field__error" role="alert" aria-live="polite">{error()}</p>
      </Show>
    </div>
  );
}

export default Switch;
