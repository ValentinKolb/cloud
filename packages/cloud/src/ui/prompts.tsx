/**
 * Minimal dialog library for alert, confirm, prompt, and custom dialogs
 * @module prompt-lib
 */

import CheckboxInput from "./input/Checkbox";
import DateTimeInput from "./input/DateTimeInput";
import ImageInput from "./input/ImageInput";
import NumberInput from "./input/NumberInput";
import PinInput from "./input/PinInput";
import SelectInput from "./input/Select";
import TagsInput from "./input/TagsInput";
import TextInput from "./input/TextInput";
import { mutation, timed } from "@valentinkolb/stdlib/solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { dialogCore } from "./dialog-core";

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
  /** Dialog size preset (default: "medium") */
  size?: "small" | "medium" | "large";
}

export type PromptSearchItem<T = unknown> = {
  label: string;
  desc?: string;
  icon?: string;
  previewUrl?: string;
  value?: T;
  onClick?: (item: PromptSearchItem<T>) => void | Promise<void>;
};

export type PromptSearchInput = {
  query: string;
  abortSignal: AbortSignal;
};

export type PromptSearchOptions = DialogOptions & {
  placeholder?: string;
  icon?: string;
  initialQuery?: string;
  minQueryLength?: number;
  debounceMs?: number;
  emptyText?: string;
  noResultsText?: string;
};

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
      /** Approximate visible lines for multiline mode. Overrides default height. */
      lines?: number;
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

const getSizeClassName = (size: DialogOptions["size"] = "medium") => {
  if (size === "small") return "w-[min(90vw,22rem)] max-h-[72vh]";
  if (size === "large") return "w-[min(96vw,48rem)] max-h-[86vh]";
  return "w-[min(94vw,28rem)] max-h-[90vh]";
};

const getVariantClassName = (variant?: DialogOptions["variant"]) => {
  if (variant === "danger") return "ring-red-500/45 dark:ring-red-500/35";
  if (variant === "success") return "ring-green-500/45 dark:ring-green-500/35";
  return "ring-zinc-300/60 dark:ring-zinc-700/60";
};

const getPanelClassName = (options?: Pick<DialogOptions, "variant" | "size">) => {
  const sizeClass = getSizeClassName(options?.size);
  const variantClass = getVariantClassName(options?.variant);
  return `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 m-0 ${sizeClass} overflow-x-hidden overflow-y-auto rounded-2xl border-0 bg-white/95 p-4 text-zinc-900 shadow-none ring-1 ring-inset ${variantClass} backdrop:bg-black/45 dark:backdrop:bg-black/35 backdrop:backdrop-blur-sm dark:bg-zinc-950/95 dark:text-zinc-100`;
};

const getSearchPanelClassName = () =>
  "fixed left-1/2 top-[25vh] -translate-x-1/2 m-0 w-[min(96vw,46rem)] h-[50vh] border-0 bg-transparent p-0 text-zinc-900 shadow-none backdrop:bg-black/45 dark:backdrop:bg-black/35 backdrop:backdrop-blur-sm dark:text-zinc-100 [@media(min-height:1100px)]:top-[33vh] [@media(min-height:1100px)]:h-[33vh]";

const isPreviewUrl = (value?: string) => typeof value === "string" && value.startsWith("/");

const openSearchPrompt = <T = unknown>(
  resolver: (input: PromptSearchInput) => Promise<PromptSearchItem<T>[]> | PromptSearchItem<T>[],
  options?: PromptSearchOptions,
) =>
  dialogCore.open<PromptSearchItem<T>>((close) => {
    const [query, setQuery] = createSignal(options?.initialQuery ?? "");
    const [items, setItems] = createSignal<PromptSearchItem<T>[]>([]);
    const [activeIndex, setActiveIndex] = createSignal(0);
    const [hasLoaded, setHasLoaded] = createSignal(false);
    const [failedPreviews, setFailedPreviews] = createStore<Record<number, true>>({});
    const [activeSearchQuery, setActiveSearchQuery] = createSignal("");

    const rowRefs = new Map<number, HTMLButtonElement>();
    let inputRef: HTMLInputElement | undefined;

    const minQueryLength = options?.minQueryLength ?? 0;
    const debounceMs = options?.debounceMs ?? 180;
    const searchMutation = mutation.create<
      {
        query: string;
        items: PromptSearchItem<T>[];
      },
      string,
      { requestQuery: string }
    >({
      onBefore: (requestQuery) => ({ requestQuery }),
      mutation: async (requestQuery, ctx) => {
        const result = await resolver({
          query: requestQuery,
          abortSignal: ctx.abortSignal,
        });
        return { query: requestQuery, items: (result ?? []).slice() };
      },
      onSuccess: (result, ctx) => {
        if (!ctx || ctx.requestQuery !== activeSearchQuery()) return;
        setItems(result.items);
        setActiveIndex(0);
        setHasLoaded(true);
      },
      onError: (err, ctx) => {
        if (!ctx || ctx.requestQuery !== activeSearchQuery()) return;
        if (err.name === "AbortError") return;
        setItems([]);
        setActiveIndex(0);
        setHasLoaded(true);
      },
    });
    const searchError = createMemo(() => {
      const err = searchMutation.error();
      if (!err || err.name === "AbortError") return null;
      return err.message || "Search failed.";
    });
    const shouldShowResults = createMemo(() => {
      if (query().trim().length < minQueryLength) return false;
      return hasLoaded() || searchError() !== null || items().length > 0;
    });
    const emptyStateText = createMemo(() => {
      if (!hasLoaded()) return options?.emptyText ?? "Type to search.";
      return options?.noResultsText ?? "No results.";
    });
    const getItemClassName = (isActive: boolean) =>
      `flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
        isActive
          ? "bg-blue-50/80 text-blue-900 dark:bg-blue-950/45 dark:text-blue-100"
          : "hover:bg-zinc-200/65 dark:hover:bg-zinc-800/70"
      }`;
    const { debouncedFn: debounceSearch, cancel: cancelDebounce } = timed.debounce((nextQuery: string) => {
      setActiveSearchQuery(nextQuery);
      searchMutation.abort();
      void searchMutation.mutate(nextQuery);
    }, debounceMs);

    const execute = async (item?: PromptSearchItem<T>) => {
      if (!item) return;
      if (item.onClick) await item.onClick(item);
      close(item);
    };

    const moveSelection = (delta: -1 | 1) => {
      const list = items();
      if (list.length === 0) return;
      const next = (activeIndex() + delta + list.length) % list.length;
      setActiveIndex(next);
    };

    createEffect(() => {
      const list = items();
      const maxIndex = list.length - 1;
      if (maxIndex < 0) {
        setActiveIndex(0);
        return;
      }
      if (activeIndex() > maxIndex) setActiveIndex(maxIndex);
      rowRefs.get(activeIndex())?.scrollIntoView({ block: "nearest" });
    });

    createEffect(() => {
      const nextQuery = query().trim();
      setFailedPreviews({});

      if (nextQuery.length < minQueryLength) {
        cancelDebounce();
        searchMutation.abort();
        setItems([]);
        setActiveIndex(0);
        setHasLoaded(false);
        setActiveSearchQuery("");
        return;
      }

      debounceSearch(nextQuery);
    });

    onCleanup(() => {
      cancelDebounce();
      searchMutation.abort();
    });

    return (
      <div class="flex h-full min-h-0 flex-col gap-2 pb-1 [--search-body-max:calc(50vh-3.5rem)] [@media(min-height:1100px)]:[--search-body-max:calc(33vh-3.5rem)]">
        <Show when={options?.title}>
          {(title) => (
            <p class="px-1 text-base font-semibold text-white dark:text-zinc-100">
              {title()}
            </p>
          )}
        </Show>

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white/95 text-zinc-900 shadow-none ring-1 ring-inset ring-zinc-300/60 dark:bg-zinc-950/95 dark:text-zinc-100 dark:ring-zinc-700/60">
          <label class="flex items-center gap-2 px-3 py-2.5">
            <i class={`${options?.icon ?? "ti ti-search"} text-dimmed`} />
            <input
              ref={inputRef}
              type="search"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveSelection(1);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveSelection(-1);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  void execute(items()[activeIndex()]);
                }
              }}
              placeholder={options?.placeholder ?? "Search..."}
              class="w-full border-0 bg-transparent text-sm outline-none placeholder:text-dimmed"
              spellcheck={false}
              autocapitalize="off"
              autocomplete="off"
              autocorrect="off"
            />
            <Show when={searchMutation.loading()}>
              <i class="ti ti-loader-2 animate-spin text-dimmed" />
            </Show>
          </label>

          <div
            class="overflow-hidden transition-[height,opacity] duration-200 ease-out"
            style={{
              height: shouldShowResults() ? "var(--search-body-max)" : "0px",
              opacity: shouldShowResults() ? "1" : "0",
            }}
          >
            <div class="h-full min-h-0 overflow-y-auto overscroll-y-contain px-2 pb-2" onWheel={(event) => event.stopPropagation()}>
              <Show when={searchError()}>{(message) => <div class="info-block-danger mb-2 text-xs">{message()}</div>}</Show>

              <Show when={items().length > 0} fallback={<p class="px-1.5 py-2 text-xs text-dimmed">{emptyStateText()}</p>}>
                <div class="flex flex-col gap-1">
                  <For each={items()}>
                    {(item, index) => (
                      <button
                        ref={(element) => {
                          if (!element) {
                            rowRefs.delete(index());
                            return;
                          }
                          rowRefs.set(index(), element);
                        }}
                        type="button"
                        onMouseEnter={() => setActiveIndex(index())}
                        onClick={() => void execute(item)}
                        class={getItemClassName(activeIndex() === index())}
                      >
                        <Show when={isPreviewUrl(item.previewUrl) || item.icon}>
                          <span class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md bg-zinc-200/80 dark:bg-zinc-800/80">
                            <Show
                              when={isPreviewUrl(item.previewUrl) && !failedPreviews[index()]}
                              fallback={<i class={`${item.icon ?? "ti ti-file"} text-xs text-dimmed`} />}
                            >
                              <img
                                src={item.previewUrl}
                                alt={item.label}
                                class="h-full w-full object-cover"
                                onError={() => setFailedPreviews(index(), true)}
                              />
                            </Show>
                          </span>
                        </Show>

                        <div class="min-w-0 flex-1">
                          <p class="truncate text-sm leading-5">{item.label}</p>
                          <Show when={item.desc}>
                            <p class="mt-0.5 truncate text-xs leading-4 text-dimmed">{item.desc}</p>
                          </Show>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    );
  }, {
    panelClassName: getSearchPanelClassName(),
    contentClassName: "h-full min-h-0 p-0",
  });

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
    dialogCore.open(
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
      {
        panelClassName: getPanelClassName(options),
      },
    ),

  /**
   * Display a success dialog with a single OK button.
   */
  success: (content: string | HTMLElement | JSX.Element, options?: Omit<DialogOptions, "variant">) =>
    prompts.alert(content, {
      ...options,
      variant: "success",
      title: options?.title ?? "Success",
      icon: options?.icon ?? "ti ti-check",
    }),

  /**
   * Display a confirmation dialog with OK and Cancel buttons
   * @param content - Question/message to display
   * @param options - Optional styling and text configuration
   * @returns Promise resolving to true if confirmed, false if cancelled
   */
  confirm: (content: string | HTMLElement | JSX.Element, options?: DialogOptions) =>
    dialogCore.open<boolean>(
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
      {
        panelClassName: getPanelClassName(options),
      },
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
    size?: "small" | "medium" | "large";
  }): Promise<InferFormValues<T> | null> => {
    return dialogCore.open<InferFormValues<T> | null>((close) => {
      const state = createFormState(config.fields);

      // Field renderer map
      const fieldRenderers: Record<string, (props: any, field: any) => JSX.Element> = {
        text: (props, field) => (
          <TextInput
            {...props}
            multiline={field.multiline}
            lines={field.lines}
            icon={field.icon}
            activeIcon={field.activeIcon}
            password={field.password}
          />
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
    }, {
      panelClassName: getPanelClassName(config),
    }) as Promise<InferFormValues<T> | null>;
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
    dialogCore.open<T>(
      (close: (result?: T) => void) => (
        <div class="flex flex-col gap-4">
          <DialogHeader title={options?.title} icon={options?.icon} close={() => close(undefined)} />
          {component(close)}
        </div>
      ),
      {
        panelClassName: getPanelClassName(options),
      },
    ),

  search: openSearchPrompt,

  /**
   * Wrapper around the alert dialog with error styling and icon
   * @param content - Error message to display
   * @param options - Optional styling and text configuration
   * @returns Promise that resolves when dialog is closed
   */
  error: (content: string | HTMLElement, options?: DialogOptions) =>
    dialogCore.open(
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
      {
        panelClassName: getPanelClassName({ ...options, variant: "danger" }),
      },
    ),

  getDialogElement: () => (typeof document === "undefined" ? undefined : document.querySelector<HTMLDialogElement>("dialog")),
};
