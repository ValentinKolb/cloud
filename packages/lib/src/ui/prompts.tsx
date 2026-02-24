/**
 * Minimal dialog library for alert, confirm, prompt, and custom dialogs
 * @module prompt-lib
 */

import CheckboxInput from "@/ui/input/Checkbox";
import DateTimeInput from "@/ui/input/DateTimeInput";
import ImageInput from "@/ui/input/ImageInput";
import NumberInput from "@/ui/input/NumberInput";
import PinInput from "@/ui/input/PinInput";
import SelectInput from "@/ui/input/Select";
import TagsInput from "@/ui/input/TagsInput";
import TextInput from "@/ui/input/TextInput";
import { For, Show, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";

/**
 * Configuration options for dialog appearance and behavior
 */
export interface DialogOptions {
  /** Optional title displayed in the dialog header */
  title?: string;
  /** Optional icon class for header (e.g., "ti ti-trash") */
  icon?: string;
  /** Custom text for the confirm/OK button*/
  confirmText?: string;
  /** Custom text for the cancel button, or false to hide it*/
  cancelText?: string | false;
  /** Visual variant affecting button and outline colors */
  variant?: "danger" | "primary" | "success";
}

/**
 * Base field configuration shared by all field types
 */
type BaseField<T = any> = {
  label?: string | false;
  description?: string;
  placeholder?: string;
  required?: boolean;
  default?: T;
  validate?: (value: T | undefined) => string | null;
};

/**
 * Field schema for form inputs - discriminated union of all field types
 */
export type FieldSchema =
  | (BaseField<string> & {
      type: "text";
      multiline?: boolean;
      maxLength?: number;
      minLength?: number;
      icon?: string;
      activeIcon?: string;
      password?: boolean;
    })
  | (BaseField<number> & {
      type: "number";
      min?: number;
      max?: number;
      step?: number;
    })
  | (BaseField<string> & {
      type: "image";
      round?: boolean;
      ariaLabel?: string;
    })
  | (BaseField<string> & {
      type: "pin";
      length?: number;
      stretch?: boolean;
    })
  | (BaseField<string> & {
      type: "select";
      options: string[] | { id: string; label?: string; description?: string; icon?: string }[];
      icon?: string;
      activeIcon?: string;
      clearable?: boolean;
    })
  | (BaseField<string[]> & {
      type: "tags";
      maxTags?: number;
      minTags?: number;
      icon?: string;
      activeIcon?: string;
    })
  | (BaseField<boolean> & {
      type: "boolean";
    })
  | (BaseField<string> & {
      type: "datetime";
      /** Use date-only input instead of datetime-local */
      dateOnly?: boolean;
    })
  | {
      type: "info";
      content: string | JSX.Element | (() => JSX.Element);
    };

/**
 * Extract value type from field schema
 */
type InferFieldType<T extends FieldSchema> = T extends { type: "text" }
  ? string
  : T extends { type: "number" }
    ? number
    : T extends { type: "image" }
      ? string
      : T extends { type: "pin" }
        ? string
        : T extends { type: "select" }
          ? string
          : T extends { type: "tags" }
            ? string[]
            : T extends { type: "boolean" }
              ? boolean
              : T extends { type: "datetime" }
                ? string
                : T extends { type: "currency" }
                  ? number
                  : T extends { type: "info" }
                    ? never
                    : never;

/**
 * Infer form values type from schema, excluding info fields
 */
type InferFormValues<T extends Record<string, FieldSchema>> = {
  [K in keyof T as T[K] extends { type: "info" } ? never : K]: T[K] extends {
    required: true;
  }
    ? InferFieldType<T[K]>
    : InferFieldType<T[K]> | undefined;
};

/**
 * Reusable form state management hook
 * @param schema - Form field schema
 * @returns Form state utilities
 */
export const createFormState = <T extends Record<string, FieldSchema>>(schema: T) => {
  const [values, setValues] = createStore<any>({});
  const [errors, setErrors] = createStore<Record<string, string>>({});

  // Initialize with default values
  Object.entries(schema).forEach(([key, field]) => {
    if (field.type !== "info" && "default" in field) {
      setValues(key, field.default);
    }
  });

  // Validate single field
  const validateField = (key: string, value: any): string | null => {
    const field = schema[key];
    if (!field || field.type === "info") return null;

    // Required check
    if (field.required && (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0))) {
      return "required";
    }

    // Custom validator
    if ("validate" in field && field.validate) {
      return field.validate(value);
    }

    return null;
  };

  // Update field value and validation
  const updateField = (key: string, value: any) => {
    setValues(key, value);
    const error = validateField(key, value);
    setErrors(key, error || (undefined as any));
  };

  // Validate all fields
  const validateAll = (): boolean => {
    let isValid = true;
    Object.entries(schema).forEach(([key, field]) => {
      if (field.type !== "info") {
        const error = validateField(key, values[key]);
        if (error) {
          setErrors(key, error);
          isValid = false;
        } else {
          setErrors(key, undefined as any);
        }
      }
    });
    return isValid;
  };

  // Reset to initial state
  const reset = () => {
    Object.entries(schema).forEach(([key, field]) => {
      if (field.type !== "info") {
        setValues(key, "default" in field ? field.default : undefined);
        setErrors(key, undefined as any);
      }
    });
  };

  return {
    values,
    errors,
    updateField,
    validateAll,
    reset,
  };
};

export const DialogHeader = (props: { close: () => void; title?: string; icon?: string }) => {
  const { title, icon, close } = props || {};
  return (
    <div class="flex flex-row items-center justify-start gap-4 border-b border-zinc-200 pb-2 dark:border-zinc-700">
      {icon && <i class={`${icon}`} />}
      {title && <p class="truncate font-semibold">{title}</p>}
      <button type="button" onClick={() => close()} class="ti ti-x ml-auto" aria-label="close dialog" />
    </div>
  );
};

class DialogManager {
  public dialogElement?: HTMLDialogElement;

  getDialog(variant?: "danger" | "primary" | "success"): HTMLDialogElement {
    // Check if dialog exists but is no longer in the DOM (e.g., after view transition)
    if (this.dialogElement && !document.body.contains(this.dialogElement)) {
      this.dialogElement = undefined;
    }

    if (!this.dialogElement) {
      this.dialogElement = document.createElement("dialog");
      document.body.appendChild(this.dialogElement);
    }

    let className = "dialog-panel";

    // Add colored outline based on variant
    if (variant === "danger") {
      className += " ring-2 ring-red-500/50";
    } else if (variant === "success") {
      className += " ring-2 ring-green-500/50";
    }

    this.dialogElement.className = className;

    return this.dialogElement;
  }

  /**
   * Shows a dialog with a custom SolidJS component
   * @param componentFactory - Function that receives close callback and returns JSX
   * @returns Promise that resolves to the result passed to close, or undefined if cancelled
   */
  dialog<T = void>(
    component: (close: (result?: T) => void) => JSX.Element,
    variant?: "danger" | "primary" | "success",
  ): Promise<T | undefined> {
    const dialog = this.getDialog(variant);
    dialog.innerHTML = "";

    // Create container for SolidJS component
    const container = document.createElement("div");
    container.className = "text-base text-zinc-800 dark:text-zinc-200";
    dialog.appendChild(container);

    return new Promise((resolve) => {
      let dispose: (() => void) | undefined;

      const close = (result?: T) => {
        dispose?.();
        dialog.close();
        // Delay resolve to allow pending operations to complete
        setTimeout(() => resolve(result));
      };

      // Render the SolidJS component
      dispose = render(() => component(close), container);

      dialog.oncancel = (e) => {
        e.preventDefault();
        close(undefined);
      };

      dialog.showModal();

      // Focus first input element instead of close button for better form UX
      requestAnimationFrame(() => {
        const firstInput = dialog.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select');
        firstInput?.focus();
      });
    });
  }
}

const manager = new DialogManager();

/**
 * Simple dialog utilities for user interactions
 *
 * @example
 * ```typescript
 * // Simple alert
 * await prompts.alert("File saved!");
 *
 * // Confirmation dialog
 * const confirmed = await prompts.confirm("Delete this item?");
 *
 * // Text input
 * const name = await prompts.prompt("Enter your name:");
 *
 * // Number input
 * const age = await prompts.promptNumber("Enter your age:", 25);
 *
 * // Dynamic form with schema
 * const values = await prompts.form({
 *   title: 'User Registration',
 *   icon: 'ti ti-user-plus',
 *   fields: {
 *     name: { type: 'text', required: true },
 *     age: { type: 'number', min: 18 },
 *     country: { type: 'select', options: ['DE', 'AT', 'CH'] },
 *     interests: { type: 'tags' },
 *     avatar: { type: 'image', round: true },
 *     price: { type: 'currency', min: 100 },
 *     pin: { type: 'pin', length: 4 },
 *     agree: { type: 'boolean', label: 'I agree to terms', required: true }
 *   }
 * });
 *
 * // Custom dialog with SolidJS component
 * const result = await prompts.dialog<boolean>((close) => (
 *   <div>
 *     <p>Custom content here</p>
 *     <button onClick={() => close(true)}>OK</button>
 *   </div>
 * ));
 *
 * // Error dialog with danger variant
 * await prompts.error("Something went wrong!");
 * ```
 */
export const prompts = {
  /**
   * Display an alert dialog with a single OK button
   * @param content - Message to display (supports HTML)
   * @param options - Optional styling and text configuration
   * @returns Promise that resolves when dialog is closed
   */
  alert: (content: string | HTMLElement | JSX.Element, options?: DialogOptions) =>
    manager.dialog(
      (close) => (
        <div>
          <DialogHeader title={options?.title || "Info"} icon={options?.icon} close={close} />

          <div class="font-xs py-4 text-sm whitespace-pre-wrap">{content}</div>

          <div class="flex justify-end gap-3">
            <button
              onClick={() => close()}
              class={`${
                options?.variant === "danger" ? "btn-danger" : options?.variant === "success" ? "btn-success" : "btn-primary"
              } btn-sm`}
            >
              {options?.confirmText || "OK"}
            </button>
          </div>
        </div>
      ),
      options?.variant,
    ),

  /**
   * Display a confirmation dialog with OK and Cancel buttons
   * @param content - Question/message to display
   * @param options - Optional styling and text configuration
   * @returns Promise resolving to true if confirmed, false if cancelled
   */
  confirm: (content: string | HTMLElement | JSX.Element, options?: DialogOptions) =>
    manager.dialog<boolean>(
      (close) => (
        <div>
          <DialogHeader title={options?.title} icon={options?.icon} close={() => close(false)} />

          <div class="font-xs py-4 text-sm whitespace-pre-wrap">{content}</div>

          <div class="flex justify-end gap-3">
            <button type="button" onClick={() => close(false)} class="btn-secondary btn-sm">
              {options?.cancelText || "Nope"}
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              class={`${
                options?.variant === "danger" ? "btn-danger" : options?.variant === "success" ? "btn-success" : "btn-primary"
              } btn-sm`}
            >
              {options?.confirmText || "Yees"}
            </button>
          </div>
        </div>
      ),
      options?.variant,
    ),

  /**
   * Display a prompt dialog with text input
   * @param content - Prompt message
   * @param defaultValue - Initial value for the input field
   * @param options - Optional styling and text configuration
   * @returns Promise resolving to entered text (empty string is possible), or null if dialog was cancelled
   */
  prompt: (content: string, defaultValue?: string, options?: DialogOptions) =>
    prompts
      .form({
        ...options,
        fields: {
          message: {
            type: "info",
            content: () => <div class="font-xs text-sm">{content}</div>,
          },
          value: {
            type: "text",
            label: false,
            default: defaultValue || "",
          },
        },
      })
      .then((result) => result?.value ?? null),

  /**
   * Display a prompt dialog with number input
   * @param content - Prompt message
   * @param defaultValue - Initial value for the input field
   * @param options - Optional styling and text configuration
   * @returns Promise resolving to entered number, or null if cancelled/empty
   */
  promptNumber: async (
    content: string,
    defaultValue?: number,
    options?: DialogOptions & {
      min?: number;
      max?: number;
    },
  ) =>
    prompts
      .form({
        ...options,
        fields: {
          message: {
            type: "info",
            content: () => <div class="font-xs text-sm">{content}</div>,
          },
          value: {
            type: "number",
            label: false,
            default: defaultValue || 0,
            min: options?.min,
            max: options?.max,
          },
        },
      })
      .then((result) => result?.value ?? null),

  /**
   * Build and display a dynamic form from schema
   * @param config - Form configuration with title, icon, and fields
   * @returns Promise resolving to form values or null if cancelled
   *
   * @example
   * ```typescript
   * const values = await prompts.form({
   *   title: 'User Form',
   *   icon: 'ti ti-user',
   *   fields: {
   *     name: { type: 'text', required: true },
   *     age: { type: 'number', min: 18 }
   *   }
   * });
   * ```
   */
  form: <T extends Record<string, FieldSchema>>(config: {
    title?: string;
    icon?: string;
    fields: T;
    confirmText?: string;
    cancelText?: string | false;
    variant?: "danger" | "primary" | "success";
  }): Promise<InferFormValues<T> | null> => {
    return manager.dialog<InferFormValues<T> | null>((close) => {
      const state = createFormState(config.fields);

      // Field renderer map
      const fieldRenderers: Record<string, (props: any, field: any) => JSX.Element> = {
        text: (props, field) => (
          <TextInput {...props} multiline={field.multiline} icon={field.icon} activeIcon={field.activeIcon} password={field.password} />
        ),
        number: (props, field) => <NumberInput {...props} min={field.min} max={field.max} step={field.step} />,
        image: (props, field) => <ImageInput {...props} round={field.round} ariaLabel={field.ariaLabel} />,
        pin: (props, field) => <PinInput {...props} length={field.length} stretch={field.stretch} />,
        select: (props, field) => (
          <SelectInput {...props} options={field.options} icon={field.icon} activeIcon={field.activeIcon} clearable={field.clearable} />
        ),
        tags: (props, field) => <TagsInput {...props} icon={field.icon} activeIcon={field.activeIcon} />,
        boolean: (props) => <CheckboxInput {...props} />,
        datetime: (props, field) => <DateTimeInput {...props} dateOnly={field.dateOnly} />,
      };

      // Handle form submission
      const handleSubmit = (e: Event) => {
        e.preventDefault();
        if (state.validateAll()) {
          close(state.values as InferFormValues<T>);
        }
      };

      // Determine button variant class
      const submitButtonClass = config.variant === "danger" ? "btn-danger" : config.variant === "success" ? "btn-success" : "btn-primary";

      return (
        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          <DialogHeader title={config.title} icon={config.icon} close={() => close(null)} />

          <div class="flex flex-col gap-4">
            <For each={Object.entries(config.fields)}>
              {([key, field]) => {
                // Info field - just display content
                if (field.type === "info") {
                  return (
                    <div>
                      {typeof field.content === "string" ? (
                        <p class="text-sm text-zinc-600 dark:text-zinc-400">{field.content}</p>
                      ) : typeof field.content === "function" ? (
                        field.content()
                      ) : (
                        field.content
                      )}
                    </div>
                  );
                }

                // Regular input fields
                // Handle label: false or undefined means no label, otherwise use provided label
                const label = field.label || undefined;
                const commonProps = {
                  label,
                  description: field.description,
                  placeholder: field.placeholder,
                  required: field.required,
                  value: () => state.values[key],
                  onChange: (v: any) => state.updateField(key, v),
                  error: () => state.errors[key],
                };

                return fieldRenderers[field.type]?.(commonProps, field);
              }}
            </For>
          </div>

          <div class="flex justify-end gap-3">
            <Show when={config.cancelText !== false}>
              <button type="button" onClick={() => close(null)} class="btn-secondary btn-sm">
                {config.cancelText || "ESC"}
              </button>
            </Show>
            <button type="submit" class={`${submitButtonClass} btn-sm`}>
              {config.confirmText || "ENTER"}
            </button>
          </div>
        </form>
      );
    }, config.variant) as Promise<InferFormValues<T> | null>;
  },

  /**
   * Display a custom dialog with a SolidJS component
   * @param componentFactory - Function that receives close callback and returns JSX
   * @param options - Optional dialog options for header (title, icon, variant)
   * @returns Promise resolving to the result passed to close, or undefined if cancelled
   *
   * @example
   * ```typescript
   * const confirmed = await prompts.dialog<boolean>((close) => (
   *   <p class="mb-4">Custom content here</p>
   * ), { title: "My Dialog", icon: "ti ti-info-circle" });
   * ```
   */
  dialog: <T = any>(component: (close: (result?: T) => void) => JSX.Element, options?: DialogOptions) =>
    manager.dialog<T>(
      (close: (result?: T) => void) => (
        <div class="flex flex-col gap-4">
          <DialogHeader title={options?.title} icon={options?.icon} close={() => close(undefined)} />
          {component(close)}
        </div>
      ),
      options?.variant,
    ),

  /**
   * Wrapper around the alert dialog with error styling and icon
   * @param content - Error message to display
   * @param options - Optional styling and text configuration
   * @returns Promise that resolves when dialog is closed
   */
  error: (content: string | HTMLElement, options?: DialogOptions) =>
    manager.dialog(
      (close) => (
        <div>
          <DialogHeader title={options?.title ?? "Uuups"} icon={options?.icon ?? "ti ti-alert-circle"} close={close} />

          <div class="font-xs p-4 text-sm">{content}</div>

          <div class="flex justify-end gap-3">
            <button onClick={() => close()} class="btn-primary btn-sm">
              {options?.confirmText || "Ok .. me sad now"}
            </button>
          </div>
        </div>
      ),
      "danger",
    ),

  getDialogElement: manager.getDialog,
};
