import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createFieldMeta, Field, fieldControlAria } from "../internal/field";
import {
  type ChoiceOption,
  createChoiceLoader,
  createChoicePopover,
  filterChoiceOptions,
  nextEnabledChoiceIndex,
} from "./choice";
import type { ValueFieldProps } from "./field-contract";
import { commitFieldValue, resolveMaybeAccessor } from "./field-contract";

export type SelectOption = ChoiceOption<string>;
export type SelectSourceOption =
  | string
  | { id: string; label?: string; description?: string; icon?: string; color?: string }
  | SelectOption;

export type SelectProps = ValueFieldProps<string | null> & {
  placeholder?: string;
  icon?: string;
  activeIcon?: string;
  options?: SelectSourceOption[];
  fetchData?: (query: string, signal: AbortSignal) => Promise<SelectSourceOption[]>;
  loadOptions?: (query: string, signal: AbortSignal) => Promise<readonly ChoiceOption<string>[]>;
  selectedOption?: ChoiceOption<string>;
  selectedLabel?: () => string | undefined;
  fetchDebounceMs?: number;
  debounceMs?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  clearable?: boolean;
  name?: string;
};

type NormalizedOption = ChoiceOption<string>;
const normalize = (option: SelectSourceOption): NormalizedOption =>
  typeof option === "string"
    ? { value: option, label: option }
    : "value" in option
      ? option
      : { ...option, value: option.id, label: option.label || option.id };

export function Select(props: SelectProps): JSX.Element {
  const meta = createFieldMeta(props.id);
  const listboxId = `${meta.controlId}-listbox`;
  const [query, setQuery] = createSignal("");
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [cache, setCache] = createSignal<Record<string, NormalizedOption>>({});
  let searchRef: HTMLInputElement | undefined;
  let optionRefs: HTMLButtonElement[] = [];
  const value = () => resolveMaybeAccessor(props.value) ?? null;
  const error = () => resolveMaybeAccessor(props.error);

  const loader = createChoiceLoader(
    () =>
      props.fetchData
        ? async (value, signal) => (await props.fetchData!(value, signal)).map(normalize)
        : props.loadOptions,
    () => props.fetchDebounceMs ?? props.debounceMs ?? 200,
  );
  const isAsync = () => Boolean(props.fetchData || props.loadOptions);
  const isSearchable = () => isAsync() || Boolean(props.searchable);
  const sourceOptions = createMemo(() => (isAsync() ? loader.options() : (props.options ?? []).map(normalize)));
  // Remote loaders filter server-side; a static list has to be filtered here or
  // the search field would render but do nothing.
  const options = createMemo(() => (isAsync() || !props.searchable ? sourceOptions() : filterChoiceOptions(sourceOptions(), query())));
  const selected = createMemo(() => {
    const current = value();
    if (!current) return undefined;
    // Resolve against the unfiltered list so typing in the search field never
    // blanks the trigger label of the current selection.
    return sourceOptions().find((option) => option.value === current) ?? cache()[current] ?? props.selectedOption ?? { value: current, label: props.selectedLabel?.() ?? current };
  });
  const popover = createChoicePopover(() => Boolean(props.disabled));
  const focusedOption = () => options()[focusedIndex()];
  const focus = (index: number) => {
    setFocusedIndex(index);
    optionRefs[index]?.scrollIntoView({ block: "nearest" });
  };
  const move = (direction: 1 | -1) => focus(nextEnabledChoiceIndex(options(), focusedIndex(), direction));
  const open = () => {
    if (props.disabled) return;
    setQuery("");
    if (isAsync()) loader.load("", true);
    const selectedIndex = options().findIndex((option) => option.value === value());
    focus(selectedIndex >= 0 ? selectedIndex : nextEnabledChoiceIndex(options(), -1, 1));
    popover.show();
    if (isSearchable()) queueMicrotask(() => searchRef?.focus());
  };
  const close = (restoreFocus = false) => {
    loader.cancel();
    setQuery("");
    setFocusedIndex(-1);
    popover.hide(restoreFocus);
  };
  const select = (option: NormalizedOption) => {
    if (option.disabled) return;
    setCache({ ...cache(), [option.value]: option });
    commitFieldValue(props, option.value);
    close(true);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!popover.open()) open();
      else move(event.key === "ArrowDown" ? 1 : -1);
    } else if ((event.key === "Enter" || event.key === " ") && !popover.open()) {
      event.preventDefault();
      open();
    } else if (event.key === "Enter" && focusedOption()) {
      event.preventDefault();
      select(focusedOption()!);
    } else if (event.key === "Escape" && popover.open()) {
      // Only swallow Escape while the list is open — a closed select must let
      // the key bubble to an enclosing dialog or drawer.
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab" && popover.open()) close();
  };
  const clear = (event: MouseEvent) => {
    event.stopPropagation();
    commitFieldValue(props, null);
    popover.trigger()?.focus();
  };

  return (
    <Field
      class={props.class}
      label={props.label}
      description={props.description}
      error={error()}
      meta={meta}
      required={props.required}
      disabled={props.disabled}
    >
      <div class="k2b-choice-control" data-invalid={error() ? "true" : undefined}>
        <button
          ref={popover.setTrigger}
          id={meta.controlId}
          type="button"
          class="k2b-choice-trigger"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={popover.open()}
          aria-controls={listboxId}
          aria-activedescendant={focusedOption() ? `${listboxId}-${focusedIndex()}` : undefined}
          {...fieldControlAria(meta, props)}
          disabled={props.disabled}
          onClick={() => (popover.open() ? close() : open())}
          onKeyDown={onKeyDown}
        >
          <Show
            when={selected()?.color}
            fallback={<Show when={selected()?.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>}
          >
            {(color) => <span class="k2b-choice-dot" style={{ "background-color": color() }} aria-hidden="true" />}
          </Show>
          <span class="k2b-choice-trigger__value" data-placeholder={selected() ? undefined : "true"}>
            {selected()?.label ?? props.placeholder ?? "Select..."}
          </span>
          <i class={popover.open() ? (props.activeIcon ?? "ti ti-chevron-up") : (props.icon ?? "ti ti-chevron-down")} aria-hidden="true" />
        </button>
        <Show when={props.name}>{(name) => <input type="hidden" name={name()} value={value() ?? ""} />}</Show>
        <Show when={props.clearable && selected() && !props.disabled}>
          <button type="button" class="k2b-choice-control__clear" aria-label="Clear selection" onClick={clear}>
            <i class="ti ti-x" aria-hidden="true" />
          </button>
        </Show>
        <div ref={popover.setPopover} popover="manual" class="k2b-choice-popover" role="group" onKeyDown={onKeyDown} aria-label={typeof props.label === "string" ? props.label : "Options"}>
          <Show when={isSearchable()}>
            <div class="k2b-choice-search">
              <i class="ti ti-search" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query()}
                placeholder={props.searchPlaceholder ?? "Search..."}
                aria-label={props.searchPlaceholder ?? "Search options"}
                aria-controls={listboxId}
                aria-activedescendant={focusedOption() ? `${listboxId}-${focusedIndex()}` : undefined}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  if (isAsync()) loader.load(event.currentTarget.value);
                  focus(isAsync() ? -1 : nextEnabledChoiceIndex(options(), -1, 1));
                }}
              />
            </div>
          </Show>
          <div id={listboxId} class="k2b-choice-options" role="listbox">
            <Show when={loader.error()}>{(message) => <div class="k2b-choice-status" data-tone="danger"><span>{message()}</span><button type="button" onClick={loader.retry}>Retry</button></div>}</Show>
            <Show when={loader.loading() && options().length === 0}>
              <div class="k2b-choice-status">
                <i class="ti ti-loader-2 k2b-spin" aria-hidden="true" />
                <span>Loading...</span>
              </div>
            </Show>
            <For
              each={loader.error() ? [] : options()}
              fallback={
                <Show when={!loader.loading() && !loader.error()}>
                  <div class="k2b-choice-status">{isSearchable() ? "No results" : "No options available"}</div>
                </Show>
              }
            >
              {(option, index) => (
                <button
                  ref={(element) => (optionRefs[index()] = element)}
                  type="button"
                  id={`${listboxId}-${index()}`}
                  class="k2b-choice-option"
                  role="option"
                  aria-selected={option.value === value()}
                  data-focused={index() === focusedIndex() ? "true" : undefined}
                  disabled={option.disabled}
                  onPointerMove={() => focus(index())}
                  onClick={() => select(option)}
                >
                  <Show
                    when={option.color}
                    fallback={<Show when={option.icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>}
                  >
                    {(color) => <span class="k2b-choice-dot" style={{ "background-color": color() }} aria-hidden="true" />}
                  </Show>
                  <span><strong>{option.label}</strong><Show when={option.description}>{(description) => <small>{description()}</small>}</Show></span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </Field>
  );
}

export default Select;
