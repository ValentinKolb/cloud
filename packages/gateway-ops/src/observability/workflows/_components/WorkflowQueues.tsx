import { formatDurationMs, formatNumber, formatRelative } from "@valentinkolb/cloud/shared";
import { DataPanel, DataTable, type DataTableColumn, RangePicker, StatusBadge } from "@valentinkolb/cloud/ui";
import type { StrandedWorkflowEffect, UndispatchedWorkflowEvent, WorkflowRunSummary } from "@valentinkolb/cloud/workflows/store";
import type { JSX } from "solid-js";
import { WINDOWS, type WorkflowsFilterState, workflowsFilter } from "../filters";
import { EFFECT_TONE, eventState, LAG_WARN_MS, RUN_LABEL, RUN_TONE } from "../presentation";

const runColumns: DataTableColumn<WorkflowRunSummary>[] = [
  { id: "workflow", header: "Workflow", cellClass: "min-w-[220px]" },
  { id: "app", header: "App" },
  { id: "cause", header: "Cause", value: (run) => run.eventType ?? "direct invocation" },
  { id: "state", header: "State" },
  { id: "lag", header: "Start lag", subtitle: "cause to first attempt", align: "right" },
  { id: "duration", header: "Duration", align: "right" },
  { id: "attempts", header: "Attempts", align: "right" },
  { id: "created", header: "Started", align: "right" },
];

const effectColumns: DataTableColumn<StrandedWorkflowEffect>[] = [
  { id: "workflow", header: "Workflow", cellClass: "min-w-[220px]" },
  { id: "app", header: "App" },
  { id: "step", header: "Step" },
  { id: "action", header: "Action" },
  { id: "state", header: "State" },
  { id: "age", header: "Unsettled for", align: "right" },
  { id: "open", header: "", align: "right" },
];

const eventColumns: DataTableColumn<UndispatchedWorkflowEvent>[] = [
  { id: "type", header: "Event", cellClass: "min-w-[220px]" },
  { id: "app", header: "App" },
  { id: "scope", header: "Scope" },
  { id: "state", header: "State" },
  { id: "attempts", header: "Attempts", align: "right" },
  { id: "occurred", header: "Occurred", align: "right" },
  { id: "error", header: "Last error", cellClass: "min-w-[240px]" },
];

type CommonProps = {
  state: WorkflowsFilterState;
  filters: JSX.Element;
  footer?: JSX.Element;
  hasNextPage: boolean;
};

export function WorkflowRunsView(props: CommonProps & { runs: WorkflowRunSummary[] }) {
  return (
    <DataPanel
      title={props.state.parent ? "Child runs" : "Runs"}
      subtitle={`${formatNumber(props.runs.length)}${props.hasNextPage ? "+" : ""} in the last ${props.state.window}`}
      actions={
        <div class="flex flex-wrap items-center justify-end gap-2">
          {props.state.parent ? (
            <a
              class="text-xs text-secondary hover:underline"
              href={workflowsFilter.build(props.state, { run: props.state.parent, parent: "", state: "all", page: 1 })}
            >
              Open parent
            </a>
          ) : null}
          <RangePicker
            options={WINDOWS.map((value) => ({
              value,
              href: workflowsFilter.build(props.state, { window: value, page: 1 }),
            }))}
            value={props.state.window}
          />
        </div>
      }
      filters={props.filters}
      isEmpty={props.runs.length === 0}
      empty={
        workflowsFilter.isActive(props.state, ["view", "window", "page", "run"])
          ? "No runs match these filters."
          : "No workflow has run in this window."
      }
      footer={props.footer}
    >
      <DataTable
        rows={props.runs}
        columns={runColumns}
        getRowId={(run) => run.id}
        density="compact"
        renderCell={({ row, col, value, render }) => {
          if (col.id === "workflow")
            return (
              <a class="block truncate font-medium hover:underline" href={workflowsFilter.build(props.state, { run: row.id })}>
                {row.workflowName}
                <span class="ml-1 text-dimmed">r{row.revision}</span>
              </a>
            );
          if (col.id === "app") return <span class="text-secondary">{row.appId}</span>;
          if (col.id === "state") return <StatusBadge tone={RUN_TONE[row.state]} label={RUN_LABEL[row.state]} variant="dot" />;
          if (col.id === "lag")
            return row.startLagMs === null ? (
              <span class="text-dimmed">—</span>
            ) : (
              <span class={row.startLagMs > LAG_WARN_MS ? "text-amber-600 dark:text-amber-400" : "text-secondary"}>
                {formatDurationMs(row.startLagMs)}
              </span>
            );
          if (col.id === "duration") return <span class="text-secondary">{formatDurationMs(row.durationMs)}</span>;
          if (col.id === "attempts")
            return <span class={row.attempt > 1 ? "text-amber-600 dark:text-amber-400" : "text-dimmed"}>{row.attempt}</span>;
          if (col.id === "created") return <span class="text-secondary">{formatRelative(row.createdAt)}</span>;
          return render(value);
        }}
      />
    </DataPanel>
  );
}

export function WorkflowEffectsView(props: CommonProps & { effects: StrandedWorkflowEffect[] }) {
  return (
    <DataPanel
      title="Effects requiring evidence"
      subtitle={`${formatNumber(props.effects.length)}${props.hasNextPage ? "+" : ""} unsettled external effects`}
      filters={props.filters}
      isEmpty={props.effects.length === 0}
      empty={props.state.app ? "No unsettled effects match this app." : "No external effects require an operator decision."}
      footer={props.footer}
    >
      <DataTable
        rows={props.effects}
        columns={effectColumns}
        getRowId={(effect) => `${effect.runId}:${effect.stepKey}`}
        density="compact"
        renderCell={({ row, col, value, render }) => {
          if (col.id === "workflow") return <span class="font-medium">{row.workflowName}</span>;
          if (col.id === "app") return <span class="text-secondary">{row.appId}</span>;
          if (col.id === "step") return <span class="font-mono text-xs">{row.stepKey}</span>;
          if (col.id === "action") return <span class="text-secondary">{row.action ?? "—"}</span>;
          if (col.id === "state")
            return <StatusBadge tone={EFFECT_TONE[row.effectState] ?? "warn"} label={row.effectState} variant="dot" />;
          if (col.id === "age") return <span class="text-secondary">{formatDurationMs(row.ageMs)}</span>;
          if (col.id === "open")
            return (
              <a class="btn-simple btn-sm" href={workflowsFilter.build(props.state, { run: row.runId })}>
                Inspect
              </a>
            );
          return render(value);
        }}
      />
    </DataPanel>
  );
}

export function WorkflowEventsView(props: CommonProps & { events: UndispatchedWorkflowEvent[] }) {
  return (
    <DataPanel
      title="Events without a run"
      subtitle={`${formatNumber(props.events.length)}${props.hasNextPage ? "+" : ""} unmatched, retrying or dead-lettered events`}
      filters={props.filters}
      isEmpty={props.events.length === 0}
      empty={props.state.app ? "No undispatched events match this app." : "Every workflow event has been dispatched."}
      footer={props.footer}
    >
      <DataTable
        rows={props.events}
        columns={eventColumns}
        getRowId={(event) => event.id}
        density="compact"
        renderCell={({ row, col, value, render }) => {
          if (col.id === "type")
            return (
              <span class="font-mono text-xs" title={row.id}>
                {row.type}
              </span>
            );
          if (col.id === "app") return <span class="text-secondary">{row.appId}</span>;
          if (col.id === "scope")
            return (
              <span class="block max-w-[220px] truncate font-mono text-xs text-secondary" title={row.scopeId}>
                {row.scopeId}
              </span>
            );
          if (col.id === "state") {
            const state = eventState(row);
            return <StatusBadge tone={state.tone} label={state.label} variant="dot" />;
          }
          if (col.id === "attempts") return <span class="text-dimmed">{row.attempts}</span>;
          if (col.id === "occurred") return <span class="text-secondary">{formatRelative(row.occurredAt)}</span>;
          if (col.id === "error")
            return (
              <span class="block max-w-[360px] truncate text-secondary" title={row.lastError ?? undefined}>
                {row.lastError ?? "—"}
              </span>
            );
          return render(value);
        }}
      />
    </DataPanel>
  );
}
