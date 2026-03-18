import { createSignal, Show } from "solid-js";
import { InputWrapper, createInputA11y } from "./util";
import type { ColorInputProps } from "./types";

/**
 * Color input component using native color picker
 */
const ColorInput = (props: ColorInputProps) => {
  const disabled = () => props.disabled ?? false;
  const compact = () => props.compact ?? !props.label;
  const [isFocused, setIsFocused] = createSignal(false);
  const inputId = crypto.randomUUID();
  const a11y = createInputA11y({ description: props.description, error: props.error });

  const currentColor = () => props.value?.() || "#3b82f6";
  const isTransparent = () => props.isTransparent?.() ?? false;

  // Compact version - just a clickable swatch
  if (compact()) {
    return (
      <div class="relative inline-flex">
        <button
          type="button"
          class={`w-7 h-7 border border-zinc-300 dark:border-zinc-600 rounded ${
            disabled() ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-500"
          }`}
          style={`background-color: ${currentColor()}`}
          onClick={() => document.getElementById(inputId)?.click()}
          disabled={disabled()}
        />
        <input
          id={inputId}
          type="color"
          class="absolute opacity-0 w-0 h-0"
          value={currentColor()}
          onInput={(e) => props.onChange?.(e.currentTarget.value)}
          onChange={(e) => props.onChange?.(e.currentTarget.value)}
          disabled={disabled()}
        />
      </div>
    );
  }

  // Full version with label
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
      <div class="relative">
        <div
          class={`input-subtle flex items-center gap-2 transition-all ${isFocused() ? "ring-2 ring-blue-500" : ""} ${
            disabled() || isTransparent() ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          }`}
          onClick={() => {
            if (!disabled() && !isTransparent()) {
              document.getElementById(a11y.inputId)?.click();
            }
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !disabled() && !isTransparent()) {
              e.preventDefault();
              document.getElementById(a11y.inputId)?.click();
            }
          }}
          role="button"
          tabIndex={disabled() || isTransparent() ? -1 : 0}
        >
          <Show
            when={!isTransparent()}
            fallback={
              <div class="h-4 w-4 shrink-0 border border-zinc-300 dark:border-zinc-600 bg-[repeating-conic-gradient(#ccc_0_25%,transparent_0_50%)] bg-size-[6px_6px] rounded" />
            }
          >
            <div
              class="h-4 w-4 shrink-0 border border-zinc-300 dark:border-zinc-600 rounded"
              style={`background-color: ${currentColor()}`}
            />
          </Show>
          <span class="flex-1 font-mono text-sm uppercase leading-tight">{isTransparent() ? "transparent" : currentColor()}</span>
          {props.transparent && (
            <button
              type="button"
              class={`shrink-0 flex items-center justify-center p-0.5 transition-colors rounded ${
                isTransparent()
                  ? "bg-zinc-200 dark:bg-zinc-700 text-primary font-medium"
                  : "text-dimmed hover:text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                props.onTransparentChange?.(!isTransparent());
              }}
              aria-label="Toggle transparent"
            >
              <i class="ti ti-grid-dots text-sm leading-none" />
            </button>
          )}
          <input
            id={a11y.inputId}
            type="color"
            class="absolute opacity-0 w-0 h-0"
            value={currentColor()}
            onInput={(e) => props.onChange?.(e.currentTarget.value)}
            onChange={(e) => props.onChange?.(e.currentTarget.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            disabled={disabled() || isTransparent()}
            aria-describedby={a11y.ariaDescribedBy()}
            aria-invalid={!!props.error?.()}
          />
        </div>
      </div>
    </InputWrapper>
  );
};

export default ColorInput;
