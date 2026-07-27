import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";
import {
  type ChoiceOption,
  type ChoiceOptionsLoader,
  createChoiceLoader,
  createChoicePopover,
  filterChoiceOptions,
  nextEnabledChoiceIndex,
} from "./choice";

export type MultiSelectOption<T extends string = string> = ChoiceOption<T>;

export type MultiSelectInputProps<T extends string = string> = {
  options?: readonly MultiSelectOption<T>[];
  loadOptions?: ChoiceOptionsLoader<T>;
  values?: readonly T[];
  selectedOptions?: readonly MultiSelectOption<T>[];
  onValuesChange?: (values: T[]) => void;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  debounceMs?: number;
  searchable?: boolean;
  clearable?: boolean;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  class?: string;
  "aria-describedby"?: string;
};

const selectedColor = (color: string | undefined): JSX.CSSProperties | undefined => {
  if (!color || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim())) return undefined;
  return { "--k2b-choice-color": color.trim() };
};

export function MultiSelectInput<T extends string = string>(props: MultiSelectInputProps<T>): JSX.Element {
  const meta = createFieldMeta(props.id);
  const listboxId = `${meta.controlId}-listbox`;
  const [query, setQuery] = createSignal("");
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [cache, setCache] = createSignal<Record<string, MultiSelectOption<T>>>({});
  let searchRef: HTMLInputElement | undefined;

  const values = () => props.values ?? [];
  const asyncOptions = createChoiceLoader(
    () => props.loadOptions,
    () => props.debounceMs ?? 200,
  );
  const sourceOptions = () => (props.loadOptions ? asyncOptions.options() : (props.options ?? []));
  const searchable = () => props.searchable ?? true;
  const visibleOptions = createMemo(() =>
    props.loadOptions ? sourceOptions() : searchable() ? filterChoiceOptions(sourceOptions(), query()) : sourceOptions(),
  );
  const optionByValue = createMemo(() => {
    const options = new Map<T, MultiSelectOption<T>>();
    for (const option of Object.values(cache()) as MultiSelectOption<T>[]) options.set(option.value, option);
    for (const option of props.selectedOptions ?? []) options.set(option.value, option);
    for (const option of sourceOptions()) options.set(option.value, option);
    return options;
  });
  const selected = createMemo(() =>
    values().map((value) => optionByValue().get(value) ?? ({ value, label: value } as MultiSelectOption<T>)),
  );
  const popover = createChoicePopover(() => Boolean(props.disabled));
  const focusedOption = () => visibleOptions()[focusedIndex()];

  const emit = (next: readonly T[]) => props.onValuesChange?.([...new Set(next)]);
  const isSelected = (value: T) => values().includes(value);
  const focusFirst = () => setFocusedIndex(nextEnabledChoiceIndex(visibleOptions(), -1, 1));
  const open = () => {
    if (props.disabled) return;
    setQuery("");
    if (props.loadOptions) asyncOptions.load("", true);
    focusFirst();
    popover.show();
    if (searchable()) queueMicrotask(() => searchRef?.focus());
  };
  const close = (restoreFocus = false) => {
    asyncOptions.cancel();
    setQuery("");
    setFocusedIndex(-1);
    popover.hide(restoreFocus);
  };
  const toggleOption = (option: MultiSelectOption<T>) => {
    if (option.disabled) return;
    setCache({ ...cache(), [option.value]: option });
    emit(isSelected(option.value) ? values().filter((value) => value !== option.value) : [...values(), option.value]);
  };
  const remove = (value: T) => emit(values().filter((item) => item !== value));
  const move = (direction: 1 | -1) => {
    setFocusedIndex(nextEnabledChoiceIndex(visibleOptions(), focusedIndex(), direction));
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!popover.open()) open();
      else move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && !popover.open()) {
      event.preventDefault();
      open();
      return;
    }
    if (event.key === "Enter" && popover.open()) {
      const option = focusedOption();
      if (option) {
        event.preventDefault();
        toggleOption(option);
      }
      return;
    }
    if (event.key === "Backspace" && popover.open() && !query() && values().length > 0) {
      event.preventDefault();
      const last = values().at(-1);
      if (last) remove(last);
      return;
    }
    if (event.key === "Escape" && popover.open()) {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab" && popover.open()) {
      close();
    }
  };

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={props.error}
      meta={meta}
      required={props.required}
    >
      <div class="k2b-choice-control" data-invalid={props.error ? "true" : undefined}>
        <div
          ref={popover.setTrigger}
          id={meta.controlId}
          class="k2b-multi-select-trigger"
          role="combobox"
          tabIndex={props.disabled ? -1 : 0}
          aria-haspopup="listbox"
          aria-expanded={popover.open()}
          aria-controls={listboxId}
          aria-activedescendant={focusedOption() ? `${listboxId}-${focusedIndex()}` : undefined}
          aria-invalid={props.error ? "true" : undefined}
          aria-required={props.required}
          aria-disabled={props.disabled}
          aria-describedby={fieldDescribedBy(meta, props.description, props.error, props["aria-describedby"])}
          data-disabled={props.disabled ? "true" : undefined}
          onClick={() => (popover.open() ? close() : open())}
          onKeyDown={handleKeyDown}
        >
          <Show
            when={selected().length > 0}
            fallback={
              <span class="k2b-choice-trigger__value" data-placeholder="true">
                {props.placeholder ?? "Select…"}
              </span>
            }
          >
            <span class="k2b-multi-select-trigger__values">
              <For each={selected()}>
                {(option) => (
                  <span class="k2b-choice-pill" style={selectedColor(option.color)}>
                    <Show when={option.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
                    <span>{option.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${option.label}`}
                      disabled={props.disabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        remove(option.value);
                      }}
                    >
                      <i class="ti ti-x" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </For>
            </span>
          </Show>
          <i class="ti ti-chevron-down k2b-multi-select-trigger__chevron" aria-hidden="true" />
        </div>
        <Show when={props.clearable && selected().length > 0 && !props.disabled}>
          <button
            type="button"
            class="k2b-choice-control__clear"
            aria-label="Clear selection"
            onClick={(event) => {
              event.stopPropagation();
              emit([]);
              popover.trigger()?.focus();
            }}
          >
            <i class="ti ti-x" aria-hidden="true" />
          </button>
        </Show>

        <div
          ref={popover.setPopover}
          popover="manual"
          class="k2b-choice-popover"
          role="group"
          onKeyDown={handleKeyDown}
          aria-label={typeof props.label === "string" ? props.label : "Options"}
        >
          <Show when={searchable()}>
            <div class="k2b-choice-search">
              <i class="ti ti-search" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query()}
                placeholder={props.searchPlaceholder ?? "Search…"}
                aria-label={props.searchPlaceholder ?? "Search options"}
                aria-controls={listboxId}
                aria-activedescendant={focusedOption() ? `${listboxId}-${focusedIndex()}` : undefined}
                onInput={(event) => {
                  const next = event.currentTarget.value;
                  setQuery(next);
                  if (props.loadOptions) asyncOptions.load(next);
                  focusFirst();
                }}
              />
            </div>
          </Show>
          <div id={listboxId} class="k2b-choice-options" role="listbox" aria-multiselectable="true">
            <Show when={asyncOptions.error()}>
              {(message) => (
                <div class="k2b-choice-status" data-tone="danger">
                  <span>{message()}</span>
                  <button type="button" onClick={asyncOptions.retry}>
                    Retry
                  </button>
                </div>
              )}
            </Show>
            <Show when={asyncOptions.loading() && visibleOptions().length === 0}>
              <div class="k2b-choice-status">{props.loadingMessage ?? "Loading…"}</div>
            </Show>
            <For
              each={asyncOptions.error() ? [] : visibleOptions()}
              fallback={
                <Show when={!asyncOptions.loading() && !asyncOptions.error()}>
                  <div class="k2b-choice-status">{props.emptyMessage ?? "No options available"}</div>
                </Show>
              }
            >
              {(option, index) => (
                <button
                  type="button"
                  id={`${listboxId}-${index()}`}
                  class="k2b-choice-option"
                  role="option"
                  aria-selected={isSelected(option.value)}
                  data-focused={index() === focusedIndex() ? "true" : undefined}
                  disabled={option.disabled}
                  onPointerMove={() => !option.disabled && setFocusedIndex(index())}
                  onClick={() => toggleOption(option)}
                >
                  <span class="k2b-choice-option__checkbox" aria-hidden="true">
                    <i class="ti ti-check" />
                  </span>
                  <Show when={option.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
                  <span>
                    <strong>{option.label}</strong>
                    <Show when={option.description}>{(description) => <small>{description()}</small>}</Show>
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </Field>
  );
}
