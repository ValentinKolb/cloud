import { For, onMount } from "solid-js";
import { InputWrapper, createInputA11y } from "./util";

type PinInputProps = {
  label?: string;
  description?: string;
  length?: number;
  value?: () => string;
  onChange?: (value: string) => void;
  error?: () => string | undefined;
  disabled?: boolean;
  stretch?: boolean;
  required?: boolean;
};

/**
 * PIN input component with individual digit fields
 * @param label - Optional label text
 * @param description - Optional description text
 * @param length - Number of PIN digits (default: 6)
 * @param value - Reactive string value getter
 * @param onChange - Called when PIN value changes
 * @param error - Reactive error message getter
 * @param disabled - Disable all input fields
 * @param stretch - Make input fields stretch to full width
 * @param required - Show required asterisk after label
 */
const PinInput = ({
  label,
  description,
  length = 6,
  value,
  onChange,
  error,
  disabled = false,
  stretch = false,
  required = false,
}: PinInputProps) => {
  let inputRefs: HTMLInputElement[] = [];
  const a11y = createInputA11y({ description, error });

  const handleChange = (index: number, newValue: string) => {
    if (disabled) return;

    // Only allow single digits
    const digit = newValue.slice(-1).replace(/[^0-9]/g, "");

    const currentValue = value?.() || "";
    const before = currentValue.slice(0, index);
    const after = currentValue.slice(index + 1);

    onChange?.(before + digit + after);

    // Auto-focus next field
    if (digit && index < length - 1) {
      inputRefs[index + 1]?.focus();
      inputRefs[index + 1]?.select();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case "Backspace":
        const val = value?.() || "";
        if (!val[index] && index > 0) {
          e.preventDefault();
          // Move to previous field and delete its content
          const currentValue = val;
          const before = currentValue.slice(0, index - 1);
          const after = currentValue.slice(index);
          onChange?.(before + after);
          inputRefs[index - 1]?.focus();
        }
        break;

      case "ArrowLeft":
        e.preventDefault();
        if (index > 0) {
          inputRefs[index - 1]?.focus();
          inputRefs[index - 1]?.select();
        }
        break;

      case "ArrowRight":
        e.preventDefault();
        if (index < length - 1) {
          inputRefs[index + 1]?.focus();
          inputRefs[index + 1]?.select();
        }
        break;
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    if (disabled) return;

    const pastedData = e.clipboardData?.getData("text") || "";
    const pastedDigits = pastedData.replace(/[^0-9]/g, "");

    if (pastedDigits.length > 0) {
      const startIndex = inputRefs.findIndex((ref) => ref === document.activeElement);
      const index = startIndex >= 0 ? startIndex : 0;

      const currentValue = value?.() || "";
      const before = currentValue.slice(0, index);
      const pasted = pastedDigits.slice(0, length - index);
      const after = currentValue.slice(index + pasted.length);

      onChange?.(before + pasted + after);

      // Focus appropriate next field
      const nextIndex = Math.min(index + pasted.length, length - 1);
      inputRefs[nextIndex]?.focus();
      inputRefs[nextIndex]?.select();
    }
  };

  // Add paste listener on mount
  onMount(() => {
    const container = inputRefs[0]?.parentElement?.parentElement;
    if (container) {
      container.addEventListener("paste", handlePaste as any);
      return () => container.removeEventListener("paste", handlePaste as any);
    }
  });

  return (
    <InputWrapper
      label={label}
      description={description}
      error={error?.()}
      required={required}
      inputId={a11y.inputId}
      descriptionId={a11y.descriptionId}
      errorId={a11y.errorId}
    >
      <div class="flex gap-1 md:gap-2" role="group" aria-labelledby={a11y.inputId} aria-describedby={a11y.ariaDescribedBy()}>
          <For each={new Array(length).fill(0)}>
            {(_, index) => (
              <input
                ref={(el) => (inputRefs[index()] = el)}
                type="text"
                inputMode="numeric"
                pattern="[0-9]"
                maxLength={1}
                class={`input-subtle ${stretch ? "w-full" : "w-10"} text-center font-mono font-semibold transition-all ${
                  (value?.() || "")[index()] ? "bg-zinc-50 dark:bg-zinc-800 " : ""
                } ${disabled ? "cursor-not-allowed opacity-50" : ""} ${error?.() ? "ring-1 ring-red-500" : ""}`}
                value={(value?.() || "")[index()] || ""}
                onInput={(e) => handleChange(index(), e.currentTarget.value)}
                onKeyDown={(e) => handleKeyDown(index(), e)}
                onFocus={(e) => e.currentTarget.select()}
                disabled={disabled}
                aria-label={`PIN digit ${index() + 1} of ${length}`}
                aria-invalid={!!error?.()}
                aria-required={index() === 0 ? required : undefined}
                autocomplete="off"
              />
            )}
          </For>
      </div>
    </InputWrapper>
  );
};

export default PinInput;
