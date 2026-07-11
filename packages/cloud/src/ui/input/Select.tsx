import { mutation, timed } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createInputA11y, InputWrapper } from "./util";

type SelectOption =
  | string
  | {
      id: string;
      label?: string;
      description?: string;
      icon?: string;
    };

/**
 * Async loader for searchable selects. Receives the current query
 * (empty on initial open) and an AbortSignal that's tripped when the
 * caller types again before the previous request resolves, or when
 * the dropdown closes mid-flight. Throw to surface an error in the
 * dropdown body — users get a Retry button.
 */
type FetchDataFn = (query: string, signal: AbortSignal) => Promise<SelectOption[]>;

type SelectInputProps = {
  label?: string;
  description?: string;
  placeholder?: string;
  icon?: string;
  activeIcon?: string;
  value?: () => string | undefined;
  onChange?: (value: string) => void;
  error?: () => string | undefined;
  /** Static option list. Required when `fetchData` is not set; ignored
   *  (still allowed for type ergonomics) when it is. */
  options?: SelectOption[];
  /** Async loader. When set, the dropdown becomes searchable: a search
   *  field renders at the top, the body shows loading / error / results,
   *  and `options` is ignored. The fetcher is wrapped in a stdlib
   *  mutation internally so loading + error + abort come for free. */
  fetchData?: FetchDataFn;
  /** Cached label for the currently-selected id when the caller already
   *  knows it (e.g. from a server-side join). Lets the trigger render
   *  the right text immediately on first paint, without waiting for
   *  fetchData to find the id. Falls back to a small internal cache
   *  populated when the user picks options, then to the id itself. */
  selectedLabel?: () => string | undefined;
  /** Debounce window for fetchData calls, in ms. Default 200. */
  fetchDebounceMs?: number;
  required?: boolean;
  clearable?: boolean;
  disabled?: boolean;
};

const SelectInput = (props: SelectInputProps) => {
  const placeholder = () => props.placeholder ?? "Select...";
  const icon = () => props.icon ?? "ti ti-chevron-down";
  const activeIcon = () => props.activeIcon ?? "ti ti-chevron-up";
  const disabled = () => props.disabled ?? false;
  const clearable = () => props.clearable ?? false;
  const isSearchable = () => Boolean(props.fetchData);

  // Normalize a raw option (string | object) into the always-object shape
  // the renderer expects. Used for both static options and fetchData
  // results so the rendering loop doesn't need to branch.
  const normalize = (option: SelectOption) =>
    typeof option === "object" ? { ...option, label: option.label || option.id } : { id: option, label: option };

  // ── Search-mode state ────────────────────────────────────────────────
  // Only meaningful when fetchData is set. Defaults are inert otherwise
  // so static-mode callers see exactly the previous behaviour.
  const [searchQuery, setSearchQuery] = createSignal("");

  // Internal label cache — populated whenever the user picks an option.
  // Lets the trigger keep rendering the right label after dropdown
  // close + reopen, even if the new fetchData call no longer surfaces
  // that record (e.g. the user typed a different filter).
  const [labelCache, setLabelCache] = createSignal<Record<string, string>>({});

  // Wrap the caller's fetchData in a stdlib mutation so we get:
  //  - reactive loading / error / data signals
  //  - one in-flight request at a time (we explicitly abort() before
  //    each new mutate() call in the debounced trigger below)
  //  - AbortSignal threaded through to fetch()
  // When fetchData is undefined we still create the mutation but never
  // call it — keeps the hook order stable across re-renders.
  const fetchMut = mutation.create<{ id: string; label: string; description?: string; icon?: string }[], string>({
    mutation: async (query, { abortSignal }) => {
      if (!props.fetchData) return [];
      const raw = await props.fetchData(query, abortSignal);
      return raw.map(normalize);
    },
  });

  const triggerFetch = (query: string) => {
    if (!props.fetchData) return;
    fetchMut.abort(); // cancel any in-flight previous request
    void fetchMut.mutate(query);
  };

  // 200ms is a sweet spot: fast enough that typing feels live, slow
  // enough to avoid hammering the server on every keystroke.
  const debounce = timed.debounce((q: string) => triggerFetch(q), props.fetchDebounceMs ?? 200);

  // ── Options resolution ───────────────────────────────────────────────
  // In static mode → the `options` prop. In fetch mode → the mutation's
  // last successful payload. Either way the renderer sees the same
  // normalized {id, label, ...} shape.
  const options = createMemo(() => {
    if (isSearchable()) return fetchMut.data() ?? [];
    return (props.options ?? []).map(normalize);
  });

  const [isOpen, setIsOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [isDarkTheme, setIsDarkTheme] = createSignal(false);
  const a11y = createInputA11y({ description: props.description, error: props.error });

  let triggerRef: HTMLDivElement | undefined;
  let dialogRef: HTMLDialogElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;
  let optionRefs: HTMLDivElement[] = [];

  // Resolve the currently-selected option's display row. Tries (in
  // order): the live options list, the internal cache, the caller's
  // selectedLabel getter, finally the id itself as a last-resort
  // fallback so the trigger never goes blank when a value is set.
  const selectedOption = createMemo(() => {
    const id = props.value?.();
    if (!id) return undefined;
    const fromList = options().find((o) => o.id === id);
    if (fromList) return fromList;
    const cached = labelCache()[id];
    if (cached) return { id, label: cached };
    const fromProp = props.selectedLabel?.();
    if (fromProp) return { id, label: fromProp };
    return { id, label: id };
  });

  const syncTheme = () => {
    if (typeof document === "undefined") return;
    setIsDarkTheme(document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  };

  const focusOption = (index: number) => {
    setFocusedIndex(index);
    optionRefs[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const navigateOptions = (direction: "next" | "previous") => {
    const count = options().length;
    if (!count) return;

    let nextIndex = focusedIndex();
    if (direction === "next") {
      nextIndex = nextIndex < count - 1 ? nextIndex + 1 : 0;
    } else {
      nextIndex = nextIndex > 0 ? nextIndex - 1 : count - 1;
    }

    focusOption(nextIndex);
  };

  const toggleDropdown = (open: boolean) => {
    if (disabled()) return;

    syncTheme();
    setIsOpen(open);
    if (!open) {
      dialogRef?.close();
      setFocusedIndex(-1);
      // Bail any in-flight request so a late response doesn't repaint
      // a closed dropdown with stale results. Reset query so the next
      // open starts fresh (matches user expectation of "open === fresh
      // search").
      if (isSearchable()) {
        debounce.cancel();
        fetchMut.abort();
        setSearchQuery("");
      }
      return;
    }

    const currentIndex = options().findIndex((option) => option.id === props.value?.());
    setFocusedIndex(currentIndex >= 0 ? currentIndex : 0);

    if (dialogRef && triggerRef) {
      const rect = triggerRef.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      // Searchable dropdowns are taller because of the sticky search
      // header on top — bump the height budget so the auto-flip logic
      // doesn't choose the wrong side.
      const dropdownMaxHeight = isSearchable() ? 320 : 260;

      dialogRef.style.left = `${rect.left}px`;
      dialogRef.style.width = `${rect.width}px`;

      if (spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow) {
        // Open above
        dialogRef.style.top = "auto";
        dialogRef.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      } else {
        // Open below (default)
        dialogRef.style.top = `${rect.bottom + 8}px`;
        dialogRef.style.bottom = "auto";
      }

      dialogRef.showModal();

      // In search mode: kick off an empty-query fetch so the user sees
      // recent / default results immediately, and move keyboard focus
      // into the search input so they can start typing right away.
      if (isSearchable()) {
        triggerFetch("");
        // Defer the focus until the dialog is actually rendered.
        queueMicrotask(() => searchInputRef?.focus());
      }
    }
  };

  const selectOption = (option: { id: string; label: string }) => {
    // Cache the picked label so the trigger keeps showing it after
    // close + reopen, even if the next fetchData call doesn't surface
    // this id (e.g. user typed a different filter mid-flow).
    setLabelCache({ ...labelCache(), [option.id]: option.label });
    props.onChange?.(option.id);
    toggleDropdown(false);
    triggerRef?.focus();
  };

  const clearValue = (event: MouseEvent) => {
    event.stopPropagation();
    props.onChange?.("");
    triggerRef?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const open = isOpen();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          toggleDropdown(true);
        } else {
          navigateOptions("next");
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (open) {
          navigateOptions("previous");
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open && focusedIndex() >= 0) {
          const option = options()[focusedIndex()];
          if (option) selectOption(option);
        } else if (!open) {
          toggleDropdown(true);
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          toggleDropdown(false);
        }
        break;
      case "Tab":
        if (open) {
          toggleDropdown(false);
        }
        break;
    }
  };

  const handleDialogClick = (event: MouseEvent) => {
    if (event.target === dialogRef) {
      toggleDropdown(false);
    }
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
          <div class="pointer-events-none absolute inset-y-0 left-2 z-10 flex items-center text-zinc-500">
            <i class={`${selectedOption()?.icon || (isOpen() ? activeIcon() : icon())} ${isOpen() ? "text-blue-500" : ""}`} />
          </div>

          <div
            ref={triggerRef}
            id={a11y.inputId}
            class={`input w-full pl-9 pr-8 ${disabled() ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            data-state={isOpen() ? "open" : "closed"}
            onClick={() => toggleDropdown(!isOpen())}
            onKeyDown={handleKeyDown}
            tabIndex={disabled() ? -1 : 0}
            role="combobox"
            aria-expanded={isOpen()}
            aria-haspopup="listbox"
            aria-label={!props.label ? "Select an option" : undefined}
            aria-describedby={a11y.ariaDescribedBy()}
            aria-invalid={!!props.error?.()}
            aria-required={props.required}
            aria-disabled={disabled()}
          >
            {/* `block truncate` keeps long option labels on one line —
                  in narrow toolbar selects (group-by row, sort row,
                  filter row) the trigger stays single-row instead of
                  wrapping to two. */}
            <Show when={selectedOption()} fallback={<span class="block truncate text-zinc-400 dark:text-zinc-500">{placeholder()}</span>}>
              <span class="block truncate text-zinc-700 dark:text-zinc-300">{selectedOption()!.label}</span>
            </Show>
          </div>

          <Show when={clearable() && selectedOption() && !disabled()}>
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
          {/* Search input — only in fetchData mode. Borderless, no
                icon, no divider underneath: the dropdown's own border
                is the visual frame, an extra HR would just add noise.
                onInput updates the visible query immediately and
                schedules the debounced fetch. */}
          <Show when={isSearchable()}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search..."
              value={searchQuery()}
              onInput={(e) => {
                const v = e.currentTarget.value;
                setSearchQuery(v);
                debounce.debouncedFn(v);
              }}
              class="w-full bg-transparent px-3 py-1.5 text-sm text-zinc-700 placeholder:text-zinc-400 outline-none border-0 focus:ring-0 dark:text-zinc-300 dark:placeholder:text-zinc-500"
              aria-label="Search options"
            />
          </Show>
          <div class="flex max-h-60 flex-col gap-1 overflow-y-auto" role="listbox" aria-label={props.label || "Options"}>
            {/* Loading row — single dim line. The previous results
                  would be more jarring than a small spinner here. */}
            <Show when={isSearchable() && fetchMut.loading()}>
              <div class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <i class="ti ti-loader-2 animate-spin" /> Loading...
              </div>
            </Show>
            {/* Error row — caller's fetchData threw. Surface message +
                  Retry. retry() reuses the last query without bouncing
                  through the debounce. */}
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
              each={isSearchable() && (fetchMut.loading() || fetchMut.error()) ? [] : options()}
              fallback={
                <div class="px-3 py-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                  {isSearchable() ? "No results" : "No options available"}
                </div>
              }
            >
              {(option, index) => {
                const isSelected = () => option.id === props.value?.();
                const isFocused = () => index() === focusedIndex();

                return (
                  <div
                    ref={(el) => (optionRefs[index()] = el)}
                    class="group flex cursor-pointer select-none items-center px-3 py-2 text-sm transition-all"
                    onClick={() => selectOption(option)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectOption(option);
                      }
                    }}
                    onMouseEnter={() => setFocusedIndex(index())}
                    role="option"
                    aria-label={option.label}
                    aria-selected={isSelected()}
                    tabIndex={-1}
                  >
                    <Show when={option.icon}>
                      <i class={`${option.icon} mr-3 text-zinc-500`} />
                    </Show>

                    <div class="min-w-0 flex-1">
                      <span
                        class={`truncate text-zinc-700 dark:text-zinc-300 ${
                          isFocused() ? "text-primary underline underline-offset-2" : "group-hover:underline group-hover:underline-offset-2"
                        }`}
                      >
                        {option.label}
                      </span>
                      <Show when={option.description}>
                        <div class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{option.description}</div>
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

export { SelectInput };
export const Select = SelectInput;
export default SelectInput;
