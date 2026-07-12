import { prompts } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { Accessor, Setter } from "solid-js";
import { apiClient } from "../../../api/client";
import type { AggregationSpec, ColumnSpec, FieldColumnSpec, GroupBySpec, RecordQuery } from "../../../contracts";
import { simpleQueryToGqlSource } from "../../../query-dsl/record-query-source";
import type { Field, Table, View } from "../../../service";
import { openViewColumnSettingsDialog } from "../dialogs/ViewColumnSettingsDialog";
import { groupedAggregationColumnId, groupedGroupColumnId } from "../table/GroupedTable";
import { errorMessage } from "../utils/api-helpers";
import { openAddViewColumnsDialog } from "./AddViewColumnsDialog";
import { openComputedColumnDialog } from "./ComputedColumnDialog";

export const isComputedColumn = (column: ColumnSpec): column is Extract<ColumnSpec, { kind: "computed" }> =>
  "kind" in column && column.kind === "computed";

export const isFieldColumn = (column: ColumnSpec): column is FieldColumnSpec => !isComputedColumn(column);

const columnId = (column: ColumnSpec): string => (isComputedColumn(column) ? column.id : column.fieldId);

export const resolveDefaultViewColumns = (tableColumns: FieldColumnSpec[], fields: Field[]): ColumnSpec[] =>
  tableColumns.length > 0
    ? tableColumns
    : fields
        .filter((field) => !field.deletedAt && !field.hideInTable)
        .sort((a, b) => a.position - b.position)
        .map((field) => ({ fieldId: field.id }));

export const mergeGroupedColumnOrder = (ids: string[], saved: string[]): string[] => {
  const idSet = new Set(ids);
  const savedSet = new Set(saved);
  return [...saved.filter((id) => idSet.has(id)), ...ids.filter((id) => !savedSet.has(id))];
};

export const moveColumn = <T>(items: T[], index: number, direction: -1 | 1): T[] | null => {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return null;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  if (!moved) return null;
  next.splice(target, 0, moved);
  return next;
};

type ColumnView = Pick<View, "id" | "tableId"> & { query: RecordQuery };

type RecordsViewColumnControllerOptions = {
  props: {
    activeView?: ColumnView | null;
    tableId: string;
    baseShortId: string;
    tableShortId: string;
  };
  fields: Accessor<Field[]>;
  tableColumns: Accessor<FieldColumnSpec[]>;
  setTableColumns: Setter<FieldColumnSpec[]>;
  query: Accessor<RecordQuery>;
  setQuery: Setter<RecordQuery>;
  viewColumns: Accessor<ColumnSpec[] | undefined>;
  setViewColumns: Setter<ColumnSpec[] | undefined>;
  groupBy: Accessor<GroupBySpec[]>;
  aggregations: Accessor<AggregationSpec[]>;
  isGrouped: Accessor<boolean>;
  isSavedView: Accessor<boolean>;
  syncUrl: (options: { replace: boolean }) => void;
};

export const createRecordsViewColumnController = ({
  props,
  fields,
  tableColumns,
  setTableColumns,
  query,
  setQuery,
  viewColumns,
  setViewColumns,
  groupBy,
  aggregations,
  isGrouped,
  isSavedView,
  syncUrl,
}: RecordsViewColumnControllerOptions) => {
  const defaultViewColumns = (): ColumnSpec[] => resolveDefaultViewColumns(tableColumns(), fields());

  const effectiveViewColumns = () => (!isGrouped() ? (viewColumns() ?? defaultViewColumns()) : undefined);

  const patchRecordQueryMut = mutations.create<{ view: View; query: RecordQuery }, Partial<RecordQuery>>({
    mutation: async (patch) => {
      const view = props.activeView;
      if (!view) throw new Error("No active view");
      const cur = await apiClient.views[":viewId"].$get({ param: { viewId: view.id } });
      if (!cur.ok) throw new Error(await errorMessage(cur, "Failed to load view"));
      const current = await cur.json();
      const nextQuery = { ...view.query, ...patch };
      const converted = simpleQueryToGqlSource({ tableId: view.tableId, query: nextQuery });
      if (!converted.ok) throw new Error(converted.reason);
      const res = await apiClient.views[":viewId"].$patch({
        param: { viewId: view.id },
        json: {
          source: converted.source,
          ui: {
            ...current.ui,
            ...(nextQuery.columns ? { columns: nextQuery.columns } : {}),
            ...(nextQuery.groupedColumnOrder ? { groupedColumnOrder: nextQuery.groupedColumnOrder } : {}),
            ...(nextQuery.hiddenGroupedColumns ? { hiddenGroupedColumns: nextQuery.hiddenGroupedColumns } : {}),
          },
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save view columns"));
      return { view: await res.json(), query: nextQuery };
    },
    onSuccess: (result) => {
      setViewColumns(result.query.columns);
      setQuery((prev) => ({
        ...prev,
        columns: result.query.columns,
        groupBy: result.query.groupBy,
        aggregations: result.query.aggregations,
        groupedColumnOrder: result.query.groupedColumnOrder,
        hiddenGroupedColumns: result.query.hiddenGroupedColumns,
      }));
    },
    onError: (e) => prompts.error(e.message),
  });

  const patchTableColumnsMut = mutations.create<Table, FieldColumnSpec[]>({
    mutation: async (columns) => {
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.tableId },
        json: { columns: columns.map((column) => cleanViewColumn(column)).filter(isFieldColumn) },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save table columns"));
      return res.json();
    },
    onSuccess: (table) => setTableColumns(table.columns),
    onError: (e) => prompts.error(e.message),
  });

  const cleanViewColumn = (column: ColumnSpec): ColumnSpec =>
    isComputedColumn(column)
      ? {
          kind: "computed",
          id: column.id,
          label: column.label.trim(),
          expression: column.expression.trim(),
          ...(column.format ? { format: column.format } : {}),
        }
      : {
          fieldId: column.fieldId,
          ...(column.label?.trim() ? { label: column.label.trim() } : {}),
          ...(column.format ? { format: column.format } : {}),
        };

  const persistFlatViewColumns = (columns: ColumnSpec[]) => {
    const cleaned = columns.map(cleanViewColumn);
    setViewColumns(cleaned);
    setQuery((prev) => ({ ...prev, columns: cleaned.some(isComputedColumn) || isSavedView() ? cleaned : undefined }));
    if (isSavedView()) patchRecordQueryMut.mutate({ columns: cleaned });
    else {
      syncUrl({ replace: true });
      if (!cleaned.some(isComputedColumn)) patchTableColumnsMut.mutate(cleaned.filter(isFieldColumn));
    }
  };

  const moveViewColumnInline = (column: ColumnSpec, direction: -1 | 1) => {
    const current = effectiveViewColumns();
    if (!current) return;
    const index = current.findIndex((item) => columnId(item) === columnId(column));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    persistFlatViewColumns(next);
  };

  const openViewColumnSettings = async (column: ColumnSpec, field: Field | null) => {
    const current = effectiveViewColumns()?.find((item) => columnId(item) === columnId(column));
    if (!current) return;
    if (isComputedColumn(current)) {
      const result = await openComputedColumnDialog({
        fields: fields(),
        currentTableId: props.tableId,
        baseShortId: props.baseShortId,
        tableShortId: props.tableShortId,
        column: current,
      });
      if (!result) return;
      if (result.action === "delete") {
        persistFlatViewColumns((effectiveViewColumns() ?? []).filter((item) => columnId(item) !== current.id));
        return;
      }
      persistFlatViewColumns((effectiveViewColumns() ?? []).map((item) => (columnId(item) === current.id ? result.column : item)));
      return;
    }
    if (!field) return;
    const result = await openViewColumnSettingsDialog({
      title: field.name,
      labelPlaceholder: field.name,
      currentLabel: current.label,
      currentFormat: current.format,
      formatField: field,
      hideLabel: "Hide column",
    });
    if (!result) return;
    if (result.action === "hide") {
      persistFlatViewColumns((effectiveViewColumns() ?? []).filter((column) => columnId(column) !== field.id));
      return;
    }
    persistFlatViewColumns(
      (effectiveViewColumns() ?? []).map((column) =>
        !isComputedColumn(column) && column.fieldId === field.id
          ? cleanViewColumn({ ...column, label: result.label, format: result.format })
          : column,
      ),
    );
  };

  const displayAggregations = (): AggregationSpec[] => {
    const explicit = aggregations();
    const hasStarCount = explicit.some((a) => a.fieldId === "*" && a.agg === "count");
    return hasStarCount ? explicit : [{ fieldId: "*", agg: "count" }, ...explicit];
  };

  const groupedColumnIds = (): string[] => [
    ...groupBy().map((spec, index) => groupedGroupColumnId(spec, index)),
    ...displayAggregations().map((spec, index) => groupedAggregationColumnId(spec, index)),
  ];
  const hiddenGroupedColumnIds = () => new Set(query().hiddenGroupedColumns ?? []);

  const effectiveGroupedColumnOrder = (): string[] => {
    const ids = groupedColumnIds();
    const saved = query().groupedColumnOrder ?? [];
    return mergeGroupedColumnOrder(ids, saved);
  };

  const visibleGroupedColumnOrder = (): string[] => effectiveGroupedColumnOrder().filter((id) => !hiddenGroupedColumnIds().has(id));

  const hideGroupedColumn = (columnId: string) => {
    const ids = new Set(groupedColumnIds());
    const next = [...new Set([...(query().hiddenGroupedColumns ?? []), columnId])].filter((id) => ids.has(id));
    patchRecordQueryMut.mutate({ hiddenGroupedColumns: next });
  };

  const moveGroupedViewColumnInline = (columnId: string, direction: -1 | 1) => {
    const order = visibleGroupedColumnOrder();
    const index = order.indexOf(columnId);
    const next = moveColumn(order, index, direction);
    if (next) {
      const hidden = effectiveGroupedColumnOrder().filter((id) => hiddenGroupedColumnIds().has(id));
      patchRecordQueryMut.mutate({ groupedColumnOrder: [...next, ...hidden] });
    }
  };

  const openGroupedViewColumnSettings = async (columnId: string) => {
    const groupIndex = groupBy().findIndex((spec, index) => groupedGroupColumnId(spec, index) === columnId);
    if (groupIndex >= 0) return openGroupColumnSettings(groupIndex);
    const aggregationIndex = displayAggregations().findIndex((spec, index) => groupedAggregationColumnId(spec, index) === columnId);
    if (aggregationIndex >= 0) return openAggregationColumnSettings(aggregationIndex);
  };

  const openGroupColumnSettings = async (index: number) => {
    const current = groupBy()[index];
    if (!current) return;
    const field = fields().find((f) => f.id === current.fieldId);
    const fallback = field ? field.name : "Group";
    const columnId = groupedGroupColumnId(current, index);
    const result = await openViewColumnSettingsDialog({
      title: fallback,
      labelPlaceholder: fallback,
      currentLabel: current.label,
      currentFormat: current.format,
      formatField: field ?? null,
      hideLabel: "Hide column",
    });
    if (!result) return;
    if (result.action === "hide") {
      hideGroupedColumn(columnId);
      return;
    }
    patchRecordQueryMut.mutate({
      groupBy: groupBy().map((spec, idx) => (idx === index ? { ...spec, label: result.label, format: result.format } : spec)),
    });
  };

  const openAggregationColumnSettings = async (index: number) => {
    const current = displayAggregations()[index];
    if (!current) return;
    const field = current.fieldId === "*" ? null : fields().find((f) => f.id === current.fieldId);
    const fallback = current.fieldId === "*" ? "# records" : `${current.agg} ${field?.name ?? "value"}`;
    const columnId = groupedAggregationColumnId(current, index);
    const result = await openViewColumnSettingsDialog({
      title: fallback,
      labelPlaceholder: fallback,
      currentLabel: current.label,
      currentFormat: current.format,
      formatField: field ?? { type: "number", config: {} },
      hideLabel: "Hide column",
    });
    if (!result) return;
    if (result.action === "hide") {
      hideGroupedColumn(columnId);
      return;
    }
    patchRecordQueryMut.mutate({
      aggregations: displayAggregations().map((spec, idx) =>
        idx === index ? { ...spec, label: result.label, format: result.format } : spec,
      ),
    });
  };

  const flatHiddenColumns = () => {
    const visibleIds = new Set((effectiveViewColumns() ?? []).filter(isFieldColumn).map((column) => column.fieldId));
    return fields()
      .filter((field) => !field.deletedAt && !visibleIds.has(field.id))
      .map((field) => ({
        id: field.id,
        label: field.name,
        description: field.type,
        icon: field.icon ?? "ti ti-columns",
      }));
  };

  const groupedColumnLabel = (columnId: string): { label: string; description: string; icon: string } | null => {
    const groupIndex = groupBy().findIndex((spec, index) => groupedGroupColumnId(spec, index) === columnId);
    if (groupIndex >= 0) {
      const spec = groupBy()[groupIndex];
      if (!spec) return null;
      const field = fields().find((f) => f.id === spec.fieldId);
      const fallback = field ? (spec.granularity ? `${field.name} (${spec.granularity})` : field.name) : "Group";
      return { label: spec.label?.trim() || fallback, description: "group", icon: "ti ti-hierarchy" };
    }
    const aggregationIndex = displayAggregations().findIndex((spec, index) => groupedAggregationColumnId(spec, index) === columnId);
    if (aggregationIndex >= 0) {
      const spec = displayAggregations()[aggregationIndex];
      if (!spec) return null;
      const field = spec.fieldId === "*" ? null : fields().find((f) => f.id === spec.fieldId);
      const fallback = spec.fieldId === "*" ? "# records" : `${spec.agg} ${field?.name ?? "value"}`;
      return { label: spec.label?.trim() || fallback, description: "aggregate", icon: "ti ti-math-function" };
    }
    return null;
  };

  const groupedHiddenColumns = () =>
    effectiveGroupedColumnOrder()
      .filter((id) => hiddenGroupedColumnIds().has(id))
      .map((id) => {
        const label = groupedColumnLabel(id);
        return label
          ? {
              id,
              ...label,
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => !!item);

  const hiddenViewColumnCount = () => (isGrouped() ? groupedHiddenColumns().length : flatHiddenColumns().length);

  const openAddViewColumnDialog = async () => {
    if (!isSavedView()) return;
    const columns = isGrouped() ? groupedHiddenColumns() : flatHiddenColumns();
    if (columns.length === 0) {
      await prompts.alert("All columns are already visible.", { title: "No hidden columns", icon: "ti ti-check" });
      return;
    }
    const selected = await openAddViewColumnsDialog(columns);
    if (!selected?.length) return;
    if (isGrouped()) {
      patchRecordQueryMut.mutate({
        hiddenGroupedColumns: (query().hiddenGroupedColumns ?? []).filter((hiddenId) => !selected.includes(hiddenId)),
      });
      return;
    }
    const existing = effectiveViewColumns() ?? [];
    const existingIds = new Set(existing.map(columnId));
    persistFlatViewColumns([...existing, ...selected.filter((id) => !existingIds.has(id)).map((fieldId) => ({ fieldId }))]);
  };

  const openAddComputedColumn = async () => {
    const result = await openComputedColumnDialog({
      fields: fields(),
      currentTableId: props.tableId,
      baseShortId: props.baseShortId,
      tableShortId: props.tableShortId,
    });
    if (!result || result.action !== "save") return;
    persistFlatViewColumns([...(effectiveViewColumns() ?? defaultViewColumns()), result.column]);
  };

  const clearComputedColumns = () => {
    const next = (effectiveViewColumns() ?? defaultViewColumns()).filter((column) => !isComputedColumn(column));
    persistFlatViewColumns(next);
  };

  return {
    effectiveViewColumns,
    visibleGroupedColumnOrder,
    hiddenViewColumnCount,
    moveViewColumnInline,
    openViewColumnSettings,
    moveGroupedViewColumnInline,
    openGroupedViewColumnSettings,
    openAddViewColumnDialog,
    openAddComputedColumn,
    clearComputedColumns,
  };
};
