import { Show, createUniqueId, type Accessor, type JSX } from "solid-js";

export type InputA11y = {
  inputId: string;
  descriptionId: string | undefined;
  errorId: string;
  ariaDescribedBy: Accessor<string | undefined>;
};

/**
 * Module-level fallback counter for `createUniqueId`.
 *
 * Solid's `createUniqueId` requires a hydrating render context. The current
 * @valentinkolb/ssr release renders islands via `renderToString` (sync, NOT
 * hydrating), which throws "getNextContextId cannot be used under
 * non-hydrating context" when an island contains TextInput / similar inputs.
 *
 * Islands are re-mounted client-side anyway (no SSR-hydration matchup for
 * the island content), so a stable-but-arbitrary id is fine for the SSR
 * pass — client mount runs `createUniqueId` again with a real context.
 */
let fallbackIdCounter = 0;
const safeUniqueId = (): string => {
  try {
    return createUniqueId();
  } catch {
    fallbackIdCounter += 1;
    return `ssr-${fallbackIdCounter}`;
  }
};

export const createInputA11y = (props: {
  description?: string | JSX.Element;
  error?: () => string | undefined;
  inputId?: string;
}): InputA11y => {
  const baseId = safeUniqueId();
  const inputId = props.inputId ?? `input-${baseId}`;
  const descriptionId = props.description ? `${inputId}-desc` : undefined;
  const errorId = `${inputId}-error`;

  return {
    inputId,
    descriptionId,
    errorId,
    ariaDescribedBy: () => {
      const parts: string[] = [];
      if (descriptionId) parts.push(descriptionId);
      if (props.error?.()) parts.push(errorId);
      return parts.length > 0 ? parts.join(" ") : undefined;
    },
  };
};

/**
 * Props for InputWrapper component
 */
export type InputWrapperProps = {
  label?: string | JSX.Element;
  description?: string | JSX.Element;
  error?: string | undefined;
  required?: boolean;
  inputId: string;
  descriptionId?: string;
  errorId?: string;
  children: JSX.Element;
};

/**
 * Shared wrapper for labeled inputs. Input IDs and aria wiring are created outside
 * the wrapper so the input subtree stays structurally stable during reactive updates.
 */
export const InputWrapper = (props: InputWrapperProps) => {
  return (
    <div class="flex flex-col gap-1">
      <Show when={props.label || props.description}>
        <label for={props.inputId}>
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
            <p id={props.descriptionId} class="text-dimmed block text-xs">
              {props.description}
            </p>
          </Show>
        </label>
      </Show>

      {props.children}

      <Show when={props.error}>
        <p id={props.errorId} class="text-xs text-red-500" role="alert" aria-live="polite">
          {props.error}
        </p>
      </Show>
    </div>
  );
};
