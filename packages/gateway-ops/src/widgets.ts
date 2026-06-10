import { listAppsDetailed } from "@valentinkolb/cloud";
import type { WidgetBlock, WidgetResponse } from "@valentinkolb/cloud/contracts";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { latestGatewayRouteSnapshot } from "@valentinkolb/cloud/services";
import { Hono } from "hono";
import { listRegisteredAppStatus } from "./registered-apps";

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
export const widgetRoutes = new Hono<AuthContext>().use(auth.requireRole("*")).get("/health", async (c) => {
  const actor = c.get("actor") as AuthContext["Variables"]["actor"] | undefined;
  const user = actor?.kind === "user" ? actor.user : actor?.delegatedUser;
  // 403 = admin-only widget; non-admins see it as locked in the dashboard modal.
  if (!user || !hasRole(user, "admin")) return c.body(null, 403);

  const [liveApps, snapshot] = await Promise.all([listAppsDetailed(), latestGatewayRouteSnapshot()]);
  const apps = await listRegisteredAppStatus(liveApps);

  const otherApps = apps.filter((a) => a.id !== "gateway" && a.id !== "gateway-router");
  const total = otherApps.length;
  const healthy = otherApps.filter((a) => a.live && a.live.expiresAt - Date.now() > 30_000);
  const degraded = total - healthy.length;

  const tone: "ok" | "warn" | "error" = degraded === 0 ? "ok" : degraded === total ? "error" : "warn";

  const blocks: WidgetBlock[] = [
    {
      kind: "status",
      grow: true,
      tone,
      title: degraded === 0 ? "All systems operational" : `${degraded} of ${total} apps degraded`,
      message: snapshot
        ? `Gateway up ${fmtUptime(Date.now() - snapshot.startedAt)} · ${total} apps registered`
        : `${total} apps registered · no gateway router snapshot`,
    },
    {
      kind: "pills",
      pills: [
        { label: "apps", value: `${healthy.length}/${total}`, tone: degraded === 0 ? "emerald" : "amber" },
        { label: "routes", value: snapshot?.routeCount ?? 0 },
        { label: "req", value: fmtCount(snapshot?.stats.totalRequests ?? 0) },
        ...(snapshot && snapshot.stats.noRouteCount > 0
          ? [{ label: "unmatched", value: snapshot.stats.noRouteCount, tone: "amber" as const }]
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
