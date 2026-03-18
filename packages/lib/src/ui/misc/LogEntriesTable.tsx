import { dates } from "../../shared/date";
import LogMetadataPreview from "./LogMetadataPreview.island";

export type LogTableEntry = {
  id: number | string;
  level: string;
  source: string;
  message: string;
  metadata: Record<string, unknown> | string | null;
  createdAt: string;
};

type Props = {
  entries: LogTableEntry[];
  emptyMessage?: string;
};

const levelBadge = (level: string) => {
  switch (level) {
    case "debug":
      return <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">debug</span>;
    case "info":
      return <span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">info</span>;
    case "warn":
      return (
        <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">warn</span>
      );
    case "error":
      return <span class="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-900/30 dark:text-rose-300">error</span>;
    default:
      return <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-dimmed dark:bg-zinc-800">{level}</span>;
  }
};

export default function LogEntriesTable(props: Props) {
  if (props.entries.length === 0) {
    return <div class="paper p-6 text-center text-sm text-dimmed">{props.emptyMessage ?? "No log entries found."}</div>;
  }

  return (
    <div class="paper overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-zinc-200/80 bg-zinc-50/70 dark:border-zinc-700/70 dark:bg-zinc-800/40">
              <th class="px-4 py-3 text-left font-medium text-dimmed">Level</th>
              <th class="px-4 py-3 text-left font-medium text-dimmed">Source</th>
              <th class="px-4 py-3 text-left font-medium text-dimmed">Message</th>
              <th class="px-4 py-3 text-left font-medium text-dimmed">Time</th>
            </tr>
          </thead>
          <tbody>
            {props.entries.map((entry) => (
              <tr class="border-b border-zinc-100/80 align-top last:border-0 hover:bg-zinc-50/60 dark:border-zinc-800/80 dark:hover:bg-zinc-800/30">
                <td class="px-4 py-3">{levelBadge(entry.level)}</td>
                <td class="px-4 py-3">
                  <span class="font-mono text-xs text-primary">{entry.source}</span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex min-w-[18rem] max-w-2xl flex-col gap-1">
                    <span class="line-clamp-1 text-primary" title={entry.message}>
                      {entry.message}
                    </span>
                    {entry.metadata ? <LogMetadataPreview data={entry.metadata} /> : null}
                  </div>
                </td>
                <td class="whitespace-nowrap px-4 py-3">
                  <div class="flex flex-col gap-0.5">
                    <span class="text-dimmed">{dates.formatDateTime(entry.createdAt)}</span>
                    <span class="text-[11px] text-dimmed">{dates.formatDateTimeRelative(entry.createdAt)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
