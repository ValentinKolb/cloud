import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import { dialogCore, type OpenDialogOptions } from "./dialog-core";

export interface DialogOptions {
  title?: string;
  icon?: string;
  confirmText?: string;
  cancelText?: string | false;
  variant?: "danger" | "primary" | "success";
  size?: "small" | "medium" | "large" | "wide";
  surface?: "default" | "bare";
  header?: false;
  cancelBehavior?: OpenDialogOptions["cancelBehavior"];
}

export type PromptContent = string | HTMLElement | JSX.Element;

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
  initialQuery?: string;
  minQueryLength?: number;
  debounceMs?: number;
  emptyText?: string;
  noResultsText?: string;
  empty?: string;
};

type BaseField<T = unknown> = {
  label?: string | false;
  description?: string;
  placeholder?: string;
  required?: boolean;
  default?: T;
  validate?: (value: T | undefined) => string | null;
};

export type FieldSchema =
  | (BaseField<string> & {
      type: "text";
      multiline?: boolean;
      lines?: number;
      maxLength?: number;
      minLength?: number;
      icon?: string;
      activeIcon?: string;
      password?: boolean;
      markdown?: boolean;
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
      accept?: string;
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
      dateOnly?: boolean;
    })
  | {
      type: "info";
      content: string | JSX.Element | (() => JSX.Element);
    };

export type InferFieldType<T extends FieldSchema> = T extends { type: "text" }
  ? string
  : T extends { type: "number" }
    ? number
    : T extends { type: "image" | "pin" | "select" | "datetime" }
      ? string
      : T extends { type: "tags" }
        ? string[]
        : T extends { type: "boolean" }
          ? boolean
          : never;

export type InferFormValues<T extends Record<string, FieldSchema>> = {
  [K in keyof T as T[K] extends { type: "info" } ? never : K]: T[K] extends { required: true }
    ? InferFieldType<T[K]>
    : InferFieldType<T[K]> | undefined;
};

export type PromptField = FieldSchema;
export type PromptFormValue = string | number | boolean | string[] | undefined;
export type PromptFormOptions<T extends Record<string, FieldSchema>> = DialogOptions & {
  fields: T;
  submitText?: string;
};
export type PromptSearchResult = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
};

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

export const createFormState = <T extends Record<string, FieldSchema>>(schema: T) => {
  const [values, setValues] = createStore<Record<string, PromptFormValue>>({});
  const [errors, setErrors] = createStore<Record<string, string | undefined>>({});

  for (const [key, field] of Object.entries(schema)) {
    if (field.type !== "info" && "default" in field) setValues(key, field.default as PromptFormValue);
  }

  const validateField = (key: string, value: PromptFormValue): string | null => {
    const field = schema[key];
    if (!field || field.type === "info") return null;
    if (field.required && isEmpty(value)) return "required";
    if (field.type === "text" && typeof value === "string") {
      if (field.minLength !== undefined && value.length < field.minLength) return `minimum ${field.minLength} characters`;
      if (field.maxLength !== undefined && value.length > field.maxLength) return `maximum ${field.maxLength} characters`;
    }
    if (field.type === "number" && typeof value === "number") {
      if (field.min !== undefined && value < field.min) return `minimum ${field.min}`;
      if (field.max !== undefined && value > field.max) return `maximum ${field.max}`;
    }
    if (field.type === "pin" && typeof value === "string" && field.length !== undefined && value.length !== field.length) {
      return `enter ${field.length} digits`;
    }
    if (field.type === "tags" && Array.isArray(value)) {
      if (field.minTags !== undefined && value.length < field.minTags) return `minimum ${field.minTags} tags`;
      if (field.maxTags !== undefined && value.length > field.maxTags) return `maximum ${field.maxTags} tags`;
    }
    if ("validate" in field && field.validate) {
      return (field.validate as (next: never) => string | null)(value as never);
    }
    return null;
  };

  const updateField = (key: string, value: PromptFormValue) => {
    setValues(key, value);
    setErrors(key, validateField(key, value) ?? undefined);
  };

  const validateAll = (): boolean => {
    let valid = true;
    for (const [key, field] of Object.entries(schema)) {
      if (field.type === "info") continue;
      const error = validateField(key, values[key]);
      setErrors(key, error ?? undefined);
      if (error) valid = false;
    }
    return valid;
  };

  const reset = () => {
    for (const [key, field] of Object.entries(schema)) {
      if (field.type === "info") continue;
      setValues(key, "default" in field ? (field.default as PromptFormValue) : undefined);
      setErrors(key, undefined);
    }
  };

  return { values, errors, updateField, validateAll, reset };
};

export const DialogHeader = (props: { close: () => void; title?: string; icon?: string }): JSX.Element => (
  <header class="k2b-dialog__header">
    <Show when={props.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
    <Show when={props.title} fallback={<span class="k2b-dialog__header-spacer" />}>
      <h2>{props.title}</h2>
    </Show>
    <button type="button" class="k2b-dialog__close" aria-label="close dialog" onClick={props.close}>
      <i class="ti ti-x" aria-hidden="true" />
    </button>
  </header>
);

const contentNode = (content: PromptContent): JSX.Element =>
  typeof content === "string" ? <p class="k2b-dialog__message">{content}</p> : content;

const panelClass = (options?: Pick<DialogOptions, "size" | "surface" | "variant">): string => {
  const size = options?.size ?? "medium";
  const variant = options?.variant ?? "primary";
  return `k2b-dialog k2b-dialog--${size} k2b-dialog--${variant}${options?.surface === "bare" ? " is-bare" : ""}`;
};

const contentClass = (surface?: DialogOptions["surface"]): string =>
  surface === "bare" ? "k2b-dialog__viewport is-bare" : "k2b-dialog__viewport";

const renderInfo = (content: Extract<FieldSchema, { type: "info" }>["content"]): JSX.Element => {
  if (typeof content === "string") return <p>{content}</p>;
  if (typeof content === "function") return content();
  return content;
};

const PromptControl = (props: {
  id: string;
  field: Exclude<FieldSchema, { type: "info" }>;
  value: () => PromptFormValue;
  update: (value: PromptFormValue) => void;
  error: () => string | undefined;
}): JSX.Element => {
  const common = {
    id: props.id,
    class: "k2b-control",
    required: props.field.required,
    placeholder: props.field.placeholder,
    "aria-invalid": props.error() ? ("true" as const) : undefined,
    "aria-describedby": props.error() ? `${props.id}-error` : undefined,
  };

  switch (props.field.type) {
    case "text":
      return props.field.multiline ? (
        <textarea
          {...common}
          rows={props.field.lines}
          minlength={props.field.minLength}
          maxlength={props.field.maxLength}
          value={String(props.value() ?? "")}
          data-markdown={props.field.markdown ? "true" : undefined}
          onInput={(event) => props.update(event.currentTarget.value)}
        />
      ) : (
        <input
          {...common}
          type={props.field.password ? "password" : "text"}
          minlength={props.field.minLength}
          maxlength={props.field.maxLength}
          value={String(props.value() ?? "")}
          onInput={(event) => props.update(event.currentTarget.value)}
        />
      );
    case "number":
      return (
        <input
          {...common}
          type="number"
          min={props.field.min}
          max={props.field.max}
          step={props.field.step}
          value={typeof props.value() === "number" ? String(props.value()) : ""}
          onInput={(event) => props.update(event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber)}
        />
      );
    case "image":
      return (
        <span class="k2b-prompt-form__image">
          <Show when={typeof props.value() === "string" && props.value()}>
            <img
              src={String(props.value())}
              alt=""
              data-round={props.field.round ? "true" : undefined}
            />
          </Show>
          <input
            {...common}
            type="file"
            accept={props.field.accept ?? "image/*"}
            aria-label={props.field.ariaLabel}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.addEventListener("load", () => props.update(String(reader.result ?? "")), { once: true });
              reader.readAsDataURL(file);
            }}
          />
        </span>
      );
    case "pin":
      return (
        <input
          {...common}
          type="password"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength={props.field.length}
          pattern={props.field.length ? `\\d{${props.field.length}}` : "\\d*"}
          value={String(props.value() ?? "")}
          data-stretch={props.field.stretch ? "true" : undefined}
          onInput={(event) => props.update(event.currentTarget.value.replace(/\D/g, ""))}
        />
      );
    case "select":
      return (
        <select
          {...common}
          value={String(props.value() ?? "")}
          onChange={(event) => props.update(event.currentTarget.value || undefined)}
        >
          <Show when={props.field.clearable}>
            <option value="">None</option>
          </Show>
          <For each={props.field.options}>
            {(option) => (
              <option value={typeof option === "string" ? option : option.id}>
                {typeof option === "string" ? option : (option.label ?? option.id)}
              </option>
            )}
          </For>
        </select>
      );
    case "tags":
      return (
        <input
          {...common}
          value={Array.isArray(props.value()) ? (props.value() as string[]).join(", ") : ""}
          onInput={(event) =>
            props.update(
              event.currentTarget.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            )
          }
        />
      );
    case "boolean":
      return (
        <input
          id={props.id}
          type="checkbox"
          required={props.field.required}
          checked={Boolean(props.value())}
          aria-invalid={props.error() ? "true" : undefined}
          aria-describedby={props.error() ? `${props.id}-error` : undefined}
          onChange={(event) => props.update(event.currentTarget.checked)}
        />
      );
    case "datetime":
      return (
        <input
          {...common}
          type={props.field.dateOnly ? "date" : "datetime-local"}
          value={String(props.value() ?? "")}
          onInput={(event) => props.update(event.currentTarget.value)}
        />
      );
  }
};

const PromptFormDialog = <T extends Record<string, FieldSchema>>(props: {
  config: PromptFormOptions<T>;
  close: (value: InferFormValues<T> | null) => void;
}): JSX.Element => {
  const formId = createUniqueId();
  const state = createFormState(props.config.fields);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (state.validateAll()) props.close(state.values as InferFormValues<T>);
  };

  return (
    <form class="k2b-dialog__panel" onSubmit={submit}>
      <Show when={props.config.header !== false}>
        <DialogHeader title={props.config.title} icon={props.config.icon} close={() => props.close(null)} />
      </Show>
      <div class="k2b-dialog__body k2b-prompt-form">
        <For each={Object.entries(props.config.fields)}>
          {([key, field]) => {
            if (field.type === "info") return <div class="k2b-prompt-form__info">{renderInfo(field.content)}</div>;
            const id = `${formId}-${key}`;
            return (
              <div class="k2b-prompt-form__field">
                <Show when={field.label !== false && field.label}>
                  <label for={id}>{field.label}</label>
                </Show>
                <Show when={field.description}>{(description) => <small>{description()}</small>}</Show>
                <PromptControl
                  id={id}
                  field={field}
                  value={() => state.values[key]}
                  update={(value) => state.updateField(key, value)}
                  error={() => state.errors[key]}
                />
                <Show when={state.errors[key]}>
                  {(error) => (
                    <small id={`${id}-error`} class="k2b-prompt-form__error" role="alert">
                      {error()}
                    </small>
                  )}
                </Show>
              </div>
            );
          }}
        </For>
      </div>
      <footer class="k2b-dialog__actions">
        <Show when={props.config.cancelText !== false}>
          <button type="button" class="k2b-button" data-variant="secondary" onClick={() => props.close(null)}>
            {props.config.cancelText || "Cancel"}
          </button>
        </Show>
        <button type="submit" class="k2b-button" data-variant={props.config.variant ?? "primary"}>
          {props.config.submitText ?? props.config.confirmText ?? "Save"}
        </button>
      </footer>
    </form>
  );
};

type CloudSearchResolver<T> = (
  input: PromptSearchInput,
) => Promise<PromptSearchItem<T>[]> | PromptSearchItem<T>[];
type SimpleSearchResolver<T extends PromptSearchResult> = (
  query: string,
  signal: AbortSignal,
) => Promise<readonly T[]>;

function openSearchPrompt<T = unknown>(
  resolver: CloudSearchResolver<T>,
  options?: PromptSearchOptions,
): Promise<PromptSearchItem<T> | undefined>;
function openSearchPrompt<T extends PromptSearchResult>(
  resolver: SimpleSearchResolver<T>,
  options?: PromptSearchOptions,
): Promise<T | null>;
function openSearchPrompt<T>(
  resolver: CloudSearchResolver<T> | SimpleSearchResolver<PromptSearchResult>,
  options?: PromptSearchOptions,
): Promise<PromptSearchItem<T> | PromptSearchResult | null | undefined> {
  let input: HTMLInputElement | undefined;
  const simpleResolver = resolver.length >= 2;
  return dialogCore
    .open<PromptSearchItem<T> | PromptSearchResult>(
      (close) => {
        const [query, setQuery] = createSignal(options?.initialQuery ?? "");
        const [items, setItems] = createSignal<Array<PromptSearchItem<T> | PromptSearchResult>>([]);
        const [activeIndex, setActiveIndex] = createSignal(0);
        const [loaded, setLoaded] = createSignal(false);
        const [loading, setLoading] = createSignal(false);
        const [error, setError] = createSignal<string>();
        const [failedPreviews, setFailedPreviews] = createStore<Record<number, true>>({});
        let timer: ReturnType<typeof setTimeout> | undefined;
        let controller: AbortController | undefined;
        let generation = 0;

        const minQueryLength = options?.minQueryLength ?? 0;
        const debounceMs = options?.debounceMs ?? 180;
        const showResults = createMemo(
          () => query().trim().length >= minQueryLength && (loaded() || loading() || Boolean(error()) || items().length > 0),
        );
        const emptyText = createMemo(() => {
          if (!loaded()) return options?.emptyText ?? "Type to search.";
          return options?.noResultsText ?? options?.empty ?? "No results.";
        });

        const resolve = async (nextQuery: string, signal: AbortSignal) => {
          if (simpleResolver) {
            return (await (resolver as SimpleSearchResolver<PromptSearchResult>)(nextQuery, signal)).slice();
          }
          return ((await (resolver as CloudSearchResolver<T>)({ query: nextQuery, abortSignal: signal })) ?? []).slice();
        };

        const search = async (nextQuery: string) => {
          controller?.abort();
          controller = new AbortController();
          const current = ++generation;
          setLoading(true);
          setError();
          try {
            const next = await resolve(nextQuery, controller.signal);
            if (current !== generation) return;
            setItems(next);
            setActiveIndex(0);
            setLoaded(true);
          } catch (cause) {
            if (current !== generation || (cause instanceof DOMException && cause.name === "AbortError")) return;
            setItems([]);
            setLoaded(true);
            setError(cause instanceof Error ? cause.message : "Search failed.");
          } finally {
            if (current === generation) setLoading(false);
          }
        };

        createEffect(() => {
          const nextQuery = query().trim();
          setFailedPreviews({});
          if (timer) clearTimeout(timer);
          if (nextQuery.length < minQueryLength) {
            controller?.abort();
            setItems([]);
            setLoaded(false);
            setLoading(false);
            setError();
            return;
          }
          timer = setTimeout(() => void search(nextQuery), debounceMs);
        });

        createEffect(() => {
          const max = items().length - 1;
          if (max < 0) setActiveIndex(0);
          else if (activeIndex() > max) setActiveIndex(max);
        });

        onCleanup(() => {
          if (timer) clearTimeout(timer);
          controller?.abort();
        });

        const execute = async (item?: PromptSearchItem<T> | PromptSearchResult) => {
          if (!item) return;
          if ("onClick" in item && item.onClick) await item.onClick(item as PromptSearchItem<T>);
          close(item);
        };
        const move = (delta: -1 | 1) => {
          if (items().length === 0) return;
          setActiveIndex((index) => (index + delta + items().length) % items().length);
        };

        return (
          <div class="k2b-prompt-search-shell">
            <Show when={options?.title}>
              {(title) => <h2 class="k2b-prompt-search-shell__title">{title()}</h2>}
            </Show>
            <div class="k2b-prompt-search">
              <label class="k2b-prompt-search__input">
                <i class={options?.icon ?? "ti ti-search"} aria-hidden="true" />
                <input
                  ref={input}
                  type="search"
                  aria-label={options?.title ?? options?.placeholder ?? "Search"}
                  value={query()}
                  placeholder={options?.placeholder ?? "Search..."}
                  spellcheck={false}
                  autocapitalize="off"
                  autocomplete="off"
                  autocorrect="off"
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      move(1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      move(-1);
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      void execute(items()[activeIndex()]);
                    }
                  }}
                />
                <Show when={loading()}>
                  <span role="status" aria-label="Searching">
                    <i class="ti ti-loader-2 k2b-spin" aria-hidden="true" />
                  </span>
                </Show>
              </label>
              <Show when={showResults()}>
                <div
                  class="k2b-prompt-search__results"
                  role="listbox"
                  aria-label={options?.title ? `${options.title} results` : "Search results"}
                >
                  <Show when={error()}>{(message) => <p class="k2b-prompt-search__error">{message()}</p>}</Show>
                  <For each={items()} fallback={<span>{emptyText()}</span>}>
                    {(item, index) => {
                      const description = () =>
                        (item as PromptSearchItem<T>).desc ?? (item as PromptSearchResult).description;
                      const previewUrl = () => ("previewUrl" in item ? item.previewUrl : undefined);
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={activeIndex() === index()}
                          data-active={activeIndex() === index() ? "true" : undefined}
                          onMouseEnter={() => setActiveIndex(index())}
                          onClick={() => void execute(item)}
                        >
                          <Show when={(previewUrl()?.startsWith("/") && !failedPreviews[index()]) || item.icon}>
                            <span class="k2b-prompt-search__preview">
                              <Show
                                when={previewUrl()?.startsWith("/") && !failedPreviews[index()]}
                                fallback={<i class={item.icon ?? "ti ti-file"} aria-hidden="true" />}
                              >
                                <img
                                  src={previewUrl()}
                                  alt={item.label}
                                  onError={() => setFailedPreviews(index(), true)}
                                />
                              </Show>
                            </span>
                          </Show>
                          <span>
                            <strong>{item.label}</strong>
                            <Show when={description()}>{(value) => <small>{value()}</small>}</Show>
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        );
      },
      {
        panelClassName: "k2b-dialog k2b-dialog--search is-bare",
        contentClassName: "k2b-dialog__viewport is-search",
        initialFocus: () => input ?? null,
        cancelBehavior: options?.cancelBehavior,
      },
    )
    .then((value) => (simpleResolver ? (value ?? null) : value));
}

function promptText(content: string, defaultValue?: string, options?: DialogOptions): Promise<string | null>;
function promptText(
  content: PromptContent,
  options?: DialogOptions & { defaultValue?: string; placeholder?: string; required?: boolean },
): Promise<string | null>;
function promptText(
  content: PromptContent,
  defaultValueOrOptions?: string | (DialogOptions & { defaultValue?: string; placeholder?: string; required?: boolean }),
  legacyOptions?: DialogOptions,
): Promise<string | null> {
  const options: (DialogOptions & { defaultValue?: string; placeholder?: string; required?: boolean }) | undefined =
    typeof defaultValueOrOptions === "string" ? legacyOptions : defaultValueOrOptions;
  const defaultValue = typeof defaultValueOrOptions === "string" ? defaultValueOrOptions : defaultValueOrOptions?.defaultValue;
  return prompts
    .form({
      ...options,
      fields: {
        message: { type: "info", content },
        value: {
          type: "text",
          label: false,
          default: defaultValue ?? "",
          placeholder: options?.placeholder,
          required: options?.required,
        },
      },
    })
    .then((result) => result?.value ?? null);
}

function promptNumber(content: string, defaultValue?: number, options?: DialogOptions & { min?: number; max?: number }): Promise<number | null>;
function promptNumber(
  content: PromptContent,
  options?: DialogOptions & { defaultValue?: number; min?: number; max?: number; step?: number },
): Promise<number | null>;
function promptNumber(
  content: PromptContent,
  defaultValueOrOptions?: number | (DialogOptions & { defaultValue?: number; min?: number; max?: number; step?: number }),
  legacyOptions?: DialogOptions & { min?: number; max?: number },
): Promise<number | null> {
  const options: (DialogOptions & { defaultValue?: number; min?: number; max?: number; step?: number }) | undefined =
    typeof defaultValueOrOptions === "number" ? legacyOptions : defaultValueOrOptions;
  const defaultValue = typeof defaultValueOrOptions === "number" ? defaultValueOrOptions : defaultValueOrOptions?.defaultValue;
  return prompts
    .form({
      ...options,
      fields: {
        message: { type: "info", content },
        value: {
          type: "number",
          label: false,
          default: defaultValue ?? 0,
          min: options?.min,
          max: options?.max,
          step: options?.step,
        },
      },
    })
    .then((result) => result?.value ?? null);
}

export const prompts = {
  alert: (content: PromptContent, options?: DialogOptions): Promise<void | undefined> =>
    dialogCore.open<void>(
      (close) => (
        <div class="k2b-dialog__panel">
          <Show when={options?.header !== false}>
            <DialogHeader title={options?.title || "Info"} icon={options?.icon} close={() => close()} />
          </Show>
          <div class="k2b-dialog__body">{contentNode(content)}</div>
          <footer class="k2b-dialog__actions">
            <button type="button" class="k2b-button" data-variant={options?.variant ?? "primary"} onClick={() => close()}>
              {options?.confirmText || "OK"}
            </button>
          </footer>
        </div>
      ),
      {
        panelClassName: panelClass(options),
        contentClassName: contentClass(options?.surface),
        cancelBehavior: options?.cancelBehavior,
      },
    ),

  success: (content: PromptContent, options?: Omit<DialogOptions, "variant">): Promise<void | undefined> =>
    prompts.alert(content, {
      ...options,
      variant: "success",
      title: options?.title ?? "Success",
      icon: options?.icon ?? "ti ti-check",
    }),

  confirm: (content: PromptContent, options?: DialogOptions): Promise<boolean | undefined> =>
    dialogCore.open<boolean>(
      (close) => (
        <div class="k2b-dialog__panel">
          <Show when={options?.header !== false}>
            <DialogHeader title={options?.title} icon={options?.icon} close={() => close(false)} />
          </Show>
          <div class="k2b-dialog__body">{contentNode(content)}</div>
          <footer class="k2b-dialog__actions">
            <Show when={options?.cancelText !== false}>
              <button type="button" class="k2b-button" data-variant="secondary" onClick={() => close(false)}>
                {options?.cancelText || "Cancel"}
              </button>
            </Show>
            <button type="button" class="k2b-button" data-variant={options?.variant ?? "primary"} onClick={() => close(true)}>
              {options?.confirmText || "Confirm"}
            </button>
          </footer>
        </div>
      ),
      {
        panelClassName: panelClass(options),
        contentClassName: contentClass(options?.surface),
        cancelBehavior: options?.cancelBehavior,
      },
    ),

  prompt: promptText,
  promptNumber,

  form: <T extends Record<string, FieldSchema>>(config: PromptFormOptions<T>): Promise<InferFormValues<T> | null> =>
    dialogCore
      .open<InferFormValues<T> | null>(
        (close) => <PromptFormDialog config={config} close={(value) => close(value)} />,
        {
          panelClassName: panelClass(config),
          contentClassName: contentClass(config.surface),
          cancelBehavior: config.cancelBehavior,
        },
      )
      .then((value) => value ?? null),

  dialog: <T = unknown>(
    component: (close: (result?: T) => void) => JSX.Element,
    options?: DialogOptions,
  ): Promise<T | undefined> =>
    dialogCore.open<T>(
      (close) => {
        const body = component(close);
        if (options?.surface === "bare" && options.header === false) return body;
        return (
          <div class="k2b-dialog__panel">
            <Show when={options?.header !== false}>
              <DialogHeader title={options?.title} icon={options?.icon} close={() => close(undefined)} />
            </Show>
            <div class="k2b-dialog__body">{body}</div>
          </div>
        );
      },
      {
        panelClassName: panelClass(options),
        contentClassName: contentClass(options?.surface),
        cancelBehavior: options?.cancelBehavior,
      },
    ),

  search: openSearchPrompt,

  error: (content: PromptContent, options?: DialogOptions): Promise<void | undefined> =>
    prompts.alert(content, {
      ...options,
      title: options?.title ?? "Error",
      icon: options?.icon ?? "ti ti-alert-circle",
      variant: "danger",
      confirmText: options?.confirmText ?? "Close",
    }),

  getDialogElement: (): HTMLDialogElement | undefined => dialogCore.getDialogElement(),
};
