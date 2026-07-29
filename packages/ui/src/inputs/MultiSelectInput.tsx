import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createFieldMeta, Field, fieldControlAria } from "../internal/field";
import { type ChoiceOption, createChoiceLoader, createChoicePopover, filterChoiceOptions, nextEnabledChoiceIndex } from "./choice";
import type { ValueFieldProps } from "./field-contract";
import { commitFieldValue, resolveMaybeAccessor } from "./field-contract";

export type MultiSelectOption =
  | string
  | { id: string; label?: string; description?: string; icon?: string; color?: string }
  | ChoiceOption<string>;
type NormalizedOption = ChoiceOption<string>;
export type MultiSelectFetchDataFn = (query: string, signal: AbortSignal) => Promise<MultiSelectOption[]>;

export type MultiSelectInputProps = ValueFieldProps<string[]> & {
  options?: MultiSelectOption[];
  fetchData?: MultiSelectFetchDataFn;
  selectedOptions?: () => MultiSelectOption[];
  placeholder?: string;
  icon?: string;
  activeIcon?: string;
  fetchDebounceMs?: number;
  debounceMs?: number;
  loadOptions?: (query: string, signal: AbortSignal) => Promise<readonly ChoiceOption<string>[]>;
  searchable?: boolean;
  clearable?: boolean;
  name?: string;
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const selectedColor = (color: string | undefined): JSX.CSSProperties | undefined => {
  if (!color || !HEX_COLOR.test(color.trim())) return undefined;
  return { "--k2b-choice-color": color.trim() };
};

/** Cloud tints the option icon with the option color instead of adding a dot. */
const iconColor = (color: string | undefined): JSX.CSSProperties | undefined =>
  color && HEX_COLOR.test(color.trim()) ? { color: color.trim() } : undefined;

const normalize = (option: MultiSelectOption): NormalizedOption =>
  typeof option === "string"
    ? { value: option, label: option }
    : "value" in option
      ? option
      : { ...option, value: option.id, label: option.label || option.id };

export function MultiSelectInput(props: MultiSelectInputProps): JSX.Element {
  const meta = createFieldMeta(props.id);
  const listboxId = `${meta.controlId}-listbox`;
  const [query, setQuery] = createSignal("");
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [cache, setCache] = createSignal<Record<string, NormalizedOption>>({});
  let searchRef: HTMLInputElement | undefined;

  const values = () => resolveMaybeAccessor(props.value) ?? [];
  const error = () => resolveMaybeAccessor(props.error);
  const asyncOptions = createChoiceLoader(
    () => props.fetchData ? async (query, signal) => (await props.fetchData!(query, signal)).map(normalize) : props.loadOptions,
    () => props.fetchDebounceMs ?? props.debounceMs ?? 200,
  );
  const isAsync = () => Boolean(props.fetchData || props.loadOptions);
  const sourceOptions = () => (isAsync() ? asyncOptions.options() : (props.options ?? []).map(normalize));
  // Cloud's multi-select always renders its search field, and filters a static
  // option list client-side while a remote loader filters server-side.
  const searchable = () => isAsync() || (props.searchable ?? true);
  const visibleOptions = createMemo(() =>
    isAsync() ? sourceOptions() : filterChoiceOptions(sourceOptions(), searchable() ? query() : ""),
  );
  const optionByValue = createMemo(() => {
    const options = new Map<string, NormalizedOption>();
    for (const option of Object.values(cache())) options.set(option.value, option);
    for (const option of (props.selectedOptions?.() ?? []).map(normalize)) options.set(option.value, option);
    for (const option of sourceOptions()) options.set(option.value, option);
    return options;
  });
  const selected = createMemo(() =>
    values().map((value) => optionByValue().get(value) ?? ({ value, label: value } as NormalizedOption)),
  );
  const popover = createChoicePopover(() => Boolean(props.disabled));
  const focusedOption = () => visibleOptions()[focusedIndex()];

  const emit = (next: readonly string[]) => {
    const unique = [...new Set(next)];
    commitFieldValue(props, unique);
  };
  const isSelected = (value: string) => values().includes(value);
  const focusFirst = () => setFocusedIndex(nextEnabledChoiceIndex(visibleOptions(), -1, 1));
  const open = () => {
    if (props.disabled) return;
    setQuery("");
    if (isAsync()) asyncOptions.load("", true);
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
  const toggleOption = (option: NormalizedOption) => {
    if (option.disabled) return;
    setCache({ ...cache(), [option.value]: option });
    emit(isSelected(option.value) ? values().filter((value) => value !== option.value) : [...values(), option.value]);
  };
  const remove = (value: string) => emit(values().filter((item) => item !== value));
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
      label={props.label}
      description={props.description}
      error={error()}
      meta={meta}
      required={props.required}
      disabled={props.disabled}
    >
      <div class="k2b-choice-control" data-invalid={error() ? "true" : undefined}>
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
          {...fieldControlAria(meta, props)}
          aria-disabled={props.disabled}
          data-disabled={props.disabled ? "true" : undefined}
          onClick={() => (popover.open() ? close() : open())}
          onKeyDown={handleKeyDown}
        >
          <Show
            when={selected().length > 0}
            fallback={
              <span class="k2b-choice-trigger__value" data-placeholder="true">
                {props.placeholder ?? "Select..."}
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
                      tabIndex={-1}
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
          <i
            class={`${popover.open() ? (props.activeIcon ?? "ti ti-chevron-up") : (props.icon ?? "ti ti-chevron-down")} k2b-multi-select-trigger__chevron`}
            aria-hidden="true"
          />
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
                placeholder="Search..."
                aria-label="Search options"
                aria-controls={listboxId}
                aria-activedescendant={focusedOption() ? `${listboxId}-${focusedIndex()}` : undefined}
                onInput={(event) => {
                  const next = event.currentTarget.value;
                  setQuery(next);
                  if (isAsync()) asyncOptions.load(next);
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
              <div class="k2b-choice-status">
                <i class="ti ti-loader-2 k2b-spin" aria-hidden="true" />
                <span>Loading...</span>
              </div>
            </Show>
            <For
              each={asyncOptions.error() ? [] : visibleOptions()}
              fallback={
                <Show when={!asyncOptions.loading() && !asyncOptions.error()}>
                  <div class="k2b-choice-status">{isAsync() || query() ? "No results" : "No options available"}</div>
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
                  <Show when={option.icon}>
                    {(icon) => <i class={icon()} style={iconColor(option.color)} aria-hidden="true" />}
                  </Show>
                  <span>
                    <strong>{option.label}</strong>
                    <Show when={option.description}>{(description) => <small>{description()}</small>}</Show>
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
        <Show when={props.name}>
          {(name) => <input type="hidden" name={name()} value={values().join(",")} />}
        </Show>
      </div>
    </Field>
  );
}

export default MultiSelectInput;
