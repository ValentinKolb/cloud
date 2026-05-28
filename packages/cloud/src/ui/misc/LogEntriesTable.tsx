import { dates } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import DataTable, { type DataTableColumn } from "./DataTable";

export type LogTableEntry = {
  id: number | string;
  level: string;
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type Props = {
  entries: LogTableEntry[];
  emptyMessage?: string;
};

const levelIcon: Record<string, { icon: string; color: string; label: string }> = {
  debug: { icon: "ti ti-bug", color: "text-zinc-400 dark:text-zinc-500", label: "debug" },
  info: { icon: "ti ti-info-circle", color: "text-blue-500 dark:text-blue-400", label: "info" },
  warn: { icon: "ti ti-alert-triangle", color: "text-amber-500 dark:text-amber-400", label: "warn" },
  error: { icon: "ti ti-alert-circle", color: "text-red-500 dark:text-red-400", label: "error" },
};

export default function LogEntriesTable(props: Props) {
  const columns = (): DataTableColumn<LogTableEntry>[] => [
    { id: "level", header: "Level", value: (entry) => entry.level },
    { id: "source", header: `Source (${props.entries.length})`, value: (entry) => entry.source },
    { id: "message", header: "Message", value: (entry) => entry.message },
    { id: "time", header: "Time", value: (entry) => entry.createdAt, cellClass: "whitespace-nowrap" },
  ];

  return (
    <Show
      when={props.entries.length > 0}
      fallback={<div class="paper py-8 text-center text-xs text-dimmed">{props.emptyMessage ?? "No log entries found."}</div>}
    >
      <DataTable
        rows={props.entries}
        columns={columns()}
        getRowId={(entry) => String(entry.id)}
        hoverRows
        class="paper overflow-x-auto"
        renderCell={({ row, col }) => {
          if (col.id === "level") {
            const level = levelIcon[row.level] ?? levelIcon.debug!;
            return (
              <span class={`inline-flex items-center gap-1.5 whitespace-nowrap ${level.color}`}>
                <i class={`${level.icon} text-sm`} />
                <span>{level.label}</span>
              </span>
            );
          }
          if (col.id === "source") return <span class="whitespace-nowrap text-secondary">{row.source}</span>;
          if (col.id === "message") return <span title={row.message}>{row.message}</span>;
          if (col.id === "time") return <span class="text-dimmed">{dates.formatDateTime(row.createdAt)}</span>;
          return "";
        }}
      />
    </Show>
  );
}
