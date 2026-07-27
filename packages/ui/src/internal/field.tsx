import { createUniqueId, type JSX, Show } from "solid-js";

type FieldMeta = {
  controlId: string;
  descriptionId: string;
  errorId: string;
};

export const createFieldMeta = (id?: string): FieldMeta => {
  const generatedId = createUniqueId();
  const controlId = id ?? `k2b-field-${generatedId}`;

  return {
    controlId,
    descriptionId: `${controlId}-description`,
    errorId: `${controlId}-error`,
  };
};

type FieldProps = {
  children: JSX.Element;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  meta: FieldMeta;
  required?: boolean;
  class?: string;
};

export function Field(props: FieldProps): JSX.Element {
  return (
    <div class={`k2b-field ${props.class ?? ""}`} data-invalid={props.error ? "true" : undefined}>
      <Show when={props.label}>
        <label class="k2b-field__label" for={props.meta.controlId}>
          {props.label}
          <Show when={props.required}>
            <span class="k2b-field__required" aria-hidden="true">
              *
            </span>
          </Show>
        </label>
      </Show>
      {props.children}
      <Show when={props.description}>
        <p class="k2b-field__description" id={props.meta.descriptionId}>
          {props.description}
        </p>
      </Show>
      <Show when={props.error}>
        <p class="k2b-field__error" id={props.meta.errorId} role="alert" aria-live="polite">
          {props.error}
        </p>
      </Show>
    </div>
  );
}

export const fieldDescribedBy = (
  meta: FieldMeta,
  description: JSX.Element | undefined,
  error: JSX.Element | undefined,
  describedBy?: string,
): string | undefined =>
  [describedBy, description ? meta.descriptionId : undefined, error ? meta.errorId : undefined].filter(Boolean).join(" ") || undefined;
