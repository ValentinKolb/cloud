/**
 * Cross-app workflow operator console.
 *
 * The page stays SSR-first and URL-backed: operators can share the exact run,
 * finding queue, filter and page they are looking at. Mutations are limited to
 * the two interventions the kernel can perform safely — cancellation and an
 * explicit decision about an ambiguous external effect.
 */
import type { AuthContext } from "@valentinkolb/cloud/server";
import { formatDurationMs, formatNumber } from "@valentinkolb/cloud/shared";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { NoticeCard, Pagination, RangePicker, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import {
  getWorkflowRun,
  listStrandedWorkflowEffects,
  listUndispatchedWorkflowEvents,
  listWorkflowRuns,
  type WorkflowAppHealth,
  workflowHealth,
} from "@valentinkolb/cloud/workflows/store";
import type { JSX } from "solid-js";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import { gatewayOpsHelp } from "../../help";
import { WorkflowEffectsView, WorkflowEventsView, WorkflowRunsView } from "./_components/WorkflowQueues";
import WorkflowRunDetailView from "./_components/WorkflowRunDetail";
import WorkflowsFilterBar from "./_components/WorkflowsFilterBar.island";
import { FINDINGS_PER_PAGE, RUN_STATES, RUNS_PER_PAGE, type WorkflowView, windowStart, workflowsFilter } from "./filters";
import { LAG_WARN_MS } from "./presentation";

type WorkflowTotals = {
  runs: number;
  failed: number;
  attention: number;
  active: number;
  stranded: number;
  undispatched: number;
  worstLagMs: number;
};

const totalsFor = (health: WorkflowAppHealth[]): WorkflowTotals =>
  health.reduce(
    (sum, entry) => ({
      runs: sum.runs + Object.values(entry.runs).reduce((count, value) => count + value, 0),
      failed: sum.failed + entry.runs.failed,
      attention: sum.attention + entry.runs.needs_attention,
      active: sum.active + entry.runs.running + entry.runs.queued + entry.runs.waiting,
      stranded: sum.stranded + entry.strandedEffects,
      undispatched: sum.undispatched + entry.undispatchedEvents,
      worstLagMs: Math.max(sum.worstLagMs, entry.worstStartLagMs ?? 0),
    }),
    { runs: 0, failed: 0, attention: 0, active: 0, stranded: 0, undispatched: 0, worstLagMs: 0 },
  );

const WorkflowStats = (props: { totals: WorkflowTotals; window: string }) => (
  <StatGrid columns={6}>
    <StatCell label="Runs" value={formatNumber(props.totals.runs)} sub={`last ${props.window}`} />
    <StatCell label="In flight" value={formatNumber(props.totals.active)} sub="queued, running or waiting" />
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

  const [detail, health, runRows, effectRows, eventRows] = await Promise.all([
    state.run ? getWorkflowRun(state.run) : Promise.resolve(null),
    workflowHealth({ since }),
    !state.run && state.view === "runs"
      ? listWorkflowRuns({
          appId: state.app || undefined,
          parentRunId: state.parent || undefined,
          state: state.state === "all" ? undefined : state.state,
          mode: state.mode === "all" ? undefined : state.mode,
          since,
          limit: RUNS_PER_PAGE + 1,
          offset,
        })
      : Promise.resolve([]),
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
  const rowsForView = state.view === "runs" ? runRows : state.view === "effects" ? effectRows : eventRows;
  const hasNextPage = rowsForView.length > pageSize;
  const runs = runRows.slice(0, RUNS_PER_PAGE);
  const effects = effectRows.slice(0, FINDINGS_PER_PAGE);
  const events = eventRows.slice(0, FINDINGS_PER_PAGE);
  const apps = [...new Set(health.map((entry) => entry.appId))].sort();
  const totals = totalsFor(health);

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

  const viewOptions = (
    [
      ["runs", "Runs"],
      ["effects", `Effects${totals.stranded ? ` (${formatNumber(totals.stranded)})` : ""}`],
      ["events", `Events${totals.undispatched ? ` (${formatNumber(totals.undispatched)})` : ""}`],
    ] as const
  ).map(([view, label]) => ({
    value: view,
    label,
    href: workflowsFilter.build(state, { view, run: "", parent: "", page: 1 }),
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

  return () => (
    <AdminLayout c={c} title="Workflows">
      <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} />
      <div class="flex flex-col gap-4">
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
            effectsHref={workflowsFilter.build(state, { view: "effects", page: 1 })}
            eventsHref={workflowsFilter.build(state, { view: "events", page: 1 })}
          />
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
        ) : state.view === "runs" ? (
          <WorkflowRunsView runs={runs} state={state} filters={filters(true)} footer={pagination("runs")} hasNextPage={hasNextPage} />
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
