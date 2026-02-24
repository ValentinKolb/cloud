import { InputWrapper } from "./util";

type NumberInputProps = {
  label?: string;
  description?: string;
  placeholder?: string;
  value?: () => number | undefined;
  onChange?: (value: number) => void;
  onInput?: (value: number) => void;
  error?: () => string | undefined;
  max?: number;
  min?: number;
  step?: number;
  required?: boolean;
  disabled?: boolean;
};

/**
 * Number input component with increment/decrement buttons
 * @param label - Optional label text
 * @param description - Optional description text
 * @param placeholder - Placeholder text
 * @param value - Reactive number value getter
 * @param onChange - Called on change event
 * @param onInput - Called on input event
 * @param error - Reactive error message getter
 * @param max - Maximum allowed value (default: Infinity)
 * @param min - Minimum allowed value (default: -Infinity)
 * @param step - Step increment/decrement amount (default: 1)
 * @param required - Show required asterisk after label
 * @param disabled - Disable the input
 */
const NumberInput = (props: NumberInputProps) => {
  const value = () => props.value?.() ?? 0;
  const max = () => props.max ?? Infinity;
  const min = () => props.min ?? -Infinity;
  const step = () => props.step ?? 1;
  const disabled = () => props.disabled ?? false;

  const parse = (val: string, applyConstraints: boolean = true) => {
    const parsed = parseInt(val);
    if (isNaN(parsed)) return min();
    return applyConstraints ? Math.max(min(), Math.min(max(), parsed)) : parsed;
  };

  return (
    <InputWrapper label={props.label} description={props.description} error={props.error} required={props.required}>
      {({ inputId, ariaDescribedBy }) => (
        <div class={`flex flex-row flex-nowrap gap-3 text-nowrap ${disabled() ? "opacity-50" : ""}`}>
          <button
            type="button"
            class={`input-subtle ti ti-minus px-3 cursor-pointer hover:text-primary ${value() <= min() && "opacity-40"}`}
            aria-label="Decrease value"
            onClick={() => {
              const v = Math.max(min(), value() - step());
              props.onChange?.(v);
              props.onInput?.(v);
            }}
            disabled={disabled() || value() <= min()}
          />
          <div class="group relative flex-1">
            <input
              id={inputId}
              type="number"
              class={`input-subtle w-full text-center font-mono font-semibold ${disabled() ? "cursor-not-allowed" : ""}`}
              placeholder={props.placeholder}
              value={value()}
              onChange={(e) => {
                const v = parse(e.currentTarget.value, true);
                props.onChange?.(v);
                e.currentTarget.value = `${v}`;
              }}
              onInput={(e) => {
                const v = parse(e.currentTarget.value, false);
                props.onInput?.(v);
              }}
              disabled={disabled()}
              aria-label={!props.label ? props.placeholder || "Enter number" : undefined}
              aria-describedby={ariaDescribedBy}
              aria-invalid={!!props.error?.()}
              aria-required={props.required}
              aria-disabled={disabled()}
              aria-valuemin={min()}
              aria-valuemax={max()}
              aria-valuenow={value()}
            />
          </div>

          <button
            type="button"
            class={`input-subtle ti ti-plus px-3 cursor-pointer hover:text-primary ${value() >= max() && "opacity-40"}`}
            aria-label="Increase value"
            onClick={() => {
              const v = Math.min(max(), value() + step());
              props.onChange?.(v);
              props.onInput?.(v);
            }}
            disabled={disabled() || value() >= max()}
          />
        </div>
      )}
    </InputWrapper>
  );
};

export default NumberInput;
