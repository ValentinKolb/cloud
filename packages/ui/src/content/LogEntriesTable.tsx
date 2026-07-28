import { dates, type DateContext } from "@k2b/stdlib";
import type { JSX } from "solid-js";
import { DataTable, type DataTableColumn } from "./DataTable";

export type LogEntry = {
  id: string | number;
  timestamp: string | Date;
  level: "debug" | "info" | "warn" | "error" | (string & {});
  message: string;
  source?: string;
  metadata?: unknown;
};

export type LogEntriesTableProps = {
  entries: readonly LogEntry[];
  dateContext?: DateContext;
  empty?: JSX.Element;
  onSelect?: (entry: LogEntry) => void;
  class?: string;
};

const columns: readonly DataTableColumn<LogEntry>[] = [
  { id: "level", header: "Level", value: "level" },
  { id: "source", header: "Source", value: "source" },
  { id: "message", header: "Message", value: "message" },
  { id: "time", header: "Time", value: "timestamp", cellClass: "k2b-log-table__time" },
];

export function LogEntriesTable(props: LogEntriesTableProps): JSX.Element {
  return (
    <DataTable
      rows={props.entries}
      columns={columns}
      getRowId={(entry) => String(entry.id)}
      density="compact"
      hoverRows
      onRowClick={props.onSelect}
      empty={props.empty ?? "No log entries"}
      class={`k2b-log-table ${props.class ?? ""}`}
      ariaLabel="Log entries"
      renderCell={({ row, column, render }) => {
        if (column.id === "level") return <span class="k2b-log-level" data-level={row.level}>{row.level}</span>;
        if (column.id === "source") return <span class="k2b-log-table__source">{row.source ?? "—"}</span>;
        if (column.id === "message") return <span title={row.message}>{row.message}</span>;
        if (column.id === "time") return <time dateTime={new Date(row.timestamp).toISOString()}>{dates.formatDateTime(row.timestamp, props.dateContext)}</time>;
        return render(undefined);
      }}
    />
  );
}
