import { listAppsDetailed } from "@valentinkolb/cloud";
import { listRegisteredAppStatus } from "./registered-apps";
import { getGatewayStats, getRouteTable } from "./stats";

export type GatewayHealthStatus = "ok" | "warn" | "error";

export type GatewayHealthApp = {
  id: string;
  name: string;
  icon: string;
  status: GatewayHealthStatus;
  online: boolean;
  healthy: boolean;
  lastSeenAt: string;
  offlineForMs: number;
};

export type GatewayHealth = {
  status: GatewayHealthStatus;
  checkedAt: string;
  summary: {
    apps: number;
    healthy: number;
    degraded: number;
    offline: number;
    routes: number;
    requests: number;
    errors: number;
    unmatchedRequests: number;
  };
  apps: GatewayHealthApp[];
};

export const buildGatewayHealth = async (scopeAppIds?: readonly string[]): Promise<GatewayHealth> => {
  const checkedAt = new Date();
  const liveApps = await listAppsDetailed();
  const registeredApps = await listRegisteredAppStatus(liveApps);
  const stats = getGatewayStats();
  const table = getRouteTable();
  const scope = scopeAppIds && scopeAppIds.length > 0 ? new Set(scopeAppIds) : null;

  const apps = registeredApps
    .filter((app) => app.id !== "gateway")
    .filter((app) => !scope || scope.has(app.id))
    .map<GatewayHealthApp>((app) => {
      const fresh = Boolean(app.live && app.live.expiresAt - Date.now() > 30_000);
      const status: GatewayHealthStatus = app.isOnline ? (fresh ? "ok" : "warn") : "error";
      return {
        id: app.id,
        name: app.name,
        icon: app.icon,
        status,
        online: app.isOnline,
        healthy: status === "ok",
        lastSeenAt: new Date(app.live?.updatedAt ?? app.lastSeenAt).toISOString(),
        offlineForMs: app.offlineForMs,
      };
    });

  const healthy = apps.filter((app) => app.status === "ok").length;
  const offline = apps.filter((app) => app.status === "error").length;
  const degraded = apps.filter((app) => app.status === "warn").length;
  const routeErrors = Array.from(stats.byRoute.values()).reduce((total, route) => total + route.errors, 0);
  const status: GatewayHealthStatus = offline > 0 ? "error" : degraded > 0 || routeErrors > 0 ? "warn" : "ok";

  return {
    status,
    checkedAt: checkedAt.toISOString(),
    summary: {
      apps: apps.length,
      healthy,
      degraded,
      offline,
      routes: table.routeCount,
      requests: stats.totalRequests,
      errors: routeErrors,
      unmatchedRequests: stats.noRouteCount,
    },
    apps,
  };
};
