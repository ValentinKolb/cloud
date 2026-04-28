import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { listAppsDetailed, type AppRegistryDetail } from "@valentinkolb/cloud";
import { getGatewayStats, getRouteTable } from "../stats";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { StatCell } from "@valentinkolb/cloud/ui";

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default ssr<AuthContext>(async (c) => {
  const apps = await listAppsDetailed();
  const stats = getGatewayStats();
  const table = getRouteTable();

  const withNav = apps.filter((a) => a.nav?.href);
  const withAdmin = apps.filter((a) => a.nav?.adminHref);
  const withSearch = apps.filter((a) => a.search);
  const healthy = apps.filter((a) => a.id !== "gateway" && a.expiresAt - Date.now() > 30_000);
  const appCount = apps.length - 1; // exclude gateway itself

  const appRows = apps
    .filter((a) => a.id !== "gateway")
    .map((app) => {
      const traffic = stats.byApp.get(app.id);
      const ttlRemaining = Math.max(0, app.expiresAt - Date.now());
      const isHealthy = ttlRemaining > 30_000;
      const upSince = Math.max(0, Date.now() - app.createdAt);
      return { ...app, traffic, ttlRemaining, isHealthy, upSince };
    })
    .sort((a, b) => (b.traffic?.count ?? 0) - (a.traffic?.count ?? 0));

  // Route data with hit counts, server-side filtered
  const searchQuery = new URL(c.req.url).searchParams.get("search")?.toLowerCase().trim() ?? "";
  const allRoutes = table.routes
    .map((r) => {
      const hit = stats.byRoute.get(r.prefix);
      return { prefix: r.prefix, appId: r.appId, count: hit?.count ?? 0, errors: hit?.errors ?? 0 };
    })
    .sort((a, b) => b.count - a.count);
  const filteredRoutes = searchQuery
    ? allRoutes.filter((r) => r.prefix.includes(searchQuery) || r.appId.includes(searchQuery))
    : allRoutes;

  return () => (
    <AdminLayout c={c} title="Apps & Gateway" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-gateway-title">
            <h1 class="text-base font-semibold text-primary">Apps & Gateway</h1>
          </div>

          {/* ── Stats — see skills/cloud-app/references/frontend.md § Stats ── */}
          <div class="paper overflow-hidden">
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px p-px bg-zinc-100 dark:bg-zinc-800">
              <StatCell value={appCount} label="Apps" sub={`${withNav.length} nav · ${withAdmin.length} admin`} />
              <StatCell value={table.routeCount} label="Routes" sub={`v${table.version}`} />
              <StatCell
                value={fmtCount(stats.totalRequests)}
                label="Requests"
                sub={`${stats.noRouteCount} unmatched`}
                accent={stats.noRouteCount > 0 ? { tone: "amber", icon: "ti ti-alert-triangle" } : undefined}
              />
              <StatCell value={withSearch.length} label="Search" sub="providers" />
              <StatCell
                value={fmtUptime(Date.now() - stats.startedAt)}
                label="Uptime"
                sub={`since ${new Date(stats.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
              />
              <StatCell
                value={`${healthy.length}/${appCount}`}
                label="Healthy"
                sub={healthy.length === appCount ? "all systems" : `${appCount - healthy.length} degraded`}
                accent={
                  healthy.length === appCount
                    ? { tone: "emerald", icon: "ti ti-check" }
                    : { tone: "red", icon: "ti ti-alert-circle" }
                }
              />
            </div>
          </div>

          {/* ── Apps Table ── */}
          <div class="paper overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-zinc-100 dark:border-zinc-800 text-[10px] uppercase tracking-wider text-dimmed">
                  <th class="text-left px-3 py-2 font-medium">App</th>
                  <th class="text-left px-3 py-2 font-medium">Base URL</th>
                  <th class="text-center px-3 py-2 font-medium">Nav</th>
                  <th class="text-center px-3 py-2 font-medium">Admin</th>
                  <th class="text-center px-3 py-2 font-medium">Search</th>
                  <th class="text-right px-3 py-2 font-medium">Heartbeat</th>
                  <th class="text-right px-3 py-2 font-medium">Up since</th>
                  <th class="text-right px-3 py-2 font-medium">Requests</th>
                  <th class="text-right px-3 py-2 font-medium">Latency</th>
                  <th class="text-right px-3 py-2 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
                {appRows.map((app) => (
                  <tr class={app.isHealthy ? "" : "bg-red-50/50 dark:bg-red-950/20"}>
                    <td class="px-3 py-2">
                      <div class="flex items-center gap-2">
                        <div class={`w-6 h-6 rounded grid place-items-center shrink-0 ${APP_ICON_CLASSES}`}>
                          <i class={`${app.icon} text-[10px]`} />
                        </div>
                        <span class="font-medium text-primary text-xs">{app.name}</span>
                        <code class="text-[9px] text-dimmed">{app.id}</code>
                      </div>
                    </td>
                    <td class="px-3 py-2"><code class="text-[10px] text-dimmed">{app.baseUrl}</code></td>
                    <td class="px-3 py-2 text-center">{app.nav?.href ? <Check /> : <Dash />}</td>
                    <td class="px-3 py-2 text-center">
                      {app.nav?.adminHref ? (
                        <a href={app.nav.adminHref} class="text-emerald-500 hover:text-emerald-700"><i class="ti ti-check text-xs" /></a>
                      ) : <Dash />}
                    </td>
                    <td class="px-3 py-2 text-center">{app.search ? <Check /> : <Dash />}</td>
                    <td class="px-3 py-2 text-right">
                      <span class={`text-[10px] ${app.isHealthy ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                        <i class={`ti ${app.isHealthy ? "ti-heartbeat" : "ti-alert-triangle"} text-[9px]`} /> {timeAgo(app.updatedAt)}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-right">
                      <span class={`text-[10px] tabular-nums ${app.isHealthy ? "text-dimmed" : "text-red-500"}`} title={new Date(app.createdAt).toLocaleString()}>
                        {fmtUptime(app.upSince)}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-right">
                      <span class="text-xs tabular-nums text-dimmed">{app.traffic ? fmtCount(app.traffic.count) : "—"}</span>
                    </td>
                    <td class="px-3 py-2 text-right">
                      <span class="text-xs tabular-nums text-dimmed">
                        {app.traffic && app.traffic.count > 0 ? fmtMs(app.traffic.totalMs / app.traffic.count) : "—"}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-right">
                      {app.traffic && app.traffic.errors > 0 ? (
                        <span class="text-xs tabular-nums text-red-500">
                          {app.traffic.errors} <span class="text-[9px]">({((app.traffic.errors / app.traffic.count) * 100).toFixed(0)}%)</span>
                        </span>
                      ) : <span class="text-xs text-dimmed">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Routes: title + search + table (same pattern as logging app) ── */}
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-primary">Routes</h2>
            <p class="mt-0.5 text-xs text-dimmed">
              {searchQuery
                ? `${filteredRoutes.length} of ${allRoutes.length} routes`
                : `${allRoutes.length} routes`}
            </p>
          </div>

          <SearchBar
            action="/admin/gateway"
            value={searchQuery}
            placeholder="Filter routes by prefix or app..."
            ariaLabel="Filter routes"
          />

          <div class="paper overflow-hidden">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-white dark:bg-zinc-900 z-10">
                <tr class="text-[10px] uppercase tracking-wider text-dimmed border-b border-zinc-100 dark:border-zinc-800">
                  <th class="text-left px-3 py-1.5 font-medium">Prefix</th>
                  <th class="text-left px-3 py-1.5 font-medium">App</th>
                  <th class="text-right px-3 py-1.5 font-medium">Hits</th>
                  <th class="text-right px-3 py-1.5 font-medium">Errors</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-50 dark:divide-zinc-800/50">
                {filteredRoutes.map((r) => (
                  <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                    <td class="px-3 py-1"><code class="text-[10px] text-primary">{r.prefix}</code></td>
                    <td class="px-3 py-1"><span class="text-[10px] text-dimmed">{r.appId}</span></td>
                    <td class="px-3 py-1 text-right">
                      <span class="text-[10px] tabular-nums text-dimmed">{r.count > 0 ? r.count.toLocaleString() : "—"}</span>
                    </td>
                    <td class="px-3 py-1 text-right">
                      {r.errors > 0
                        ? <span class="text-[10px] tabular-nums text-red-500">{r.errors}</span>
                        : <span class="text-[10px] text-dimmed">—</span>}
                    </td>
                  </tr>
                ))}
                {filteredRoutes.length === 0 ? (
                  <tr>
                    <td colspan={4} class="px-3 py-4 text-center text-dimmed text-[10px]">
                      No routes match "{searchQuery}"
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
});
