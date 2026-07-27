import { type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, fieldDescribedBy } from "../internal/field";

export type CheckboxCardProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange" | "type"> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  icon?: string;
  color?: string;
  variant?: "card" | "input";
};

const validHexColor = (color: string | undefined): string | undefined =>
  color && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim()) ? color.trim() : undefined;

export function CheckboxCard(props: CheckboxCardProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "aria-describedby",
    "checked",
    "class",
    "color",
    "description",
    "error",
    "icon",
    "id",
    "label",
    "onCheckedChange",
    "variant",
  ]);
  const meta = createFieldMeta(local.id);
  const color = () => validHexColor(local.color);

  return (
    <div class={`k2b-checkbox-card-field ${local.class ?? ""}`}>
      <label
        class="k2b-checkbox-card"
        data-state={local.error ? "invalid" : local.checked ? "checked" : "idle"}
        data-variant={local.variant ?? "card"}
      >
        <input
          {...rest}
          id={meta.controlId}
          type="checkbox"
          checked={local.checked}
          aria-invalid={local.error ? "true" : undefined}
          aria-describedby={fieldDescribedBy(meta, local.description, local.error, local["aria-describedby"])}
          onChange={(event) => local.onCheckedChange?.(event.currentTarget.checked)}
        />
        <span class="k2b-checkbox-card__control" aria-hidden="true">
          <i class="ti ti-check" />
        </span>
        <Show
          when={local.icon}
          fallback={<Show when={color()}>{(value) => <span class="k2b-checkbox-card__color" style={{ background: value() }} />}</Show>}
        >
          {(icon) => <i class={`k2b-checkbox-card__icon ${icon()}`} aria-hidden="true" />}
        </Show>
        <span class="k2b-checkbox-card__content">
          <span class="k2b-checkbox-card__label">
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
      <Show when={local.error}>
        <p class="k2b-field__error" id={meta.errorId} role="alert" aria-live="polite">
          {local.error}
        </p>
      </Show>
    </div>
  );
}
