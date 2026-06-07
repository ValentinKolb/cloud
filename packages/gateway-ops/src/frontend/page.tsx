import { listAppsDetailed } from "@valentinkolb/cloud";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { latestGatewayRouteSnapshot } from "@valentinkolb/cloud/services";
import { DataTable, type DataTableColumn, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import { listRegisteredAppStatus, type RegisteredAppStatus } from "../registered-apps";
import RemoveRegisteredAppButton from "./RemoveRegisteredAppButton.island";

// ── Helpers ──────────────────────────────────────────────────────────────────

const APP_ICON_CLASSES = "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400";

const timeAgo = (ts: number) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

const fmtUptime = (ms: number) => {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
};

const fmtMs = (ms: number) => {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const Check = () => <i class="ti ti-check text-emerald-500 text-xs" />;
const Dash = () => <i class="ti ti-minus text-zinc-300 dark:text-zinc-600 text-xs" />;

type GatewayAppRow = RegisteredAppStatus & {
  traffic: { count: number; totalMs: number; errors: number } | undefined;
  isHealthy: boolean;
  upSince: number;
};

type GatewayRouteRow = {
  prefix: string;
  appId: string;
  count: number;
  errors: number;
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const isRoutesPage = url.pathname.endsWith("/routes");
  const [liveApps, routerSnapshot] = await Promise.all([
    listAppsDetailed(),
    latestGatewayRouteSnapshot(),
  ]);
  const appTraffic = new Map((routerSnapshot?.stats.byApp ?? []).map((traffic) => [traffic.appId, traffic]));
  const routeHits = new Map((routerSnapshot?.stats.byRoute ?? []).map((route) => [route.prefix, route]));
  const registeredApps = await listRegisteredAppStatus(liveApps);
  const visibleApps = registeredApps.filter((a) => a.id !== "gateway" && a.id !== "gateway-router");

  const navOf = (app: RegisteredAppStatus) => app.live?.nav ?? app.nav;
  const searchOf = (app: RegisteredAppStatus) => app.live?.search ?? app.search;
  const withNav = visibleApps.filter((a) => navOf(a)?.href);
  const withAdmin = visibleApps.filter((a) => navOf(a)?.adminHref);
  const withSearch = visibleApps.filter((a) => searchOf(a));
  const healthy = visibleApps.filter((a) => a.live && a.live.expiresAt - Date.now() > 30_000);
  const appCount = visibleApps.length;
  const offlineCount = visibleApps.filter((a) => !a.isOnline).length;

  const appRows = visibleApps
    .map((app) => {
      const traffic = appTraffic.get(app.id);
      const isHealthy = Boolean(app.live && app.live.expiresAt - Date.now() > 30_000);
      const upSince = app.live ? Math.max(0, Date.now() - app.live.createdAt) : app.offlineForMs;
      return { ...app, traffic, isHealthy, upSince };
    })
    .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || (b.traffic?.count ?? 0) - (a.traffic?.count ?? 0));

  // Route data with hit counts, server-side filtered
  const searchQuery = url.searchParams.get("search")?.toLowerCase().trim() ?? "";
  const allRoutes = (routerSnapshot?.routes ?? [])
    .map((r) => {
      const hit = routeHits.get(r.prefix);
      return { prefix: r.prefix, appId: r.appId, count: hit?.count ?? 0, errors: hit?.errors ?? 0 };
    })
    .sort((a, b) => b.count - a.count);
  const filteredRoutes = searchQuery ? allRoutes.filter((r) => r.prefix.includes(searchQuery) || r.appId.includes(searchQuery)) : allRoutes;
  const appColumns: DataTableColumn<GatewayAppRow>[] = [
    { id: "app", header: "App", value: (app) => app.name },
    { id: "status", header: "Status", value: (app) => app.isOnline, headerClass: "text-center", cellClass: "text-center" },
    { id: "baseUrl", header: "Base URL", value: (app) => app.baseUrl },
    { id: "nav", header: "Nav", value: (app) => app.nav?.href, headerClass: "text-center", cellClass: "text-center" },
    { id: "admin", header: "Admin", value: (app) => app.nav?.adminHref, headerClass: "text-center", cellClass: "text-center" },
    { id: "search", header: "Search", value: (app) => app.search, headerClass: "text-center", cellClass: "text-center" },
    {
      id: "heartbeat",
      header: "Heartbeat",
      value: (app) => app.updatedAt,
      headerClass: "text-right",
      cellClass: "text-right whitespace-nowrap",
    },
    {
      id: "upSince",
      header: "Up since",
      value: (app) => app.upSince,
      headerClass: "text-right",
      cellClass: "text-right whitespace-nowrap",
    },
    {
      id: "requests",
      header: "Requests",
      value: (app) => app.traffic?.count,
      headerClass: "text-right",
      cellClass: "text-right tabular-nums",
    },
    {
      id: "latency",
      header: "Latency",
      value: (app) => (app.traffic ? app.traffic.totalMs / app.traffic.count : null),
      headerClass: "text-right",
      cellClass: "text-right tabular-nums",
    },
    {
      id: "errors",
      header: "Errors",
      value: (app) => app.traffic?.errors,
      headerClass: "text-right",
      cellClass: "text-right tabular-nums",
    },
    {
      id: "actions",
      header: <span class="sr-only">Actions</span>,
      headerClass: "text-right",
      cellClass: "text-right whitespace-nowrap max-w-none",
    },
  ];
  const routeColumns: DataTableColumn<GatewayRouteRow>[] = [
    { id: "prefix", header: "Prefix", value: (route) => route.prefix },
    { id: "app", header: "App", value: (route) => route.appId },
    { id: "hits", header: "Hits", value: (route) => route.count, headerClass: "text-right", cellClass: "text-right tabular-nums" },
    { id: "errors", header: "Errors", value: (route) => route.errors, headerClass: "text-right", cellClass: "text-right tabular-nums" },
  ];
  return () => (
    <AdminLayout c={c} title={isRoutesPage ? "Routes" : "Apps"} stretch>
      <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-gateway-title">
            <h1 class="text-base font-semibold text-primary">{isRoutesPage ? "Routes" : "Apps"}</h1>
            <p class="mt-1 text-xs text-dimmed">
              {isRoutesPage ? "Route prefixes currently served by the gateway router." : "Registered apps and their current gateway health."}
            </p>
          </div>

          {/* ── Stats — see skills/cloud-app/references/frontend.md § Stats ── */}
          <StatGrid columns={6}>
            <StatCell value={appCount} label="Apps" sub={`${withNav.length} nav · ${withAdmin.length} admin`} />
            <StatCell value={routerSnapshot?.routeCount ?? 0} label="Routes" sub={routerSnapshot ? `v${routerSnapshot.tableVersion}` : "no router"} />
            <StatCell
              value={fmtCount(routerSnapshot?.stats.totalRequests ?? 0)}
              label="Requests"
              sub={`${routerSnapshot?.stats.noRouteCount ?? 0} unmatched`}
              accent={(routerSnapshot?.stats.noRouteCount ?? 0) > 0 ? { tone: "amber", icon: "ti ti-alert-triangle" } : undefined}
            />
            <StatCell value={withSearch.length} label="Search" sub="providers" />
            <StatCell
              value={routerSnapshot ? fmtUptime(Date.now() - routerSnapshot.startedAt) : "—"}
              label="Uptime"
              sub={
                routerSnapshot
                  ? `since ${new Date(routerSnapshot.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "no router snapshot"
              }
            />
            <StatCell
              value={`${healthy.length}/${appCount}`}
              label="Healthy"
              sub={
                healthy.length === appCount
                  ? "all systems"
                  : `${offlineCount} offline · ${appCount - healthy.length - offlineCount} degraded`
              }
              accent={healthy.length === appCount ? { tone: "emerald", icon: "ti ti-check" } : { tone: "red", icon: "ti ti-alert-circle" }}
            />
          </StatGrid>

          {/* ── Apps Table ── */}
          {!isRoutesPage ? (
            <DataTable
              rows={appRows}
              columns={appColumns}
              getRowId={(app) => app.id}
              hoverRows
              highlightColumns={false}
              rowClass={(app) => (app.isHealthy ? "" : "bg-red-50/50 dark:bg-red-950/20")}
              class="paper overflow-x-auto"
              tableClass="w-full text-sm"
              renderCell={({ row: app, col }) => {
              if (col.id === "app") {
                return (
                  <div class="flex items-center gap-2">
                    <div class={`w-6 h-6 rounded grid place-items-center shrink-0 ${APP_ICON_CLASSES}`}>
                      <i class={`${app.icon} text-[10px]`} />
                    </div>
                    <span class="font-medium text-primary text-xs">{app.name}</span>
                    <code class="text-[9px] text-dimmed">{app.id}</code>
                  </div>
                );
              }
              if (col.id === "baseUrl") return <code class="text-[10px] text-dimmed">{app.baseUrl}</code>;
              if (col.id === "status") {
                return app.isOnline ? (
                  <span class="inline-flex items-center justify-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <i class="ti ti-heartbeat text-[9px]" /> live
                  </span>
                ) : (
                  <span class="inline-flex items-center justify-center gap-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-500">
                    <i class="ti ti-plug-off text-[9px]" /> offline
                  </span>
                );
              }
              if (col.id === "nav") return navOf(app)?.href ? <Check /> : <Dash />;
              if (col.id === "admin") {
                const adminHref = navOf(app)?.adminHref;
                return adminHref ? (
                  <a href={adminHref} class="text-emerald-500 hover:text-emerald-700">
                    <i class="ti ti-check text-xs" />
                  </a>
                ) : (
                  <Dash />
                );
              }
              if (col.id === "search") return searchOf(app) ? <Check /> : <Dash />;
              if (col.id === "heartbeat") {
                return (
                  <span class={`text-[10px] ${app.isHealthy ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    <i class={`ti ${app.isHealthy ? "ti-heartbeat" : "ti-alert-triangle"} text-[9px]`} />{" "}
                    {app.isOnline ? timeAgo(app.live!.updatedAt) : `last ${timeAgo(app.lastSeenAt)}`}
                  </span>
                );
              }
              if (col.id === "upSince") {
                return (
                  <span
                    class={`text-[10px] tabular-nums ${app.isHealthy ? "text-dimmed" : "text-red-500"}`}
                    title={new Date(app.live?.createdAt ?? app.lastSeenAt).toLocaleString()}
                  >
                    {fmtUptime(app.upSince)}
                  </span>
                );
              }
              if (col.id === "requests") return <span class="text-xs text-dimmed">{app.traffic ? fmtCount(app.traffic.count) : "—"}</span>;
              if (col.id === "latency") {
                return (
                  <span class="text-xs tabular-nums text-dimmed">
                    {app.traffic && app.traffic.count > 0 ? fmtMs(app.traffic.totalMs / app.traffic.count) : "—"}
                  </span>
                );
              }
              if (col.id === "errors") {
                return app.traffic && app.traffic.errors > 0 ? (
                  <span class="text-xs tabular-nums text-red-500">
                    {app.traffic.errors} <span class="text-[9px]">({((app.traffic.errors / app.traffic.count) * 100).toFixed(0)}%)</span>
                  </span>
                ) : (
                  <span class="text-xs text-dimmed">—</span>
                );
              }
              if (col.id === "actions") {
                return <RemoveRegisteredAppButton id={app.id} name={app.name} disabled={app.isOnline} />;
              }
                return "";
              }}
            />
          ) : null}

          {/* ── Routes: title + search + table (same pattern as logs) ── */}
          {isRoutesPage ? (
            <>
              <div class="min-w-0">
                <p class="text-xs text-dimmed">
                  {searchQuery ? `${filteredRoutes.length} of ${allRoutes.length} routes` : `${allRoutes.length} routes`}
                </p>
              </div>

              <SearchBar
                action="/admin/gateway/routes"
                value={searchQuery}
                placeholder="Filter routes by prefix or app..."
                ariaLabel="Filter routes"
              />

              <DataTable
                rows={filteredRoutes}
                columns={routeColumns}
                getRowId={(route) => route.prefix}
                hoverRows
                highlightColumns={false}
                density="compact"
                class="paper overflow-x-auto"
                empty={`No routes match "${searchQuery}"`}
                renderCell={({ row: route, col }) => {
              if (col.id === "prefix") return <code class="text-[10px] text-primary">{route.prefix}</code>;
              if (col.id === "app") return <span class="text-[10px] text-dimmed">{route.appId}</span>;
              if (col.id === "hits")
                return <span class="text-[10px] text-dimmed">{route.count > 0 ? route.count.toLocaleString() : "—"}</span>;
              if (col.id === "errors") {
                return route.errors > 0 ? (
                  <span class="text-[10px] tabular-nums text-red-500">{route.errors}</span>
                ) : (
                  <span class="text-[10px] text-dimmed">—</span>
                );
              }
                  return "";
                }}
              />
            </>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
});
