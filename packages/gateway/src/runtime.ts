import { appRegistry, buildRuntimeFromRegistry, listApps } from "@valentinkolb/cloud";
import { logger } from "@valentinkolb/cloud/services";
import { gatewayRouter } from "./config";
import { buildGatewayRouteSnapshot, publishGatewayRouteSnapshot, removeGatewayRouteSnapshot } from "@valentinkolb/cloud/services";
import { buildAppRoutesDetailed, type AppRouteWarning } from "./routes";
import { getRouteTable, setRouteTable, stats } from "./stats";
import { buildRouteTable } from "./trie";

const log = logger("gateway");

let currentRuntime = buildRuntimeFromRegistry([]);
let lastRouteHash = "";
let lastWarningsHash = "";
let lastRouteWarnings: AppRouteWarning[] = [];
let watcherAbort: AbortController | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const startedAt = Date.now();

export const getCurrentRuntime = () => currentRuntime;

const publishSnapshot = async (routeHash: string, routeWarnings: AppRouteWarning[]): Promise<void> => {
  await publishGatewayRouteSnapshot(
    buildGatewayRouteSnapshot({
      instanceId: gatewayRouter.id,
      baseUrl: gatewayRouter.baseUrl,
      startedAt,
      routeHash,
      routeWarnings,
      table: getRouteTable(),
      stats,
    }),
  );
};

export const refreshRoutes = async (): Promise<void> => {
  try {
    const apps = await listApps();
    const { routes: appRoutes, warnings } = buildAppRoutesDetailed(apps);
    const routeHash = JSON.stringify(appRoutes.map((r) => `${r.prefix}:${r.baseUrl}`).sort());
    const warningsHash = JSON.stringify(warnings);

    if (routeHash !== lastRouteHash) {
      lastRouteHash = routeHash;
      const table = buildRouteTable(appRoutes);
      setRouteTable(table);
      log.info(`Route table rebuilt: ${table.routeCount} routes from ${apps.length} apps`);
    }

    if (warningsHash !== lastWarningsHash) {
      lastWarningsHash = warningsHash;
      lastRouteWarnings = warnings;
      for (const warning of warnings) {
        log.warn("Skipped app route", warning);
      }
    }

    await publishSnapshot(routeHash, lastRouteWarnings);
    currentRuntime = buildRuntimeFromRegistry(apps);
  } catch (error) {
    log.error("Route refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const startRegistryWatcher = async (): Promise<void> => {
  watcherAbort?.abort();
  watcherAbort = new AbortController();
  const signal = watcherAbort.signal;
  try {
    const snap = await appRegistry.snapshot({ prefix: "apps/" });
    for await (const _ev of appRegistry.reader({ prefix: "apps/", after: snap.cursor }).stream({ signal })) {
      await refreshRoutes();
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return;
    log.error("Registry watcher failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const gatewayRuntime = {
  setup: async (): Promise<void> => {
    await refreshRoutes();
  },

  start: async (): Promise<void> => {
    refreshTimer = setInterval(refreshRoutes, 5_000);
    void startRegistryWatcher();
  },

  stop: async (): Promise<void> => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    watcherAbort?.abort();
    watcherAbort = null;
    await removeGatewayRouteSnapshot(gatewayRouter.id);
  },
};
