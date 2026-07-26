/**
 * Cross-app workflow operator console.
 *
 * The page stays SSR-first and URL-backed: operators can share the exact run,
 * finding queue, filter and page they are looking at. Mutations are limited to
 * the two interventions the kernel can perform safely — cancellation and an
 * explicit decision about an ambiguous external effect.
 */
import type { AuthContext } from "@valentinkolb/cloud/server";
import { formatDateTime, formatDurationMs, formatNumber } from "@valentinkolb/cloud/shared";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { NoticeCard, Pagination, Placeholder, RangePicker, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import {
  getWorkflow,
  getWorkflowRun,
  listStrandedWorkflowEffects,
  listUndispatchedWorkflowEvents,
  listWorkflowFamilies,
  listWorkflowRunTimeline,
  listWorkflowRuns,
  type WorkflowAppHealth,
  workflowHealth,
} from "@valentinkolb/cloud/workflows/store";
import type { JSX } from "solid-js";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import ObservabilityChart from "../../frontend/ObservabilityChart.island";
import { gatewayOpsHelp } from "../../help";
import { WorkflowEffectsView, WorkflowEventsView, WorkflowFamiliesView, WorkflowRunsView } from "./_components/WorkflowQueues";
import WorkflowRunDetailView from "./_components/WorkflowRunDetail";
import WorkflowsFilterBar from "./_components/WorkflowsFilterBar.island";
import { FINDINGS_PER_PAGE, RUN_STATES, RUNS_PER_PAGE, type WorkflowView, windowStart, workflowsFilter } from "./filters";
import { LAG_WARN_MS, RUN_LABEL } from "./presentation";
import { buildWorkflowTimelineRows } from "./timeline";

type WorkflowTotals = {
  runs: number;
  failed: number;
  attention: number;
  active: number;
  queued: number;
  stranded: number;
  undispatched: number;
  worstLagMs: number;
  oldestQueuedMs: number;
};

const totalsFor = (health: WorkflowAppHealth[]): WorkflowTotals =>
  health.reduce(
    (sum, entry) => ({
      runs: sum.runs + Object.values(entry.runs).reduce((count, value) => count + value, 0),
      failed: sum.failed + entry.runs.failed,
      attention: sum.attention + entry.runs.needs_attention,
      active: sum.active + entry.runs.running + entry.runs.queued + entry.runs.waiting,
      queued: sum.queued + entry.runs.queued,
      stranded: sum.stranded + entry.strandedEffects,
      undispatched: sum.undispatched + entry.undispatchedEvents,
      worstLagMs: Math.max(sum.worstLagMs, entry.worstStartLagMs ?? 0),
      oldestQueuedMs: Math.max(sum.oldestQueuedMs, entry.oldestQueuedMs ?? 0),
    }),
    { runs: 0, failed: 0, attention: 0, active: 0, queued: 0, stranded: 0, undispatched: 0, worstLagMs: 0, oldestQueuedMs: 0 },
  );

const WorkflowStats = (props: { totals: WorkflowTotals; window: string }) => (
  <StatGrid columns={6}>
    <StatCell label="Runs" value={formatNumber(props.totals.runs)} sub={`last ${props.window}`} />
    <StatCell
      label="In flight"
      value={formatNumber(props.totals.active)}
      sub={
        props.totals.queued === 0
          ? "running or waiting"
          : `${formatNumber(props.totals.queued)} queued · oldest ${formatDurationMs(props.totals.oldestQueuedMs)}`
      }
      valueClass={props.totals.oldestQueuedMs > LAG_WARN_MS ? "text-amber-600 dark:text-amber-400" : undefined}
    />
    <StatCell
      label="Failed"
      value={formatNumber(props.totals.failed)}
      valueClass={props.totals.failed > 0 ? "text-red-600 dark:text-red-400" : undefined}
    />
    <StatCell
      label="Needs attention"
      value={formatNumber(props.totals.attention)}
      sub="a human has to decide"
      valueClass={props.totals.attention > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
    />
    <StatCell
      label="Worst start lag"
      value={props.totals.worstLagMs > 0 ? formatDurationMs(props.totals.worstLagMs) : "—"}
      sub="cause to first attempt"
      valueClass={props.totals.worstLagMs > LAG_WARN_MS ? "text-amber-600 dark:text-amber-400" : undefined}
    />
    <StatCell
      label="Open findings"
      value={formatNumber(props.totals.stranded + props.totals.undispatched)}
      sub={`${formatNumber(props.totals.stranded)} effects · ${formatNumber(props.totals.undispatched)} events`}
      valueClass={props.totals.stranded + props.totals.undispatched > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
    />
  </StatGrid>
);

const FindingNotices = (props: { totals: WorkflowTotals; effectsHref: string; eventsHref: string }) => (
  <>
    {props.totals.stranded > 0 ? (
      <NoticeCard
        tone="warn"
        title={`${formatNumber(props.totals.stranded)} external effect${props.totals.stranded === 1 ? "" : "s"} require evidence`}
        detail={
          <span>
            A replay will not repeat an unsettled effect.{" "}
            <a class="font-medium hover:underline" href={props.effectsHref}>
              Review the effects queue
            </a>
            .
          </span>
        }
      />
    ) : null}
    {props.totals.undispatched > 0 ? (
      <NoticeCard
        tone="warn"
        title={`${formatNumber(props.totals.undispatched)} event${props.totals.undispatched === 1 ? "" : "s"} did not become a run`}
        detail={
          <span>
            These are unmatched, retrying or dead-lettered occurrences.{" "}
            <a class="font-medium hover:underline" href={props.eventsHref}>
              Review the events queue
            </a>
            .
          </span>
        }
      />
    ) : null}
  </>
);

export default ssr<AuthContext>(async (c) => {
  const state = workflowsFilter.parse(new URL(c.req.url));
  const since = windowStart(state.window);
  const offset = (state.page - 1) * (state.view === "runs" ? RUNS_PER_PAGE : FINDINGS_PER_PAGE);
  const showRunList = state.view === "runs" && Boolean(state.workflow || state.parent);
  const showFamilyOverview = state.view === "runs" && !showRunList;
  const runFilter = {
    appId: state.app || undefined,
    workflowId: state.workflow || undefined,
    state: state.state === "all" ? undefined : state.state,
    mode: state.mode === "all" ? undefined : state.mode,
    since,
  };

  const [detail, selectedWorkflow, health, familyRows, runRows, timelineResult, effectRows, eventRows] = await Promise.all([
    state.run ? getWorkflowRun(state.run) : Promise.resolve(null),
    state.workflow ? getWorkflow(state.workflow) : Promise.resolve(null),
    workflowHealth({ since }),
    !state.run && showFamilyOverview
      ? listWorkflowFamilies({
          ...runFilter,
          limit: RUNS_PER_PAGE + 1,
          offset,
        })
      : Promise.resolve([]),
    !state.run && showRunList
      ? listWorkflowRuns({
          ...runFilter,
          parentRunId: state.parent || undefined,
          limit: RUNS_PER_PAGE + 1,
          offset,
        })
      : Promise.resolve([]),
    !state.run && state.view === "runs" && !state.parent
      ? listWorkflowRunTimeline(runFilter, { limit: 2_000 })
      : Promise.resolve({ runs: [], total: 0 }),
    !state.run && state.view === "effects"
      ? listStrandedWorkflowEffects({
          appId: state.app || undefined,
          limit: FINDINGS_PER_PAGE + 1,
          offset,
        })
      : Promise.resolve([]),
    !state.run && state.view === "events"
      ? listUndispatchedWorkflowEvents({
          appId: state.app || undefined,
          limit: FINDINGS_PER_PAGE + 1,
          offset,
        })
      : Promise.resolve([]),
  ]);

  const pageSize = state.view === "runs" ? RUNS_PER_PAGE : FINDINGS_PER_PAGE;
  const rowsForView =
    state.view === "runs" ? (showFamilyOverview ? familyRows : runRows) : state.view === "effects" ? effectRows : eventRows;
  const hasNextPage = rowsForView.length > pageSize;
  const families = familyRows.slice(0, RUNS_PER_PAGE);
  const runs = runRows.slice(0, RUNS_PER_PAGE);
  const effects = effectRows.slice(0, FINDINGS_PER_PAGE);
  const events = eventRows.slice(0, FINDINGS_PER_PAGE);
  const apps = [...new Set(health.map((entry) => entry.appId))].sort();
  const totals = totalsFor(state.app ? health.filter((entry) => entry.appId === state.app) : health);
  const nowMs = Date.now();
  const timelineWindow = { fromMs: since.getTime(), toMs: nowMs };
  const timelineRows = buildWorkflowTimelineRows(timelineResult.runs, timelineWindow).map((row) => ({
    label: row.label,
    href: workflowsFilter.build(state, { workflow: row.workflowId, run: "", parent: "", page: 1 }),
    tooltip: `${row.label} · ${row.appId}`,
    intervals: row.intervals.map(({ run, ...interval }) => {
      const activeMs = nowMs - (run.startedAt ?? run.createdAt).getTime();
      const timing =
        run.state === "queued"
          ? `queued ${formatDurationMs(nowMs - run.createdAt.getTime())}`
          : run.durationMs !== null
            ? formatDurationMs(run.durationMs)
            : run.startedAt
              ? `active ${formatDurationMs(activeMs)}`
              : "not started";
      return {
        ...interval,
        label: timing,
        href: workflowsFilter.build(state, {
          workflow: run.workflowId,
          run: run.id,
          parent: "",
          page: 1,
        }),
        tooltip: [
          run.workflowName,
          RUN_LABEL[run.state],
          run.eventType ?? "direct invocation",
          formatDateTime(run.createdAt),
          timing,
          run.attempt === 0 ? "not attempted" : `attempt ${run.attempt}`,
        ].join(" · "),
      };
    }),
  }));

  const hrefFor = {
    app: Object.fromEntries([
      ["", workflowsFilter.build(state, { app: "", workflow: "", page: 1, run: "" })],
      ...apps.map((app) => [app, workflowsFilter.build(state, { app, workflow: "", page: 1, run: "" })] as const),
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

  const viewOptions = (
    [
      ["runs", "Workflows"],
      ["effects", `Effects${totals.stranded ? ` (${formatNumber(totals.stranded)})` : ""}`],
      ["events", `Events${totals.undispatched ? ` (${formatNumber(totals.undispatched)})` : ""}`],
    ] as const
  ).map(([view, label]) => ({
    value: view,
    label,
    href: workflowsFilter.build(state, { view, workflow: "", run: "", parent: "", page: 1 }),
  }));

  const pagination = (view: WorkflowView): JSX.Element | undefined =>
    state.page > 1 || hasNextPage ? (
      <Pagination
        currentPage={state.page}
        totalPages={hasNextPage ? state.page + 1 : state.page}
        baseUrl={workflowsFilter.paginationBase({ ...state, view }, "page")}
      />
    ) : undefined;

  const filters = (showRunFilters: boolean) => (
    <WorkflowsFilterBar
      apps={apps}
      app={state.app}
      state={state.state}
      mode={state.mode}
      hrefFor={hrefFor}
      showRunFilters={showRunFilters}
    />
  );
  const allWorkflowsHref = workflowsFilter.build(state, { workflow: "", run: "", parent: "", page: 1 });
  const title = selectedWorkflow?.name ?? detail?.workflowName ?? "Workflows";

  return () => (
    <AdminLayout c={c} title="Workflows">
      <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} />
      <div class="app-rows">
        <div class="min-w-0" style="view-transition-name: admin-workflows-title">
          <div class="flex items-center gap-2">
            {state.workflow || state.parent ? (
              <a class="btn-simple btn-sm text-dimmed" href={allWorkflowsHref} aria-label="Back to all workflows">
                <i class="ti ti-arrow-left" />
              </a>
            ) : null}
            <div class="min-w-0">
              <h1 class="truncate text-base font-semibold text-primary">{title}</h1>
              <p class="mt-1 text-xs text-dimmed">
                {selectedWorkflow
                  ? `Runs for this workflow in the last ${state.window}.`
                  : "Cross-app workflow health, runtime history, and operator findings."}
              </p>
            </div>
          </div>
        </div>

        <WorkflowStats totals={totals} window={state.window} />
        <div class="flex flex-wrap items-center justify-between gap-2">
          <RangePicker label={null} ariaLabel="Workflow observability view" options={viewOptions} value={state.view} />
          <a class="btn-simple btn-sm" href={workflowsFilter.build(state)}>
            <i class="ti ti-refresh" />
            Refresh
          </a>
        </div>

        {!detail && state.view === "runs" ? (
          <FindingNotices
            totals={totals}
            effectsHref={workflowsFilter.build(state, { view: "effects", workflow: "", run: "", parent: "", page: 1 })}
            eventsHref={workflowsFilter.build(state, { view: "events", workflow: "", run: "", parent: "", page: 1 })}
          />
        ) : null}

        {!detail && state.view === "runs" && !state.parent ? (
          <section class="paper p-3">
            <h2 class="text-xs font-semibold text-primary">Run timeline</h2>
            <p class="text-[10px] text-dimmed">
              One lane per workflow, busiest first. Completed runs use their execution time; queued and active runs extend to now. Drag to
              pan; use Ctrl/⌘ + wheel or the controls to zoom.
            </p>
            {timelineResult.total > timelineResult.runs.length ? (
              <p class="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                Showing the latest {formatNumber(timelineResult.runs.length)} of {formatNumber(timelineResult.total)} matching runs. The
                timeline reflects this loaded sample.
              </p>
            ) : null}
            {timelineRows.length === 0 ? (
              <Placeholder variant="compact" description="No workflow runs recorded in this window." />
            ) : (
              <ObservabilityChart
                kind="stateTimeline"
                class="mt-2 w-full text-dimmed"
                rows={timelineRows}
                domain={[timelineWindow.fromMs, timelineWindow.toMs]}
                states={[
                  { state: "queued", label: "Queued", color: "#71717a" },
                  { state: "running", label: "Running", color: "#3b82f6" },
                  { state: "waiting", label: "Waiting", color: "#8b5cf6" },
                  { state: "succeeded", label: "Succeeded", color: "#10b981" },
                  { state: "failed", label: "Failed", color: "#ef4444" },
                  { state: "needs_attention", label: "Needs attention", color: "#f59e0b" },
                  { state: "canceled", label: "Canceled", color: "#a1a1aa" },
                ]}
                xFormat="timeline"
                legend
                interactive
              />
            )}
          </section>
        ) : null}

        {state.run && !detail ? (
          <NoticeCard
            tone="error"
            title="Workflow run not found"
            detail={
              <a class="font-medium hover:underline" href={workflowsFilter.build(state, { run: "" })}>
                Return to {state.view}
              </a>
            }
          />
        ) : detail ? (
          <WorkflowRunDetailView detail={detail} state={state} />
        ) : state.workflow && !selectedWorkflow ? (
          <NoticeCard
            tone="error"
            title="Workflow not found"
            detail={
              <a class="font-medium hover:underline" href={allWorkflowsHref}>
                Return to all workflows
              </a>
            }
          />
        ) : state.view === "runs" ? (
          showFamilyOverview ? (
            <WorkflowFamiliesView
              families={families}
              state={state}
              filters={filters(true)}
              footer={pagination("runs")}
              hasNextPage={hasNextPage}
            />
          ) : (
            <WorkflowRunsView
              runs={runs}
              workflowName={selectedWorkflow?.name}
              allWorkflowsHref={allWorkflowsHref}
              state={state}
              filters={filters(true)}
              footer={pagination("runs")}
              hasNextPage={hasNextPage}
            />
          )
        ) : state.view === "effects" ? (
          <WorkflowEffectsView
            effects={effects}
            state={state}
            filters={filters(false)}
            footer={pagination("effects")}
            hasNextPage={hasNextPage}
          />
        ) : (
          <WorkflowEventsView
            events={events}
            state={state}
            filters={filters(false)}
            footer={pagination("events")}
            hasNextPage={hasNextPage}
          />
        )}
      </div>
    </AdminLayout>
  );
});
