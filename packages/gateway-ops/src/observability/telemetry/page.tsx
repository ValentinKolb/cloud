import { listAppsDetailed } from "@valentinkolb/cloud";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { formatNumber as fmtCount, formatDurationMs as fmtMs, formatPercent as fmtRatio } from "@valentinkolb/cloud/shared";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, Placeholder, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import ObservabilityChart from "../../frontend/ObservabilityChart.island";
import { listAppSloWindows } from "../../grids-operational-health";
import { gatewayOpsHelp } from "../../help";
import TelemetryFilterBar, { type TelemetryAppFilterOption } from "./_components/TelemetryFilterBar.island";
import {
  buildTelemetryFilterUrl,
  closeRouteUrl,
  parseTelemetryFilterFromUrl,
  selectRouteUrl,
  type TelemetryFilter,
} from "./_components/types";
import { TELEMETRY_SORT_LABELS } from "./contracts";
import {
  getTelemetryOverview,
  getTelemetryTimeseries,
  listTelemetryApps,
  listTelemetryEvents,
  listTelemetryRoutes,
  SLOW_REQUEST_MS,
  type TelemetryEventRow,
  type TelemetryRouteRow,
  type TelemetryRouteSort,
} from "./service";

/** Individual requests shown once a route is selected. */
const DRILLDOWN_EVENT_LIMIT = 100;

const fmtPercent = (part: number, total: number) => (total === 0 ? "—" : `${((part / total) * 100).toFixed(1)}%`);

const fmtDateTime = (value: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

const legacyTelemetryAppIcons: Record<string, string> = {
  gateway: "ti ti-route-scan",
  logging: "ti ti-list-details",
  notifications: "ti ti-bell-ringing",
  settings: "ti ti-settings",
};

const normalizeIcon = (icon: string | undefined) => {
  if (!icon) return "ti ti-app";
  return icon.startsWith("ti ") ? icon : `ti ${icon}`;
};

/** Error rates only read as a problem above a floor; below it they are noise. */
const isProblemRate = (errors: number, requests: number) => requests >= 20 && errors / requests >= 0.05;

const statusTone = (status: number) => {
  if (status >= 500) return "text-red-500";
  if (status === 429) return "text-violet-600 dark:text-violet-400";
  if (status >= 400) return "text-amber-600 dark:text-amber-400";
  return "text-dimmed";
};

/**
 * DataTable has no sorting of its own, so sortable headers are plain links
 * that swap the `sort` param — server-side ordering, no client state.
 */
const SortableHeader = (props: { filter: TelemetryFilter; sort: TelemetryRouteSort; label: string }) => {
  const active = props.filter.sort === props.sort;
  return (
    <a
      href={buildTelemetryFilterUrl(props.filter, { sort: props.sort })}
      class={`inline-flex items-center gap-1 hover:text-primary ${active ? "text-primary" : "text-dimmed"}`}
      aria-label={`Sort by ${props.label}`}
      title={`Sort by ${props.label}`}
    >
      {props.label}
      {/* Inactive columns keep a dimmed marker so the whole row reads as sortable. */}
      <i class={`ti ti-arrow-down text-[9px] ${active ? "" : "opacity-30"}`} aria-hidden="true" />
    </a>
  );
};

export default ssr<AuthContext>(async (c) => {
  const filter = parseTelemetryFilterFromUrl(new URL(c.req.url));
  const query = { range: filter.range, appId: filter.appId || undefined, route: filter.route || undefined };

  const [overview, timeseries, routes, telemetryApps, registryApps, events, sloWindows] = await Promise.all([
    getTelemetryOverview(query),
    getTelemetryTimeseries(query),
    listTelemetryRoutes(query, filter.sort, { errorsOnly: filter.errorsOnly, slowOnly: filter.slowOnly }),
    listTelemetryApps(filter.range),
    listAppsDetailed(),
    // Raw events are only worth reading once the user picked a route.
    filter.route ? listTelemetryEvents(query, DRILLDOWN_EVENT_LIMIT) : Promise.resolve([]),
    // Availability objectives are per app, so they only mean something once
    // the view is narrowed to one.
    filter.appId ? listAppSloWindows(filter.appId) : Promise.resolve([]),
  ]);

  const registryById = new Map(registryApps.map((app) => [app.id, app]));
  const appOptions: TelemetryAppFilterOption[] = telemetryApps.map((id) => ({
    id,
    label: id,
    icon: normalizeIcon(registryById.get(id)?.icon ?? legacyTelemetryAppIcons[id]),
  }));

  const requestSeries = timeseries.map((point) => ({ x: new Date(point.at).getTime(), y: point.requests }));
  const errorSeries = timeseries.map((point) => ({ x: new Date(point.at).getTime(), y: point.errors }));

  const routeColumns: DataTableColumn<TelemetryRouteRow>[] = [
    { id: "route", header: "Route" },
    { id: "requests", header: <SortableHeader filter={filter} sort="requests" label="Requests" />, align: "right" },
    { id: "errors", header: <SortableHeader filter={filter} sort="errorRate" label="Error rate" />, align: "right" },
    { id: "errorCount", header: <SortableHeader filter={filter} sort="errors" label="Errors" />, align: "right" },
    { id: "slow", header: <SortableHeader filter={filter} sort="slow" label="Slow" />, align: "right" },
    { id: "duration", header: <SortableHeader filter={filter} sort="duration" label="Avg / Max" />, align: "right" },
  ];

  const eventColumns: DataTableColumn<TelemetryEventRow>[] = [
    { id: "time", header: "Time" },
    { id: "method", header: "Method" },
    { id: "status", header: "Status", align: "right" },
    { id: "duration", header: "Duration", align: "right" },
  ];

  return () => (
    <AdminLayout c={c} title="Telemetry">
      <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} />
      <div class="app-rows">
        <div class="min-w-0" style="view-transition-name: admin-telemetry-title">
          <h1 class="text-base font-semibold text-primary">Telemetry</h1>
          <p class="mt-1 text-xs text-dimmed">Which routes are busy, which are failing, and when it changed.</p>
        </div>

        <TelemetryFilterBar filter={filter} apps={appOptions} />

        <StatGrid columns={5}>
          <StatCell value={fmtCount(overview.requests)} label="Requests" sub={filter.range} />
          <StatCell
            value={fmtCount(overview.serverErrors)}
            label="Server errors"
            sub="5xx"
            valueClass={overview.serverErrors > 0 ? "text-red-500" : undefined}
            accent={overview.serverErrors > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
          />
          <StatCell value={fmtCount(overview.clientErrors)} label="Client errors" sub="4xx excl. 429" />
          <StatCell
            value={fmtCount(overview.rateLimited)}
            label="Rate limited"
            sub="429"
            accent={overview.rateLimited > 0 ? { tone: "amber", icon: "ti ti-hand-stop" } : undefined}
          />
          <StatCell
            value={fmtCount(overview.slowRequests)}
            label="Slow"
            sub={`>= ${SLOW_REQUEST_MS}ms`}
            accent={overview.slowRequests > 0 ? { tone: "amber", icon: "ti ti-clock-exclamation" } : undefined}
          />
        </StatGrid>

        <section class="paper p-3">
          <h2 class="text-xs font-semibold text-primary">Traffic</h2>
          <p class="text-[10px] text-dimmed">Requests and failing responses over the selected range.</p>
          <ObservabilityChart
            kind="line"
            class="mt-2 h-72 w-full text-dimmed"
            series={[
              { label: "Requests", data: requestSeries },
              { label: "Errors", data: errorSeries },
            ]}
            xFormat="datetime"
            legend
            area
          />
        </section>

        {sloWindows.length > 0 ? (
          <section class="paper p-3" aria-labelledby="request-slo-title">
            <h2 id="request-slo-title" class="text-xs font-semibold text-primary">
              Request availability
            </h2>
            <p class="text-[10px] text-dimmed">HTTP 5xx and gateway failures consume the 99.9% availability objective.</p>
            <StatGrid columns={3} size="sm">
              {sloWindows.map((window) => {
                const completeSeconds = window.window === "1h" ? 3600 : window.window === "6h" ? 21_600 : 2_592_000;
                const collecting = window.observedSeconds < completeSeconds * 0.95;
                const missed = !collecting && window.requestCount > 0 && window.availabilityRatio < 0.999;
                return (
                  <StatCell
                    label={window.window}
                    value={window.requestCount === 0 ? "No traffic" : fmtRatio(window.availabilityRatio)}
                    sub={
                      collecting
                        ? `${fmtCount(window.requestCount)} requests · collecting history`
                        : `${fmtCount(window.requestCount)} requests`
                    }
                    valueClass={missed ? "text-red-500" : "text-primary"}
                    accent={missed ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
                  />
                );
              })}
            </StatGrid>
          </section>
        ) : null}

        <div class={filter.route ? "grid min-h-0 gap-2 xl:grid-cols-[minmax(0,1fr)_24rem]" : "min-h-0"}>
          <section class="paper overflow-hidden">
            <div class="px-3 py-2">
              <h2 class="text-xs font-semibold text-primary">Routes</h2>
              <p class="text-[10px] text-dimmed">
                Sorted by {TELEMETRY_SORT_LABELS[filter.sort].toLowerCase()} · select a route to inspect its requests
              </p>
            </div>
            <DataTable
              rows={routes}
              columns={routeColumns}
              getRowId={(row) => `${row.appId} ${row.route}`}
              selectedRowId={filter.route ? `${filter.appId} ${filter.route}` : null}
              hoverRows
              highlightColumns={false}
              density="compact"
              class="overflow-x-auto"
              empty="No traffic recorded in this range"
              renderCell={({ row, col }) => {
                if (col.id === "route")
                  return (
                    <a href={selectRouteUrl(filter, row.appId, row.route)} class="flex min-w-0 flex-col hover:text-primary">
                      <code class="truncate text-[10px] text-primary">{row.route}</code>
                      <span class="text-[9px] text-dimmed">{row.appId}</span>
                    </a>
                  );
                if (col.id === "requests") return <span class="text-[10px] tabular-nums text-dimmed">{fmtCount(row.requests)}</span>;
                if (col.id === "errors")
                  return (
                    <span
                      class={`text-[10px] tabular-nums ${isProblemRate(row.errors, row.requests) ? "text-red-500" : "text-dimmed"}`}
                      title={`${fmtCount(row.errors)} of ${fmtCount(row.requests)} requests`}
                    >
                      {row.errors === 0 ? "—" : fmtPercent(row.errors, row.requests)}
                    </span>
                  );
                if (col.id === "errorCount")
                  return <span class="text-[10px] tabular-nums text-dimmed">{row.errors === 0 ? "—" : fmtCount(row.errors)}</span>;
                if (col.id === "slow")
                  return (
                    <span class={`text-[10px] tabular-nums ${row.slowRequests > 0 ? "text-amber-600 dark:text-amber-400" : "text-dimmed"}`}>
                      {row.slowRequests === 0 ? "—" : fmtCount(row.slowRequests)}
                    </span>
                  );
                if (col.id === "duration")
                  return (
                    <span class="text-[10px] tabular-nums text-dimmed">
                      {fmtMs(row.avgDurationMs)} <span class="text-dimmed/60">/</span>{" "}
                      <span
                        class={
                          row.maxDurationMs !== null && row.maxDurationMs >= SLOW_REQUEST_MS ? "text-amber-600 dark:text-amber-400" : ""
                        }
                      >
                        {fmtMs(row.maxDurationMs)}
                      </span>
                    </span>
                  );
                return "";
              }}
            />
          </section>

          {filter.route ? (
            <aside class="paper min-h-0 overflow-y-auto" aria-label="Route detail">
              <div class="flex items-start justify-between gap-2 px-3 py-2">
                <div class="min-w-0">
                  <code class="block truncate text-[11px] text-primary">{filter.route}</code>
                  <p class="text-[10px] text-dimmed">Last {DRILLDOWN_EVENT_LIMIT} requests in this range</p>
                </div>
                <a
                  href={closeRouteUrl(filter)}
                  class="btn-simple btn-sm shrink-0 text-dimmed hover:text-primary"
                  aria-label="Close route detail"
                >
                  <i class="ti ti-x" />
                </a>
              </div>
              {events.length === 0 ? (
                <Placeholder variant="compact" description="No individual requests retained for this range." />
              ) : (
                <DataTable
                  rows={events}
                  columns={eventColumns}
                  getRowId={(row) => String(row.id)}
                  highlightColumns={false}
                  density="compact"
                  renderCell={({ row, col }) => {
                    if (col.id === "time") return <span class="text-[10px] text-dimmed">{fmtDateTime(row.occurredAt)}</span>;
                    if (col.id === "method") return <span class="text-[10px] font-medium text-dimmed">{row.method}</span>;
                    if (col.id === "status")
                      return (
                        <span class={`text-[10px] tabular-nums ${statusTone(row.status)}`} title={row.errorKind ?? undefined}>
                          {row.status}
                        </span>
                      );
                    if (col.id === "duration")
                      return (
                        <span
                          class={`text-[10px] tabular-nums ${row.durationMs >= SLOW_REQUEST_MS ? "text-amber-600 dark:text-amber-400" : "text-dimmed"}`}
                        >
                          {fmtMs(row.durationMs)}
                        </span>
                      );
                    return "";
                  }}
                />
              )}
            </aside>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
});
