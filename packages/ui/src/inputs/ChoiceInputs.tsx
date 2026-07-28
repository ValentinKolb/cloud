import { For, type JSX, Show, splitProps } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";

type ChoiceFieldProps = {
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  class?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
};

export type PinInputProps = ChoiceFieldProps & {
  value?: string | null;
  onValueChange?: (value: string) => void;
  length?: number;
  name?: string;
  stretch?: boolean;
};

export function PinInput(props: PinInputProps): JSX.Element {
  const meta = createFieldMeta(props.id);
  const length = () => Math.max(1, props.length ?? 6);
  let inputs: HTMLInputElement[] = [];
  const digits = () => (props.value ?? "").replace(/\D/g, "").slice(0, length());

  const updateDigit = (index: number, input: string) => {
    if (props.disabled) return;
    const digit = input.replace(/\D/g, "").slice(-1);
    const current = digits();
    props.onValueChange?.(`${current.slice(0, index)}${digit}${current.slice(index + 1)}`);
    if (digit && index < length() - 1) {
      inputs[index + 1]?.focus();
      inputs[index + 1]?.select();
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent) => {
    if (props.disabled) return;
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputs[index - 1]?.focus();
      inputs[index - 1]?.select();
    } else if (event.key === "ArrowRight" && index < length() - 1) {
      event.preventDefault();
      inputs[index + 1]?.focus();
      inputs[index + 1]?.select();
    } else if (event.key === "Backspace" && !digits()[index] && index > 0) {
      event.preventDefault();
      const current = digits();
      props.onValueChange?.(`${current.slice(0, index - 1)}${current.slice(index)}`);
      inputs[index - 1]?.focus();
      inputs[index - 1]?.select();
    }
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (props.disabled) return;
    const pasted = event.clipboardData?.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();
    const focused = inputs.indexOf(document.activeElement as HTMLInputElement);
    const start = focused >= 0 ? focused : 0;
    const insert = pasted.slice(0, length() - start);
    const current = digits();
    props.onValueChange?.(`${current.slice(0, start)}${insert}${current.slice(start + insert.length)}`.slice(0, length()));
    const next = Math.min(start + insert.length, length() - 1);
    inputs[next]?.focus();
    inputs[next]?.select();
  };

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error}
      meta={meta}
      required={props.required}
    >
      <div
        class="k2b-pin-input"
        data-stretch={props.stretch ? "true" : undefined}
        role="group"
        aria-describedby={fieldDescribedBy(meta, props.description, props.error)}
        onPaste={handlePaste}
      >
        <For each={Array.from({ length: length() })}>
          {(_, index) => (
            <input
              ref={(element) => {
                inputs[index()] = element;
              }}
              id={index() === 0 ? meta.controlId : undefined}
              class="k2b-control k2b-pin-input__digit"
              name={index() === 0 ? props.name : undefined}
              type="text"
              inputmode="numeric"
              autocomplete={index() === 0 ? "one-time-code" : "off"}
              pattern="[0-9]"
              maxlength={1}
              value={digits()[index()] ?? ""}
              required={index() === 0 ? props.required : undefined}
              disabled={props.disabled}
              aria-label={`Digit ${index() + 1} of ${length()}`}
              aria-invalid={props.error ? "true" : undefined}
              onInput={(event) => updateDigit(index(), event.currentTarget.value)}
              onKeyDown={(event) => handleKeyDown(index(), event)}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </For>
      </div>
    </Field>
  );
}

export type SliderProps = ChoiceFieldProps &
  Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onInput"> & {
    value?: number;
    onValueChange?: (value: number) => void;
    valueLabel?: (value: number) => string;
    showValue?: boolean;
    center?: boolean;
    defaultValue?: number;
  };

export function Slider(props: SliderProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "center",
    "class",
    "defaultValue",
    "description",
    "error",
    "id",
    "label",
    "onValueChange",
    "showValue",
    "value",
    "valueLabel",
  ]);
  const meta = createFieldMeta(local.id);
  const min = () => Number(rest.min ?? 0);
  const max = () => Number(rest.max ?? 100);
  const value = () => local.value ?? min();
  const percentage = () => {
    const span = max() - min();
    return span <= 0 ? 0 : Math.min(100, Math.max(0, ((value() - min()) / span) * 100));
  };
  const track = () => {
    const position = percentage();
    if (local.center) {
      const low = Math.min(50, position);
      const high = Math.max(50, position);
      return `linear-gradient(to right, var(--k2b-surface-muted) 0 ${low}%, var(--k2b-action) ${low}% ${high}%, var(--k2b-surface-muted) ${high}% 100%)`;
    }
    return `linear-gradient(to right, var(--k2b-action) 0 ${position}%, var(--k2b-surface-muted) ${position}% 100%)`;
  };
  const resetValue = () => local.defaultValue ?? (local.center ? (min() + max()) / 2 : min());

  return (
    <Field
      class={local.class}
      label={local.label}
      description={local.description}
      error={local.error}
      meta={meta}
      required={rest.required}
    >
      <div class="k2b-slider">
        <input
          {...rest}
          id={meta.controlId}
          type="range"
          value={value()}
          style={{ background: track() }}
          aria-describedby={fieldDescribedBy(meta, local.description, local.error, rest["aria-describedby"])}
          aria-invalid={local.error ? "true" : undefined}
          onInput={(event) => local.onValueChange?.(event.currentTarget.valueAsNumber)}
          onDblClick={() => local.onValueChange?.(resetValue())}
        />
        <Show when={local.showValue ?? true}>
          <output for={meta.controlId}>{local.valueLabel?.(value()) ?? value()}</output>
        </Show>
      </div>
    </Field>
  );
}

export type ColorInputProps = ChoiceFieldProps & {
  value?: string | null;
  onValueChange?: (value: string) => void;
  name?: string;
  compact?: boolean;
  transparent?: boolean;
  isTransparent?: boolean;
  onTransparentChange?: (value: boolean) => void;
};

export function ColorInput(props: ColorInputProps): JSX.Element {
  const meta = createFieldMeta(props.id);
  const currentColor = () => props.value || "#3b82f6";
  const compact = () => props.compact ?? !props.label;
  let picker: HTMLInputElement | undefined;

  if (compact()) {
    return (
      <span class={`k2b-color-input k2b-color-input--compact ${props.class ?? ""}`}>
        <button
          type="button"
          class="k2b-color-input__swatch"
          style={{ "background-color": currentColor() }}
          disabled={props.disabled}
          aria-label={typeof props.label === "string" ? props.label : "Choose color"}
          onClick={() => picker?.click()}
        />
        <input
          ref={picker}
          id={meta.controlId}
          class="k2b-color-input__native"
          type="color"
          name={props.name}
          value={currentColor()}
          disabled={props.disabled}
          onInput={(event) => props.onValueChange?.(event.currentTarget.value)}
        />
      </span>
    );
  }

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error}
      meta={meta}
      required={props.required}
    >
      <div
        class="k2b-color-input k2b-color-input--full"
        data-disabled={props.disabled || props.isTransparent ? "true" : undefined}
      >
        <button
          type="button"
          class="k2b-color-input__value"
          disabled={props.disabled || props.isTransparent}
          aria-describedby={fieldDescribedBy(meta, props.description, props.error)}
          aria-invalid={props.error ? "true" : undefined}
          onClick={() => picker?.click()}
        >
          <span
            class="k2b-color-input__swatch"
            data-transparent={props.isTransparent ? "true" : undefined}
            style={props.isTransparent ? undefined : { "background-color": currentColor() }}
          />
          <code>{props.isTransparent ? "transparent" : currentColor().toUpperCase()}</code>
        </button>
        <Show when={props.transparent}>
          <button
            type="button"
            class="k2b-color-input__transparent"
            aria-label={props.isTransparent ? "Use a color" : "Use transparent"}
            aria-pressed={props.isTransparent}
            disabled={props.disabled}
            onClick={() => props.onTransparentChange?.(!props.isTransparent)}
          >
            <i class="ti ti-grid-dots" aria-hidden="true" />
          </button>
        </Show>
        <input
          ref={picker}
          id={meta.controlId}
          class="k2b-color-input__native"
          type="color"
          name={props.name}
          value={currentColor()}
          disabled={props.disabled || props.isTransparent}
          onInput={(event) => props.onValueChange?.(event.currentTarget.value)}
        />
      </div>
    </Field>
  );
}
