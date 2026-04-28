import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import { hasRole } from "@valentinkolb/cloud/contracts";
import type { WidgetResponse, WidgetBlock } from "@valentinkolb/cloud/contracts";
import { listAppsDetailed } from "@valentinkolb/cloud";
import { getGatewayStats, getRouteTable } from "./stats";

const fmtUptime = (ms: number): string => {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
};

const fmtCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Platform health widget — admin only. Status banner reflects whether every
 * registered app has a fresh heartbeat; pills carry route + traffic numbers
 * so the admin gets the gateway summary without leaving the dashboard.
 */
export const widgetRoutes = new Hono<AuthContext>()
  .use(auth.requireRole("*"))
  .get("/health", async (c) => {
    const user = c.get("user");
    // 403 = admin-only widget; non-admins see it as locked in the dashboard modal.
    if (!user || !hasRole(user, "admin")) return c.body(null, 403);

    const apps = await listAppsDetailed();
    const stats = getGatewayStats();
    const table = getRouteTable();

    const otherApps = apps.filter((a) => a.id !== "gateway");
    const total = otherApps.length;
    const healthy = otherApps.filter((a) => a.expiresAt - Date.now() > 30_000);
    const degraded = total - healthy.length;

    const tone: "ok" | "warn" | "error" =
      degraded === 0 ? "ok" : degraded === total ? "error" : "warn";

    const blocks: WidgetBlock[] = [
      {
        kind: "status",
        grow: true,
        tone,
        title:
          degraded === 0
            ? "All systems operational"
            : `${degraded} of ${total} apps degraded`,
        message: `Gateway up ${fmtUptime(Date.now() - stats.startedAt)} · ${total} apps registered`,
      },
      {
        kind: "pills",
        pills: [
          { label: "apps", value: `${healthy.length}/${total}`, tone: degraded === 0 ? "emerald" : "amber" },
          { label: "routes", value: table.routeCount },
          { label: "req", value: fmtCount(stats.totalRequests) },
          ...(stats.noRouteCount > 0
            ? [{ label: "unmatched", value: stats.noRouteCount, tone: "amber" as const }]
            : []),
        ],
      },
    ];

    const body: WidgetResponse = {
      title: "Platform health",
      icon: "ti ti-heartbeat",
      href: "/admin/gateway",
      blocks,
    };
    return c.json(body);
  });
