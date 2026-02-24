import { Show, type JSX } from "solid-js";

/**
 * Props for InputWrapper component
 */
export type InputWrapperProps = {
  label?: string | JSX.Element;
  description?: string | JSX.Element;
  error?: () => string | undefined;
  required?: boolean;
  children: (props: {
    inputId: string;
    descriptionId: string | undefined;
    errorId: string | undefined;
    ariaDescribedBy: string | undefined;
  }) => JSX.Element;
};

/**
 * Wrapper component for form inputs that handles label, description, and error display
 * with proper accessibility attributes
 *
 * @param label - Optional label text
 * @param description - Optional description text
 * @param error - Reactive error message getter
 * @param required - Show required asterisk
 * @param children - Render prop that receives accessibility IDs
 *
 * @example
 * ```tsx
 * <InputWrapper label="Name" description="Your full name" error={error} required>
 *   {({ inputId, ariaDescribedBy }) => (
 *     <input
 *       id={inputId}
 *       aria-describedby={ariaDescribedBy}
 *       aria-invalid={!!error()}
 *       aria-required={required}
 *     />
 *   )}
 * </InputWrapper>
 * ```
 */
export const InputWrapper = (props: InputWrapperProps) => {
  const inputId = crypto.randomUUID();
  const descriptionId = props.description ? `${inputId}-desc` : undefined;
  const errorId = `${inputId}-error`;

  // Build aria-describedby string from description and error
  const ariaDescribedBy = () => {
    const parts = [];
    if (props.description) parts.push(descriptionId);
    if (props.error?.()) parts.push(errorId);
    return parts.length > 0 ? parts.join(" ") : undefined;
  };

  return (
    <div class="flex flex-col gap-1">
      <Show when={props.label || props.description}>
        <label for={inputId}>
          <Show when={props.label}>
            <p class="block text-sm font-medium">
              {props.label}
              <Show when={props.required}>
                <span class="ml-0.5 text-red-500" aria-hidden="true">
                  *
                </span>
              </Show>
            </p>
          </Show>
          <Show when={props.description}>
            <p id={descriptionId} class="text-dimmed block text-xs">
              {props.description}
            </p>
          </Show>
        </label>
      </Show>

      {props.children({
        inputId,
        descriptionId,
        errorId,
        ariaDescribedBy: ariaDescribedBy(),
      })}

      <Show when={props.error?.()}>
        <p id={errorId} class="text-xs text-red-500" role="alert" aria-live="polite">
          {props.error?.()}
        </p>
      </Show>
    </div>
  );
};
