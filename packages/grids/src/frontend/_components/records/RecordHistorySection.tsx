import { Placeholder } from "@valentinkolb/cloud/ui";
import { createResource, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { AuditEntry } from "../../../service";

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

export default function RecordHistorySection(props: { tableId: string; recordId: string }) {
  const [entries] = createResource(
    () => `${props.tableId}:${props.recordId}`,
    async () => {
      const res = await apiClient.records[":tableId"][":recordId"].audit.$get({
        param: { tableId: props.tableId, recordId: props.recordId },
      });
      if (!res.ok) return { items: [] as AuditEntryWithUser[] };
      return res.json();
    },
  );

  return (
    <details class="paper p-0 group">
      <summary class="cursor-pointer select-none flex items-center gap-2 px-3 py-2 text-xs font-medium text-secondary">
        <i class="ti ti-history text-sm" />
        History
        <Show when={!entries.loading && entries()}>
          <span class="text-[10px] text-dimmed">({entries()!.items.length})</span>
        </Show>
        <i class="ti ti-chevron-down ml-auto text-xs text-dimmed transition-transform group-open:rotate-180" />
      </summary>
      <div class="px-3 pb-3 flex flex-col gap-2">
        <Show when={entries.loading}>
          <p class="text-xs text-dimmed">Loading history…</p>
        </Show>
        <Show when={!entries.loading && entries() && entries()!.items.length === 0}>
          <Placeholder align="left" class="px-0 py-2">
            No history yet.
          </Placeholder>
        </Show>
        <For each={entries()?.items ?? []}>
          {(entry) => {
            const fieldsChanged = entry.diff ? Object.keys(entry.diff) : [];
            const summary =
              fieldsChanged.length === 0
                ? null
                : fieldsChanged.length <= 3
                  ? fieldsChanged.join(", ")
                  : `${fieldsChanged.slice(0, 3).join(", ")} +${fieldsChanged.length - 3} more`;
            return (
              <details class="text-xs">
                <summary class="cursor-pointer select-none flex items-baseline gap-2">
                  <i class={`ti ${ACTION_ICONS[entry.action] ?? "ti-circle"} ${ACTION_COLORS[entry.action] ?? "text-dimmed"} text-xs`} />
                  <span class="capitalize text-secondary">{entry.action}</span>
                  {/* Actor attribution. The audit row carries both a
                      `userId` (UUID of the actor at write time, or
                      null) and a `userDisplayName` resolved at read
                      time via JOIN to auth.users (null when the user
                      is gone OR when no user was ever associated).
                      Three states, three distinct strings:
                        - name resolved        → "by <name>"
                        - userId null          → "via public form"
                          (every null-actor audit on records comes
                          from the anonymous form-submit path; see
                          submitFormResponse in api/form-api-shared.ts)
                        - userId set, name nil → "by deleted user"
                          (italic to mark it as a phantom — the
                          actor existed but is no longer in auth.users)
                  */}
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
                <Show when={entry.diff && fieldsChanged.length > 0}>
                  <pre class="ml-5 mt-1 max-h-40 overflow-auto rounded-md bg-zinc-50 dark:bg-zinc-800 p-2 text-[10px] font-mono text-zinc-700 dark:text-zinc-300">
                    {JSON.stringify(entry.diff, null, 2)}
                  </pre>
                </Show>
              </details>
            );
          }}
        </For>
      </div>
    </details>
  );
}
