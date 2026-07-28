import { createEffect, createSignal, type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";

export type NumberInputProps = Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  "max" | "min" | "onChange" | "onInput" | "prefix" | "step" | "type" | "value"
> & {
  value?: number | null;
  onValueChange?: (value: number | null) => void;
  onChange?: (value: number | null) => void;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  max?: number;
  min?: number;
  step?: number;
  decimalPlaces?: number;
  allowNegative?: boolean;
  clearable?: boolean;
  onClear?: () => void;
  clearLabel?: string;
  showSteppers?: boolean;
  disableSteppers?: boolean;
  icon?: string;
  activeIcon?: string;
  prefix?: JSX.Element;
  suffix?: JSX.Element;
};

export function NumberInput(props: NumberInputProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "activeIcon",
    "allowNegative",
    "aria-describedby",
    "class",
    "clearLabel",
    "clearable",
    "decimalPlaces",
    "description",
    "disableSteppers",
    "error",
    "icon",
    "id",
    "label",
    "max",
    "min",
    "onChange",
    "onClear",
    "onValueChange",
    "prefix",
    "required",
    "showSteppers",
    "step",
    "suffix",
    "value",
  ]);
  const meta = createFieldMeta(local.id);
  const [focused, setFocused] = createSignal(false);
  const [raw, setRaw] = createSignal(local.value == null ? "" : String(local.value));
  const places = () => Math.max(0, local.decimalPlaces ?? 0);
  const min = () => local.min ?? -Infinity;
  const max = () => local.max ?? Infinity;
  const step = () => local.step ?? 1;

  const filter = (value: string) => {
    let output = "";
    let decimal = false;
    for (const character of value.replace(/,/g, ".")) {
      if (/\d/.test(character)) output += character;
      else if (character === "-" && output === "" && (local.allowNegative ?? true)) output += character;
      else if (character === "." && !decimal && places() > 0) {
        output += character;
        decimal = true;
      }
    }
    if (decimal) {
      const [integer = "", fraction = ""] = output.split(".");
      return `${integer}.${fraction.slice(0, places())}`;
    }
    return output;
  };
  const parse = (value: string) => {
    if (!value || value === "-" || value === ".") return null;
    const number = places() === 0 ? Number.parseInt(value, 10) : Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const normalize = (value: number | null) => {
    if (value === null) return null;
    const clamped = Math.max(min(), Math.min(max(), value));
    const anchor = Number.isFinite(min()) ? min() : 0;
    const snapped = step() > 0 ? Math.round((clamped - anchor) / step()) * step() + anchor : clamped;
    return places() === 0 ? Math.round(snapped) : Number(snapped.toFixed(places()));
  };
  const emit = (value: number | null, commit = false) => {
    local.onValueChange?.(value);
    if (commit) local.onChange?.(value);
  };
  const commit = (value: number | null) => {
    const next = normalize(value);
    setRaw(next === null ? "" : String(next));
    emit(next, true);
  };
  const stepBy = (direction: number) => {
    if (rest.disabled || local.disableSteppers) return;
    const seed = local.value ?? (Number.isFinite(min()) ? min() : 0);
    commit(seed + direction * step());
  };

  createEffect(() => {
    if (focused()) return;
    const next = local.value == null ? "" : String(local.value);
    if (parse(raw()) !== local.value) setRaw(next);
  });

  return (
    <Field
      class={local.class}
      label={local.label}
      description={local.description}
      error={local.error}
      meta={meta}
      required={local.required}
    >
      <div class="k2b-number-input" data-disabled={rest.disabled ? "true" : undefined}>
        <Show when={local.showSteppers ?? true}>
          <button
            type="button"
            class="k2b-number-input__step"
            aria-label="Decrease value"
            disabled={rest.disabled || local.disableSteppers || (local.value !== null && local.value !== undefined && local.value <= min())}
            onClick={() => stepBy(-1)}
          >
            <i class="ti ti-minus" aria-hidden="true" />
          </button>
        </Show>
        <div class="k2b-input-shell" data-invalid={local.error ? "true" : undefined}>
          <Show when={local.icon}>
            <span class="k2b-input-shell__icon k2b-text-input__icon" aria-hidden="true">
              <i class={local.icon} />
              <i class={local.activeIcon ?? local.icon} />
            </span>
          </Show>
          <Show when={local.prefix}>
            <span class="k2b-input-shell__affix">{local.prefix}</span>
          </Show>
          <input
            {...rest}
            id={meta.controlId}
            class="k2b-input k2b-number-input__control"
            type="text"
            role="spinbutton"
            inputmode={places() === 0 ? "numeric" : "decimal"}
            value={raw()}
            required={local.required}
            aria-invalid={local.error ? "true" : undefined}
            aria-describedby={fieldDescribedBy(meta, local.description, local.error, local["aria-describedby"])}
            aria-valuemin={Number.isFinite(min()) ? min() : undefined}
            aria-valuemax={Number.isFinite(max()) ? max() : undefined}
            aria-valuenow={local.value ?? undefined}
            onFocus={() => setFocused(true)}
            onInput={(event) => {
              const next = filter(event.currentTarget.value);
              event.currentTarget.value = next;
              setRaw(next);
              emit(parse(next));
            }}
            onBlur={() => {
              commit(parse(raw()));
              setFocused(false);
            }}
          />
          <Show when={local.suffix && raw()}>
            <span class="k2b-input-shell__affix">{local.suffix}</span>
          </Show>
          <Show when={local.clearable && raw() && !rest.disabled && !rest.readOnly}>
            <button
              type="button"
              class="k2b-input-shell__clear"
              aria-label={local.clearLabel ?? "Clear"}
              onClick={() => (local.onClear ? local.onClear() : commit(null))}
            >
              <i class="ti ti-x" aria-hidden="true" />
            </button>
          </Show>
        </div>
        <Show when={local.showSteppers ?? true}>
          <button
            type="button"
            class="k2b-number-input__step"
            aria-label="Increase value"
            disabled={rest.disabled || local.disableSteppers || (local.value !== null && local.value !== undefined && local.value >= max())}
            onClick={() => stepBy(1)}
          >
            <i class="ti ti-plus" aria-hidden="true" />
          </button>
        </Show>
      </div>
    </Field>
  );
}
