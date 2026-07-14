import { DataTable, type DataTableColumn, Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { createEffect, For, type JSX, Show } from "solid-js";
import type { AggregationSpec, ColumnSpec } from "../../../contracts";
import { effectiveDisplayField } from "../../../lookup-display";
import type { Field, GridRecord, RecordList } from "../../../service";
import { fieldTypeIcon, fieldTypeLabel } from "../fields/field-type-meta";
import { FieldValue } from "./FieldValue";
import { fieldDisplayFormat, formatFieldValueText } from "./field-value-format";

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
 * Field values are rendered through `FieldValue`, including relation
 * labels from each record's pre-fetched `expanded` map. Zero render-time
 * DB calls — the batched-once `attachRelationExpansion` pass on the
 * server is the only roundtrip cost.
 */
type Props = {
  /** The list-call response. Items + schema + cursor in one prop. */
  result: RecordList;
  /** Parent base id — required for `<RecordLink>` hrefs. */
  baseId: string;
  /** Optional table UUID -> short id map so relation links use path routes. */
  tableShortIds?: Record<string, string>;
  /** Optional field catalog for resolving lookup target display types. */
  fieldsByTable?: Record<string, Field[]>;
  /**
   * Row click handler. Omit to render rows as non-interactive
   * (cursor stays default, no hover state). The records page passes
   * a handler that opens the detail panel; the dashboard passes a
   * handler that navigates to the records page with the row selected.
   */
  onRecordClick?: (record: GridRecord) => void;
  /** Highlighted row id — purely visual. */
  selectedId?: string | null;
  /** Short-lived live-refresh glow row ids — purely visual. */
  highlightedIds?: ReadonlySet<string>;
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
  dateConfig?: DateContext;
  class?: string;
  adminMode?: boolean;
  onFieldSettings?: (field: Field) => void;
  onFieldMove?: (field: Field, direction: -1 | 1) => void;
  onViewColumnSettings?: (column: ColumnSpec, field: Field | null) => void;
  onViewColumnMove?: (column: ColumnSpec, direction: -1 | 1) => void;
  bulkSelection?: {
    selectedIds: ReadonlySet<string>;
    onToggleRecord: (recordId: string, selected: boolean) => void;
    onToggleVisible: (selected: boolean) => void;
  };
};

const isComputedColumn = (column: ColumnSpec): column is Extract<ColumnSpec, { kind: "computed" }> =>
  "kind" in column && column.kind === "computed";

const columnId = (column: ColumnSpec): string => (isComputedColumn(column) ? column.id : column.fieldId);

const BULK_SELECTION_COLUMN_ID = "__bulk_selection";

const SelectionCheckbox = (props: { checked: boolean; indeterminate?: boolean; label: string; onChange: (checked: boolean) => void }) => {
  let inputRef: HTMLInputElement | undefined;
  createEffect(() => {
    if (inputRef) inputRef.indeterminate = !!props.indeterminate;
  });
  return (
    <input
      ref={inputRef}
      type="checkbox"
      class="focus-ui h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900"
      style={{ "accent-color": "var(--app-accent)" }}
      checked={props.checked}
      aria-label={props.label}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => props.onChange(event.currentTarget.checked)}
    />
  );
};

export default function DatabaseTable(props: Props) {
  /** Fields that actually render. When the caller passes `viewColumns`,
   *  it dictates BOTH visibility and order. Otherwise we fall back to
   *  the table-level default: every non-deleted, non-`hideInTable`
   *  field in `position` order — same rule the records page uses. */
  const computedField = (column: Extract<ColumnSpec, { kind: "computed" }>): Field => ({
    id: column.id,
    shortId: column.id.slice(-5),
    tableId: props.result.fields[0]?.tableId ?? "",
    name: column.label,
    description: null,
    icon: "ti ti-calculator",
    type: "formula",
    config: { expression: column.expression },
    position: 0,
    required: false,
    presentable: false,
    hideInTable: false,
    defaultValue: null,
    indexed: false,
    uniqueConstraint: false,
    deletedAt: null,
    createdAt: "",
    updatedAt: "",
  });

  const visibleColumns = (): Array<{ column: ColumnSpec; field: Field }> => {
    if (props.viewColumns) {
      const fieldsById = new Map(props.result.fields.map((f) => [f.id, f]));
      const entries: Array<{ column: ColumnSpec; field: Field }> = [];
      for (const column of props.viewColumns) {
        if (isComputedColumn(column)) {
          entries.push({ column, field: computedField(column) });
          continue;
        }
        const field = fieldsById.get(column.fieldId);
        if (field && !field.deletedAt) entries.push({ column, field });
      }
      return entries;
    }
    return props.result.fields
      .filter((field) => !field.deletedAt && !field.hideInTable)
      .sort((a, b) => a.position - b.position)
      .map((field) => ({ column: { fieldId: field.id }, field }));
  };

  const visibleFields = (): Field[] => visibleColumns().map((entry) => entry.field);

  /** Look up a per-column FormatSpec from the active viewColumns, if
   *  any. Drives date / number / currency / percent rendering. */
  const columnFormat = (fieldId: string) => {
    if (!props.viewColumns) return undefined;
    const col = props.viewColumns.find((c) => columnId(c) === fieldId);
    return col && "format" in col ? col.format : undefined;
  };

  const displayFormat = (field: Field) => fieldDisplayFormat(field, columnFormat(field.id));

  const columnLabel = (fieldId: string, fallback: string) => {
    if (!props.viewColumns) return fallback;
    const column = props.viewColumns.find((c) => columnId(c) === fieldId);
    return column && "label" in column ? column.label?.trim() || fallback : fallback;
  };

  const renderCell = (record: GridRecord, field: Field) => (
    <FieldValue
      field={field}
      value={record.data[field.id]}
      record={record}
      allFields={props.result.fields}
      baseId={props.baseId}
      tableShortIds={props.tableShortIds}
      fieldsByTable={props.fieldsByTable}
      dateConfig={props.dateConfig}
      format={displayFormat(field)}
      mode="table"
      linkLookup
      showBarcodeOpenAction
    />
  );

  const headerLabel = (field: Field, computed: boolean) => (
    <span class={`inline-flex min-w-0 items-center gap-1.5 ${computed ? "app-accent-text" : ""}`}>
      <i class={`${fieldTypeIcon(field.type, field.icon)} shrink-0 text-[13px] ${computed ? "" : "text-dimmed"}`} />
      <span class="truncate">{columnLabel(field.id, field.name)}</span>
    </span>
  );

  const visibleRecordIds = () => props.result.items.map((record) => record.id);
  const selectedVisibleCount = () => visibleRecordIds().filter((id) => props.bulkSelection?.selectedIds.has(id)).length;
  const allVisibleSelected = () => visibleRecordIds().length > 0 && selectedVisibleCount() === visibleRecordIds().length;
  const someVisibleSelected = () => selectedVisibleCount() > 0 && !allVisibleSelected();

  const selectionColumn = (): DataTableColumn<GridRecord> | null =>
    props.bulkSelection
      ? {
          id: BULK_SELECTION_COLUMN_ID,
          header: (
            <SelectionCheckbox
              checked={allVisibleSelected()}
              indeterminate={someVisibleSelected()}
              label={allVisibleSelected() ? "Clear visible records" : "Select visible records"}
              onChange={props.bulkSelection.onToggleVisible}
            />
          ),
          value: (record) => record.id,
          class: "w-10 min-w-10 max-w-10",
          headerClass: "w-10 min-w-10 max-w-10",
          cellClass: "w-10 min-w-10 max-w-10",
        }
      : null;

  const dataColumns = (): DataTableColumn<GridRecord>[] =>
    visibleColumns().map(({ column, field }) => {
      const computed = isComputedColumn(column);
      return {
        id: field.id,
        header: headerLabel(field, computed),
        subtitle: props.showColumnSubtitles === false ? undefined : computed ? "computed" : fieldTypeLabel(field.type).toLowerCase(),
        value: (record) => record.data[field.id],
        headerClass: computed ? "bg-[var(--theme-list-active-bg)]" : undefined,
      };
    });

  const columns = (): DataTableColumn<GridRecord>[] => {
    const selection = selectionColumn();
    return selection ? [selection, ...dataColumns()] : dataColumns();
  };

  const shellClass = () => props.class;

  const renderAdminHeader = (field: Field, subtitle: JSX.Element | undefined, computed: boolean) => (
    <div class="flex flex-col gap-0.5 leading-tight">
      <span class={computed ? "app-accent-text font-semibold" : "font-semibold text-primary"}>{headerLabel(field, computed)}</span>
      <Show when={subtitle !== undefined}>
        <span class={computed ? "app-accent-text text-[10px] font-normal opacity-80" : "text-[10px] font-normal text-dimmed"}>
          {subtitle}
        </span>
      </Show>
    </div>
  );

  const footerCell = (field: Field) => {
    const displayField = effectiveDisplayField(field, props.fieldsByTable);
    const index = visibleFields().findIndex((f) => f.id === field.id);
    return (
      <For each={(props.aggregationSpecs ?? []).filter((s) => (s.fieldId === "*" ? index === 0 : s.fieldId === field.id))}>
        {(spec) => {
          const value = () => (props.aggregates ?? {})[`${spec.fieldId}__${spec.agg}`];
          const displayValue = () =>
            spec.fieldId === "*"
              ? String(value())
              : formatFieldValueText({
                  field: displayField,
                  value: value(),
                  fieldsByTable: props.fieldsByTable,
                  dateConfig: props.dateConfig,
                  format: displayFormat(field),
                });
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
    <Show when={visibleFields().length > 0} fallback={<Placeholder surface="paper">No visible fields.</Placeholder>}>
      <DataTable
        rows={props.result.items}
        columns={columns()}
        class={shellClass()}
        scrollPreserveKey={props.scrollPreserveKey}
        getRowId={(record) => record.id}
        selectedRowId={props.selectedId}
        onRowClick={props.onRecordClick}
        rowClass={(record) =>
          props.highlightedIds?.has(record.id)
            ? "bg-sky-50/45 shadow-[inset_2px_0_0_rgb(56_189_248_/_0.65)] transition-colors dark:bg-sky-950/20"
            : undefined
        }
        empty="No records"
        hasMore={props.hasMore}
        loadingMore={props.loadingMore}
        onLoadMore={props.onLoadMore}
        cellContentClass="max-h-28 max-w-full overflow-auto pr-1"
        fillHeight
        renderCell={({ row, col }) => {
          if (col.id === BULK_SELECTION_COLUMN_ID && props.bulkSelection) {
            return (
              <SelectionCheckbox
                checked={props.bulkSelection.selectedIds.has(row.id)}
                label={`Select record ${row.id}`}
                onChange={(selected) => props.bulkSelection?.onToggleRecord(row.id, selected)}
              />
            );
          }
          const field = visibleFields().find((f) => f.id === col.id);
          return field ? renderCell(row, field) : "";
        }}
        renderHeader={({ col, render }) => {
          if (col.id === BULK_SELECTION_COLUMN_ID) return render();
          const entry = visibleColumns().find((item) => item.field.id === col.id);
          const field = entry?.field;
          const computed = entry ? isComputedColumn(entry.column) : false;
          const subtitle = typeof col.subtitle === "function" ? undefined : col.subtitle;
          const isColumnOrderEdit = !!props.viewColumns && !!props.onViewColumnMove;
          const isViewColumnEdit = !!props.onViewColumnSettings;
          const isFieldEdit = !!props.onFieldSettings;
          if (!props.adminMode || !field || (!isColumnOrderEdit && !isViewColumnEdit && !isFieldEdit)) return render();
          const index = visibleFields().findIndex((f) => f.id === field.id);
          const canMoveLeft = index > 0 && (isColumnOrderEdit || (!!props.onFieldMove && !props.viewColumns));
          const canMoveRight =
            index >= 0 && index < visibleFields().length - 1 && (isColumnOrderEdit || (!!props.onFieldMove && !props.viewColumns));
          const adminIconClass =
            "icon-btn h-6 w-6 shrink-0 text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200";
          return (
            <div class="flex min-w-0 items-start gap-2">
              <div class="min-w-0 flex-1">{renderAdminHeader(field, subtitle, computed)}</div>
              <div class="flex shrink-0 items-center gap-0">
                <button
                  type="button"
                  class={adminIconClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isColumnOrderEdit && entry) props.onViewColumnMove?.(entry.column, -1);
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
                    if (isColumnOrderEdit && entry) props.onViewColumnMove?.(entry.column, 1);
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
                    if (isViewColumnEdit && entry)
                      props.onViewColumnSettings?.(entry.column, isComputedColumn(entry.column) ? null : field);
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
