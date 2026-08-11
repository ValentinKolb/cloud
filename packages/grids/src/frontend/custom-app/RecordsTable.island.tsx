import { DataTable, type DataTableColumn, Placeholder } from "@k2b/ui";
import type { DslQueryPreviewResponse } from "../../contracts";
import type { CustomAppRowNavigation } from "../../custom-apps/contracts";
import { customAppRowHref } from "../../custom-apps/routing";
import { customAppRecordsResultColumns } from "./records-table-model";

type QuerySuccess = Extract<DslQueryPreviewResponse, { ok: true }>;

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  return JSON.stringify(value);
};

export default function RecordsTable(props: {
  title: string;
  emptyText: string;
  shortId: string;
  selectedColumnIds?: string[];
  result: QuerySuccess;
  rowNavigate?: CustomAppRowNavigation;
}) {
  const resultColumns = customAppRecordsResultColumns(props.result.columns, props.selectedColumnIds);
  const rows = props.result.rows.map((row, index) => ({
    ...row,
    rowKey: row.recordId ? `${row.recordId}:${index}` : `row-${index}`,
    href: row.recordId && props.rowNavigate ? customAppRowHref(props.shortId, props.rowNavigate, row.recordId) : null,
  }));
  const firstColumnId = resultColumns[0]?.key;
  const columns: DataTableColumn<(typeof rows)[number]>[] = resultColumns.map((column) => ({
    id: column.key,
    header: column.label,
    subtitle: column.type,
    value: (row) => row.values[column.key],
  }));
  if (columns.length === 0) {
    return (
      <Placeholder
        state="error"
        variant="compact"
        align="left"
        title="Records unavailable"
        description="The selected fields are not part of this view result."
      />
    );
  }
  return (
    <div class="overflow-x-auto">
      <DataTable
        ariaLabel={props.title}
        rows={rows}
        columns={columns}
        getRowId={(row) => row.rowKey}
        density="compact"
        surface="plain"
        hoverRows={Boolean(props.rowNavigate)}
        rowClass={(row) => (row.href ? "cursor-pointer" : undefined)}
        onRowClick={
          props.rowNavigate
            ? (row) => {
                if (!row.href) return;
                if (props.rowNavigate?.history === "replace") window.location.replace(row.href);
                else window.location.assign(row.href);
              }
            : undefined
        }
        empty={<span>{props.emptyText}</span>}
        renderCell={({ row, col, value }) => {
          const text = displayValue(value);
          return row.href && col.id === firstColumnId ? (
            <a href={row.href} class="font-medium text-accent hover:underline">
              {text}
            </a>
          ) : (
            <span class="whitespace-pre-wrap break-words">{text}</span>
          );
        }}
      />
    </div>
  );
}
