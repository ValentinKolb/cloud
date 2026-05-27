import { appRegistry, buildRuntimeFromRegistry, createHeartbeat, listApps, listAppsDetailed } from "@valentinkolb/cloud";
import type { AppRegistryEntry } from "@valentinkolb/cloud/contracts";
import { get as getSetting, loadCache as loadSettingsCache, logger } from "@valentinkolb/cloud/services";
import { job, scheduler } from "@valentinkolb/sync";
import { app } from "./config";
import { runHealthWebhookCheck } from "./health-webhooks";
import { migrate } from "./migrate";
import { listRegisteredAppStatus, markOfflineLogged, upsertRegisteredApps } from "./registered-apps";
import { buildAppRoutes } from "./routes";
import { getRouteTable, setRouteTable } from "./stats";
import { buildRouteTable } from "./trie";

const log = logger("gateway");
const offlineLog = logger("gateway:registered-apps");

const OFFLINE_AFTER_MS = 10 * 60 * 1000;
const OFFLINE_LOG_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_CLEANUP_CRON = "0 4 * * *";
const DEFAULT_HEALTH_CRON = "*/5 * * * *";
const HEALTH_SCHEDULE_ID = "gateway:health-webhook-check";

const fmtDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length || seconds) parts.push(`${seconds}s`);
  return parts.join(" ");
};

const getCronSetting = async (key: string, fallback: string): Promise<string> => {
  const value = String((await getSetting<string>(key)) || "").trim();
  return value.length > 0 ? value : fallback;
};

const getTimezoneSetting = async (): Promise<string> => {
  const value = String((await getSetting<string>("app.timezone")) || "").trim();
  return value.length > 0 ? value : "Europe/Berlin";
};

const retryOnError =
  (cfg: { maxAttempts: number; baseMs: number; maxMs?: number }) =>
  ({
    ctx,
  }: {
    ctx: {
      error?: Error;
      failureCount: number;
      reschedule: (cfg: { delayMs: number }) => void;
      expBackoff: (cfg: { baseMs: number; maxMs?: number }) => number;
    };
  }) => {
    if (!ctx.error) return;
    if (ctx.failureCount >= cfg.maxAttempts - 1) return;
    ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: cfg.baseMs, maxMs: cfg.maxMs }) });
  };

type OfflineAuditSummary = {
  scanned: number;
  offline: number;
  logged: number;
};

const offlineAuditJob = job<void, OfflineAuditSummary>({
  id: "gateway:registered-apps:offline-audit",
  defaults: { leaseMs: 120_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return { scanned: 0, offline: 0, logged: 0 };
    const liveApps = await listAppsDetailed();
    const rows = await listRegisteredAppStatus(liveApps);
    const now = Date.now();
    let offline = 0;
    let logged = 0;

    for (const appStatus of rows) {
      if (appStatus.id === app.meta.id || appStatus.isOnline || appStatus.offlineForMs < OFFLINE_AFTER_MS) continue;
      offline += 1;
      if (appStatus.lastOfflineLoggedAt && now - appStatus.lastOfflineLoggedAt < OFFLINE_LOG_INTERVAL_MS) continue;
      const offlineFor = fmtDuration(appStatus.offlineForMs);
      offlineLog.error(`Registered app "${appStatus.id}" has been offline for ${offlineFor}`, {
        appId: appStatus.id,
        appName: appStatus.name,
        lastSeenAt: new Date(appStatus.lastSeenAt).toISOString(),
        offlineForMs: appStatus.offlineForMs,
        offlineFor,
        baseUrl: appStatus.baseUrl,
        routes: appStatus.routes,
      });
      await markOfflineLogged(appStatus.id);
      logged += 1;
    }

    return { scanned: rows.length, offline, logged };
  },
  after: retryOnError({ maxAttempts: 3, baseMs: 1000 }),
});

const gatewayScheduler = scheduler({ id: "gateway-lifecycle" });

const registryEntry: AppRegistryEntry = {
  id: app.meta.id,
  name: app.meta.name,
  icon: app.meta.icon,
  description: app.meta.description,
  baseUrl: app.baseUrl,
  routes: app.meta.routes,
  nav: {
    href: "",
    section: "hidden",
    adminHref: app.meta.adminHref,
  },
  widgets: app.meta.widgets ? app.meta.widgets.map((w) => ({ ...w })) : undefined,
};

const heartbeat = createHeartbeat(app.meta.id, registryEntry);

let currentRuntime = buildRuntimeFromRegistry([]);
let lastRouteHash = "";
let watcherAbort: AbortController | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let schedulerStarted = false;
let scheduleRegistered = false;

export const getCurrentRuntime = () => currentRuntime;

export const refreshRoutes = async (): Promise<void> => {
  try {
    const apps = await listApps();
    await upsertRegisteredApps(apps);
    const appRoutes = buildAppRoutes(apps);
    const routeHash = JSON.stringify(appRoutes.map((r) => `${r.prefix}:${r.baseUrl}`).sort());
    if (routeHash !== lastRouteHash) {
      lastRouteHash = routeHash;
      const table = buildRouteTable(appRoutes);
      setRouteTable(table);
      log.info(`Route table rebuilt: ${table.routeCount} routes from ${apps.length} apps`);
    }
    currentRuntime = buildRuntimeFromRegistry(apps);
  } catch (error) {
    log.error("Route refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const createOfflineAuditSchedule = async (): Promise<void> => {
  if (scheduleRegistered) return;
  const [cron, tz] = await Promise.all([getCronSetting("app.cleanup_schedule", DEFAULT_CLEANUP_CRON), getTimezoneSetting()]);
  try {
    await gatewayScheduler.create({
      id: "gateway:registered-apps:offline-audit",
      cron,
      tz,
      process: async ({ ctx }) => {
        await offlineAuditJob.submit({ key: `slot:${ctx.slotTs}` });
      },
    });
  } catch (error) {
    if (cron === DEFAULT_CLEANUP_CRON) throw error;
    log.warn("Invalid configured cron, falling back to default", {
      key: "app.cleanup_schedule",
      configuredCron: cron,
      fallbackCron: DEFAULT_CLEANUP_CRON,
      timezone: tz,
      error: error instanceof Error ? error.message : String(error),
    });
    await gatewayScheduler.create({
      id: "gateway:registered-apps:offline-audit",
      cron: DEFAULT_CLEANUP_CRON,
      tz,
      process: async ({ ctx }) => {
        await offlineAuditJob.submit({ key: `slot:${ctx.slotTs}` });
      },
    });
  }
  scheduleRegistered = true;
};

const createHealthWebhookSchedule = async (cronOverride?: string): Promise<void> => {
  const [cron, tz] = await Promise.all([
    cronOverride ? Promise.resolve(cronOverride) : getCronSetting("gateway.health_check_schedule", DEFAULT_HEALTH_CRON),
    getTimezoneSetting(),
  ]);
  try {
    await gatewayScheduler.create({
      id: HEALTH_SCHEDULE_ID,
      cron,
      tz,
      process: async () => runHealthWebhookCheck(),
    });
  } catch (error) {
    if (cron === DEFAULT_HEALTH_CRON) throw error;
    log.warn("Invalid configured cron, falling back to default", {
      key: "gateway.health_check_schedule",
      configuredCron: cron,
      fallbackCron: DEFAULT_HEALTH_CRON,
      timezone: tz,
      error: error instanceof Error ? error.message : String(error),
    });
    await gatewayScheduler.create({
      id: HEALTH_SCHEDULE_ID,
      cron: DEFAULT_HEALTH_CRON,
      tz,
      process: async () => runHealthWebhookCheck(),
    });
  }
};

export const updateHealthSchedule = async (cron: string): Promise<void> => {
  await createHealthWebhookSchedule(cron);
};

const startScheduler = async (): Promise<void> => {
  if (!schedulerStarted) {
    gatewayScheduler.start();
    schedulerStarted = true;
  }
  await createOfflineAuditSchedule();
  await createHealthWebhookSchedule();
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
    await migrate();
    await loadSettingsCache();
  },

  start: async (): Promise<void> => {
    await heartbeat.start();
    await refreshRoutes();
    refreshTimer = setInterval(refreshRoutes, 5_000);
    void startRegistryWatcher();
    await startScheduler();
  },

  stop: async (): Promise<void> => {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    watcherAbort?.abort();
    watcherAbort = null;
    await heartbeat.stop();
    if (schedulerStarted) {
      await gatewayScheduler.stop();
      schedulerStarted = false;
      scheduleRegistered = false;
    }
  },

  submitOfflineAudit: (): Promise<string> => offlineAuditJob.submit({ key: `manual:${Date.now()}` }),
  routeTable: getRouteTable,
};
