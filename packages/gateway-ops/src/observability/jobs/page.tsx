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
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, Pagination, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import JobsFilterBar from "./_components/JobsFilterBar.island";
import {
  buildJobsFilterUrl,
  type JobsFilterState,
  jobsDurationOptions,
  jobsWindowOptions,
  minDurationFromFilter,
  parseJobsFilterFromUrl,
} from "./_components/types";

const baseUrl = "/admin/observability/jobs";
const numberFormat = new Intl.NumberFormat("de-DE");
const percentFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

const formatNumber = (value: number): string => numberFormat.format(Math.round(value));
const formatPercent = (value: number): string => `${percentFormat.format(value)}%`;

const formatMs = (ms: number | null): string => {
  if (ms === null) return "-";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / (60 * 60_000)).toFixed(1)}h`;
};

const formatDate = (value: string | null): string => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
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
  if (group.running > 0) return statusBadge({ status: "running", running: true });
  if (group.failed > 0) return statusBadge({ status: "error" });
  return statusBadge({ status: "ok" });
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

const prettyJson = (value: Record<string, unknown> | null): string | null => (value ? JSON.stringify(value, null, 2) : null);

const paginationBaseUrl = (filter: JobsFilterState): string => {
  const url = buildJobsFilterUrl(baseUrl, { page: 1, run: null }, filter);
  return url.includes("?") ? `${url}&page=` : `${url}?page=`;
};

const sourceUrl = (filter: JobsFilterState, source: string): string => buildJobsFilterUrl(baseUrl, { source, page: 1, run: null }, filter);

const runUrl = (filter: JobsFilterState, span: TraceSpan): string => buildJobsFilterUrl(baseUrl, { run: runKey(span) }, filter);

const closeRunUrl = (filter: JobsFilterState): string => buildJobsFilterUrl(baseUrl, { run: null }, filter);

const statsGrid = (stats: TraceRunStats, filter: JobsFilterState) => (
  <StatGrid columns={5}>
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
      sub="open spans"
      accent={stats.running > 0 ? { tone: "blue", icon: "ti ti-loader" } : undefined}
    />
    <StatCell label="P99" value={formatMs(stats.p99DurationMs)} sub={`avg ${formatMs(stats.avgDurationMs)}`} />
  </StatGrid>
);

const groupColumns: DataTableColumn<TraceSourceGroup>[] = [
  { id: "source", header: "Source", value: (row) => row.source, cellClass: "min-w-[260px]" },
  { id: "health", header: "Health", value: (row) => row.failed },
  { id: "runs", header: "Runs", value: (row) => row.runs, headerClass: "text-right", cellClass: "text-right" },
  {
    id: "failed",
    header: "Failed",
    subtitle: "error rate",
    value: (row) => row.failed,
    headerClass: "text-right",
    cellClass: "text-right",
  },
  {
    id: "runtime",
    header: "Runtime",
    subtitle: "avg / p99",
    value: (row) => row.avgDurationMs,
    headerClass: "text-right",
    cellClass: "text-right",
  },
  { id: "types", header: "Types", value: (row) => row.categories.join(", ") },
  { id: "latest", header: "Latest", value: (row) => row.latestStartedAt, cellClass: "whitespace-nowrap" },
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
  const parts = [`${formatNumber(group.jobRuns)} job`, `${formatNumber(group.scheduleRuns)} schedule`];
  if (group.aiRuns) parts.push(`${formatNumber(group.aiRuns)} ai`);
  if (group.customRuns) parts.push(`${formatNumber(group.customRuns)} custom`);
  return parts.join(" · ");
};

const OverviewTable = (props: { groups: TraceSourceGroup[]; filter: JobsFilterState }) => (
  <section class="paper overflow-hidden">
    <div class="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
      <h2 class="text-xs font-semibold text-primary">Job families</h2>
      <p class="text-[10px] text-dimmed">Grouped by source. Schedule definition spans are excluded from runtime statistics.</p>
    </div>
    <DataTable
      rows={props.groups}
      columns={groupColumns}
      getRowId={(row) => row.source}
      hoverRows
      highlightColumns={false}
      density="compact"
      class="overflow-x-auto"
      empty="No background job sources match the current filters"
      renderCell={({ row, col }) => {
        if (col.id === "source")
          return (
            <a href={sourceUrl(props.filter, row.source)} class="block min-w-0 hover:text-blue-600 dark:hover:text-blue-300">
              <span class="block truncate text-[11px] font-medium text-primary">{row.source}</span>
              <span class="block truncate text-[10px] text-dimmed">{row.latestName ?? sourceSubtitle(row)}</span>
            </a>
          );
        if (col.id === "health") return groupHealth(row);
        if (col.id === "runs") return <span class="text-[10px] tabular-nums text-dimmed">{formatNumber(row.runs)}</span>;
        if (col.id === "failed")
          return (
            <span class="text-[10px] tabular-nums text-dimmed">
              {formatNumber(row.failed)} · {formatPercent(row.errorRate)}
            </span>
          );
        if (col.id === "runtime")
          return (
            <span class="text-[10px] tabular-nums text-dimmed">
              {formatMs(row.avgDurationMs)} / {formatMs(row.p99DurationMs)}
            </span>
          );
        if (col.id === "types") return <span class="text-[10px] text-dimmed">{sourceSubtitle(row)}</span>;
        if (col.id === "latest") return <span class="text-[10px] text-dimmed">{formatDate(row.latestStartedAt)}</span>;
        return "";
      }}
    />
  </section>
);

const RunDetailPanel = (props: { span: TraceSpan; events: TraceEvent[]; closeHref: string }) => {
  const attributes = prettyJson(props.span.attributes);
  const summary = prettyJson(props.span.summary);
  return (
    <aside class="paper min-h-0 overflow-y-auto">
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

        {summary ? (
          <section class="detail-section">
            <h3 class="detail-section-label">Summary</h3>
            <pre class="max-h-72 overflow-auto rounded-md bg-zinc-50 p-2 text-[10px] text-primary dark:bg-zinc-950">{summary}</pre>
          </section>
        ) : null}

        {attributes ? (
          <section class="detail-section">
            <h3 class="detail-section-label">Attributes</h3>
            <pre class="max-h-72 overflow-auto rounded-md bg-zinc-50 p-2 text-[10px] text-primary dark:bg-zinc-950">{attributes}</pre>
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
                  {event.attributes ? (
                    <pre class="mt-1 max-h-40 overflow-auto rounded bg-zinc-50 p-1.5 text-[10px] text-primary dark:bg-zinc-950">
                      {JSON.stringify(event.attributes, null, 2)}
                    </pre>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </aside>
  );
};

const SourceRunsTable = (props: {
  spans: TraceSpan[];
  total: number;
  pagination: ReturnType<typeof createPagination>;
  filter: JobsFilterState;
  selectedRunKey: string | null;
}) => (
  <section class="paper overflow-hidden">
    <div class="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
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
    <div class="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
      <Pagination currentPage={props.pagination.page} totalPages={props.pagination.total_pages} baseUrl={paginationBaseUrl(props.filter)} />
    </div>
  </section>
);

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const filter = parseJobsFilterFromUrl(url);
  const traceFilter = traceFilterFromJobs(filter);
  const perPage = 100;
  const paginationInput = { page: filter.page, perPage, offset: (filter.page - 1) * perPage };
  const selectedRun = parseRunKey(filter.run);

  const [stats, groups, listResult, selectedSpan, selectedEvents] = await Promise.all([
    trace.stats({ filter: traceFilter }),
    filter.source ? Promise.resolve([]) : trace.sourceGroups({ filter: traceFilter }),
    filter.source ? trace.list(paginationInput, { filter: traceFilter }) : Promise.resolve({ spans: [], total: 0 }),
    selectedRun ? trace.getSpan(selectedRun) : Promise.resolve(null),
    selectedRun ? trace.events({ ...selectedRun, limit: 200 }) : Promise.resolve([]),
  ]);
  const pagination = createPagination(paginationInput, listResult.total);
  const selectedRunKey = selectedSpan ? runKey(selectedSpan) : filter.run;

  return () => (
    <AdminLayout c={c} title="Background Jobs" stretch>
      <GatewayOpsLayoutHelp />
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
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
            <OverviewTable groups={groups} filter={filter} />
          )}
        </div>
      </div>
    </AdminLayout>
  );
});
