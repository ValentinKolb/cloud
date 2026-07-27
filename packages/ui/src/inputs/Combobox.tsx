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

export type ComboboxOption<T extends string = string> = ChoiceOption<T>;

export type ComboboxProps<T extends string = string> = {
  options?: readonly ComboboxOption<T>[];
  loadOptions?: ChoiceOptionsLoader<T>;
  onSelect?: (option: ComboboxOption<T>) => void;
  query?: string;
  onQueryChange?: (query: string) => void;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  placeholder?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  debounceMs?: number;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  class?: string;
  "aria-describedby"?: string;
};

export function Combobox<T extends string = string>(props: ComboboxProps<T>): JSX.Element {
  const meta = createFieldMeta(props.id);
  const listboxId = `${meta.controlId}-listbox`;
  const [internalQuery, setInternalQuery] = createSignal("");
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  let inputRef: HTMLInputElement | undefined;

  const query = () => props.query ?? internalQuery();
  const setQuery = (value: string) => {
    setInternalQuery(value);
    props.onQueryChange?.(value);
  };
  const asyncOptions = createChoiceLoader(
    () => props.loadOptions,
    () => props.debounceMs ?? 200,
  );
  const visibleOptions = createMemo(() => (props.loadOptions ? asyncOptions.options() : filterChoiceOptions(props.options ?? [], query())));
  const popover = createChoicePopover(() => Boolean(props.disabled));
  const focusedOption = () => visibleOptions()[focusedIndex()];

  const focusFirst = () => setFocusedIndex(nextEnabledChoiceIndex(visibleOptions(), -1, 1));
  const open = () => {
    if (props.disabled) return;
    popover.show();
    if (props.loadOptions) asyncOptions.load(query(), true);
    focusFirst();
  };
  const close = () => {
    asyncOptions.cancel();
    setFocusedIndex(-1);
    popover.hide();
  };
  const select = (option: ComboboxOption<T>) => {
    if (option.disabled) return;
    props.onSelect?.(option);
    setQuery("");
    close();
    inputRef?.focus();
  };
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
    if (event.key === "Enter" && popover.open()) {
      const option = focusedOption();
      if (option) {
        event.preventDefault();
        select(option);
      }
      return;
    }
    if (event.key === "Escape" && popover.open()) {
      event.preventDefault();
      close();
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
      <div class="k2b-combobox" data-invalid={props.error ? "true" : undefined}>
        <div class="k2b-combobox__input">
          <i class="ti ti-search" aria-hidden="true" />
          <input
            ref={(element) => {
              inputRef = element;
              popover.setTrigger(element);
            }}
            id={meta.controlId}
            type="search"
            name={props.name}
            value={query()}
            placeholder={props.placeholder ?? "Search…"}
            disabled={props.disabled}
            required={props.required}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={popover.open()}
            aria-controls={listboxId}
            aria-activedescendant={focusedOption() ? `${listboxId}-${focusedIndex()}` : undefined}
            aria-invalid={props.error ? "true" : undefined}
            aria-describedby={fieldDescribedBy(meta, props.description, props.error, props["aria-describedby"])}
            onFocus={open}
            onClick={open}
            onInput={(event) => {
              const next = event.currentTarget.value;
              setQuery(next);
              if (!popover.open()) open();
              if (props.loadOptions) asyncOptions.load(next);
              focusFirst();
            }}
            onKeyDown={handleKeyDown}
          />
          <Show when={asyncOptions.loading()} fallback={<i class="ti ti-chevron-down" aria-hidden="true" />}>
            <i class="ti ti-loader-2 k2b-spin" aria-hidden="true" />
          </Show>
        </div>

        <div
          ref={popover.setPopover}
          popover="manual"
          class="k2b-choice-popover"
          role="group"
          onKeyDown={handleKeyDown}
          aria-label={typeof props.label === "string" ? props.label : "Suggestions"}
        >
          <div id={listboxId} class="k2b-choice-options" role="listbox">
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
                  <div class="k2b-choice-status">{props.emptyMessage ?? (query().trim() ? "No results found" : "Type to search…")}</div>
                </Show>
              }
            >
              {(option, index) => (
                <button
                  type="button"
                  id={`${listboxId}-${index()}`}
                  class="k2b-choice-option"
                  role="option"
                  aria-selected={index() === focusedIndex()}
                  data-focused={index() === focusedIndex() ? "true" : undefined}
                  disabled={option.disabled}
                  onPointerMove={() => !option.disabled && setFocusedIndex(index())}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => select(option)}
                >
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
