import { createUniqueId, type JSX, Show } from "solid-js";
import type { FieldProps } from "../inputs/field-contract";
import { resolveMaybeAccessor } from "../inputs/field-contract";

export type FieldMeta = {
  controlId: string;
  labelId: string;
  descriptionId: string;
  errorId: string;
};

export const createFieldMeta = (id?: string): FieldMeta => {
  const generatedId = createUniqueId();
  const controlId = id ?? `k2b-field-${generatedId}`;

  return {
    controlId,
    labelId: `${controlId}-label`,
    descriptionId: `${controlId}-description`,
    errorId: `${controlId}-error`,
  };
};

type FieldLayoutProps = {
  children: JSX.Element;
  meta: FieldMeta;
  fill?: boolean;
} & Pick<FieldProps, "class" | "description" | "error" | "label" | "required" | "disabled">;

export function Field(props: FieldLayoutProps): JSX.Element {
  const error = () => resolveMaybeAccessor(props.error);

  return (
    <div
      class={`k2b-field ${props.class ?? ""}`}
      data-disabled={props.disabled ? "true" : undefined}
      data-fill={props.fill ? "true" : undefined}
      data-invalid={error() ? "true" : undefined}
    >
      <Show when={props.label}>
        <label id={props.meta.labelId} class="k2b-field__label" for={props.meta.controlId}>
          {props.label}
          <Show when={props.required}>
            <span class="k2b-field__required" aria-hidden="true">
              *
            </span>
          </Show>
        </label>
      </Show>
      <Show when={props.description}>
        <p class="k2b-field__description" id={props.meta.descriptionId}>
          {props.description}
        </p>
      </Show>
      {props.children}
      <Show when={error()}>
        <p class="k2b-field__error" id={props.meta.errorId} role="alert" aria-live="polite">
          {error()}
        </p>
      </Show>
    </div>
  );
}

type FieldAriaOwner = Pick<FieldProps, "aria-describedby" | "aria-label" | "description" | "error" | "label" | "required">;

export const fieldDescribedBy = (meta: FieldMeta, owner: FieldAriaOwner): string | undefined =>
  [
    owner["aria-describedby"],
    owner.description ? meta.descriptionId : undefined,
    resolveMaybeAccessor(owner.error) ? meta.errorId : undefined,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

export const fieldControlAria = (meta: FieldMeta, owner: FieldAriaOwner) => ({
  get "aria-label"() {
    return owner.label ? undefined : owner["aria-label"];
  },
  get "aria-labelledby"() {
    return owner.label ? meta.labelId : undefined;
  },
  get "aria-describedby"() {
    return fieldDescribedBy(meta, owner);
  },
  get "aria-invalid"() {
    return resolveMaybeAccessor(owner.error) ? ("true" as const) : undefined;
  },
  get "aria-required"() {
    return owner.required || undefined;
  },
});
