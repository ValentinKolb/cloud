import { Placeholder } from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import type { AuditEntry, Field } from "../../../service";

type AuditEntryWithUser = AuditEntry & { userDisplayName: string | null };

const ACTION_ICONS: Record<string, string> = {
  created: "ti-plus",
  updated: "ti-pencil",
  deleted: "ti-trash",
  restored: "ti-arrow-back-up",
  imported: "ti-file-import",
};

const ACTION_COLORS: Record<string, string> = {
  created: "text-emerald-600 dark:text-emerald-400",
  updated: "text-blue-600 dark:text-blue-400",
  deleted: "text-red-600 dark:text-red-400",
  restored: "text-amber-600 dark:text-amber-400",
  imported: "text-zinc-600 dark:text-zinc-400",
};

export function formatRecordRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86_400 * 30) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "Empty" : value.map(displayValue).join(", ");
  return JSON.stringify(value);
};

export default function RecordHistorySection(props: { entries: AuditEntryWithUser[]; fields: Field[] }) {
  const fieldNames = () => new Map(props.fields.map((field) => [field.id, field.name]));
  return (
    <details class="detail-section-compact group">
      <summary class="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-secondary">
        <i class="ti ti-history text-sm" />
        History
        <span class="text-[10px] text-dimmed">({props.entries.length})</span>
        <i class="ti ti-chevron-down ml-auto text-xs text-dimmed transition-transform group-open:rotate-180" />
      </summary>
      <div class="mt-3 flex flex-col gap-2">
        <Show when={props.entries.length === 0}>
          <Placeholder align="left" class="px-0 py-2">
            No history yet.
          </Placeholder>
        </Show>
        <For each={props.entries}>
          {(entry) => {
            const fieldsChanged = entry.diff ? Object.keys(entry.diff) : [];
            const changedLabels = fieldsChanged.map((fieldId) => fieldNames().get(fieldId) ?? fieldId);
            const summary =
              fieldsChanged.length === 0
                ? null
                : fieldsChanged.length <= 3
                  ? changedLabels.join(", ")
                  : `${changedLabels.slice(0, 3).join(", ")} +${fieldsChanged.length - 3} more`;
            return (
              <details class="text-xs">
                <summary class="cursor-pointer select-none flex items-baseline gap-2">
                  <i class={`ti ${ACTION_ICONS[entry.action] ?? "ti-circle"} ${ACTION_COLORS[entry.action] ?? "text-dimmed"} text-xs`} />
                  <span class="capitalize text-secondary">{entry.action}</span>
                  <Show
                    when={entry.userDisplayName}
                    fallback={
                      <Show when={entry.userId === null} fallback={<span class="text-dimmed italic">by deleted user</span>}>
                        <span class="text-dimmed inline-flex items-center gap-1">
                          <i class="ti ti-world text-[10px]" />
                          via public form
                        </span>
                      </Show>
                    }
                  >
                    {(name) => <span class="text-dimmed">by {name()}</span>}
                  </Show>
                  <span class="ml-auto text-[10px] text-dimmed shrink-0" title={entry.createdAt}>
                    {formatRecordRelativeTime(entry.createdAt)}
                  </span>
                </summary>
                <Show when={summary}>
                  <p class="ml-5 text-[11px] text-dimmed">changed {summary}</p>
                </Show>
                <Show when={(entry.context?.answers.length ?? 0) > 0}>
                  <dl class="ml-5 mt-2 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
                    <For each={entry.context?.answers ?? []}>
                      {(answer) => (
                        <>
                          <dt class="text-dimmed">{answer.label}</dt>
                          <dd class="whitespace-pre-wrap text-secondary">{answer.optionLabel ?? answer.value}</dd>
                        </>
                      )}
                    </For>
                  </dl>
                </Show>
                <Show when={entry.diff && fieldsChanged.length > 0}>
                  <dl class="ml-5 mt-2 flex flex-col gap-2">
                    <For each={fieldsChanged}>
                      {(fieldId) => {
                        const change = entry.diff?.[fieldId];
                        return (
                          <div class="rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-2 text-[11px]">
                            <dt class="font-medium text-secondary">{fieldNames().get(fieldId) ?? fieldId}</dt>
                            <dd class="mt-1 grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-1">
                              <span class="text-dimmed">Before</span>
                              <span class="break-words text-secondary">{displayValue(change?.old)}</span>
                              <span class="text-dimmed">After</span>
                              <span class="break-words text-secondary">{displayValue(change?.new)}</span>
                            </dd>
                          </div>
                        );
                      }}
                    </For>
                  </dl>
                </Show>
              </details>
            );
          }}
        </For>
      </div>
    </details>
  );
}
