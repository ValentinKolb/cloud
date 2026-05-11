import { For, Show } from "solid-js";
import type { Field, GridRecord, RecordList } from "../../service";
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

/**
 * DatabaseTable — minimal, presentational records table.
 *
 * Designed as a "dumb" component: it renders whatever rows the caller
 * gives it, and emits row clicks. No toolbar, no filter UI, no
 * sort headers, no add/edit/delete affordances, no detail-panel
 * mounting, no pagination controls. All of those belong to the
 * surrounding screen and are wired up there.
 *
 * Why a separate component when `RecordsGrid` already exists? Two
 * goals:
 *   1. Reuse on the dashboard. The dashboard's view-cell was
 *      reinventing a worse version of the records table — no
 *      relation links, no consistent formatting.
 *   2. Cleaner API. `RecordsGrid` couples table rendering to the
 *      records-page concerns (aggregations footer, viewColumns from a
 *      saved view, selection state for the URL-driven detail panel).
 *      `<DatabaseTable>` carries just the rendering, and the caller
 *      adds the surrounding chrome it needs.
 *
 * Relation cells: read each record's pre-fetched `expanded` map
 * (populated by `gridsService.record.list({ includeRelations: true })`)
 * and render `<RecordLink>` with a label joined from the linked
 * record's presentable fields. Zero render-time DB calls — the
 * batched-once `attachRelationExpansion` pass on the server is the
 * only roundtrip cost.
 */
type Props = {
  /** The list-call response. Items + schema + cursor in one prop. */
  result: RecordList;
  /** Parent base id — required for `<RecordLink>` hrefs. */
  baseId: string;
  /**
   * Row click handler. Omit to render rows as non-interactive
   * (cursor stays default, no hover state). The records page passes
   * a handler that opens the detail panel; the dashboard passes a
   * handler that navigates to the records page with the row selected.
   */
  onRecordClick?: (record: GridRecord) => void;
  /** Highlighted row id — purely visual. */
  selectedId?: string | null;
  /**
   * Optional saved-view column override. When set, dictates BOTH the
   * visible field set AND their order (instead of the default
   * `!hideInTable` + `position` rule). Per-column `format` lives here
   * too; used by date / decimal / currency / percent renderers to
   * pick up the view's saved style.
   */
  viewColumns?: ColumnSpec[];
  /**
   * Pre-resolved aggregate values keyed `<fieldId>__<agg>`. Drives a
   * footer row when paired with `aggregationSpecs`. Omit both to skip
   * the footer entirely (the dashboard view widget does this).
   */
  aggregates?: Record<string, unknown>;
  /**
   * Aggregation specs that produced `aggregates`. Footer renders one
   * entry per spec under its target field's column (`*` specs land
   * under the leftmost visible field, Airtable-style).
   */
  aggregationSpecs?: AggregationSpec[];
};

/** Joins a list of arbitrary cell values into a presentable label.
 *  Mirrors the server-side `formatLabelPart` for the field types we
 *  expect in `record.expanded` (presentable fields are typically text,
 *  number, boolean, or currency/location objects). */
const valueToLabelPart = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(valueToLabelPart).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.label === "string") return obj.label;
    if (typeof obj.amount === "string") return obj.amount;
  }
  return "";
};

/** Builds the link label for a single linked record from its expanded
 *  fields. The server already filtered down to presentable + displayFieldId
 *  precedence, so we just join everything in iteration order with ' · '.
 *  Falls back to an 8-char UUID prefix when expansion is missing
 *  (target table the viewer can't read, or expansion wasn't requested). */
const buildExpandedLabel = (
  expandedForUuid: Record<string, unknown> | undefined,
  fallbackUuid: string,
): string => {
  if (!expandedForUuid) return fallbackUuid.slice(0, 8);
  const parts = Object.values(expandedForUuid).map(valueToLabelPart).filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join(" · ") : fallbackUuid.slice(0, 8);
};

export default function DatabaseTable(props: Props) {
  /** Fields that actually render. When the caller passes `viewColumns`,
   *  it dictates BOTH visibility and order. Otherwise we fall back to
   *  the table-level default: every non-deleted, non-`hideInTable`
   *  field in `position` order — same rule the records page uses. */
  const visibleFields = (): Field[] => {
    if (props.viewColumns) {
      const fieldsById = new Map(props.result.fields.map((f) => [f.id, f]));
      return props.viewColumns
        .map((c) => fieldsById.get(c.fieldId))
        .filter((f): f is Field => !!f && !f.deletedAt);
    }
    return props.result.fields
      .filter((f) => !f.deletedAt && !f.hideInTable)
      .sort((a, b) => a.position - b.position);
  };

  /** Look up a per-column FormatSpec from the active viewColumns, if
   *  any. Drives date / decimal / currency / percent rendering. */
  const columnFormat = (fieldId: string) => {
    if (!props.viewColumns) return undefined;
    const col = props.viewColumns.find((c) => c.fieldId === fieldId);
    return col && "format" in col ? col.format : undefined;
  };

  /** Renders a relation cell as one or more inline `<RecordLink>`s.
   *  Each link reads from the parent record's `.expanded` map — no
   *  extra DB calls, no separate label cache to thread through. */
  const renderRelationCell = (record: GridRecord, field: Field) => {
    const raw = record.data[field.id];
    const ids: string[] = Array.isArray(raw)
      ? (raw as unknown[]).filter((x): x is string => typeof x === "string")
      : typeof raw === "string" && raw.length > 0
        ? [raw]
        : [];
    if (ids.length === 0) return "";
    const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
    return (
      <span class="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {ids.map((id, i) => (
          <RecordLink
            label={buildExpandedLabel(record.expanded?.[id], id)}
            targetTableId={targetTableId}
            targetRecordId={id}
            baseId={props.baseId}
            comma={i < ids.length - 1}
          />
        ))}
      </span>
    );
  };

  /** Renders a lookup cell: the projected value plus a click-through
   *  to the first linked record on the source relation. Same shape
   *  RecordsGrid uses, kept consistent so dashboard + records-page
   *  feel identical. */
  const renderLookupCell = (record: GridRecord, field: Field) => {
    const cfg = field.config as { relationFieldId?: string };
    const relationField = cfg.relationFieldId
      ? visibleFields().find((f) => f.id === cfg.relationFieldId && f.type === "relation")
      : undefined;
    const value = formatCell(
      record.data[field.id],
      field.type,
      field.config,
      columnFormat(field.id),
    );
    if (!value || !relationField) return value;
    const targetTableId = (relationField.config as { targetTableId?: string }).targetTableId;
    const linked = record.data[relationField.id];
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

  /** Cell dispatcher — picks the relation/lookup specialisations or
   *  falls back to formatCell for everything else (text, number, date,
   *  select, currency, etc.). */
  const renderCell = (record: GridRecord, field: Field) => {
    if (field.type === "relation") return renderRelationCell(record, field);
    if (field.type === "lookup") return renderLookupCell(record, field);
    return formatCell(record.data[field.id], field.type, field.config, columnFormat(field.id));
  };

  const isInteractive = () => !!props.onRecordClick;

  const onRowClick = (record: GridRecord) => {
    props.onRecordClick?.(record);
  };

  const onRowKeyDown = (event: KeyboardEvent, record: GridRecord) => {
    if (!isInteractive()) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onRowClick(record);
  };

  return (
    <Show
      when={visibleFields().length > 0}
      fallback={
        <div class="paper p-6 text-center text-sm text-dimmed">
          No visible fields.
        </div>
      }
    >
      {/* `paper overflow-auto flex-1 min-h-0` so the table acts as
          its own scroll container — sticky thead pins inside this
          element. Outside a flex-col context, `flex-1 min-h-0` no-ops
          and the wrapper just takes its natural height. */}
      <div class="paper overflow-auto flex-1 min-h-0">
        <table class="w-full text-xs">
          {/* Sticky thead — column names pin to the top during vertical scroll. */}
          <thead class="sticky top-0 z-10 bg-white dark:bg-zinc-900">
            <tr class="border-b border-zinc-100 dark:border-zinc-800">
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
          {/* Footer aggregations — opt-in via the records-page toolbar's
              Aggregations panel. Each spec maps to a line in the cell
              under its target field. `*` specs ("count of rows") land
              under the leftmost visible field, Airtable-style. Reactivity
              gotcha: aggregationSpecs / aggregates MUST be read inside
              JSX expressions (or memos) — destructuring into local consts
              inside For freezes values at row's first render. */}
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
              when={props.result.items.length > 0}
              fallback={
                <tr>
                  <td
                    class="px-3 py-6 text-center text-xs text-dimmed"
                    colspan={visibleFields().length}
                  >
                    No records
                  </td>
                </tr>
              }
            >
              <For each={props.result.items}>
                {(record) => {
                  const isSelected = () => props.selectedId === record.id;
                  return (
                    <tr
                      class={`border-b border-zinc-100 dark:border-zinc-800/60 last:border-0 ${
                        isInteractive()
                          ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                          : ""
                      } ${
                        isSelected()
                          ? "bg-blue-50 dark:bg-blue-900/20"
                          : ""
                      }`}
                      tabIndex={isInteractive() ? 0 : undefined}
                      onClick={() => isInteractive() && onRowClick(record)}
                      onKeyDown={(e) => onRowKeyDown(e, record)}
                    >
                      <For each={visibleFields()}>
                        {(f) => (
                          <td class="px-3 py-2 align-top max-w-[260px] truncate">
                            {renderCell(record, f)}
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
    </Show>
  );
}
