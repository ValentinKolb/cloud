import { createPagination } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import {
  type TraceEvent,
  type TraceListFilter,
  type TraceRunStats,
  type TraceSourceGroup,
  type TraceSpan,
  trace,
} from "@valentinkolb/cloud/services";
import {
  formatDate,
  formatDurationMs as formatMs,
  formatNumber,
  formatPercent,
  formatDateTime as formatTimestamp,
} from "@valentinkolb/cloud/shared";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import {
  DataTable,
  type DataTableColumn,
  Pagination,
  Placeholder,
  StatCell,
  StatGrid,
  StructuredDataPreview,
} from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import ObservabilityChart from "../../frontend/ObservabilityChart.island";
import { gatewayOpsHelp } from "../../help";
import JobsActionToast from "./_components/JobsActionToast.island";
import JobsFilterBar from "./_components/JobsFilterBar.island";
import {
  buildJobsFilterUrl,
  type JobsFilterState,
  jobsDurationOptions,
  jobsWindowOptions,
  minDurationFromFilter,
  parseJobsFilterFromUrl,
} from "./_components/types";
import {
  type BackgroundJobOverviewRow,
  buildBackgroundJobRows,
  buildJobTimelineRows,
  filterBackgroundJobRows,
  jobsObservabilityService,
} from "./service";

const baseUrl = "/admin/observability/jobs";

/**
 * A schedule can legitimately be a little late — the handler polls, the tick
 * lands a moment after the minute. Only a clear overshoot means it stopped.
 */
const OVERDUE_GRACE_MS = 2 * 60 * 1000;

const formatDuration = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

const windowLabel = (filter: JobsFilterState): string =>
  jobsWindowOptions.find((option) => option.value === filter.window)?.label.toLowerCase() ?? "24 hours";

const durationLabel = (filter: JobsFilterState): string =>
  jobsDurationOptions.find((option) => option.value === filter.duration)?.label ?? "All durations";

const runKey = (span: Pick<TraceSpan, "traceId" | "spanId">): string => `${span.traceId}:${span.spanId}`;

const parseRunKey = (value: string | null): { traceId: string; spanId: string } | null => {
  if (!value) return null;
  const [traceId, spanId] = value.split(":");
  if (!traceId || !spanId) return null;
  if (!/^[a-f0-9]{32}$/i.test(traceId) || !/^[a-f0-9]{16}$/i.test(spanId)) return null;
  return { traceId, spanId };
};

const traceFilterFromJobs = (filter: JobsFilterState): TraceListFilter => {
  const traceFilter: TraceListFilter = {
    window: filter.window,
    excludeDefinitions: true,
    search: filter.search || undefined,
    source: filter.source ?? undefined,
    category: filter.type === "all" ? undefined : filter.type,
    minDurationMs: minDurationFromFilter(filter.duration),
  };

  if (filter.health === "failed") traceFilter.status = "error";
  if (filter.health === "running") traceFilter.active = true;
  if (filter.health === "healthy") traceFilter.status = "ok";

  return traceFilter;
};

const statusBadge = (input: { status: string | null; running?: boolean }) => {
  if (input.running) {
    return (
      <span class="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
        Running
      </span>
    );
  }
  if (input.status === "error") {
    return (
      <span class="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-200">Failed</span>
    );
  }
  if (input.status === "ok") {
    return (
      <span class="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
        Healthy
      </span>
    );
  }
  return <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-dimmed dark:bg-zinc-900">Unset</span>;
};

const groupHealth = (group: TraceSourceGroup) => {
  if (group.latestStartedAt && !group.latestEndedAt) return statusBadge({ status: group.latestStatus, running: true });
  return statusBadge({ status: group.latestStatus });
};

const rowHealth = (row: BackgroundJobOverviewRow) => (row.trace ? groupHealth(row.trace) : statusBadge({ status: null }));

const stateBadge = (row: BackgroundJobOverviewRow) => {
  if (row.kind === "trace") {
    if (row.trace.categories.includes("backfill")) {
      return (
        <span class="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
          <i class="ti ti-database-import" aria-hidden="true" />
          Backfill
        </span>
      );
    }
    return <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-dimmed dark:bg-zinc-900">Trace only</span>;
  }
  if (row.state === "available") {
    return (
      <span class="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
        Available
      </span>
    );
  }
  return (
    <span class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
      Unavailable
    </span>
  );
};

const summarize = (summary: Record<string, unknown> | null): string => {
  if (!summary) return "-";
  const entries = Object.entries(summary).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return "-";
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
};

const paginationBaseUrl = (filter: JobsFilterState): string => {
  const url = buildJobsFilterUrl(baseUrl, { page: 1, run: null }, filter);
  return url.includes("?") ? `${url}&page=` : `${url}?page=`;
};

const sourceUrl = (filter: JobsFilterState, source: string): string => buildJobsFilterUrl(baseUrl, { source, page: 1, run: null }, filter);

const runUrl = (filter: JobsFilterState, span: TraceSpan): string => buildJobsFilterUrl(baseUrl, { run: runKey(span) }, filter);

const closeRunUrl = (filter: JobsFilterState): string => buildJobsFilterUrl(baseUrl, { run: null }, filter);

const timelineStateLabel = {
  ok: "Succeeded",
  error: "Failed",
  running: "Running",
  stuck: "Never finished",
} as const;

const statsGrid = (stats: TraceRunStats, filter: JobsFilterState) => (
  <StatGrid columns={6}>
    <StatCell label="Sources" value={formatNumber(stats.sources)} sub={filter.source ? "selected source" : "job families"} />
    <StatCell label="Runs" value={formatNumber(stats.runs)} sub={windowLabel(filter)} />
    <StatCell
      label="Failed"
      value={formatNumber(stats.failed)}
      sub={`${formatPercent(stats.errorRate)} error rate`}
      valueClass={stats.failed > 0 ? "text-red-500" : "text-primary"}
      accent={stats.failed > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : { tone: "emerald", icon: "ti ti-check" }}
    />
    <StatCell
      label="Running"
      value={formatNumber(stats.running)}
      sub="in flight now"
      accent={stats.running > 0 ? { tone: "blue", icon: "ti ti-loader" } : undefined}
    />
    <StatCell
      label="Stuck"
      value={formatNumber(stats.stuck)}
      sub="open, abandoned"
      valueClass={stats.stuck > 0 ? "text-red-500" : "text-primary"}
      accent={stats.stuck > 0 ? { tone: "red", icon: "ti ti-plug-connected-x" } : undefined}
      href={stats.stuck > 0 ? buildJobsFilterUrl(baseUrl, { health: "stuck" }, filter) : undefined}
    />
    <StatCell
      label="P99"
      value={formatMs(stats.p99DurationMs)}
      sub={
        stats.anomalous > 0
          ? `avg ${formatMs(stats.avgDurationMs)} · ${formatNumber(stats.anomalous)} excluded`
          : `avg ${formatMs(stats.avgDurationMs)}`
      }
      title={
        stats.anomalous > 0
          ? `${formatNumber(stats.anomalous)} runs lasted longer than the abandonment threshold and are excluded from these percentiles.`
          : undefined
      }
    />
  </StatGrid>
);

const overviewColumns: DataTableColumn<BackgroundJobOverviewRow>[] = [
  { id: "source", header: "Schedule / Source", value: (row) => row.source, cellClass: "min-w-[280px]" },
  { id: "control", header: "Control", subtitle: "handler", value: (row) => row.state },
  { id: "health", header: "Latest", subtitle: "trace run", value: (row) => row.trace?.latestStatus ?? "" },
  { id: "runs", header: "Runs", value: (row) => row.trace?.runs ?? 0, headerClass: "text-right", cellClass: "text-right" },
  {
    id: "failed",
    header: "Failed",
    subtitle: "error rate",
    value: (row) => row.trace?.failed ?? 0,
    headerClass: "text-right",
    cellClass: "text-right",
  },
  {
    id: "runtime",
    header: "Runtime",
    subtitle: "avg / p99",
    value: (row) => row.trace?.avgDurationMs ?? 0,
    headerClass: "text-right",
    cellClass: "text-right",
  },
  { id: "next", header: "Next", subtitle: "scheduled", value: (row) => row.nextRunAt ?? 0, cellClass: "whitespace-nowrap" },
  { id: "action", header: "", value: (row) => row.scheduleId ?? row.source, headerClass: "text-right", cellClass: "text-right" },
];

const runColumns: DataTableColumn<TraceSpan>[] = [
  { id: "started", header: "Started", value: (row) => row.startedAt, cellClass: "whitespace-nowrap" },
  { id: "name", header: "Run", value: (row) => row.name, cellClass: "min-w-[240px]" },
  { id: "type", header: "Type", value: (row) => row.category },
  { id: "status", header: "Status", value: (row) => row.status },
  { id: "duration", header: "Duration", value: (row) => row.durationMs, headerClass: "text-right", cellClass: "text-right" },
  { id: "events", header: "Events", value: (row) => row.eventCount, headerClass: "text-right", cellClass: "text-right" },
  { id: "summary", header: "Summary", value: (row) => summarize(row.summary) },
];

const sourceSubtitle = (group: TraceSourceGroup): string => {
  if (group.categories.length === 1 && group.categories[0] === "backfill") {
    return `${formatNumber(group.runs)} backfill ${group.runs === 1 ? "run" : "runs"}`;
  }
  const parts = [`${formatNumber(group.jobRuns)} job`, `${formatNumber(group.scheduleRuns)} schedule`];
  if (group.aiRuns) parts.push(`${formatNumber(group.aiRuns)} ai`);
  if (group.customRuns) parts.push(`${formatNumber(group.customRuns)} custom`);
  return parts.join(" · ");
};

const overviewSubtitle = (row: BackgroundJobOverviewRow): string => {
  const parts = [row.family];
  if (row.resourceKind) parts.push(row.resourceKind);
  if (row.resourceLabel) parts.push(row.resourceLabel);
  if (row.kind === "schedule") parts.push(`${row.schedulerId} / ${row.scheduleId}`);
  else parts.push(sourceSubtitle(row.trace));
  return parts.join(" · ");
};

const DetailLink = (props: { row: BackgroundJobOverviewRow }) => {
  if (!props.row.detailHref) return null;
  return (
    <a class="btn-simple btn-sm" href={props.row.detailHref} title="Open the owning resource.">
      <i class="ti ti-external-link" />
      Open
    </a>
  );
};

const RunNowButton = (props: { row: BackgroundJobOverviewRow; filter: JobsFilterState }) => {
  if (props.row.kind !== "schedule") return null;
  const disabled = props.row.state !== "available";
  return (
    <form method="post" action="/admin/observability/jobs/run-now" class="inline-flex justify-end">
      <input type="hidden" name="schedulerId" value={props.row.schedulerId} />
      <input type="hidden" name="scheduleId" value={props.row.scheduleId} />
      <input type="hidden" name="redirectTo" value={buildJobsFilterUrl(baseUrl, { run: null }, props.filter)} />
      <button
        type="submit"
        class="btn-simple btn-sm"
        disabled={disabled}
        title={disabled ? props.row.lastError || "No live scheduler handler is available." : "Request a manual scheduler run."}
      >
        <i class="ti ti-player-play" />
        Run now
      </button>
    </form>
  );
};

const ActionCell = (props: { row: BackgroundJobOverviewRow; filter: JobsFilterState }) => {
  const hasDetail = Boolean(props.row.detailHref);
  const hasRun = props.row.kind === "schedule";
  if (!hasDetail && !hasRun) return <span class="text-[10px] text-dimmed">-</span>;
  return (
    <div class="inline-flex flex-wrap justify-end gap-1">
      <DetailLink row={props.row} />
      <RunNowButton row={props.row} filter={props.filter} />
    </div>
  );
};

const OverviewTable = (props: { rows: BackgroundJobOverviewRow[]; filter: JobsFilterState }) => (
  <section class="paper overflow-hidden">
    <div class="px-3 py-2">
      <h2 class="text-xs font-semibold text-primary">Schedules and job families</h2>
      <p class="text-[10px] text-dimmed">
        Schedules come from sync schedulerControl. Runtime statistics stay SQL-based and are joined by source.
      </p>
    </div>
    <DataTable
      rows={props.rows}
      columns={overviewColumns}
      getRowId={(row) => (row.kind === "schedule" ? `${row.schedulerId}:${row.scheduleId}` : `trace:${row.source}`)}
      hoverRows
      highlightColumns={false}
      density="compact"
      class="overflow-x-auto"
      empty="No background job schedules or sources match the current filters"
      renderCell={({ row, col }) => {
        if (col.id === "source")
          return (
            <a href={sourceUrl(props.filter, row.source)} class="block min-w-0 hover:text-blue-600 dark:hover:text-blue-300">
              <span class="block truncate text-[11px] font-medium text-primary">{row.label}</span>
              <span class="block truncate text-[10px] text-dimmed">{overviewSubtitle(row)}</span>
            </a>
          );
        if (col.id === "control") return stateBadge(row);
        if (col.id === "health") return rowHealth(row);
        if (col.id === "runs") return <span class="text-[10px] tabular-nums text-dimmed">{formatNumber(row.trace?.runs ?? 0)}</span>;
        if (col.id === "failed")
          return (
            <span class="text-[10px] tabular-nums text-dimmed">
              {formatNumber(row.trace?.failed ?? 0)} · {formatPercent(row.trace?.errorRate ?? 0)}
            </span>
          );
        if (col.id === "runtime")
          return (
            <span class="text-[10px] tabular-nums text-dimmed">
              {formatMs(row.trace?.avgDurationMs ?? null)} / {formatMs(row.trace?.p99DurationMs ?? null)}
            </span>
          );
        if (col.id === "next") {
          // A schedule whose next run is already in the past is not "due soon",
          // it has stopped firing — the failure mode a plain timestamp hides.
          const overdueMs = row.nextRunAt ? Date.now() - row.nextRunAt : 0;
          return overdueMs > OVERDUE_GRACE_MS ? (
            <span
              class="text-[10px] text-red-500"
              title={`Expected at ${formatTimestamp(row.nextRunAt === null ? null : new Date(row.nextRunAt))}`}
            >
              overdue {formatDuration(overdueMs)}
            </span>
          ) : (
            <span class="text-[10px] text-dimmed">{formatTimestamp(row.nextRunAt === null ? null : new Date(row.nextRunAt))}</span>
          );
        }
        if (col.id === "action") return <ActionCell row={row} filter={props.filter} />;
        return "";
      }}
    />
  </section>
);

const RunDetailPanel = (props: { span: TraceSpan; events: TraceEvent[]; closeHref: string }) => (
  <aside class="min-h-0 overflow-y-auto">
    <div class="detail-stack">
      <section class="detail-section">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="detail-section-label">Run detail</p>
            <h2 class="truncate text-base font-semibold text-primary">{props.span.name}</h2>
            <p class="mt-1 truncate text-[11px] text-dimmed">{props.span.spanKey ?? props.span.spanId}</p>
          </div>
          <a href={props.closeHref} class="btn-simple btn-sm shrink-0 text-dimmed hover:text-primary" aria-label="Close run detail panel">
            <i class="ti ti-x" />
          </a>
        </div>
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Status</h3>
        <dl class="detail-facts">
          <dt class="detail-fact-key">Source</dt>
          <dd class="break-all font-mono">{props.span.source}</dd>
          <dt class="detail-fact-key">Type</dt>
          <dd>{props.span.category}</dd>
          <dt class="detail-fact-key">Status</dt>
          <dd>{statusBadge({ status: props.span.status, running: !props.span.endedAt })}</dd>
          <dt class="detail-fact-key">Started</dt>
          <dd>{formatDate(props.span.startedAt)}</dd>
          <dt class="detail-fact-key">Ended</dt>
          <dd>{formatDate(props.span.endedAt)}</dd>
          <dt class="detail-fact-key">Duration</dt>
          <dd>{formatMs(props.span.durationMs)}</dd>
          <dt class="detail-fact-key">Events</dt>
          <dd>{formatNumber(props.span.eventCount)}</dd>
          {props.span.statusMessage ? (
            <>
              <dt class="detail-fact-key">Message</dt>
              <dd class="break-words">{props.span.statusMessage}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {props.span.summary ? (
        <section class="detail-section">
          <StructuredDataPreview title="Summary" data={props.span.summary} maxRows={8} />
        </section>
      ) : null}

      {props.span.attributes ? (
        <section class="detail-section">
          <StructuredDataPreview title="Attributes" data={props.span.attributes} maxRows={10} />
        </section>
      ) : null}

      <section class="detail-section">
        <h3 class="detail-section-label">Events</h3>
        <div class="flex flex-col gap-1.5">
          {props.events.length === 0 ? (
            <p class="text-[11px] text-dimmed">No events recorded for this run.</p>
          ) : (
            props.events.map((event) => (
              <article class="rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate text-[11px] font-medium text-primary">{event.name}</span>
                  <span class="shrink-0 text-[10px] text-dimmed">{formatDate(event.occurredAt)}</span>
                </div>
                <p class="mt-1 text-[10px] text-dimmed">{event.severity}</p>
                {event.body ? <p class="mt-1 break-words text-[10px] text-primary">{event.body}</p> : null}
                {event.attributes ? <StructuredDataPreview class="mt-1" data={event.attributes} maxRows={6} /> : null}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  </aside>
);

const SourceRunsTable = (props: {
  spans: TraceSpan[];
  total: number;
  pagination: ReturnType<typeof createPagination>;
  filter: JobsFilterState;
  selectedRunKey: string | null;
}) => (
  <section class="paper overflow-hidden">
    <div class="px-3 py-2">
      <h2 class="text-xs font-semibold text-primary">Runs</h2>
      <p class="text-[10px] text-dimmed">
        {formatNumber(props.spans.length)} of {formatNumber(props.total)} runs. Duration filter: {durationLabel(props.filter)}.
      </p>
    </div>
    <DataTable
      rows={props.spans}
      columns={runColumns}
      getRowId={runKey}
      selectedRowId={props.selectedRunKey}
      hoverRows
      highlightColumns={false}
      density="compact"
      class="overflow-x-auto"
      empty="No runs match the current filters"
      renderCell={({ row, col }) => {
        if (col.id === "started") return <span class="text-[10px] text-dimmed">{formatDate(row.startedAt)}</span>;
        if (col.id === "name")
          return (
            <a href={runUrl(props.filter, row)} class="block min-w-0 hover:text-blue-600 dark:hover:text-blue-300">
              <span class="block truncate text-[11px] font-medium text-primary">{row.name}</span>
              <span class="block truncate text-[10px] text-dimmed">{row.spanKey ?? row.spanId}</span>
            </a>
          );
        if (col.id === "type") return <span class="text-[10px] text-dimmed">{row.category}</span>;
        if (col.id === "status") return statusBadge({ status: row.status, running: !row.endedAt });
        if (col.id === "duration") return <span class="text-[10px] tabular-nums text-dimmed">{formatMs(row.durationMs)}</span>;
        if (col.id === "events") return <span class="text-[10px] tabular-nums text-dimmed">{formatNumber(row.eventCount)}</span>;
        if (col.id === "summary") return <span class="block max-w-[360px] truncate text-[10px] text-dimmed">{summarize(row.summary)}</span>;
        return "";
      }}
    />
    <div class="px-3 py-2">
      <Pagination currentPage={props.pagination.page} totalPages={props.pagination.total_pages} baseUrl={paginationBaseUrl(props.filter)} />
    </div>
  </section>
);

type JobsActionFeedback = { tone: "error"; message: string } | null;

const parseActionFeedback = (url: URL): JobsActionFeedback => {
  const status = url.searchParams.get("job_action");
  if (status === "error") return { tone: "error", message: url.searchParams.get("job_message") || "Schedule run could not be requested." };
  return null;
};

const FeedbackBanner = (props: { feedback: JobsActionFeedback }) => {
  if (!props.feedback) return null;
  return (
    <div class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <i class="ti ti-alert-circle" /> {props.feedback.message}
    </div>
  );
};

const ControlWarning = (props: { error: string | null }) =>
  props.error ? (
    <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <i class="ti ti-alert-triangle" /> Scheduler control is unavailable: {props.error}
    </div>
  ) : null;

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const filter = parseJobsFilterFromUrl(url);
  const actionFeedback = parseActionFeedback(url);
  const traceFilter = traceFilterFromJobs(filter);
  const perPage = 100;
  const paginationInput = { page: filter.page, perPage, offset: (filter.page - 1) * perPage };
  const selectedRun = parseRunKey(filter.run);
  const schedulesPromise = filter.source
    ? Promise.resolve({ schedules: [], error: null as string | null })
    : jobsObservabilityService
        .listSchedules()
        .then((schedules) => ({ schedules, error: null as string | null }))
        .catch((error) => ({ schedules: [], error: error instanceof Error ? error.message : String(error) }));

  const [stats, groups, listResult, selectedSpan, selectedEvents, scheduleResult, timelineResult] = await Promise.all([
    trace.stats({ filter: traceFilter }),
    filter.source ? Promise.resolve([]) : trace.sourceGroups({ filter: traceFilter }),
    filter.source ? trace.list(paginationInput, { filter: traceFilter }) : Promise.resolve({ spans: [], total: 0 }),
    selectedRun ? trace.getSpan(selectedRun) : Promise.resolve(null),
    selectedRun ? trace.events({ ...selectedRun, limit: 200 }) : Promise.resolve([]),
    schedulesPromise,
    // Lanes need the individual runs; the overview table only has aggregates.
    trace.list({ page: 1, perPage: 2000, offset: 0 }, { filter: traceFilter }).catch(() => ({ spans: [], total: 0 })),
  ]);
  const windowSeconds = jobsWindowOptions.find((option) => option.value === filter.window)?.seconds ?? 86_400;
  const timelineWindow = { fromMs: Date.now() - windowSeconds * 1000, toMs: Date.now() };
  const rawTimelineRows = buildJobTimelineRows(timelineResult.spans, timelineWindow);

  const pagination = createPagination(paginationInput, listResult.total);
  const selectedRunKey = selectedSpan ? runKey(selectedSpan) : filter.run;
  const overviewRows = filterBackgroundJobRows(buildBackgroundJobRows(scheduleResult.schedules, groups), {
    search: filter.search,
    type: filter.type,
    health: filter.health,
    requireTraceMatch: filter.duration !== "all",
  });
  const labelsBySource = new Map(overviewRows.map((row) => [row.source, row.label]));
  const timelineRows = rawTimelineRows.map((row) => {
    const label = labelsBySource.get(row.source) ?? row.label;
    return {
      label,
      href: sourceUrl(filter, row.source),
      tooltip: label === row.source ? row.source : `${label} (${row.source})`,
      intervals: row.intervals.map((interval) => {
        const statusMessage = interval.statusMessage?.trim();
        const tooltip = [
          interval.name,
          timelineStateLabel[interval.state],
          formatTimestamp(new Date(interval.startedAt)),
          interval.durationMs === null ? null : formatMs(interval.durationMs),
          statusMessage ? statusMessage.slice(0, 160) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          ...interval,
          href: buildJobsFilterUrl(baseUrl, { source: row.source, run: `${interval.traceId}:${interval.spanId}`, page: 1 }, filter),
          tooltip,
        };
      }),
    };
  });

  return () => (
    <AdminLayout c={c} title="Background Jobs">
      <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} />
      <JobsActionToast />
      <div class="app-rows">
        <div class="min-w-0" style="view-transition-name: admin-jobs-title">
          <div class="flex items-center gap-2">
            {filter.source ? (
              <a href={buildJobsFilterUrl(baseUrl, { source: null, run: null, page: 1 }, filter)} class="btn-simple btn-sm text-dimmed">
                <i class="ti ti-arrow-left" />
              </a>
            ) : null}
            <div class="min-w-0">
              <h1 class="truncate text-base font-semibold text-primary">{filter.source ?? "Background Jobs"}</h1>
              <p class="mt-1 text-xs text-dimmed">
                {filter.source
                  ? `Runs for this source in the last ${windowLabel(filter)}.`
                  : "Grouped trace-backed sync jobs, schedules, and manual background work."}
              </p>
            </div>
          </div>
        </div>

        {statsGrid(stats, filter)}

        <section class="paper p-3">
          <h2 class="text-xs font-semibold text-primary">Run timeline</h2>
          <p class="text-[10px] text-dimmed">
            One lane per job, busiest first. Marks sit where the run started; their width is a readability floor, not a duration — most runs
            finish in milliseconds. Drag to pan; use Ctrl/⌘ + wheel or the controls to zoom.
          </p>
          {timelineResult.total > timelineResult.spans.length ? (
            <p class="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
              Showing the latest {formatNumber(timelineResult.spans.length)} of {formatNumber(timelineResult.total)} matching runs. The
              timeline reflects this loaded sample.
            </p>
          ) : null}
          {timelineRows.length === 0 ? (
            <Placeholder variant="compact" description="No runs recorded in this window." />
          ) : (
            <ObservabilityChart
              kind="stateTimeline"
              class="mt-2 w-full text-dimmed"
              rows={timelineRows}
              domain={[timelineWindow.fromMs, timelineWindow.toMs]}
              states={[
                { state: "ok", label: "Succeeded", color: "#10b981" },
                { state: "error", label: "Failed", color: "#ef4444" },
                { state: "running", label: "Running", color: "#3b82f6" },
                { state: "stuck", label: "Never finished", color: "#f59e0b" },
              ]}
              xFormat="timeline"
              legend
              interactive
            />
          )}
        </section>
        <FeedbackBanner feedback={actionFeedback} />
        <ControlWarning error={scheduleResult.error} />

        <section class="paper p-3">
          <JobsFilterBar filter={filter} />
        </section>

        {filter.source ? (
          <div class={selectedSpan ? "grid min-h-0 gap-2 xl:grid-cols-[minmax(0,1fr)_26rem]" : "min-h-0"}>
            <SourceRunsTable
              spans={listResult.spans}
              total={listResult.total}
              pagination={pagination}
              filter={filter}
              selectedRunKey={selectedRunKey}
            />
            {selectedSpan ? <RunDetailPanel span={selectedSpan} events={selectedEvents} closeHref={closeRunUrl(filter)} /> : null}
          </div>
        ) : (
          <OverviewTable rows={overviewRows} filter={filter} />
        )}
      </div>
    </AdminLayout>
  );
});
