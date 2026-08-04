import { createEffect, type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, fieldControlAria } from "../internal/field";
import type { ValueFieldProps } from "./field-contract";
import { commitFieldValue, resolveMaybeAccessor } from "./field-contract";

export type CheckboxProps = ValueFieldProps<boolean> & {
  /** Visual and accessible mixed state for partial bulk selections. */
  indeterminate?: boolean;
  name?: string;
};

export function Checkbox(props: CheckboxProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "description",
    "error",
    "id",
    "indeterminate",
    "label",
    "onValueChange",
    "onValueCommit",
    "value",
  ]);
  const meta = createFieldMeta(local.id);
  const checked = () => resolveMaybeAccessor(local.value) ?? false;
  const error = () => resolveMaybeAccessor(local.error);
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (inputRef) inputRef.indeterminate = local.indeterminate ?? false;
  });

  return (
    <div
      class={`k2b-check-field ${rest.class ?? ""}`}
      data-disabled={rest.disabled ? "true" : undefined}
      data-invalid={error() ? "true" : undefined}
    >
      <label class="k2b-check" data-indeterminate={local.indeterminate ? "true" : undefined}>
        <input
          ref={inputRef}
          id={meta.controlId}
          type="checkbox"
          name={props.name}
          checked={checked()}
          disabled={rest.disabled}
          required={rest.required}
          aria-checked={local.indeterminate ? "mixed" : checked()}
          {...fieldControlAria(meta, props)}
          onChange={(event) => commitFieldValue(local, event.currentTarget.checked)}
        />
        <span class="k2b-check__control" aria-hidden="true">
          <i class={local.indeterminate ? "ti ti-minus" : "ti ti-check"} />
        </span>
        <Show when={local.label || local.description}>
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
        </Show>
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
