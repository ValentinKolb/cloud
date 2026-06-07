import { listAppsDetailed } from "@valentinkolb/cloud";
import { listGatewayRouteSnapshots } from "@valentinkolb/cloud/services";
import { listRegisteredAppStatus } from "./registered-apps";

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
    gatewayInstances: number;
  };
  apps: GatewayHealthApp[];
};

export const buildGatewayHealth = async (scopeAppIds?: readonly string[]): Promise<GatewayHealth> => {
  const checkedAt = new Date();
  const [liveApps, snapshots] = await Promise.all([listAppsDetailed(), listGatewayRouteSnapshots()]);
  const registeredApps = await listRegisteredAppStatus(liveApps);
  const latestSnapshot = snapshots.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  const scope = scopeAppIds && scopeAppIds.length > 0 ? new Set(scopeAppIds) : null;

  const apps = registeredApps
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
  const routeErrors = snapshots.reduce(
    (total, snapshot) => total + snapshot.stats.byRoute.reduce((sum, route) => sum + route.errors, 0),
    0,
  );
  const status: GatewayHealthStatus = snapshots.length === 0 || offline > 0 ? "error" : degraded > 0 || routeErrors > 0 ? "warn" : "ok";

  return {
    status,
    checkedAt: checkedAt.toISOString(),
    summary: {
      apps: apps.length,
      healthy,
      degraded,
      offline,
      routes: latestSnapshot?.routeCount ?? 0,
      requests: snapshots.reduce((total, snapshot) => total + snapshot.stats.totalRequests, 0),
      errors: routeErrors,
      unmatchedRequests: snapshots.reduce((total, snapshot) => total + snapshot.stats.noRouteCount, 0),
      gatewayInstances: snapshots.length,
    },
    apps,
  };
};
