import { type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, fieldControlAria } from "../internal/field";
import type { ValueFieldProps } from "./field-contract";
import { commitFieldValue, resolveMaybeAccessor } from "./field-contract";

export type CheckboxCardProps = Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  "checked" | "onChange" | "type" | "value" | keyof ValueFieldProps<boolean>
> &
  ValueFieldProps<boolean> & {
  icon?: string;
  color?: string;
  variant?: "card" | "input";
};

const validHexColor = (color: string | undefined): string | undefined =>
  color && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim()) ? color.trim() : undefined;

export function CheckboxCard(props: CheckboxCardProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "aria-describedby",
    "class",
    "color",
    "description",
    "error",
    "id",
    "icon",
    "label",
    "onValueChange",
    "onValueCommit",
    "value",
    "variant",
  ]);
  const meta = createFieldMeta(local.id);
  const color = () => validHexColor(local.color);
  const checked = () => resolveMaybeAccessor(local.value) ?? false;
  const error = () => resolveMaybeAccessor(local.error);

  return (
    <div class={`k2b-checkbox-card-field ${local.class ?? ""}`}>
      <label
        class="k2b-checkbox-card"
        data-state={error() ? "invalid" : checked() ? "checked" : "idle"}
        data-variant={local.variant ?? "card"}
      >
        <input
          {...rest}
          id={meta.controlId}
          type="checkbox"
          checked={checked()}
          {...fieldControlAria(meta, props)}
          onChange={(event) => commitFieldValue(local, event.currentTarget.checked)}
        />
        <span class="k2b-checkbox-card__control" aria-hidden="true">
          <i class="ti ti-check" />
        </span>
        <span class="k2b-checkbox-card__content">
          <span id={meta.labelId} class="k2b-checkbox-card__label">
            {/* The icon / colour dot lives inside the label row (as in Cloud) so a card
                without one does not reserve an empty grid column plus its gap. */}
            <Show
              when={local.icon}
              fallback={
                <Show when={color()}>{(value) => <span class="k2b-checkbox-card__color" style={{ background: value() }} />}</Show>
              }
            >
              {(icon) => <i class={`k2b-checkbox-card__icon ${icon()}`} aria-hidden="true" />}
            </Show>
            <span class="k2b-checkbox-card__text">{local.label}</span>
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

export default CheckboxCard;
