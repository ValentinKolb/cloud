import { MultiSelectInput, type MultiSelectOption, SelectInput } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { RelationLookupItem } from "../../../contracts";

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
 * - `multi=true` → renders the platform's `MultiSelectInput` in async
 *   mode, so relation pickers use the same searchable dropdown pattern
 *   as the rest of cloud-ui.
 */
type LookupItem = RelationLookupItem;

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
  /** Extra ids to hide from the dropdown, e.g. the record currently being edited for self-relations. */
  excludeIds?: () => string[];
};

/**
 * Shared lookup fetcher — abortable, throws on HTTP error so consumers
 * can surface it as an error state. The exclude param is parametric so
 * single- and multi-mode can both use it.
 */
const fetchLookup = async (targetTableId: string, q: string, excludeIds: string[], signal: AbortSignal): Promise<LookupItem[]> => {
  const res = await apiClient.tables[":tableId"].lookup.$get(
    {
      param: { tableId: targetTableId },
      query: {
        q,
        excludeIds: excludeIds.join(","),
        limit: "10",
      },
    },
    { init: { signal } },
  );
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("You do not have permission to choose records from this table.");
    }
    throw new Error("Could not load linked records.");
  }
  const data = await res.json();
  return data.items;
};

export default function RelationPicker(props: Props) {
  const excludedIds = () => [...new Set([...props.value(), ...(props.excludeIds?.() ?? [])])];
  const labelFor = (id: string): string => {
    const fromProp = props.labels()[id];
    if (fromProp) return fromProp;
    return "Unknown record";
  };

  const toOption = (item: LookupItem): MultiSelectOption => ({ id: item.id, label: item.label, icon: "ti ti-link" });

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
          const items = await fetchLookup(props.targetTableId, q, excludedIds(), signal);
          return items.map((i) => ({ id: i.id, label: i.label, icon: "ti ti-link" }));
        }}
      />
    );
  }

  // ── Multi-cardinality path ──────────────────────────────────────────
  return (
    <MultiSelectInput
      placeholder="Add linked records..."
      icon="ti ti-link"
      activeIcon="ti ti-link"
      clearable
      disabled={props.saving?.() ?? false}
      value={props.value}
      onChange={props.onChange}
      selectedOptions={() => props.value().map((id) => ({ id, label: labelFor(id), icon: "ti ti-link" }))}
      fetchData={async (q, signal) => {
        const items = await fetchLookup(props.targetTableId, q, excludedIds(), signal);
        return items.map(toOption);
      }}
    />
  );
}
