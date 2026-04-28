import type { CheckboxInputProps } from "./types";

/**
 * Checkbox/Boolean input component
 * @param label - Text displayed next to checkbox
 * @param description - Optional description text below
 * @param value - Reactive boolean value getter
 * @param onChange - Called when checkbox state changes
 * @param error - Reactive error message getter
 * @param required - Show required asterisk
 * @param disabled - Disable the checkbox
 */
const CheckboxInput = ({ label, description, value, onChange, error, required = false, disabled = false }: CheckboxInputProps) => {
  const inputId = crypto.randomUUID();

  return (
    <div class="flex flex-col gap-2 select-none">
      <div class="flex flex-row items-center gap-2">
        <input
          id={inputId}
          type="checkbox"
          checked={value?.() || false}
          onChange={(e) => onChange?.(e.target.checked)}
          disabled={disabled}
          aria-required={required}
          aria-invalid={!!error?.()}
          aria-describedby={error?.() ? `${inputId}-error` : undefined}
          class="h-4 w-4"
        />
        {label && (
          <label for={inputId} class={`text-xs select-none ${disabled ? "opacity-50" : "cursor-pointer"}`}>
            {label}
            {required && (
              <span class="ml-0.5 text-red-500" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
      </div>

      {description && <p class="text-dimmed ml-6 text-xs">{description}</p>}

      {error?.() && (
        <p id={`${inputId}-error`} class="ml-6 text-sm text-red-500" role="alert" aria-live="polite">
          {error()}
        </p>
      )}
    </div>
  );
};

export { CheckboxInput };
export const Checkbox = CheckboxInput;
export default CheckboxInput;
