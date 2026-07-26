import { formatDurationMs, formatNumber, formatPercent, formatRelative } from "@valentinkolb/cloud/shared";
import { DataPanel, DataTable, type DataTableColumn, RangePicker, StatusBadge } from "@valentinkolb/cloud/ui";
import type {
  StrandedWorkflowEffect,
  UndispatchedWorkflowEvent,
  WorkflowFamilySummary,
  WorkflowRunSummary,
} from "@valentinkolb/cloud/workflows/store";
import type { JSX } from "solid-js";
import { WINDOWS, type WorkflowsFilterState, workflowsFilter } from "../filters";
import { EFFECT_TONE, eventState, LAG_WARN_MS, RUN_LABEL, runErrorSummary, RUN_TONE } from "../presentation";

const familyColumns: DataTableColumn<WorkflowFamilySummary>[] = [
  { id: "workflow", header: "Workflow / Trigger", cellClass: "min-w-[280px]" },
  { id: "latest", header: "Latest", subtitle: "matching run" },
  { id: "runs", header: "Runs", align: "right" },
  { id: "failed", header: "Failed", subtitle: "error rate", align: "right" },
  { id: "runtime", header: "Runtime", subtitle: "avg / p99", align: "right" },
  { id: "backlog", header: "Backlog", subtitle: "active / oldest", align: "right" },
  { id: "activity", header: "Last", subtitle: "activity", align: "right" },
  { id: "open", header: "", align: "right" },
];

const runColumns: DataTableColumn<WorkflowRunSummary>[] = [
  { id: "workflow", header: "Workflow / Run", cellClass: "min-w-[260px]" },
  { id: "cause", header: "Cause", value: (run) => run.eventType ?? "direct invocation" },
  { id: "state", header: "State" },
  { id: "lag", header: "Start", subtitle: "lag / queued", align: "right" },
  { id: "duration", header: "Duration", align: "right" },
  { id: "attempts", header: "Attempts", align: "right" },
  { id: "created", header: "Created", align: "right" },
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

const eventTypesLabel = (family: WorkflowFamilySummary): string =>
  family.eventTypes.length === 0 ? "direct invocation" : family.eventTypes.join(", ");

export function WorkflowFamiliesView(props: CommonProps & { families: WorkflowFamilySummary[] }) {
  return (
    <DataPanel
      title="Workflow families"
      subtitle={`${formatNumber(props.families.length)}${props.hasNextPage ? "+" : ""} matching definitions in the last ${props.state.window}`}
      filters={props.filters}
      isEmpty={props.families.length === 0}
      empty="No workflows ran in this window."
      footer={props.footer}
    >
      <DataTable
        rows={props.families}
        columns={familyColumns}
        getRowId={(family) => family.workflowId}
        density="compact"
        hoverRows
        highlightColumns={false}
        class="overflow-x-auto"
        renderCell={({ row, col }) => {
          const href = workflowsFilter.build(props.state, { workflow: row.workflowId, run: "", parent: "", page: 1 });
          if (col.id === "workflow")
            return (
              <a class="block min-w-0 hover:text-blue-600 dark:hover:text-blue-300" href={href}>
                <span class="block truncate text-[11px] font-medium text-primary">{row.workflowName}</span>
                <span class="block truncate text-[10px] text-dimmed" title={`${row.appId} · ${row.scopeId} · ${eventTypesLabel(row)}`}>
                  {row.appId} · {eventTypesLabel(row)} · r{row.latestRevision}
                </span>
              </a>
            );
          if (col.id === "latest")
            return (
              <a
                href={workflowsFilter.build(props.state, {
                  workflow: row.workflowId,
                  run: row.latestRunId,
                  parent: "",
                  page: 1,
                })}
                title="Open latest run"
              >
                <StatusBadge tone={RUN_TONE[row.latestState]} label={RUN_LABEL[row.latestState]} variant="dot" />
              </a>
            );
          if (col.id === "runs") return <span class="text-[10px] tabular-nums text-dimmed">{formatNumber(row.runs)}</span>;
          if (col.id === "failed")
            return (
              <span class={`text-[10px] tabular-nums ${row.failed > 0 ? "text-red-500" : "text-dimmed"}`}>
                {formatNumber(row.failed)} · {formatPercent(row.runs === 0 ? 0 : row.failed / row.runs)}
              </span>
            );
          if (col.id === "runtime")
            return (
              <span class="text-[10px] tabular-nums text-dimmed">
                {formatDurationMs(row.avgDurationMs)} / {formatDurationMs(row.p99DurationMs)}
              </span>
            );
          if (col.id === "backlog") {
            const queuedAge = row.oldestQueuedAt ? Date.now() - row.oldestQueuedAt.getTime() : null;
            return (
              <span
                class={`text-[10px] tabular-nums ${
                  row.needsAttention > 0 || (queuedAge ?? 0) > LAG_WARN_MS ? "text-amber-600 dark:text-amber-400" : "text-dimmed"
                }`}
                title={row.needsAttention > 0 ? `${formatNumber(row.needsAttention)} need attention` : undefined}
              >
                {formatNumber(row.active)} / {queuedAge === null ? "—" : formatDurationMs(queuedAge)}
              </span>
            );
          }
          if (col.id === "activity") return <span class="text-[10px] text-dimmed">{formatRelative(row.latestRunAt)}</span>;
          if (col.id === "open")
            return (
              <a class="btn-simple btn-sm" href={href}>
                Open
              </a>
            );
          return "";
        }}
      />
    </DataPanel>
  );
}

export function WorkflowRunsView(props: CommonProps & { runs: WorkflowRunSummary[]; workflowName?: string; allWorkflowsHref?: string }) {
  return (
    <DataPanel
      title={props.state.parent ? "Child runs" : props.workflowName ? `${props.workflowName} runs` : "Runs"}
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
          {!props.state.parent && props.allWorkflowsHref ? (
            <a class="text-xs text-secondary hover:underline" href={props.allWorkflowsHref}>
              All workflows
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
        workflowsFilter.isActive(props.state, ["view", "window", "app", "state", "mode", "workflow", "parent", "page", "run"])
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
        class="overflow-x-auto"
        renderCell={({ row, col, value, render }) => {
          if (col.id === "workflow") {
            const error = runErrorSummary(row.error);
            return (
              <a class="block min-w-0 hover:underline" href={workflowsFilter.build(props.state, { run: row.id })}>
                <span class="block truncate font-medium text-primary">
                  {row.workflowName}
                  <span class="ml-1 text-dimmed">r{row.revision}</span>
                </span>
                <span class="block truncate font-mono text-[9px] text-dimmed" title={row.id}>
                  {row.appId} · {row.mode} · {row.id.slice(0, 8)}
                </span>
                {error ? (
                  <span class="block truncate text-[9px] text-red-500" title={error.message}>
                    {error.message}
                  </span>
                ) : null}
              </a>
            );
          }
          if (col.id === "state") {
            const queuedMs = row.state === "queued" ? Date.now() - row.createdAt.getTime() : null;
            return (
              <div class="flex flex-col items-start gap-0.5">
                <StatusBadge tone={RUN_TONE[row.state]} label={RUN_LABEL[row.state]} variant="dot" />
                {queuedMs !== null ? (
                  <span class={queuedMs > LAG_WARN_MS ? "text-[9px] text-amber-600 dark:text-amber-400" : "text-[9px] text-dimmed"}>
                    waiting {formatDurationMs(queuedMs)}
                  </span>
                ) : null}
              </div>
            );
          }
          if (col.id === "lag")
            return row.startedAt === null ? (
              <span
                class={
                  row.state === "queued" && Date.now() - row.createdAt.getTime() > LAG_WARN_MS
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-dimmed"
                }
              >
                not started
              </span>
            ) : (
              <span class={(row.startLagMs ?? 0) > LAG_WARN_MS ? "text-amber-600 dark:text-amber-400" : "text-secondary"}>
                {formatDurationMs(row.startLagMs)}
              </span>
            );
          if (col.id === "duration") {
            const duration = row.durationMs ?? (row.startedAt ? Date.now() - row.startedAt.getTime() : null);
            return <span class="text-secondary">{formatDurationMs(duration)}</span>;
          }
          if (col.id === "attempts")
            return (
              <span class={row.attempt > 1 ? "text-amber-600 dark:text-amber-400" : "text-dimmed"}>
                {row.attempt === 0 ? "not started" : row.attempt}
              </span>
            );
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
        class="overflow-x-auto"
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
        class="overflow-x-auto"
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
