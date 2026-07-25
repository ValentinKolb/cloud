/**
 * Workflow runs, across every app.
 *
 * The question this page answers in one look is "is any workflow broken right
 * now". Everything above the run list is a finding that used to have no
 * surface at all: an effect that escaped and never reported back, a run waiting
 * on a human, an event that matched nothing and said nothing.
 */
import type { AuthContext } from "@valentinkolb/cloud/server";
import { formatDurationMs, formatNumber, formatRelative } from "@valentinkolb/cloud/shared";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import {
  DataPanel,
  DataTable,
  type DataTableColumn,
  NoticeCard,
  Pagination,
  RangePicker,
  StatCell,
  StatGrid,
  StatusBadge,
  type StatusTone,
  StructuredDataPreview,
} from "@valentinkolb/cloud/ui";
import type { WorkflowRunState } from "@valentinkolb/cloud/workflows";
import {
  getWorkflowRun,
  listStrandedWorkflowEffects,
  listUndispatchedWorkflowEvents,
  listWorkflowRuns,
  type WorkflowRunSummary,
  type WorkflowStepSummary,
  workflowHealth,
} from "@valentinkolb/cloud/workflows/store";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import { gatewayOpsHelp } from "../../help";
import WorkflowsFilterBar from "./_components/WorkflowsFilterBar.island";
import { RUN_STATES, RUNS_PER_PAGE, WINDOWS, windowStart, workflowsFilter } from "./filters";

/** A run state's colour is the operator's first read, so it maps once, here. */
const RUN_TONE: Record<WorkflowRunState, StatusTone> = {
  queued: "neutral",
  running: "running",
  waiting: "degraded",
  succeeded: "ok",
  failed: "error",
  canceled: "neutral",
  needs_attention: "warn",
};

const RUN_LABEL: Record<WorkflowRunState, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Waiting",
  succeeded: "Succeeded",
  failed: "Failed",
  canceled: "Canceled",
  needs_attention: "Needs attention",
};

/**
 * Step states are the kernel's own outcome discriminants, so this covers the
 * execute and dry-run vocabularies without inventing a third one.
 */
const STEP_TONE: Record<string, StatusTone> = {
  running: "running",
  waiting: "degraded",
  completed: "ok",
  planned: "ok",
  terminal: "ok",
  failed: "error",
  needs_attention: "warn",
  unsupported: "warn",
  indeterminate: "warn",
  canceled: "neutral",
};

const EFFECT_TONE: Record<string, StatusTone> = {
  executing: "running",
  ambiguous: "warn",
  succeeded: "ok",
  failed: "error",
};

/** A lag only matters once it is well past the tick that caused it. */
const LAG_WARN_MS = 5 * 60 * 1000;

const readString = (value: unknown, key: string): string | null => {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
};

export default ssr<AuthContext>(async (c) => {
  const state = workflowsFilter.parse(new URL(c.req.url));
  const since = windowStart(state.window);

  const [detail, health, stranded, undispatched, runs] = await Promise.all([
    state.run ? getWorkflowRun(state.run) : Promise.resolve(null),
    workflowHealth({ since }),
    listStrandedWorkflowEffects({ limit: 10 }),
    listUndispatchedWorkflowEvents({ limit: 10 }),
    listWorkflowRuns({
      appId: state.app || undefined,
      state: state.state === "all" ? undefined : state.state,
      mode: state.mode === "all" ? undefined : state.mode,
      since,
      // One row past the page, so pagination knows whether a next one exists
      // without counting every run ever recorded.
      limit: RUNS_PER_PAGE + 1,
      offset: (state.page - 1) * RUNS_PER_PAGE,
    }),
  ]);

  const hasNextPage = runs.length > RUNS_PER_PAGE;
  const pageRuns = runs.slice(0, RUNS_PER_PAGE);
  const apps = health.map((entry) => entry.appId);

  const totals = health.reduce(
    (sum, entry) => ({
      runs: sum.runs + Object.values(entry.runs).reduce((count, value) => count + value, 0),
      failed: sum.failed + entry.runs.failed,
      attention: sum.attention + entry.runs.needs_attention,
      active: sum.active + entry.runs.running + entry.runs.queued + entry.runs.waiting,
      worstLagMs: Math.max(sum.worstLagMs, entry.worstStartLagMs ?? 0),
    }),
    { runs: 0, failed: 0, attention: 0, active: 0, worstLagMs: 0 },
  );

  // Built server-side so the island never has to know the other parameters —
  // the hand-rolled copies of this differed exactly there, silently dropping
  // unrelated filters.
  const hrefFor = {
    app: Object.fromEntries([
      ["", workflowsFilter.build(state, { app: "", page: 1, run: "" })],
      ...apps.map((app) => [app, workflowsFilter.build(state, { app, page: 1, run: "" })] as const),
    ]),
    state: Object.fromEntries(
      RUN_STATES.map((value) => [value, workflowsFilter.build(state, { state: value, page: 1, run: "" })] as const),
    ),
    mode: Object.fromEntries(
      (["all", "execute", "dryRun"] as const).map(
        (value) => [value, workflowsFilter.build(state, { mode: value, page: 1, run: "" })] as const,
      ),
    ),
  };

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

  const stepColumns: DataTableColumn<WorkflowStepSummary>[] = [
    { id: "step", header: "Step", cellClass: "min-w-[160px]" },
    { id: "action", header: "Action" },
    { id: "state", header: "State" },
    { id: "effect", header: "Effect" },
    { id: "attempts", header: "Attempts", align: "right" },
    { id: "duration", header: "Duration", align: "right" },
  ];

  // The handler hands back a render function, not the tree itself.
  return () => (
    <AdminLayout c={c} title="Workflows">
      <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} />
      <div class="flex flex-col gap-4">
        <StatGrid>
          <StatCell label="Runs" value={formatNumber(totals.runs)} sub={`last ${state.window}`} />
          <StatCell label="In flight" value={formatNumber(totals.active)} sub="queued, running or waiting" />
          <StatCell
            label="Failed"
            value={formatNumber(totals.failed)}
            valueClass={totals.failed > 0 ? "text-red-600 dark:text-red-400" : undefined}
          />
          <StatCell
            label="Needs attention"
            value={formatNumber(totals.attention)}
            sub="a human has to decide"
            valueClass={totals.attention > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
          />
          <StatCell
            label="Worst start lag"
            value={totals.worstLagMs > 0 ? formatDurationMs(totals.worstLagMs) : "—"}
            sub="cause to first attempt"
            valueClass={totals.worstLagMs > LAG_WARN_MS ? "text-amber-600 dark:text-amber-400" : undefined}
          />
        </StatGrid>

        {stranded.length > 0 ? (
          <NoticeCard
            tone="warn"
            title={`${formatNumber(stranded.length)} effect${stranded.length === 1 ? "" : "s"} left the process and never reported back`}
            detail={
              <div class="flex flex-col gap-1.5">
                <p>
                  A replay will not repeat these — each one may already have happened. Until they are settled, their runs cannot continue.
                </p>
                <ul class="flex flex-col gap-0.5">
                  {stranded.slice(0, 5).map((effect) => (
                    <li class="text-xs">
                      <a class="font-mono hover:underline" href={workflowsFilter.build(state, { run: effect.runId })}>
                        {effect.workflowName} · {effect.stepKey}
                      </a>
                      <span class="ml-1 text-dimmed">
                        {effect.action ?? "—"} · {effect.effectState} for {formatDurationMs(effect.ageMs)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            }
          />
        ) : null}

        {undispatched.length > 0 ? (
          <NoticeCard
            tone={undispatched.some((event) => event.lastError) ? "error" : "warn"}
            title={`${formatNumber(undispatched.length)} event${undispatched.length === 1 ? "" : "s"} never turned into a run`}
            detail={
              <ul class="flex flex-col gap-0.5">
                {undispatched.slice(0, 5).map((event) => (
                  <li class="text-xs">
                    <span class="font-mono">{event.type}</span>
                    <span class="ml-1 text-dimmed">
                      {event.appId} · {formatRelative(event.occurredAt)} · {event.attempts} attempt{event.attempts === 1 ? "" : "s"}
                      {event.lastError ? ` · ${event.lastError}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}

        {detail ? (
          <DataPanel
            title={`${detail.workflowName} · revision ${detail.revision}`}
            subtitle={
              <span class="flex flex-wrap items-center gap-2">
                <StatusBadge tone={RUN_TONE[detail.state]} label={RUN_LABEL[detail.state]} />
                <span class="text-dimmed">
                  {detail.appId} · {detail.mode} · attempt {detail.attempt} · {formatRelative(detail.createdAt)}
                </span>
              </span>
            }
            actions={
              <a class="text-xs text-secondary hover:underline" href={workflowsFilter.build(state, { run: "" })}>
                Back to runs
              </a>
            }
            isEmpty={detail.steps.length === 0}
            empty="This run has not recorded a step yet."
            footer={
              <div class="flex flex-col gap-3 px-3 py-2 text-xs">
                <div class="flex flex-wrap gap-x-6 gap-y-1">
                  <span>
                    <span class="text-dimmed">Cause</span> {detail.eventType ?? "direct invocation"}
                  </span>
                  <span>
                    <span class="text-dimmed">Occurred</span> {formatRelative(detail.occurredAt)}
                  </span>
                  <span>
                    <span class="text-dimmed">Start lag</span> {formatDurationMs(detail.startLagMs)}
                  </span>
                  <span>
                    <span class="text-dimmed">Duration</span> {formatDurationMs(detail.durationMs)}
                  </span>
                  {Object.keys(detail.effectBudget).length > 0 ? (
                    <span>
                      <span class="text-dimmed">Effects</span>{" "}
                      {Object.entries(detail.effectBudget)
                        .map(([dimension, limit]) => `${dimension} ${detail.effectsUsed[dimension] ?? 0}/${limit}`)
                        .join(" · ")}
                    </span>
                  ) : null}
                </div>
                {Object.values(detail.children).some((count) => count > 0) ? (
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-dimmed">Children</span>
                    {(Object.entries(detail.children) as [WorkflowRunState, number][])
                      .filter(([, count]) => count > 0)
                      .map(([childState, count]) => (
                        <StatusBadge
                          tone={RUN_TONE[childState]}
                          label={`${formatNumber(count)} ${RUN_LABEL[childState].toLowerCase()}`}
                          variant="dot"
                        />
                      ))}
                  </div>
                ) : null}
                {detail.error ? (
                  <div class="flex flex-col gap-1">
                    <span class="text-dimmed">
                      {readString(detail.error, "kind") === "budget_exceeded" ? "Effect budget exhausted" : "Error"}
                    </span>
                    <StructuredDataPreview data={detail.error} />
                  </div>
                ) : null}
                {detail.eventData && Object.keys(detail.eventData).length > 0 ? (
                  <div class="flex flex-col gap-1">
                    <span class="text-dimmed">Event payload</span>
                    <StructuredDataPreview data={detail.eventData} />
                  </div>
                ) : null}
              </div>
            }
          >
            <DataTable
              rows={detail.steps}
              columns={stepColumns}
              getRowId={(step) => step.stepKey}
              density="compact"
              renderCell={({ row, col, value, render }) => {
                if (col.id === "step") return <span class="font-mono text-xs">{row.stepKey}</span>;
                if (col.id === "action") return <span class="text-secondary">{row.action ?? row.kind}</span>;
                if (col.id === "state") return <StatusBadge tone={STEP_TONE[row.state] ?? "neutral"} label={row.state} variant="dot" />;
                if (col.id === "effect")
                  return row.effectState ? (
                    <StatusBadge tone={EFFECT_TONE[row.effectState] ?? "neutral"} label={row.effectState} variant="dot" />
                  ) : (
                    <span class="text-dimmed">—</span>
                  );
                // Attempts are stored zero-based: the first run of a step is
                // attempt 1 to anyone reading the page.
                if (col.id === "attempts") return <span class="text-dimmed">{row.attempt + 1}</span>;
                if (col.id === "duration") return <span class="text-secondary">{formatDurationMs(row.durationMs)}</span>;
                return render(value);
              }}
            />
          </DataPanel>
        ) : (
          <DataPanel
            title="Runs"
            subtitle={`${formatNumber(pageRuns.length)}${hasNextPage ? "+" : ""} in the last ${state.window}`}
            actions={
              <RangePicker
                options={WINDOWS.map((value) => ({ value, href: workflowsFilter.build(state, { window: value, page: 1 }) }))}
                value={state.window}
              />
            }
            filters={<WorkflowsFilterBar apps={apps} app={state.app} state={state.state} mode={state.mode} hrefFor={hrefFor} />}
            isEmpty={pageRuns.length === 0}
            empty={
              workflowsFilter.isActive(state, ["window", "page", "run"])
                ? "No runs match these filters."
                : "No workflow has run in this window."
            }
            footer={
              state.page > 1 || hasNextPage ? (
                <Pagination
                  currentPage={state.page}
                  totalPages={hasNextPage ? state.page + 1 : state.page}
                  baseUrl={workflowsFilter.paginationBase(state, "page")}
                />
              ) : undefined
            }
          >
            <DataTable
              rows={pageRuns}
              columns={runColumns}
              getRowId={(run) => run.id}
              density="compact"
              renderCell={({ row, col, value, render }) => {
                if (col.id === "workflow")
                  return (
                    <a class="block truncate font-medium hover:underline" href={workflowsFilter.build(state, { run: row.id })}>
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
        )}
      </div>
    </AdminLayout>
  );
});
