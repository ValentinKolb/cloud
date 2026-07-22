import type { WidgetBlock, WidgetResponse } from "@valentinkolb/cloud/contracts";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { latestGatewayRouteSnapshot } from "@valentinkolb/cloud/services";
import { Hono } from "hono";
import { buildGatewayHealth } from "./health";

const fmtUptime = (ms: number): string => {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
};

const fmtCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Platform health widget — admin only. Status includes app liveness and the
 * operational signals evaluated by the central health service.
 */
export const widgetRoutes = new Hono<AuthContext>().use(auth.requireRole("*")).get("/health", async (c) => {
  const actor = c.get("actor") as AuthContext["Variables"]["actor"] | undefined;
  const user = actor?.kind === "user" ? actor.user : actor?.delegatedUser;
  // 403 = admin-only widget; non-admins see it as locked in the dashboard modal.
  if (!user || !hasRole(user, "admin")) return c.body(null, 403);

  const [health, snapshot] = await Promise.all([buildGatewayHealth(), latestGatewayRouteSnapshot()]);
  const { apps: total, healthy, degraded, offline } = health.summary;
  const unhealthy = degraded + offline;

  const blocks: WidgetBlock[] = [
    {
      kind: "status",
      grow: true,
      tone: health.status,
      title: unhealthy === 0 ? "All systems operational" : `${unhealthy} of ${total} apps need attention`,
      message: snapshot
        ? `Gateway up ${fmtUptime(Date.now() - snapshot.startedAt)} · ${total} apps registered`
        : `${total} apps registered · no gateway router snapshot`,
    },
    {
      kind: "pills",
      pills: [
        { label: "apps", value: `${healthy}/${total}`, tone: unhealthy === 0 ? "emerald" : health.status === "error" ? "red" : "amber" },
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
