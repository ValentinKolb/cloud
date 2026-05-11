import { For, Show } from "solid-js";
import type { Field, GridRecord } from "../../service";
import type { AggregationSpec } from "../../contracts";
import type { ColumnSpec } from "../../service/views";
import { formatCell } from "./format-cell";
import { RecordLink } from "./RecordLink";

/** Friendly label for an aggregation kind — used as the fallback when
 *  the user didn't set a custom label on the aggregation row. */
const AGG_LABELS: Record<string, string> = {
  count: "values",
  countEmpty: "empty",
  countUnique: "unique",
  sum: "Σ",
  avg: "avg",
  min: "min",
  max: "max",
  median: "median",
  earliest: "earliest",
  latest: "latest",
};

type Props = {
  baseId: string;
  tableId: string;
  fields: Field[];
  records: GridRecord[];
  canWrite: boolean;
  /** "live" = edit/delete via the detail panel; "trash" = restore. */
  mode?: "live" | "trash";
  /**
   * Currently-selected record id (controlled by RecordsView). Drives
   * the row highlight; row clicks emit via `onSelectRecord` rather
   * than mutating the URL directly.
   */
  selectedId?: string | null;
  /** Row click + keyboard activate. RecordsView handles URL sync. */
  onSelectRecord: (record: GridRecord) => void;
  /**
   * Per-view rendered columns. Undefined = inherit table default
   * (every field where `!hideInTable`, sorted by `position`). Set =
   * render exactly these in this order. Cross-table data is served
   * by lookup/rollup field types, not view-level joins.
   */
  viewColumns?: ColumnSpec[];
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
   * Rendered as a footer row, opt-in via `aggregationSpecs` — if the user
   * didn't pick aggregations in the toolbar this is empty and the footer
   * row hides entirely.
   */
  aggregates?: Record<string, unknown>;
  /**
   * The user-defined aggregation rows that produced `aggregates`. Lets
   * the footer render in declaration order and pick up custom labels
   * (`spec.label`). `*__count` rows are rendered under the leftmost
   * visible field (Airtable convention for "row total").
   */
  aggregationSpecs?: AggregationSpec[];
};

/**
 * Records table. Rows are clickable: clicking a row calls onSelectRecord
 * with the record. RecordsView (the parent island) handles URL sync and
 * detail-panel mounting. No URL writes / custom events from here.
 */
export default function RecordsGrid(props: Props) {
  const mode: "live" | "trash" = props.mode ?? "live";
  const selectedId = () => props.selectedId ?? null;

  /**
   * Resolves to the ordered list of `Field`s the table renders. When
   * `viewColumns` is set, it dictates BOTH visibility and order. When
   * not set, we fall back to the table-level default: every field
   * where `!hideInTable && !deletedAt`, in `position` order.
   */
  const visibleFields = (): Field[] => {
    if (props.viewColumns) {
      const fieldsById = new Map(props.fields.map((f) => [f.id, f]));
      return props.viewColumns
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
    const col = props.viewColumns.find((c) => c.fieldId === fieldId);
    return col && "format" in col ? col.format : undefined;
  };

  /**
   * Renders a relation cell as a list of inline links — one per linked
   * record. Each link navigates to the target table with the record-
   * detail panel open, and the click is `stopPropagation`'d so it
   * doesn't bubble to the row's "open detail panel" handler.
   *
   * Plain text colour with hover-underline only (no blue) — matches
   * the user's request for unobtrusive cross-record navigation.
   */
  const renderRelationCell = (field: Field, value: unknown) => {
    const ids = Array.isArray(value)
      ? (value as string[])
      : typeof value === "string" && value.length > 0
      ? [value]
      : [];
    if (ids.length === 0) return "";
    const cache = props.relationLabels ?? {};
    const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
    return (
      <span class="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {ids.map((id, i) => (
          <RecordLink
            label={cache[id] ?? id.slice(0, 8)}
            targetTableId={targetTableId}
            targetRecordId={id}
            baseId={props.baseId}
            comma={i < ids.length - 1}
          />
        ))}
      </span>
    );
  };

  /**
   * Renders a lookup cell (the projected value plus a link back to the
   * source-relation's first target record). Lookups are read-only
   * projections, so the cell shows whatever value was extracted; the
   * link points to the related record for context.
   */
  const renderLookupCell = (field: Field, rec: GridRecord) => {
    const cfg = field.config as { relationFieldId?: string };
    const relationField = cfg.relationFieldId
      ? props.fields.find((f) => f.id === cfg.relationFieldId && f.type === "relation")
      : undefined;
    const value = formatCell(rec.data[field.id], field.type, field.config, columnFormat(field.id));
    if (!value || !relationField) return value;
    const targetTableId = (relationField.config as { targetTableId?: string }).targetTableId;
    const linked = rec.data[relationField.id];
    const targetId = Array.isArray(linked)
      ? (linked[0] as string | undefined)
      : typeof linked === "string"
      ? linked
      : undefined;
    if (!targetTableId || !targetId) return value;
    return (
      <RecordLink
        label={value}
        targetTableId={targetTableId}
        targetRecordId={targetId}
        baseId={props.baseId}
      />
    );
  };

  const onRowClick = (rec: GridRecord) => props.onSelectRecord(rec);

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
            {/* `<thead>` is `sticky top-0` so the column-name row
                stays pinned to the top of the records-view scroll
                container while data rows scroll under it. The
                background covers the rows behind it (otherwise they'd
                show through during scroll). The records-view wrapper
                owns the y-scroll context — see RecordsView.island. */}
            <thead class="sticky top-0 z-10 bg-white dark:bg-zinc-900">
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
            {/* Footer aggregations — opt-in via the toolbar's
                Aggregations panel. Each row of the panel maps to a
                line in the cell under its target field. `*` rows
                ("count of rows") land under the leftmost visible
                field, Airtable-style.

                Reactivity gotcha: `props.aggregationSpecs` and
                `props.aggregates` MUST be read inside JSX expressions
                (or memos) — destructuring them into local consts
                inside the For render-fn freezes the values at the
                row's first render, so live updates from the toolbar
                wouldn't show until the next page reload. */}
            <Show when={(props.aggregationSpecs ?? []).length > 0}>
              <tfoot>
                <tr class="border-t border-zinc-100 dark:border-zinc-800">
                  <For each={visibleFields()}>
                    {(f, i) => (
                      <td class="px-3 py-1.5 text-[11px] text-dimmed">
                        <For
                          each={(props.aggregationSpecs ?? []).filter((s) =>
                            s.fieldId === "*" ? i() === 0 : s.fieldId === f.id,
                          )}
                        >
                          {(spec) => {
                            const value = () =>
                              (props.aggregates ?? {})[`${spec.fieldId}__${spec.agg}`];
                            const fallbackLabel = AGG_LABELS[spec.agg] ?? spec.agg;
                            const label = spec.label?.trim() || fallbackLabel;
                            return (
                              <Show when={value() !== undefined && value() !== null}>
                                <span
                                  class="block whitespace-nowrap"
                                  title={`${spec.agg}${spec.label ? ` (${spec.label})` : ""}`}
                                >
                                  <span class="font-medium text-secondary">
                                    {String(value())}
                                  </span>{" "}
                                  <span>{label}</span>
                                </span>
                              </Show>
                            );
                          }}
                        </For>
                      </td>
                    )}
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
                                ? renderRelationCell(f, rec.data[f.id])
                                : f.type === "lookup"
                                ? renderLookupCell(f, rec)
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
