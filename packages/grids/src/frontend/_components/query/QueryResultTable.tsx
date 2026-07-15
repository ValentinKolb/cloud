import { DataTable, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { createMemo } from "solid-js";
import type { DslQueryPreviewResponse } from "../../../contracts";
import type { Field, Table } from "../../../service";
import { FieldValue } from "../table/FieldValue";

type QueryResult = Extract<DslQueryPreviewResponse, { ok: true }>;
type QueryResultRow = QueryResult["rows"][number] & { __rowKey: string };
type QueryResultColumn = QueryResult["columns"][number];

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  return JSON.stringify(value, null, 2);
};

export default function QueryResultTable(props: {
  result: QueryResult;
  baseShortId: string;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
  scrollPreserveKey: string;
}) {
  const rows = createMemo<QueryResultRow[]>(() =>
    props.result.rows.map((row, index) => ({ ...row, __rowKey: row.recordId ?? `row-${index}` })),
  );
  const columns = createMemo<DataTableColumn<QueryResultRow>[]>(() =>
    props.result.columns.map((column) => ({
      id: column.key,
      header: column.label,
      subtitle: column.joinAlias ? `${column.joinAlias} · ${column.type}` : column.type,
      value: (row) => row.values[column.key],
    })),
  );
  const tableShortIds = createMemo(() => Object.fromEntries(props.tables.map((table) => [table.id, table.shortId])));
  const fieldForColumn = (column: QueryResultColumn): Field | null => {
    if (column.type === "aggregate" || !column.tableId || !column.fieldId) return null;
    return props.fieldsByTable[column.tableId]?.find((field) => field.id === column.fieldId && !field.deletedAt) ?? null;
  };

  return (
    <DataTable
      rows={rows()}
      columns={columns()}
      getRowId={(row) => row.__rowKey}
      class="paper h-full min-h-0 flex-1 overflow-auto"
      density="compact"
      fillHeight
      hoverRows={false}
      cellContentClass="max-h-24 overflow-auto whitespace-pre-wrap break-words"
      empty={<span>No rows match this query.</span>}
      renderCell={({ col, value }) => {
        const column = props.result.columns.find((item) => item.key === col.id);
        const field = column ? fieldForColumn(column) : null;
        if (!field) return <span>{displayValue(value)}</span>;
        return (
          <FieldValue
            field={field}
            value={value}
            baseId={props.baseShortId}
            tableShortIds={tableShortIds()}
            fieldsByTable={props.fieldsByTable}
            mode="table"
            relationValueMode={field.type === "relation" ? "labels" : "ids"}
          />
        );
      }}
      scrollPreserveKey={props.scrollPreserveKey}
    />
  );
}
