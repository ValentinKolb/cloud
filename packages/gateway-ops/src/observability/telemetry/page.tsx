import { listAppsDetailed } from "@valentinkolb/cloud";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { createPagination } from "@valentinkolb/cloud/contracts";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, Pagination, StatCell, StatGrid, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import { getTelemetrySummary, listTelemetryApps, listTelemetryEvents, type TelemetryEventRow } from "../../telemetry";
import TelemetryFilterBar, { type TelemetryAppFilterOption } from "./TelemetryFilterBar.island";

const fmtMs = (ms: number | null) => {
  if (ms === null) return "-";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const fmtDate = (value: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
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

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const params = url.searchParams;
  const search = params.get("search")?.trim() ?? "";
  const appId = params.get("app")?.trim() ?? "";
  const slowOnly = params.get("slow") === "1";
  const errorsOnly = params.get("errors") === "1";
  const page = Math.max(1, Number(params.get("page") ?? "1"));
  const perPage = 100;

  const [summary, telemetryApps, registryApps, events] = await Promise.all([
    getTelemetrySummary(),
    listTelemetryApps(),
    listAppsDetailed(),
    listTelemetryEvents({ search, appId, slowOnly, errorsOnly, page, perPage }),
  ]);
  const registryById = new Map(registryApps.map((app) => [app.id, app]));
  const appOptions: TelemetryAppFilterOption[] = telemetryApps.map((id) => {
    const app = registryById.get(id);
    return {
      id,
      label: id,
      icon: normalizeIcon(app?.icon ?? legacyTelemetryAppIcons[id]),
    };
  });
  const pagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, events.total);
  const baseParams = new URLSearchParams(params);
  baseParams.delete("page");
  const baseUrl = baseParams.toString() ? `/admin/observability/telemetry?${baseParams.toString()}&page=` : "/admin/observability/telemetry?page=";

  const columns: DataTableColumn<TelemetryEventRow>[] = [
    { id: "time", header: "Time", value: (row) => row.occurredAt, cellClass: "whitespace-nowrap" },
    { id: "app", header: "App", value: (row) => row.appId },
    { id: "route", header: "Route", value: (row) => row.routePrefix },
    { id: "method", header: "Method", value: (row) => row.method },
    { id: "status", header: "Status", value: (row) => row.status, headerClass: "text-right", cellClass: "text-right" },
    { id: "duration", header: "Duration", value: (row) => row.durationMs, headerClass: "text-right", cellClass: "text-right" },
    { id: "error", header: "Error", value: (row) => row.errorKind },
  ];

  return () => (
    <AdminLayout c={c} title="Telemetry" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-telemetry-title">
            <h1 class="text-base font-semibold text-primary">Telemetry</h1>
            <p class="mt-1 text-xs text-dimmed">Request events, slow routes, and gateway errors.</p>
          </div>

          <StatGrid columns={5}>
            <StatCell value={summary.requests.toLocaleString()} label="Requests" sub="last 24h" />
            <StatCell value={summary.errors.toLocaleString()} label="Errors" sub="last 24h" accent={summary.errors > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined} />
            <StatCell value={summary.slowRequests.toLocaleString()} label="Slow" sub=">= 800ms" accent={summary.slowRequests > 0 ? { tone: "amber", icon: "ti ti-clock-exclamation" } : undefined} />
            <StatCell value={fmtMs(summary.avgDurationMs)} label="Average" sub="request time" />
            <StatCell value={fmtMs(summary.p95DurationMs)} label="P95" sub="request time" />
          </StatGrid>

          <SearchBar action="/admin/observability/telemetry" value={search} placeholder="Search app, route, method, or error..." ariaLabel="Search telemetry" />

          <TelemetryFilterBar search={search} appId={appId} slowOnly={slowOnly} errorsOnly={errorsOnly} apps={appOptions} />

          <DataTable
            rows={events.items}
            columns={columns}
            getRowId={(row) => String(row.id)}
            hoverRows
            highlightColumns={false}
            density="compact"
            class="paper overflow-x-auto"
            empty="No telemetry events match the current filters"
            renderCell={({ row, col }) => {
              if (col.id === "time") return <span class="text-[10px] text-dimmed">{fmtDate(row.occurredAt)}</span>;
              if (col.id === "app") return <span class="text-[10px] text-dimmed">{row.appId}</span>;
              if (col.id === "route") return <code class="text-[10px] text-primary">{row.routePrefix}</code>;
              if (col.id === "method") return <span class="text-[10px] font-medium text-dimmed">{row.method}</span>;
              if (col.id === "status") return <span class={`text-[10px] tabular-nums ${row.status >= 500 ? "text-red-500" : row.status >= 400 ? "text-amber-600 dark:text-amber-400" : "text-dimmed"}`}>{row.status}</span>;
              if (col.id === "duration") return <span class={`text-[10px] tabular-nums ${row.durationMs >= 800 ? "text-amber-600 dark:text-amber-400" : "text-dimmed"}`}>{fmtMs(row.durationMs)}</span>;
              if (col.id === "error") return row.errorKind ? <span class="text-[10px] text-red-500">{row.errorKind}</span> : <span class="text-[10px] text-dimmed">-</span>;
              return "";
            }}
          />

          <Pagination currentPage={pagination.page} totalPages={pagination.total_pages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
