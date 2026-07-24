import { For, Show } from "solid-js";
import type { Table } from "../../../service";
import type { WorkflowTriggerRuntimeState } from "../../../workflows/contracts";
import { formatWorkflowRunDate as formatDate } from "./workflow-display";

const scheduleStateLabel: Record<NonNullable<WorkflowTriggerRuntimeState["schedule"]>["state"], string> = {
  paused: "Paused",
  pending: "Reconciling",
  reconciled: "Scheduled",
  degraded: "Needs attention",
};

export function WorkflowAutomaticTriggerState(props: { state: WorkflowTriggerRuntimeState; tables: Table[] }) {
  const tableLabel = (tableId: string | null): string =>
    tableId ? (props.tables.find((table) => table.id === tableId)?.name ?? "Unavailable table") : "Any accessible table";
  return (
    <section class="paper flex flex-wrap items-start gap-x-6 gap-y-2 p-3" aria-label="Automatic triggers">
      <Show when={props.state.schedule}>
        {(schedule) => (
          <div class="min-w-56 flex-1">
            <div class="flex items-center gap-2 text-xs font-medium text-primary">
              <i class="ti ti-calendar-time" aria-hidden="true" />
              <span>{scheduleStateLabel[schedule().state]}</span>
            </div>
            <p class="mt-1 text-xs text-dimmed">
              <span class="font-mono">{schedule().cron}</span> · {schedule().timezone}
              <Show when={schedule().nextRunAt}>{(next) => <> · Next {formatDate(next())}</>}</Show>
            </p>
            <Show when={schedule().problem}>{(problem) => <p class="mt-1 text-xs text-red-600 dark:text-red-400">{problem()}</p>}</Show>
          </div>
        )}
      </Show>
      <For each={props.state.recordEvents}>
        {(trigger) => (
          <div class="min-w-56 flex-1">
            <div class="flex items-center gap-2 text-xs font-medium text-primary">
              <i class="ti ti-bolt" aria-hidden="true" />
              <span>{trigger.state === "active" ? "Enabled" : "Paused"}</span>
            </div>
            <p class="mt-1 text-xs text-dimmed">
              {tableLabel(trigger.tableId)} · {trigger.event}
              {trigger.hasFilter ? " · Filtered" : " · All matching records"}
            </p>
          </div>
        )}
      </For>
    </section>
  );
}
