import { createSignal, For, Show } from "solid-js";
import { prompts, CopyButton } from "@valentinkolb/cloud/lib/ui";
import { dates } from "@valentinkolb/cloud/lib/shared";
import type { LogTableEntry } from "@valentinkolb/cloud/lib/ui";

type Props = { entries: LogTableEntry[] };

const LEVEL: Record<string, { icon: string; color: string; label: string }> = {
  debug: { icon: "ti ti-bug", color: "text-zinc-400 dark:text-zinc-500", label: "debug" },
  info: { icon: "ti ti-info-circle", color: "text-blue-500 dark:text-blue-400", label: "info" },
  warn: { icon: "ti ti-alert-triangle", color: "text-amber-500 dark:text-amber-400", label: "warn" },
  error: { icon: "ti ti-alert-circle", color: "text-red-500 dark:text-red-400", label: "error" },
};

/** key=value, key2=value2 for the inline detail column */
function formatMetaInline(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  return Object.entries(metadata)
    .map(([k, v]) => {
      if (v === null || v === undefined) return `${k}=null`;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
      return `${k}=${JSON.stringify(v)}`;
    })
    .join(", ");
}

/** Structured metadata view for the detail dialog */
function MetadataDetail(props: { metadata: Record<string, unknown> | null }) {
  if (!props.metadata) return null;

  const entries = Object.entries(props.metadata);
  const jsonRaw = JSON.stringify(props.metadata, null, 2);
  const [showRaw, setShowRaw] = createSignal(false);

  return (
    <div class="flex flex-col gap-2">
      <Show when={!showRaw()} fallback={
        <div class="relative bg-zinc-100 dark:bg-zinc-800 rounded-md px-3 py-2">
          <pre class="text-[11px] text-secondary whitespace-pre-wrap break-all max-h-64 overflow-y-auto pr-16">{jsonRaw}</pre>
          <div class="absolute top-2 right-2"><CopyButton text={jsonRaw} label="Copy" /></div>
        </div>
      }>
        <div class="bg-zinc-100 dark:bg-zinc-800 rounded-md px-3 py-2">
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            {entries.map(([key, value]) => {
              const isComplex = typeof value === "object" && value !== null;
              const display = isComplex ? JSON.stringify(value) : String(value ?? "null");
              return (
                <>
                  <span class="text-dimmed font-medium shrink-0">{key}</span>
                  <span class={`text-secondary break-all ${isComplex ? "font-mono text-[11px]" : ""}`}>{display}</span>
                </>
              );
            })}
          </div>
        </div>
      </Show>
      <button type="button" class="text-[10px] text-dimmed hover:text-secondary transition-colors self-start" onClick={() => setShowRaw(!showRaw())}>
        {showRaw() ? "View formatted" : "View raw"}
      </button>
    </div>
  );
}

function showDetail(entry: LogTableEntry) {
  const level = LEVEL[entry.level];
  void prompts.dialog(
    (close) => (
      <div class="flex flex-col gap-4">
        <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <span class="text-dimmed">Level</span>
          <span class={`font-medium ${level?.color ?? "text-primary"}`}>{level?.label ?? entry.level}</span>
          <span class="text-dimmed">Source</span>
          <span class="text-primary">{entry.source}</span>
          <span class="text-dimmed">Time</span>
          <span class="text-primary">{dates.formatDateTime(entry.createdAt)}</span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-[10px] uppercase tracking-wider text-dimmed">Message</span>
          <p class="text-xs text-primary whitespace-pre-wrap break-all bg-zinc-100 dark:bg-zinc-800 rounded-md px-3 py-2">{entry.message}</p>
        </div>
        <Show when={entry.metadata}>
          <div class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-wider text-dimmed">Metadata</span>
            <MetadataDetail metadata={entry.metadata} />
          </div>
        </Show>
        <div class="flex justify-end">
          <button type="button" class="btn-secondary btn-sm" onClick={() => close()}>Close</button>
        </div>
      </div>
    ),
    {
      title: `${level?.label ?? entry.level}: ${entry.source}`,
      icon: level?.icon ?? "ti ti-file-text",
      size: "large",
    },
  );
}

export default function LogTable(props: Props) {
  return (
    <div class="paper overflow-hidden">
      <Show when={props.entries.length > 0} fallback={<div class="py-8 text-center text-xs text-dimmed">No log entries found.</div>}>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-zinc-100 dark:border-zinc-800">
                <th class="px-3 py-2 text-left font-medium text-dimmed">Level</th>
                <th class="px-3 py-2 text-left font-medium text-dimmed">Source</th>
                <th class="px-3 py-2 text-left font-medium text-dimmed">Message</th>
                <th class="px-3 py-2 text-left font-medium text-dimmed hidden xl:table-cell">Detail</th>
                <th class="px-3 py-2 text-left font-medium text-dimmed">Time</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.entries}>
                {(entry) => {
                  const level = LEVEL[entry.level] ?? LEVEL.debug!;
                  const meta = formatMetaInline(entry.metadata);
                  return (
                    <tr class="border-b border-zinc-50 last:border-0 hover:bg-zinc-50 cursor-pointer dark:border-zinc-800/50 dark:hover:bg-zinc-800/30" onClick={() => showDetail(entry)}>
                      <td class="px-3 py-1.5 whitespace-nowrap">
                        <span class={`inline-flex items-center gap-1.5 ${level.color}`}>
                          <i class={`${level.icon} text-sm`} />
                          <span>{level.label}</span>
                        </span>
                      </td>
                      <td class="px-3 py-1.5 whitespace-nowrap text-secondary">{entry.source}</td>
                      <td class="px-3 py-1.5 text-primary truncate max-w-[30rem]" title={entry.message}>{entry.message}</td>
                      <td class="px-3 py-1.5 text-dimmed truncate max-w-[20rem] hidden xl:table-cell">{meta || "—"}</td>
                      <td class="whitespace-nowrap px-3 py-1.5 text-dimmed">{dates.formatDateTime(entry.createdAt)}</td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
