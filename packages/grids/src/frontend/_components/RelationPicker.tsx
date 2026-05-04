import { For, Show, createSignal, onCleanup } from "solid-js";
import { SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import { timed } from "@valentinkolb/stdlib/solid";

/**
 * Relation picker — search-driven dropdown over a target table.
 *
 * The picker is "controlled" in the React/Solid sense — `value` and
 * `onChange` flow from the parent. The parent (RecordDetailPanel) is
 * responsible for persisting the new id-array via PATCH /records/:id.
 *
 * Single vs multi:
 * - `multi=false` → renders the platform's `SelectInput` with `fetchData`.
 *   The SelectInput's built-in dropdown / search / loading / error UI
 *   matches every other select in the platform — visual consistency for
 *   free.
 * - `multi=true` → keeps the chip-based UI inline (SelectInput doesn't
 *   have multi-mode yet). Selected records render as chips with an ×;
 *   the search field stays visible to allow appending more.
 */
type LookupItem = { id: string; label: string };

type Props = {
  /** Target table to search records of. */
  targetTableId: string;
  /** Currently-linked record ids. Empty array = nothing linked. */
  value: () => string[];
  /** Pre-resolved labels for the currently-linked ids — passed in by
   *  the parent (RecordDetailPanel reuses the SSR-built relationLabels
   *  cache). Missing entries fall back to an 8-char id prefix. */
  labels: () => Record<string, string>;
  /** True = multi-relation (array of ids). False = single (single-id
   *  array, picker replaces on select). Maps to the relation field's
   *  cardinality config. */
  multi: boolean;
  /** Emit the new id list to the parent. The parent persists. */
  onChange: (next: string[]) => void;
  /** True while the parent's PATCH is in-flight; greys out the picker. */
  saving?: () => boolean;
};

/**
 * Shared lookup fetcher — abortable, throws on HTTP error so consumers
 * can surface it as an error state. The exclude param is parametric so
 * single- and multi-mode can both use it.
 */
const fetchLookup = async (
  targetTableId: string,
  q: string,
  excludeIds: string[],
  signal: AbortSignal,
): Promise<LookupItem[]> => {
  const url = new URL(
    `/api/grids/tables/${targetTableId}/lookup`,
    window.location.origin,
  );
  if (q) url.searchParams.set("q", q);
  if (excludeIds.length > 0) url.searchParams.set("excludeIds", excludeIds.join(","));
  url.searchParams.set("limit", "10");
  const res = await fetch(url.toString(), { credentials: "same-origin", signal });
  if (!res.ok) throw new Error(`Lookup failed (HTTP ${res.status})`);
  const data = (await res.json()) as { items: LookupItem[] };
  return data.items ?? [];
};

export default function RelationPicker(props: Props) {
  const labelFor = (id: string): string => {
    const fromProp = props.labels()[id];
    if (fromProp) return fromProp;
    return id.slice(0, 8);
  };

  // ── Single-cardinality path ─────────────────────────────────────────
  // Thin wrapper around SelectInput. The platform's SelectInput already
  // owns search / debounce / loading / error / abort via its mutation-
  // backed `fetchData` prop, so this is just glue: array<->string for
  // the value, and a label resolver for the selected-display fallback.
  if (!props.multi) {
    return (
      <SelectInput
        placeholder="Pick a linked record..."
        clearable
        disabled={props.saving?.() ?? false}
        value={() => props.value()[0] ?? ""}
        onChange={(id) => props.onChange(id ? [id] : [])}
        selectedLabel={() => {
          const id = props.value()[0];
          return id ? labelFor(id) : undefined;
        }}
        fetchData={async (q, signal) => {
          // Exclude the current pick so the dropdown shows alternatives —
          // the trigger already displays the selection, so listing it
          // again would just be noise.
          const items = await fetchLookup(props.targetTableId, q, props.value(), signal);
          return items.map((i) => ({ id: i.id, label: i.label, icon: "ti ti-link" }));
        }}
      />
    );
  }

  // ── Multi-cardinality path ──────────────────────────────────────────
  // Chip-based UI: selected records render as chips above; the search
  // field stays open for appending more. This path will eventually be
  // replaced with a multi-mode SelectInput once the platform component
  // grows multi-select support.
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<LookupItem[]>([]);
  const [open, setOpen] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  // Cache of labels we've discovered through the dropdown. The parent
  // passes `labels` for the initial value, but newly-picked ids may not
  // be in it yet — keep our own cache so chips render immediately
  // without a re-fetch round-trip.
  const [pickedLabels, setPickedLabels] = createSignal<Record<string, string>>({});

  const labelForChip = (id: string): string => {
    const fromProp = props.labels()[id];
    if (fromProp) return fromProp;
    const fromCache = pickedLabels()[id];
    if (fromCache) return fromCache;
    return id.slice(0, 8);
  };

  let abortCtl: AbortController | null = null;
  const fetchResults = async (q: string) => {
    abortCtl?.abort();
    abortCtl = new AbortController();
    setLoading(true);
    try {
      const items = await fetchLookup(props.targetTableId, q, props.value(), abortCtl.signal);
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const debounce = timed.debounce(fetchResults, 250);

  const onInput = (next: string) => {
    setQuery(next);
    setOpen(true);
    debounce.debouncedFn(next);
  };

  const onFocus = () => {
    setOpen(true);
    // Seed the dropdown with recent records on first focus so an empty
    // picker still has something to click. Skip if we already have
    // results (avoids a flash on every focus).
    if (results().length === 0 && !loading()) fetchResults("");
  };

  // Click-outside to close the dropdown. We don't use a portal here —
  // the picker lives inside the detail-panel scroll container, so the
  // dropdown flows naturally below the input.
  let rootEl: HTMLDivElement | undefined;
  const onDocClick = (e: MouseEvent) => {
    if (!rootEl) return;
    if (!rootEl.contains(e.target as Node)) setOpen(false);
  };
  if (typeof document !== "undefined") {
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  }

  const pick = (item: LookupItem) => {
    // Multi-only path now (single is handled by SelectInput above).
    setPickedLabels({ ...pickedLabels(), [item.id]: item.label });
    const next = [...props.value(), item.id];
    props.onChange(next);
    setQuery("");
    // Refetch so the just-picked item disappears from the list (the
    // exclude=ids param now includes it).
    void fetchResults("");
  };

  const remove = (id: string) => {
    props.onChange(props.value().filter((x) => x !== id));
  };

  return (
    <div class="flex flex-col gap-1.5" ref={rootEl}>
      {/* Selected chips — clicking the × removes the link. Empty array
          renders nothing so the picker collapses gracefully. */}
      <Show when={props.value().length > 0}>
        <div class="flex flex-wrap gap-1">
          <For each={props.value()}>
            {(id) => (
              <span class="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-primary dark:bg-zinc-800">
                <span class="truncate max-w-[12rem]">{labelForChip(id)}</span>
                <button
                  type="button"
                  class="text-dimmed hover:text-red-500 disabled:opacity-50"
                  onClick={() => remove(id)}
                  disabled={props.saving?.() ?? false}
                  aria-label="Unlink"
                  title="Unlink this record"
                >
                  <i class="ti ti-x text-[11px]" />
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* Search field — only shown when:
           - multi (always allows adding more), or
           - single but nothing linked yet.
          When `single + already-linked`, we hide the input. The chip's
          × is the way to clear the selection before re-picking. */}
      <Show when={props.multi || props.value().length === 0}>
        {/* `onFocusIn` on the wrapper triggers when the inner TextInput
            receives focus (TextInput itself doesn't expose an onFocus
            prop). Bubbling makes this clean — no need to fork
            cloud-ui. */}
        <div class="relative" onFocusIn={onFocus}>
          <TextInput
            icon="ti ti-search"
            placeholder={props.multi ? "Add a linked record..." : "Pick a linked record..."}
            value={query}
            onInput={onInput}
            disabled={props.saving?.() ?? false}
          />

          {/* Dropdown — absolute-positioned under the input. Caps height
              at 256px (h-64) and scrolls when more results arrive. */}
          <Show when={open()}>
            <div class="absolute left-0 right-0 top-full mt-1 z-10 max-h-64 overflow-y-auto rounded border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <Show when={loading()}>
                <div class="flex items-center justify-center gap-1.5 py-3 text-xs text-dimmed">
                  <i class="ti ti-loader-2 animate-spin" /> Searching...
                </div>
              </Show>
              <Show when={!loading() && results().length === 0}>
                <div class="flex items-center justify-center gap-1.5 py-3 text-xs text-dimmed">
                  <i class="ti ti-search-off" />
                  {query() ? "No matches" : "No records to link"}
                </div>
              </Show>
              <Show when={!loading() && results().length > 0}>
                <ul class="flex flex-col">
                  <For each={results()}>
                    {(item) => (
                      <li>
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          onClick={() => pick(item)}
                        >
                          <i class="ti ti-link text-dimmed" />
                          <span class="truncate">{item.label}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
