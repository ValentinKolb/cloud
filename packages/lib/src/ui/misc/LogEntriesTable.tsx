import { dates } from "../../shared/date";

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
  if (props.entries.length === 0) {
    return <div class="py-8 text-center text-xs text-dimmed">{props.emptyMessage ?? "No log entries found."}</div>;
  }

  return (
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b border-zinc-100 dark:border-zinc-800">
            <th class="px-3 py-2 text-left font-medium text-dimmed">Level</th>
            <th class="px-3 py-2 text-left font-medium text-dimmed">Source ({props.entries.length})</th>
            <th class="px-3 py-2 text-left font-medium text-dimmed">Message</th>
            <th class="px-3 py-2 text-left font-medium text-dimmed">Time</th>
          </tr>
        </thead>
        <tbody>
          {props.entries.map((entry) => {
            const level = levelIcon[entry.level] ?? levelIcon.debug!;
            return (
              <tr class="border-b border-zinc-50 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                <td class="px-3 py-1.5 whitespace-nowrap">
                  <span class={`inline-flex items-center gap-1.5 ${level.color}`}>
                    <i class={`${level.icon} text-sm`} />
                    <span>{level.label}</span>
                  </span>
                </td>
                <td class="px-3 py-1.5 whitespace-nowrap text-secondary">{entry.source}</td>
                <td class="px-3 py-1.5 text-primary truncate max-w-[30rem]" title={entry.message}>{entry.message}</td>
                <td class="whitespace-nowrap px-3 py-1.5 text-dimmed">{dates.formatDateTime(entry.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
