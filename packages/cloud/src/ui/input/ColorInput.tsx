import { Show } from "solid-js";
import Tooltip from "../misc/Tooltip";
import type { ColorInputProps } from "./types";
import { createInputA11y, InputWrapper } from "./util";

/**
 * Color input component using native color picker
 */
const ColorInput = (props: ColorInputProps) => {
  const disabled = () => props.disabled ?? false;
  const compact = () => props.compact ?? !props.label;
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
          class={`color-input-swatch focus-ui h-7 w-7 rounded border border-zinc-300 dark:border-zinc-600 ${
            disabled() ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-500"
          }`}
          style={`background-color: ${currentColor()}`}
          onClick={() => document.getElementById(inputId)?.click()}
          disabled={disabled()}
          aria-label={typeof props.label === "string" ? props.label : "Choose color"}
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
          class={`input flex items-center gap-2 transition-all ${
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
            <Tooltip content={isTransparent() ? "Use a color" : "Use transparent"} class="shrink-0">
              <button
                type="button"
                class={`focus-ui flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors ${
                  isTransparent()
                    ? "bg-zinc-200 font-medium text-primary dark:bg-zinc-700"
                    : "text-dimmed hover:bg-zinc-100 hover:text-secondary dark:hover:bg-zinc-800"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onTransparentChange?.(!isTransparent());
                }}
                aria-label={isTransparent() ? "Use a color" : "Use transparent"}
                aria-pressed={isTransparent()}
              >
                <i class="ti ti-grid-dots text-sm leading-none" />
              </button>
            </Tooltip>
          )}
          <input
            id={a11y.inputId}
            type="color"
            class="absolute opacity-0 w-0 h-0"
            value={currentColor()}
            onInput={(e) => props.onChange?.(e.currentTarget.value)}
            onChange={(e) => props.onChange?.(e.currentTarget.value)}
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
