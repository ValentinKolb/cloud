import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { Field, GridRecord } from "../../service";
import type { ViewColumn } from "../../service/views";
import {
  RECORD_DETAIL_EVENT,
  setSelectedRecordInUrl,
  getSelectedRecordIdFromUrl,
  type RecordDetailMode,
  type RecordDetailPayload,
} from "./record-detail-context";
import { formatCell } from "./format-cell";

type Props = {
  tableId: string;
  fields: Field[];
  records: GridRecord[];
  canWrite: boolean;
  /** "live" = edit/delete via the detail panel; "trash" = restore. */
  mode?: RecordDetailMode;
  /** Initial selected record id from `?record=<id>` (SSR). */
  initialSelectedId?: string | null;
  /**
   * Per-view rendered columns. Undefined = inherit table default
   * (every field where `!hideInTable`, sorted by `position`). Set =
   * render exactly these in this order. v1 only honours
   * `kind: "field"` — `kind: "join"` columns are silently skipped
   * until slice #5 wires the server-side traversal.
   */
  viewColumns?: ViewColumn[];
  /**
   * Pre-resolved labels for linked records, keyed by target record id.
   * Built SSR-side from every relation field on the visible page —
   * each entry is the joined-with-" · " values of the target table's
   * `presentable` fields (or the relation's `displayFieldId` fallback,
   * or an 8-char id prefix). Empty for tables with no relations.
   */
  relationLabels?: Record<string, string>;
  /**
   * Aggregate values keyed `<fieldId>__<agg>` (matches the API's keying).
   * Rendered as a footer row: count for every field + sum for numerics.
   * Empty object = footer row hidden (trash mode, empty table, etc).
   */
  aggregates?: Record<string, unknown>;
};

/**
 * Records table. Rows are clickable: clicking a row sets `?record=<id>` on
 * the URL and dispatches the `grids-record-select` event so the
 * RecordDetailPanel mounted in the third column updates without a full SSR
 * round-trip. Edit / delete / restore actions live entirely in that panel
 * — there are no inline row buttons here anymore.
 */
export default function RecordsGrid(props: Props) {
  const [selectedId, setSelectedId] = createSignal<string | null>(props.initialSelectedId ?? null);
  const mode: RecordDetailMode = props.mode ?? "live";

  // Listen for the detail-panel selection event so the highlight stays in
  // sync when the user closes the panel or navigates back/forward.
  onMount(() => {
    const onEvent = (e: Event) => {
      const payload = (e as CustomEvent<RecordDetailPayload>).detail;
      setSelectedId(payload.itemKey);
    };
    const onPop = () => setSelectedId(getSelectedRecordIdFromUrl());
    window.addEventListener(RECORD_DETAIL_EVENT, onEvent);
    window.addEventListener("popstate", onPop);
    onCleanup(() => {
      window.removeEventListener(RECORD_DETAIL_EVENT, onEvent);
      window.removeEventListener("popstate", onPop);
    });
  });

  /**
   * Resolves to the ordered list of `Field`s the table renders. When
   * `viewColumns` is set, it dictates BOTH visibility and order; we
   * filter to the field-kind columns and resolve each fieldId. When
   * not set, we fall back to the table-level default: every field
   * where `!hideInTable && !deletedAt`, in `position` order.
   */
  const visibleFields = (): Field[] => {
    if (props.viewColumns) {
      const fieldsById = new Map(props.fields.map((f) => [f.id, f]));
      return props.viewColumns
        .filter((c): c is Extract<ViewColumn, { kind: "field" }> => c.kind === "field")
        .map((c) => fieldsById.get(c.fieldId))
        .filter((f): f is Field => !!f && !f.deletedAt);
    }
    return props.fields
      .filter((f) => !f.deletedAt && !f.hideInTable)
      .sort((a, b) => a.position - b.position);
  };

  /** Looks up a per-column FormatSpec from the active view (if any). */
  const columnFormat = (fieldId: string) => {
    if (!props.viewColumns) return undefined;
    const col = props.viewColumns.find(
      (c) => c.kind === "field" && c.fieldId === fieldId,
    );
    return col && "format" in col ? col.format : undefined;
  };

  /** Renders a relation cell using the SSR-resolved label cache. */
  const formatRelationCell = (value: unknown): string => {
    const ids = Array.isArray(value)
      ? (value as string[])
      : typeof value === "string" && value.length > 0
      ? [value]
      : [];
    if (ids.length === 0) return "";
    const cache = props.relationLabels ?? {};
    return ids
      .map((id) => cache[id] ?? id.slice(0, 8))
      .join(", ");
  };

  const onRowClick = (rec: GridRecord) => {
    setSelectedId(rec.id);
    setSelectedRecordInUrl({ recordId: rec.id, record: rec, mode });
  };

  const onRowKeyDown = (event: KeyboardEvent, rec: GridRecord) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onRowClick(rec);
  };

  return (
    <Show
      when={visibleFields().length > 0}
      fallback={
        <div class="paper p-6 text-center text-sm text-dimmed">
          No fields. Add one in the sidebar to populate this table.
        </div>
      }
    >
      {/*
        Two-layer wrapper so wide tables (lots of fields, long values) scroll
        horizontally inside the paper border without forcing the whole page
        wider. Mirrors the spaces ItemsTable pattern.
      */}
      <div class="paper overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-zinc-100 dark:border-zinc-800">
                {/* Two-line headers — explicitly breaking the platform's
                    single-line table convention because grids tables are far
                    more dynamic (any field type, user-defined names) than
                    the static-schema tables elsewhere in the cloud. Top
                    line = column name (primary, semibold); bottom line =
                    data type (small, dimmed). */}
                <For each={visibleFields()}>
                  {(f) => (
                    <th class="px-3 py-2 text-left">
                      <div class="flex flex-col gap-0.5 leading-tight">
                        <span class="text-primary font-semibold">{f.name}</span>
                        <span class="text-[10px] text-dimmed font-normal">{f.type}</span>
                      </div>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <Show when={props.aggregates && Object.keys(props.aggregates).length > 0}>
              <tfoot>
                <tr class="border-t border-zinc-100 dark:border-zinc-800">
                  <For each={visibleFields()}>
                    {(f) => {
                      const agg = props.aggregates ?? {};
                      const count = agg[`${f.id}__count`];
                      const sum = agg[`${f.id}__sum`];
                      return (
                        <td class="px-3 py-1.5 text-[11px] text-dimmed">
                          <Show when={count !== undefined && count !== null}>
                            <span class="block whitespace-nowrap" title="non-empty count">
                              {String(count)} {Number(count) === 1 ? "value" : "values"}
                            </span>
                          </Show>
                          <Show when={sum !== undefined && sum !== null}>
                            <span class="block whitespace-nowrap" title="sum">
                              Σ {String(sum)}
                            </span>
                          </Show>
                        </td>
                      );
                    }}
                  </For>
                </tr>
              </tfoot>
            </Show>
            <tbody>
              <Show
                when={props.records.length > 0}
                fallback={
                  <tr>
                    <td
                      colspan={visibleFields().length}
                      class="px-3 py-3 text-left text-dimmed text-xs"
                    >
                      {mode === "trash" ? "No deleted records." : "No records."}
                    </td>
                  </tr>
                }
              >
                <For each={props.records}>
                  {(rec) => {
                    const isSelected = () => selectedId() === rec.id;
                    return (
                      <tr
                        // Row is the click target — opens the detail panel.
                        // Tabindex + role + keydown make it keyboard-accessible.
                        tabindex={0}
                        role="button"
                        aria-pressed={isSelected()}
                        class={`cursor-pointer border-b border-zinc-50 last:border-0 dark:border-zinc-800/50 ${
                          isSelected()
                            ? "bg-blue-50 dark:bg-blue-950/30"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                        }`}
                        onClick={() => onRowClick(rec)}
                        onKeyDown={(e) => onRowKeyDown(e, rec)}
                      >
                        <For each={visibleFields()}>
                          {(f) => (
                            <td class="px-3 py-2 text-primary">
                              {f.type === "relation"
                                ? formatRelationCell(rec.data[f.id])
                                : formatCell(
                                    rec.data[f.id],
                                    f.type,
                                    f.config,
                                    columnFormat(f.id),
                                  )}
                            </td>
                          )}
                        </For>
                      </tr>
                    );
                  }}
                </For>
              </Show>
            </tbody>
          </table>
        </div>
      </div>
    </Show>
  );
}
