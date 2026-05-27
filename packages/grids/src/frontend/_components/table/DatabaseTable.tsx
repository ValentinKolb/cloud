import { markdown } from "@valentinkolb/cloud/shared";
import { DataTable, type DataTableColumn, MarkdownView, ProgressBar } from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import type { AggregationSpec } from "../../../contracts";
import type { Field, GridRecord, RecordList } from "../../../service";
import type { ColumnSpec } from "../../../service/views";
import { formatCell, progressRatio } from "./format-cell";
import { RecordLink } from "./RecordLink";
import { SelectValueBadges } from "./select-badges";

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
 * This is the canonical records table renderer for Grids. It is kept
 * presentational so the records page, dashboard embeds, and view pages
 * can share relation links, formatting, and aggregate footers without
 * dragging in page-specific toolbar or detail-panel state.
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
  /** Optional table UUID -> short id map so relation links use path routes. */
  tableShortIds?: Record<string, string>;
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
   * too; used by date / number / currency / percent renderers to
   * pick up the view's saved style.
   */
  viewColumns?: ColumnSpec[];
  /** Hide the field-type subtitle in compact surfaces like dashboards. */
  showColumnSubtitles?: boolean;
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
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  scrollPreserveKey?: string;
  adminMode?: boolean;
  onFieldSettings?: (field: Field) => void;
  onFieldMove?: (field: Field, direction: -1 | 1) => void;
  onViewColumnSettings?: (field: Field) => void;
  onViewColumnMove?: (field: Field, direction: -1 | 1) => void;
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
 *  fields. The server already filtered down to the target table's
 *  label fields, so we just join everything in iteration order with ' · '.
 *  Falls back to a neutral placeholder when expansion is missing
 *  (target table the viewer can't read, or expansion wasn't requested). */
const buildExpandedLabel = (expandedForUuid: Record<string, unknown> | undefined, _fallbackUuid: string): string => {
  if (!expandedForUuid) return "Unknown record";
  const parts = Object.values(expandedForUuid)
    .map(valueToLabelPart)
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join(" · ") : "Untitled record";
};

const isMarkdownLongtext = (field: Field) => field.type === "longtext" && Boolean((field.config as { markdown?: boolean }).markdown);

const renderMarkdownCell = (value: unknown) => {
  if (typeof value !== "string" || value.trim().length === 0) return "";
  return <MarkdownView html={markdown.render(value)} smallHeadings class="text-sm" />;
};

export default function DatabaseTable(props: Props) {
  /** Fields that actually render. When the caller passes `viewColumns`,
   *  it dictates BOTH visibility and order. Otherwise we fall back to
   *  the table-level default: every non-deleted, non-`hideInTable`
   *  field in `position` order — same rule the records page uses. */
  const visibleFields = (): Field[] => {
    if (props.viewColumns) {
      const fieldsById = new Map(props.result.fields.map((f) => [f.id, f]));
      return props.viewColumns.map((c) => fieldsById.get(c.fieldId)).filter((f): f is Field => !!f && !f.deletedAt);
    }
    return props.result.fields.filter((f) => !f.deletedAt && !f.hideInTable).sort((a, b) => a.position - b.position);
  };

  /** Look up a per-column FormatSpec from the active viewColumns, if
   *  any. Drives date / number / currency / percent rendering. */
  const columnFormat = (fieldId: string) => {
    if (!props.viewColumns) return undefined;
    const col = props.viewColumns.find((c) => c.fieldId === fieldId);
    return col && "format" in col ? col.format : undefined;
  };

  const columnLabel = (fieldId: string, fallback: string) => {
    if (!props.viewColumns) return fallback;
    return props.viewColumns.find((c) => c.fieldId === fieldId)?.label?.trim() || fallback;
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
            targetTableShortId={targetTableId ? props.tableShortIds?.[targetTableId] : undefined}
            targetRecordId={id}
            baseId={props.baseId}
            comma={i < ids.length - 1}
          />
        ))}
      </span>
    );
  };

  /** Renders a lookup cell: the projected value plus a click-through
   *  to the first linked record on the source relation. Kept
   *  consistent so dashboard + records-page feel identical. */
  const renderLookupCell = (record: GridRecord, field: Field) => {
    const cfg = field.config as { relationFieldId?: string };
    const relationField = cfg.relationFieldId
      ? props.result.fields.find((f) => f.id === cfg.relationFieldId && f.type === "relation" && !f.deletedAt)
      : undefined;
    const value = formatCell(record.data[field.id], field.type, field.config, columnFormat(field.id));
    if (!value || !relationField) return value;
    const targetTableId = (relationField.config as { targetTableId?: string }).targetTableId;
    const linked = record.data[relationField.id];
    const targetId = Array.isArray(linked) ? (linked[0] as string | undefined) : typeof linked === "string" ? linked : undefined;
    if (!targetTableId || !targetId) return value;
    return (
      <RecordLink
        label={value}
        targetTableId={targetTableId}
        targetTableShortId={props.tableShortIds?.[targetTableId]}
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
    if (field.type === "select") {
      return <SelectValueBadges value={record.data[field.id]} type={field.type} fieldConfig={field.config} />;
    }
    if (isMarkdownLongtext(field)) return renderMarkdownCell(record.data[field.id]);
    const fmt = columnFormat(field.id);
    if (fmt?.kind === "progress" && (field.type === "percent" || field.type === "formula")) {
      const ratio = progressRatio(record.data[field.id], field.type, field.config);
      const percent = Math.round(ratio * 100);
      const label =
        fmt.label === "none" ? "" : fmt.label === "value" ? formatCell(record.data[field.id], field.type, field.config) : `${percent}%`;
      return (
        <span class="flex min-w-36 items-center gap-3">
          <ProgressBar value={percent} size="sm" class="w-32 shrink-0" />
          <Show when={label}>
            <span class="whitespace-nowrap tabular-nums text-primary">{label}</span>
          </Show>
        </span>
      );
    }
    return formatCell(record.data[field.id], field.type, field.config, columnFormat(field.id));
  };

  const columns = (): DataTableColumn<GridRecord>[] =>
    visibleFields().map((field) => ({
      id: field.id,
      header: columnLabel(field.id, field.name),
      subtitle: props.showColumnSubtitles === false ? undefined : field.type,
      value: (record) => record.data[field.id],
    }));

  const shellClass = () => undefined;

  const renderAdminHeader = (field: Field, subtitle: DataTableColumn<GridRecord>["subtitle"]) => (
    <div class="flex flex-col gap-0.5 leading-tight">
      <span class="font-semibold text-emerald-700 dark:text-emerald-300">{columnLabel(field.id, field.name)}</span>
      <Show when={subtitle !== undefined}>
        <span class="text-[10px] font-normal text-emerald-600/80 dark:text-emerald-300/80">{field.type}</span>
      </Show>
    </div>
  );

  const footerCell = (field: Field) => {
    const index = visibleFields().findIndex((f) => f.id === field.id);
    return (
      <For each={(props.aggregationSpecs ?? []).filter((s) => (s.fieldId === "*" ? index === 0 : s.fieldId === field.id))}>
        {(spec) => {
          const value = () => (props.aggregates ?? {})[`${spec.fieldId}__${spec.agg}`];
          const displayValue = () =>
            spec.fieldId === "*" ? String(value()) : formatCell(value(), field.type, field.config, columnFormat(field.id));
          const fallbackLabel = AGG_LABELS[spec.agg] ?? spec.agg;
          const label = spec.label?.trim() || fallbackLabel;
          return (
            <Show when={value() !== undefined && value() !== null}>
              <span class="block whitespace-nowrap" title={`${spec.agg}${spec.label ? ` (${spec.label})` : ""}`}>
                <span class="font-medium text-secondary">{displayValue()}</span> <span>{label}</span>
              </span>
            </Show>
          );
        }}
      </For>
    );
  };

  return (
    <Show when={visibleFields().length > 0} fallback={<div class="paper p-6 text-center text-sm text-dimmed">No visible fields.</div>}>
      <DataTable
        rows={props.result.items}
        columns={columns()}
        class={shellClass()}
        scrollPreserveKey={props.scrollPreserveKey}
        getRowId={(record) => record.id}
        selectedRowId={props.selectedId}
        onRowClick={props.onRecordClick}
        empty="No records"
        hasMore={props.hasMore}
        loadingMore={props.loadingMore}
        onLoadMore={props.onLoadMore}
        cellContentClass="max-h-28 max-w-full overflow-auto pr-1"
        fillHeight
        renderCell={({ row, col }) => {
          const field = visibleFields().find((f) => f.id === col.id);
          return field ? renderCell(row, field) : "";
        }}
        renderHeader={({ col, render }) => {
          const field = visibleFields().find((f) => f.id === col.id);
          const isColumnOrderEdit = !!props.viewColumns && !!props.onViewColumnMove;
          const isViewColumnEdit = !!props.onViewColumnSettings;
          const isFieldEdit = !!props.onFieldSettings;
          if (!props.adminMode || !field || (!isColumnOrderEdit && !isViewColumnEdit && !isFieldEdit)) return render();
          const index = visibleFields().findIndex((f) => f.id === field.id);
          const canMoveLeft = index > 0 && (isColumnOrderEdit || (!!props.onFieldMove && !props.viewColumns));
          const canMoveRight =
            index >= 0 && index < visibleFields().length - 1 && (isColumnOrderEdit || (!!props.onFieldMove && !props.viewColumns));
          const adminIconClass =
            "icon-btn h-6 w-6 shrink-0 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300";
          return (
            <div class="flex min-w-0 items-start gap-2">
              <div class="min-w-0 flex-1">{renderAdminHeader(field, col.subtitle)}</div>
              <div class="flex shrink-0 items-center gap-0">
                <button
                  type="button"
                  class={adminIconClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isColumnOrderEdit) props.onViewColumnMove?.(field, -1);
                    else props.onFieldMove?.(field, -1);
                  }}
                  disabled={!canMoveLeft}
                  title="Move column left"
                  aria-label={`Move ${field.name} left`}
                >
                  <i class="ti ti-chevron-left text-xs" />
                </button>
                <button
                  type="button"
                  class={adminIconClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isColumnOrderEdit) props.onViewColumnMove?.(field, 1);
                    else props.onFieldMove?.(field, 1);
                  }}
                  disabled={!canMoveRight}
                  title="Move column right"
                  aria-label={`Move ${field.name} right`}
                >
                  <i class="ti ti-chevron-right text-xs" />
                </button>
                <button
                  type="button"
                  class={adminIconClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isViewColumnEdit) props.onViewColumnSettings?.(field);
                    else props.onFieldSettings?.(field);
                  }}
                  title={isViewColumnEdit ? "Column settings" : "Field settings"}
                  aria-label={`${isViewColumnEdit ? "Column" : "Field"} settings for ${field.name}`}
                >
                  <i class="ti ti-settings text-xs" />
                </button>
              </div>
            </div>
          );
        }}
        footer={
          (props.aggregationSpecs ?? []).length > 0
            ? {
                renderCell: ({ col }) => {
                  const field = visibleFields().find((f) => f.id === col.id);
                  return field ? footerCell(field) : "";
                },
              }
            : undefined
        }
      />
    </Show>
  );
}
