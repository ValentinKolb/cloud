import { createSignal } from "solid-js";
import { InputWrapper, createInputA11y } from "./util";

type TextInputProps = {
  name?: string;
  label?: string;
  description?: string;
  placeholder?: string;
  ariaLabel?: string;
  type?: "text" | "search" | "email" | "url" | "tel";
  icon?: string;
  activeIcon?: string;
  value?: () => string | undefined | null;
  onChange?: (value: string) => void;
  onInput?: (value: string) => void;
  clearable?: boolean;
  onClear?: () => void;
  clearLabel?: string;
  error?: () => string | undefined;
  multiline?: boolean;
  required?: boolean;
  disabled?: boolean;
  password?: boolean;
  /**
   * Enable markdown mode.
   * When true, automatically enables multiline mode and sets default icon to markdown.
   */
  markdown?: boolean;
  /**
   * Called when Enter is pressed (without Shift/Cmd) in multiline mode.
   * Useful for submitting forms with Enter while keeping Shift+Enter for newlines.
   */
  onSubmit?: () => void;
  /** Approximate visible lines for multiline mode. Overrides default height. */
  lines?: number;
};

/**
 * Text input component with optional multiline support
 * @param label - Optional label text
 * @param description - Optional description text
 * @param placeholder - Placeholder text
 * @param icon - Icon shown when not focused
 * @param activeIcon - Icon shown when focused
 * @param value - Reactive value getter
 * @param onChange - Called on change event
 * @param onInput - Called on input event
 * @param error - Reactive error message getter
 * @param multiline - Enable textarea mode
 * @param required - Show required asterisk after label
 * @param disabled - Disable the input
 * @param markdown - Enable markdown mode (implies multiline, shows markdown icon)
 */
const TextInput = (props: TextInputProps) => {
  const markdown = () => props.markdown ?? false;
  const icon = () => props.icon ?? (markdown() ? "ti ti-markdown" : "ti ti-cursor-text");
  const activeIcon = () => props.activeIcon ?? "ti ti-pencil";
  const multiline = () => props.multiline ?? markdown(); // markdown implies multiline
  const disabled = () => props.disabled ?? false;
  const canClear = () => props.clearable && !multiline() && !props.password && !disabled();
  const currentValue = () => props.value?.() ?? "";
  const hasValue = () => currentValue().length > 0;
  const [showPassword, setShowPassword] = createSignal(false);
  const a11y = createInputA11y({ description: props.description, error: props.error, inputId: props.name });

  const handleClear = () => {
    if (props.onClear) {
      props.onClear();
      return;
    }
    props.onInput?.("");
    props.onChange?.("");
  };

  return (
    <InputWrapper
      label={props.label}
      description={props.description}
      error={props.error?.()}
      required={props.required}
      inputId={a11y.inputId}
      descriptionId={a11y.descriptionId}
      errorId={a11y.errorId}
    >
      <div class="group relative flex">
        <div
          class={`absolute left-3 z-10 flex pointer-events-none text-zinc-400 dark:text-zinc-500 ${
            multiline() ? "top-2.5" : "inset-y-0 items-center"
          }`}
        >
          <i class={`${icon()} group-focus-within:hidden`} />
          <i class={`${activeIcon()} hidden text-blue-500 group-focus-within:block`} />
        </div>
        {multiline() ? (
          <textarea
            id={a11y.inputId}
            name={props.name}
            class={`input w-full pl-9 ${disabled() ? "cursor-not-allowed opacity-50" : ""}`}
            style={props.lines ? `min-height: ${props.lines * 1.5}em; max-height: ${Math.max(props.lines * 1.5, 20)}em` : "min-height: 3.75rem; height: 5rem; max-height: 12.5rem"}
            placeholder={props.placeholder}
            value={props.value?.() ?? ""}
            onChange={(e) => props.onChange?.(e.target.value)}
            onInput={(e) => props.onInput?.(e.target.value)}
            onKeyDown={(e) => {
              if (props.onSubmit && e.key === "Enter" && !e.shiftKey && !e.metaKey) {
                e.preventDefault();
                props.onSubmit();
              }
            }}
            disabled={disabled()}
            aria-label={!props.label ? (props.ariaLabel ?? props.placeholder) : undefined}
            aria-describedby={a11y.ariaDescribedBy()}
            aria-invalid={!!props.error?.()}
            aria-required={props.required}
            aria-disabled={disabled()}
          />
        ) : (
          <input
            id={a11y.inputId}
            name={props.name}
            type={props.password && !showPassword() ? "password" : (props.type ?? "text")}
            class={`input w-full pl-9 ${props.password || canClear() ? "pr-9" : ""} ${disabled() ? "cursor-not-allowed opacity-50" : ""}`}
            placeholder={props.placeholder}
            value={currentValue()}
            onChange={(e) => props.onChange?.(e.target.value)}
            onInput={(e) => props.onInput?.(e.target.value)}
            disabled={disabled()}
            aria-label={!props.label ? (props.ariaLabel ?? props.placeholder) : undefined}
            aria-describedby={a11y.ariaDescribedBy()}
            aria-invalid={!!props.error?.()}
            aria-required={props.required}
            aria-disabled={disabled()}
          />
        )}
        {canClear() && hasValue() && (
          <button
            type="button"
            class="absolute inset-y-0 right-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
            onClick={handleClear}
            aria-label={props.clearLabel ?? "Clear input"}
          >
            <i class="ti ti-x" />
          </button>
        )}
        {props.password && !multiline() && (
          <button
            type="button"
            class="absolute inset-y-0 right-3 flex items-center text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
            onClick={() => setShowPassword(!showPassword())}
            tabIndex={-1}
          >
            <i class={showPassword() ? "ti ti-eye-off" : "ti ti-eye"} />
          </button>
        )}
      </div>
    </InputWrapper>
  );
};

export default TextInput;
