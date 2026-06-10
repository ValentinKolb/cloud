import { DataTable, type DataTableColumn, Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import type { Field } from "../../../service";
import type { FormatSpec } from "../../../service/views";
import { formatCell } from "./format-cell";
import { RecordLink } from "./RecordLink";

/**
 * Server-rendered shape of a group bucket. Mirrors the API contract
 * in `contracts.GroupBucketSchema`. Keys are parallel to the
 * groupBy spec used to produce them; values is keyed by `${fid}__${agg}`
 * (or `*__count` for COUNT(*)).
 */
export type GroupBucket = {
  keys: unknown[];
  values: Record<string, unknown>;
};

type GroupTableColumn =
  | { kind: "group"; id: string; spec: GroupByCol; index: number }
  | { kind: "agg"; id: string; spec: AggCol; index: number };
type GroupDataTableColumn = DataTableColumn<GroupBucket> & { meta: GroupTableColumn };

type GroupByCol = {
  fieldId: string;
  label?: string;
  format?: FormatSpec;
  granularity?: "day" | "week" | "month" | "quarter" | "year";
};

type AggCol = {
  fieldId: string | "*";
  agg: string;
  label?: string;
  format?: FormatSpec;
};

type Props = {
  /** Base id (UUID or slug — same value the parent page uses) so the
   *  relation-group-key links can navigate to `/app/grids/<base>?table=…&record=…`,
   *  matching the row-mode relation cell behavior. */
  baseId: string;
  tableShortIds?: Record<string, string>;
  fields: Field[];
  groupBy: GroupByCol[];
  aggregations: AggCol[];
  buckets: GroupBucket[];
  /** Server flag: at least one groupBy dimension is a relation, so a
   *  record with N links contributes to N buckets and `*__count` counts
   *  pair occurrences, not unique records. UI surfaces a hint when set. */
  explode?: boolean;
  /** UUID → presentable label for relation-typed group keys. Same map
   *  the row-mode grid uses to render relation cells; the API endpoint
   *  resolves it server-side for grouped responses so the keys column
   *  doesn't show raw UUIDs. */
  relationLabels?: Record<string, string>;
  selectedBucketKey?: string | null;
  onBucketClick?: (bucket: GroupBucket) => void;
  adminMode?: boolean;
  columnOrder?: string[];
  hiddenColumnIds?: string[];
  scrollPreserveKey?: string;
  onColumnSettings?: (columnId: string) => void;
  onColumnMove?: (columnId: string, direction: -1 | 1) => void;
  dateConfig?: DateContext;
};

export const groupedGroupColumnId = (spec: GroupByCol, index: number): string => `group:${index}:${spec.fieldId}:${spec.granularity ?? ""}`;

export const groupedAggregationColumnId = (spec: AggCol, index: number): string => `agg:${index}:${spec.fieldId}:${spec.agg}`;

/**
 * Renders a "summary view": one row per bucket, columns are
 *   [<group key 1>, <group key 2>, …, <agg 1>, <agg 2>, …]
 *
 * Records aren't shown (classic GROUP BY semantics — switch the view
 * back to no-grouping for the row-level list). The default `*__count`
 * column is always emitted by the server, even when the user didn't
 * configure aggregations explicitly.
 */
export default function GroupedTable(props: Props) {
  const fieldsById = new Map(props.fields.map((f) => [f.id, f]));

  const groupHeader = (g: GroupByCol): string => {
    if (g.label?.trim()) return g.label.trim();
    const f = fieldsById.get(g.fieldId);
    if (!f) return "missing field";
    return g.granularity ? `${f.name} (${g.granularity})` : f.name;
  };
  const aggHeader = (a: AggCol): string => {
    if (a.label) return a.label;
    if (a.fieldId === "*") return a.agg === "count" ? "# records" : a.agg;
    const f = fieldsById.get(a.fieldId);
    const name = f ? f.name : "missing field";
    return `${a.agg} ${name}`;
  };

  /** Plain-text fallback for non-relation cells. Relation cells render
   *  via RecordLink in the JSX path so they get cross-table navigation —
   *  same UX as the row-mode grid. */
  const formatScalarKey = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    return String(val);
  };

  /** Label resolution shared by RecordLink + the dash-fallback case. */
  const relationLabelFor = (val: string): string => props.relationLabels?.[val] ?? "Unknown record";

  // Always include the implicit `*__count` column even if the user
  // didn't configure it — the server adds it for every group query
  // because "how many records in this bucket" is universally useful.
  const aggColsWithCount = (): AggCol[] => {
    const explicit = props.aggregations;
    const hasStarCount = explicit.some((a) => a.fieldId === "*" && a.agg === "count");
    return hasStarCount ? explicit : [{ fieldId: "*", agg: "count" }, ...explicit];
  };
  const aggKeyOf = (a: AggCol): string => `${a.fieldId}__${a.agg}`;

  const formatAgg = (val: unknown, spec: AggCol): string => {
    if (val === null || val === undefined) return "—";
    if (spec.format) {
      const field = spec.fieldId === "*" ? null : fieldsById.get(spec.fieldId);
      return formatCell(val, field?.type ?? "number", field?.config ?? {}, spec.format, props.dateConfig) || String(val);
    }
    if (typeof val === "number") return Number.isInteger(val) ? String(val) : val.toFixed(2);
    return String(val);
  };
  const bucketKey = (bucket: GroupBucket): string => JSON.stringify(bucket.keys);

  const columns = (): GroupDataTableColumn[] => {
    const hidden = new Set(props.hiddenColumnIds ?? []);
    const baseColumns: GroupDataTableColumn[] = [
      ...props.groupBy.map((g, index) => ({
        id: groupedGroupColumnId(g, index),
        header: groupHeader(g),
        subtitle: "group",
        value: () => undefined,
        meta: { kind: "group", id: groupedGroupColumnId(g, index), spec: g, index } as GroupTableColumn,
      })),
      ...aggColsWithCount().map((a, index) => ({
        id: groupedAggregationColumnId(a, index),
        header: aggHeader(a),
        subtitle: "aggregate",
        value: (bucket: GroupBucket) => bucket.values[aggKeyOf(a)],
        cellClass: "tabular-nums",
        meta: { kind: "agg", id: groupedAggregationColumnId(a, index), spec: a, index } as GroupTableColumn,
      })),
    ].filter((column) => !hidden.has(column.id));
    const orderedIds = props.columnOrder ?? [];
    if (orderedIds.length === 0) return baseColumns;
    const byId = new Map(baseColumns.map((column) => [column.id, column]));
    const orderedColumns = orderedIds.map((id) => byId.get(id)).filter((column): column is GroupDataTableColumn => !!column);
    const orderedSet = new Set(orderedColumns.map((column) => column.id));
    return [...orderedColumns, ...baseColumns.filter((column) => !orderedSet.has(column.id))];
  };

  const columnMeta = (col: DataTableColumn<GroupBucket>): GroupTableColumn => (col as GroupDataTableColumn).meta;

  return (
    <Show
      when={props.buckets.length > 0}
      fallback={<Placeholder surface="paper">No groups. Adjust the filter or grouping configuration.</Placeholder>}
    >
      <Show when={props.explode}>
        <div class="text-[11px] text-dimmed flex items-center gap-1.5 px-1">
          <i class="ti ti-info-circle" />
          Buckets may overlap — a record with multiple linked targets contributes to each bucket. Counts reflect (record × link) pairs.
        </div>
      </Show>
      <DataTable
        rows={props.buckets}
        columns={columns()}
        scrollPreserveKey={props.scrollPreserveKey}
        selectedRowId={props.selectedBucketKey}
        getRowId={bucketKey}
        onRowClick={props.onBucketClick}
        renderHeader={({ col, render }) => {
          const meta = columnMeta(col);
          if (!props.adminMode) return render();
          const renderedColumns = columns();
          const index = renderedColumns.findIndex((column) => column.id === col.id);
          const count = renderedColumns.length;
          const settings = props.onColumnSettings;
          const move = props.onColumnMove;
          if (!settings && !move) return render();
          const adminIconClass =
            "icon-btn h-6 w-6 shrink-0 text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200";
          return (
            <div class="flex min-w-0 items-start gap-2">
              <div class="min-w-0 flex-1">{render()}</div>
              <div class="flex shrink-0 items-center gap-0">
                <button
                  type="button"
                  class={adminIconClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    move?.(meta.id, -1);
                  }}
                  disabled={!move || index === 0}
                  title="Move column left"
                  aria-label="Move column left"
                >
                  <i class="ti ti-chevron-left text-xs" />
                </button>
                <button
                  type="button"
                  class={adminIconClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    move?.(meta.id, 1);
                  }}
                  disabled={!move || index >= count - 1}
                  title="Move column right"
                  aria-label="Move column right"
                >
                  <i class="ti ti-chevron-right text-xs" />
                </button>
                <button
                  type="button"
                  class={adminIconClass}
                  onClick={(event) => {
                    event.stopPropagation();
                    settings?.(meta.id);
                  }}
                  disabled={!settings}
                  title="Column settings"
                  aria-label="Column settings"
                >
                  <i class="ti ti-settings text-xs" />
                </button>
              </div>
            </div>
          );
        }}
        renderCell={({ row, col }) => {
          const meta = columnMeta(col);
          if (meta.kind === "agg") return formatAgg(row.values[aggKeyOf(meta.spec)], meta.spec);
          const f = fieldsById.get(meta.spec.fieldId);
          const val = row.keys[meta.index];
          if (f && f.type === "relation" && typeof val === "string") {
            const cfg = f.config as { targetTableId?: string };
            return (
              <RecordLink
                baseId={props.baseId}
                targetTableId={cfg.targetTableId}
                targetTableShortId={cfg.targetTableId ? props.tableShortIds?.[cfg.targetTableId] : undefined}
                targetRecordId={val}
                label={relationLabelFor(val)}
              />
            );
          }
          return f
            ? formatCell(
                val,
                f.type,
                meta.spec.granularity ? { ...f.config, includeTime: false } : f.config,
                meta.spec.format,
                props.dateConfig,
              ) || formatScalarKey(val)
            : formatScalarKey(val);
        }}
      />
    </Show>
  );
}
