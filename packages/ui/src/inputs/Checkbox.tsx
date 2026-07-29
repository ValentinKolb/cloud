import { type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, fieldControlAria } from "../internal/field";
import type { ValueFieldProps } from "./field-contract";
import { commitFieldValue, resolveMaybeAccessor } from "./field-contract";

export type CheckboxProps = ValueFieldProps<boolean> & {
  name?: string;
};

export function Checkbox(props: CheckboxProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "description",
    "error",
    "id",
    "label",
    "onValueChange",
    "onValueCommit",
    "value",
  ]);
  const meta = createFieldMeta(local.id);
  const checked = () => resolveMaybeAccessor(local.value) ?? false;
  const error = () => resolveMaybeAccessor(local.error);

  return (
    <div
      class={`k2b-check-field ${rest.class ?? ""}`}
      data-disabled={rest.disabled ? "true" : undefined}
      data-invalid={error() ? "true" : undefined}
    >
      <label class="k2b-check">
        <input
          id={meta.controlId}
          type="checkbox"
          name={props.name}
          checked={checked()}
          disabled={rest.disabled}
          {...fieldControlAria(meta, props)}
          onChange={(event) => commitFieldValue(local, event.currentTarget.checked)}
        />
        <span class="k2b-check__control" aria-hidden="true">
          <i class="ti ti-check" />
        </span>
        <span class="k2b-check__content">
          <span id={meta.labelId} class="k2b-check__label">
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
      </label>
      <Show when={error()}>
        <p class="k2b-field__error" id={meta.errorId} role="alert" aria-live="polite">
          {error()}
        </p>
      </Show>
    </div>
  );
}

export default Checkbox;
