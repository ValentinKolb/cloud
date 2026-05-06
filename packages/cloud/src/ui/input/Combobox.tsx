import { withMinLoadTime } from "@valentinkolb/stdlib";
import { mutation, timed } from "@valentinkolb/stdlib/solid";
import { createSignal, createUniqueId, For, onCleanup, Show } from "solid-js";

/**
 * Single rendered row inside the Combobox dropdown. Caller's `fetchData`
 * returns these directly — the component owns the rendering, no JSX
 * callbacks. Mirrors the option shape used by `SelectInput` so the visual
 * vocabulary stays consistent across the platform.
 */
export type ComboboxOption = {
  id: string;
  label: string;
  /** Optional dim line under the label. */
  description?: string;
  /** Tabler icon class name without the `ti ` prefix, e.g. `"ti-user"`. */
  icon?: string;
};

export type ComboboxProps = {
  placeholder?: string;
  /**
   * Async loader. Receives the current query (empty on initial open) and
   * an AbortSignal that's tripped when the caller types again before the
   * previous request resolves, or when the dropdown closes mid-flight.
   * Throw to surface an error in the dropdown body — users get a Retry
   * button.
   */
  fetchData: (query: string, signal: AbortSignal) => Promise<ComboboxOption[]>;
  /**
   * Fires when the user picks an option. Combobox is fire-and-forget —
   * the input clears itself + closes the popover immediately after.
   */
  onSelect: (option: ComboboxOption) => void;
  disabled?: boolean;
};

/**
 * Searchable combobox. The trigger IS the search field — type directly
 * to filter, click an option to fire `onSelect` (input clears, popover
 * closes). Designed for "consume-and-clear" flows like "add a member":
 * no value tracking, no selected-state. For stateful picks, use
 * `SelectInput`.
 *
 * ### Why the Popover API + CSS anchor positioning
 *
 * The result list is rendered inside a `<div popover="manual">` opened
 * via `showPopover()`, anchored to the input via `anchor-name` /
 * `position-anchor`. That gets us three things at once:
 *
 * 1. **Top-layer rendering** — the popover escapes any ancestor
 *    `overflow:hidden` (modals, scroll containers, cards). Without
 *    that, a Combobox inside a `prompts.dialog()` would have its
 *    results clipped at the modal edge.
 * 2. **No focus theft** — unlike `<dialog>.showModal()`, the popover
 *    API doesn't move focus. The input stays focused so the user
 *    can keep typing — true combobox feel, not a fake-trigger +
 *    real-input-in-modal pattern.
 * 3. **Auto-flip placement** — `position-try-fallbacks` flips the
 *    popover above the input when there's no room below.
 *
 * `popover="manual"` (not `"auto"`) because clicking the input itself
 * would trigger auto-close — the input is "outside" the popover from
 * the API's perspective. With manual, we wire close handlers ourselves
 * (Escape, blur with delay, click-outside).
 *
 * ### Behaviours worth knowing
 *
 * - **Open on focus / click**, with an immediate `fetchData("")` call
 *   so the caller's prepended "suggested" rows render before any
 *   typing.
 * - **Debounced (200ms)** subsequent `fetchData` calls keyed on input
 *   value, with the previous request aborted before the next fires.
 * - **Pick-then-clear**: `onSelect` fires, input clears, popover
 *   closes, focus stays on the input — ready for the next pick.
 * - **Click-outside / Escape / Tab** all close the popover without
 *   picking. Blur is debounced ~150ms so a click on an option lands
 *   before the close kicks in.
 * - **Keyboard nav**: Arrow up/down cycle focused option; Enter picks.
 */
const Combobox = (props: ComboboxProps) => {
  // Per-instance anchor name so multiple Comboboxes on a page don't
  // share an anchor target. createUniqueId is SSR-safe.
  const anchorName = `--cmbx-${createUniqueId()}`;

  const [query, setQuery] = createSignal("");
  const [isOpen, setIsOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);

  // Wrap fetchData in a stdlib mutation so we get loading + error +
  // abort + retry for free. We `abort()` before each new fetch so a
  // late response doesn't repaint the dropdown with stale results.
  //
  // `withMinLoadTime` guarantees the loader stays visible for at least
  // 200ms — without it, sub-100ms responses would flash the spinner so
  // briefly that it reads as a flicker. 200ms is the sweet spot: long
  // enough to register as a "processing" cue, short enough that fast
  // requests still feel snappy.
  const fetchMut = mutation.create<ComboboxOption[], string>({
    mutation: async (q, { abortSignal }) =>
      withMinLoadTime(() => props.fetchData(q, abortSignal), 200),
  });

  const triggerFetch = (q: string) => {
    fetchMut.abort();
    void fetchMut.mutate(q);
  };

  // 200ms matches SelectInput's default — fast enough to feel live,
  // slow enough not to hammer the server while typing.
  const debounce = timed.debounce((q: string) => triggerFetch(q), 200);

  const options = () => fetchMut.data() ?? [];

  let inputRef: HTMLInputElement | undefined;
  let popoverRef: HTMLDivElement | undefined;
  let optionRefs: HTMLDivElement[] = [];
  let blurTimeout: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (props.disabled || isOpen()) return;
    setIsOpen(true);
    setFocusedIndex(-1);
    // Match popover width to the input on every open — accounts for
    // responsive resizes between opens.
    if (popoverRef && inputRef) {
      popoverRef.style.width = `${inputRef.offsetWidth}px`;
      popoverRef.showPopover();
    }
    // Eager empty-query fetch so the caller's suggested rows render
    // before the user types anything.
    triggerFetch("");
  };

  const close = () => {
    if (!isOpen()) return;
    setIsOpen(false);
    setFocusedIndex(-1);
    debounce.cancel();
    fetchMut.abort();
    setQuery("");
    popoverRef?.hidePopover();
  };

  const select = (option: ComboboxOption) => {
    props.onSelect(option);
    close();
    // Keep focus on the input so the user can immediately add another.
    inputRef?.focus();
  };

  const handleInput = (value: string) => {
    setQuery(value);
    setFocusedIndex(-1);
    debounce.debouncedFn(value);
  };

  const navigate = (direction: "next" | "prev") => {
    const count = options().length;
    if (count === 0) return;
    let next = focusedIndex();
    if (direction === "next") {
      next = next < count - 1 ? next + 1 : 0;
    } else {
      next = next > 0 ? next - 1 : count - 1;
    }
    setFocusedIndex(next);
    optionRefs[next]?.scrollIntoView({ block: "nearest" });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!isOpen()) {
          open();
        } else {
          navigate("next");
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (isOpen()) navigate("prev");
        break;
      case "Enter": {
        if (!isOpen()) return;
        const opt = options()[focusedIndex()];
        if (opt) {
          event.preventDefault();
          select(opt);
        }
        break;
      }
      case "Escape":
        if (isOpen()) {
          event.preventDefault();
          close();
        }
        break;
      case "Tab":
        if (isOpen()) close();
        break;
    }
  };

  // Blur with delay — gives a clicked option time to fire its onClick
  // (and therefore `select()`) before we tear down the popover.
  const handleBlur = () => {
    blurTimeout = setTimeout(() => close(), 150);
  };

  const cancelBlur = () => {
    if (blurTimeout) {
      clearTimeout(blurTimeout);
      blurTimeout = undefined;
    }
  };

  onCleanup(() => {
    if (blurTimeout) clearTimeout(blurTimeout);
    debounce.cancel();
    fetchMut.abort();
  });

  return (
    <div class="relative">
      <div class="group relative">
        <div
          class={`pointer-events-none absolute inset-y-0 left-2 z-10 flex items-center ${
            isOpen() ? "text-blue-500" : "text-zinc-500"
          }`}
        >
          <i class="ti ti-search" />
        </div>

        <input
          ref={inputRef}
          type="text"
          class={`input w-full pl-9 pr-8 ${
            isOpen() ? "!border-blue-500 dark:!border-blue-400" : ""
          } ${props.disabled ? "cursor-not-allowed opacity-50" : ""}`}
          placeholder={props.placeholder ?? "Search..."}
          value={query()}
          // anchor-name lets the popover position itself relative to
          // this element via CSS, no JS rect math.
          style={`anchor-name: ${anchorName}`}
          onFocus={open}
          onClick={open}
          onBlur={handleBlur}
          onInput={(e) => handleInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={props.disabled}
          role="combobox"
          aria-expanded={isOpen()}
          aria-autocomplete="list"
          aria-controls="combobox-listbox"
        />

        <div class="pointer-events-none absolute inset-y-0 right-2 z-10 flex items-center text-zinc-500">
          {/* Loader replaces the chevron during fetch — keeps the
              dropdown body untouched (stale results stay visible) so
              the user doesn't see a flicker between old and new. */}
          <Show
            when={fetchMut.loading()}
            fallback={
              <i
                class={`ti ti-chevron-down transition-transform ${isOpen() ? "rotate-180" : ""}`}
              />
            }
          >
            <i class="ti ti-loader-2 animate-spin" />
          </Show>
        </div>
      </div>

      {/* Popover lives in the top layer — escapes any ancestor
          overflow:hidden (modals, cards). Anchored to the input via
          CSS, with auto-flip when there's no space below. The element
          is always mounted (toggled via showPopover/hidePopover) so
          the ref stays valid across opens. */}
      <div
        ref={popoverRef}
        popover="manual"
        // Cancel the blur-close when the user mouses into the popover —
        // clicking an option needs the input to still be considered
        // "active" until the option's onClick fires.
        onMouseDown={cancelBlur}
        class="paper max-h-60 overflow-y-auto p-1 border! border-zinc-300/60! dark:border-zinc-600/50!"
        style={`position-anchor: ${anchorName}; position: fixed; inset: unset; margin: 0; top: anchor(bottom); left: anchor(left); margin-top: 4px; position-try-fallbacks: flip-block;`}
        role="listbox"
        id="combobox-listbox"
      >
        {/* Stale-while-revalidate: while a new fetch is in flight, the
            previous options stay rendered (the loader sits in the input
            chevron slot, see above). Errors replace the option list with
            an inline retry. */}
        <Show
          when={fetchMut.error() && !fetchMut.loading()}
          fallback={null}
        >
          <div class="flex items-center gap-2 px-3 py-1.5 text-xs text-red-500">
            <i class="ti ti-alert-triangle shrink-0" />
            <span class="flex-1 truncate">
              {fetchMut.error()?.message ?? "Failed to load"}
            </span>
            <button
              type="button"
              class="text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300"
              onMouseDown={(e) => {
                e.preventDefault();
                fetchMut.retry();
              }}
            >
              Retry
            </button>
          </div>
        </Show>

        <Show when={!(fetchMut.error() && !fetchMut.loading())}>
          <For
            each={options()}
            fallback={
              <div class="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-500">
                {query().length >= 2
                  ? "No results found"
                  : "Type to search..."}
              </div>
            }
          >
            {(option, index) => {
              const isFocused = () => index() === focusedIndex();
              return (
                <div
                  ref={(el) => (optionRefs[index()] = el)}
                  class="group flex cursor-pointer select-none items-center gap-3 rounded px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  classList={{
                    "bg-zinc-100 dark:bg-zinc-800": isFocused(),
                  }}
                  role="option"
                  aria-selected={isFocused()}
                  onMouseEnter={() => setFocusedIndex(index())}
                  // onMouseDown beats onBlur — the input's blur
                  // handler would otherwise close the popover before
                  // the click resolves.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(option);
                  }}
                >
                  <Show when={option.icon}>
                    <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                      <i class={`ti ${option.icon} text-sm`} />
                    </div>
                  </Show>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-zinc-700 dark:text-zinc-300">
                      {option.label}
                    </div>
                    <Show when={option.description}>
                      <div class="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {option.description}
                      </div>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
};

export default Combobox;
