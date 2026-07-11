import { mutation, timed } from "@valentinkolb/stdlib/solid";
import type { JSX } from "solid-js";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createInputA11y, InputWrapper } from "./util";

export type MultiSelectOption =
  | string
  | {
      id: string;
      label?: string;
      description?: string;
      icon?: string;
      color?: string;
    };

type NormalizedOption = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  color?: string;
};

export type MultiSelectFetchDataFn = (query: string, signal: AbortSignal) => Promise<MultiSelectOption[]>;

export type MultiSelectInputProps = {
  label?: string;
  description?: string;
  placeholder?: string;
  icon?: string;
  activeIcon?: string;
  value?: () => string[];
  onChange?: (value: string[]) => void;
  error?: () => string | undefined;
  options?: MultiSelectOption[];
  fetchData?: MultiSelectFetchDataFn;
  selectedOptions?: () => MultiSelectOption[];
  fetchDebounceMs?: number;
  required?: boolean;
  clearable?: boolean;
  disabled?: boolean;
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

const expandHex = (color: string): string => {
  if (color.length !== 4) return color;
  return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
};

const hexToRgb = (color: string): { r: number; g: number; b: number } | null => {
  if (!HEX_COLOR.test(color)) return null;
  const hex = expandHex(color).slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
};

const pillStyle = (color?: string): JSX.CSSProperties | undefined => {
  const rgb = color ? hexToRgb(color.trim()) : null;
  if (!rgb) return undefined;
  const { r, g, b } = rgb;
  return {
    "background-color": `rgba(${r}, ${g}, ${b}, 0.12)`,
    color: `rgb(${r}, ${g}, ${b})`,
  };
};

const iconColorStyle = (color?: string): JSX.CSSProperties | undefined =>
  color && HEX_COLOR.test(color.trim()) ? { color: color.trim() } : undefined;

const MultiSelectInput = (props: MultiSelectInputProps) => {
  const placeholder = () => props.placeholder ?? "Select...";
  const icon = () => props.icon ?? "ti ti-chevron-down";
  const activeIcon = () => props.activeIcon ?? "ti ti-chevron-up";
  const disabled = () => props.disabled ?? false;
  const clearable = () => props.clearable ?? false;
  const value = () => props.value?.() ?? [];
  const a11y = createInputA11y({ description: props.description, error: props.error });
  const isSearchable = () => Boolean(props.fetchData);

  const normalize = (option: MultiSelectOption): NormalizedOption =>
    typeof option === "object" ? { ...option, label: option.label || option.id } : { id: option, label: option };

  const [optionCache, setOptionCache] = createSignal<Record<string, NormalizedOption>>({});
  const fetchMut = mutation.create<NormalizedOption[], string>({
    mutation: async (query, { abortSignal }) => {
      if (!props.fetchData) return [];
      const raw = await props.fetchData(query, abortSignal);
      return raw.map(normalize);
    },
  });

  const triggerFetch = (query: string) => {
    if (!props.fetchData) return;
    fetchMut.abort();
    void fetchMut.mutate(query);
  };

  const debounce = timed.debounce((q: string) => triggerFetch(q), props.fetchDebounceMs ?? 200);

  const options = createMemo(() => {
    if (isSearchable()) return fetchMut.data() ?? [];
    return (props.options ?? []).map(normalize);
  });
  const selectedOptionHints = createMemo(() => (props.selectedOptions?.() ?? []).map(normalize));
  const optionById = createMemo(() => {
    const map = new Map<string, NormalizedOption>();
    for (const option of Object.values(optionCache())) map.set(option.id, option);
    for (const option of selectedOptionHints()) map.set(option.id, option);
    for (const option of options()) map.set(option.id, option);
    return map;
  });
  const selectedOptions = createMemo(() => value().map((id) => optionById().get(id) ?? { id, label: id }));

  const [isOpen, setIsOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [isDarkTheme, setIsDarkTheme] = createSignal(false);

  let triggerRef: HTMLDivElement | undefined;
  let dialogRef: HTMLDialogElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;
  let optionRefs: HTMLDivElement[] = [];

  const filteredOptions = createMemo(() => {
    if (isSearchable()) return options();
    const q = query().trim().toLowerCase();
    if (!q) return options();
    return options().filter((option) => [option.label, option.description, option.id].some((part) => part?.toLowerCase().includes(q)));
  });
  const waitingForRemoteOptions = () => isSearchable() && (fetchMut.loading() || Boolean(fetchMut.error()));
  const visibleOptions = () => (waitingForRemoteOptions() ? [] : filteredOptions());

  const isSelected = (id: string) => value().includes(id);
  const nextWithout = (id: string) => value().filter((item) => item !== id);
  const emit = (next: string[]) => props.onChange?.([...new Set(next)]);

  const syncTheme = () => {
    if (typeof document === "undefined") return;
    setIsDarkTheme(document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  };

  const focusOption = (index: number) => {
    setFocusedIndex(index);
    optionRefs[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const navigateOptions = (direction: "next" | "previous") => {
    const count = filteredOptions().length;
    if (!count) return;
    const current = focusedIndex();
    const next = direction === "next" ? (current < count - 1 ? current + 1 : 0) : current > 0 ? current - 1 : count - 1;
    focusOption(next);
  };

  const positionDialog = () => {
    if (!dialogRef || !triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const maxHeight = 320;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    dialogRef.style.left = `${rect.left}px`;
    dialogRef.style.width = `${rect.width}px`;
    if (spaceBelow < maxHeight && spaceAbove > spaceBelow) {
      dialogRef.style.top = "auto";
      dialogRef.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    } else {
      dialogRef.style.top = `${rect.bottom + 8}px`;
      dialogRef.style.bottom = "auto";
    }
  };

  const toggleDropdown = (open: boolean) => {
    if (disabled()) return;
    syncTheme();
    setIsOpen(open);
    if (!open) {
      dialogRef?.close();
      setFocusedIndex(-1);
      setQuery("");
      if (isSearchable()) {
        debounce.cancel();
        fetchMut.abort();
      }
      triggerRef?.focus();
      return;
    }
    setFocusedIndex(filteredOptions().length > 0 ? 0 : -1);
    positionDialog();
    dialogRef?.showModal();
    if (isSearchable()) triggerFetch("");
    queueMicrotask(() => searchInputRef?.focus());
  };

  const toggleOption = (option: NormalizedOption) => {
    setOptionCache({ ...optionCache(), [option.id]: option });
    const next = isSelected(option.id) ? nextWithout(option.id) : [...value(), option.id];
    emit(next);
  };

  const removeOption = (event: MouseEvent, id: string) => {
    event.stopPropagation();
    emit(nextWithout(id));
  };

  const clearValue = (event: MouseEvent) => {
    event.stopPropagation();
    emit([]);
    triggerRef?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const open = isOpen();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        open ? navigateOptions("next") : toggleDropdown(true);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (open) navigateOptions("previous");
        break;
      case "Enter":
        if (open && focusedIndex() >= 0) {
          event.preventDefault();
          const option = filteredOptions()[focusedIndex()];
          if (option) toggleOption(option);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          toggleDropdown(false);
        }
        break;
      case "Backspace":
        if (open && query().length === 0 && value().length > 0) {
          event.preventDefault();
          emit(value().slice(0, -1));
        }
        break;
      case "Tab":
        if (open) toggleDropdown(false);
        break;
    }
  };

  const handleDialogClick = (event: MouseEvent) => {
    if (event.target === dialogRef) toggleDropdown(false);
  };

  onCleanup(() => dialogRef?.close());

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
        <div class="group relative flex-1">
          <div class="pointer-events-none absolute left-2 top-1/2 z-10 flex -translate-y-1/2 items-center text-zinc-500">
            <i class={`${isOpen() ? activeIcon() : icon()} ${isOpen() ? "text-blue-500" : ""}`} />
          </div>

          <div
            ref={triggerRef}
            id={a11y.inputId}
            class={`input relative flex h-8 w-full items-center gap-1.5 overflow-hidden py-1.5 pl-9 pr-8 ${
              disabled() ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
            data-state={isOpen() ? "open" : "closed"}
            onClick={() => toggleDropdown(!isOpen())}
            onKeyDown={handleKeyDown}
            tabIndex={disabled() ? -1 : 0}
            role="combobox"
            aria-expanded={isOpen()}
            aria-haspopup="listbox"
            aria-label={!props.label ? "Select options" : undefined}
            aria-describedby={a11y.ariaDescribedBy()}
            aria-invalid={!!props.error?.()}
            aria-required={props.required}
            aria-disabled={disabled()}
          >
            <Show
              when={selectedOptions().length > 0}
              fallback={<span class="truncate text-zinc-400 dark:text-zinc-500">{placeholder()}</span>}
            >
              <div class="multi-select-pill-strip absolute inset-y-0 left-9 right-8 flex items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap">
                <For each={selectedOptions()}>
                  {(option) => (
                    <span
                      class="inline-flex max-w-36 shrink-0 items-center gap-1 rounded-full px-1 text-xs leading-5"
                      style={pillStyle(option.color)}
                    >
                      <Show when={option.icon}>
                        <i class={`${option.icon} text-[13px]`} />
                      </Show>
                      <span class="truncate">{option.label}</span>
                      <button
                        type="button"
                        class="-mr-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                        onClick={(event) => removeOption(event, option.id)}
                        tabIndex={-1}
                        aria-label={`Remove ${option.label}`}
                      >
                        <i class="ti ti-x text-[11px]" />
                      </button>
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <Show when={clearable() && selectedOptions().length > 0 && !disabled()}>
            <button
              type="button"
              class="absolute inset-y-0 right-2 flex items-center px-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              onClick={clearValue}
              tabIndex={-1}
              aria-label="Clear selection"
            >
              <i class="ti ti-x text-sm" />
            </button>
          </Show>
        </div>

        <dialog
          ref={dialogRef}
          class="popup border border-zinc-200 p-1 backdrop:bg-transparent dark:border-zinc-700"
          classList={{ dark: isDarkTheme() }}
          onKeyDown={handleKeyDown}
          onClick={handleDialogClick}
          aria-label="Options"
        >
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search..."
            value={query()}
            onInput={(event) => {
              const next = event.currentTarget.value;
              setQuery(next);
              setFocusedIndex(0);
              if (isSearchable()) {
                debounce.debouncedFn(next);
              } else {
                setFocusedIndex(filteredOptions().length > 0 ? 0 : -1);
              }
            }}
            class="w-full border-0 bg-transparent px-3 py-1.5 text-sm text-zinc-700 outline-none placeholder:text-zinc-400 focus:ring-0 dark:text-zinc-300 dark:placeholder:text-zinc-500"
            aria-label="Search options"
          />
          <div
            class="flex max-h-72 flex-col gap-1 overflow-y-auto"
            role="listbox"
            aria-label={props.label || "Options"}
            aria-multiselectable="true"
          >
            <Show when={isSearchable() && fetchMut.loading()}>
              <div class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <i class="ti ti-loader-2 animate-spin" /> Loading...
              </div>
            </Show>
            <Show when={isSearchable() && !fetchMut.loading() && fetchMut.error()}>
              <div class="flex items-center gap-2 px-3 py-1.5 text-xs text-red-500">
                <i class="ti ti-alert-triangle shrink-0" />
                <span class="flex-1 truncate">{fetchMut.error()?.message ?? "Failed to load"}</span>
                <button
                  type="button"
                  class="text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
                  onClick={() => fetchMut.retry()}
                >
                  Retry
                </button>
              </div>
            </Show>
            <For
              each={visibleOptions()}
              fallback={
                <Show when={!waitingForRemoteOptions()}>
                  <div class="px-3 py-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                    {isSearchable() ? "No results" : "No options available"}
                  </div>
                </Show>
              }
            >
              {(option, index) => {
                const selected = () => isSelected(option.id);
                const focused = () => index() === focusedIndex();

                return (
                  <div
                    ref={(el) => (optionRefs[index()] = el)}
                    class={`group flex cursor-pointer select-none items-center gap-3 rounded px-2 py-2 text-sm transition-colors ${
                      focused() ? "bg-blue-50 dark:bg-blue-950/35" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                    onClick={() => toggleOption(option)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleOption(option);
                      }
                    }}
                    onMouseEnter={() => setFocusedIndex(index())}
                    role="option"
                    aria-label={option.label}
                    aria-selected={selected()}
                    tabIndex={-1}
                  >
                    <span
                      class={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        selected()
                          ? "border-blue-500 bg-blue-500 text-white"
                          : "border-zinc-300 bg-white text-transparent dark:border-zinc-600 dark:bg-zinc-900"
                      }`}
                    >
                      <i class="ti ti-check text-[12px]" />
                    </span>
                    <Show when={option.icon}>
                      <i class={`${option.icon} shrink-0 text-zinc-500 dark:text-zinc-400`} style={iconColorStyle(option.color)} />
                    </Show>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-zinc-800 dark:text-zinc-200">{option.label}</div>
                      <Show when={option.description}>
                        <div class="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{option.description}</div>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </dialog>
      </div>
    </InputWrapper>
  );
};

export { MultiSelectInput };
export default MultiSelectInput;
