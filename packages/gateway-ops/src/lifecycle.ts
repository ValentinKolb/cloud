import { appRegistry, listApps, listAppsDetailed } from "@valentinkolb/cloud";
import type { AppLifecycle } from "@valentinkolb/cloud/contracts";
import { get as getSetting, logger } from "@valentinkolb/cloud/services";
import { job, scheduler } from "@valentinkolb/sync";
import { runHealthWebhookCheck } from "./health-webhooks";
import { migrate } from "./migrate";
import { listRegisteredAppStatus, markOfflineLogged, upsertRegisteredApps } from "./registered-apps";
import { cleanupTelemetry, consumeTelemetry } from "./telemetry";

const log = logger("gateway-ops");
const offlineLog = logger("gateway-ops:registered-apps");

const OFFLINE_AFTER_MS = 10 * 60 * 1000;
const OFFLINE_LOG_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_CLEANUP_CRON = "0 4 * * *";
const DEFAULT_HEALTH_CRON = "*/5 * * * *";
const TELEMETRY_CLEANUP_CRON = "17 3 * * *";
const HEALTH_SCHEDULE_ID = "gateway:health-webhook-check";

const gatewayOpsScheduler = scheduler({ id: "gateway-ops-lifecycle" });

let registryWatcherAbort: AbortController | null = null;
let registryRefreshTimer: ReturnType<typeof setInterval> | null = null;
let telemetryAbort: AbortController | null = null;
let telemetryTask: Promise<void> | null = null;
let schedulerStarted = false;
let offlineScheduleRegistered = false;
let registryRefreshInFlight = false;

const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";

const delay = async (ms: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
};

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
      if (appStatus.isOnline || appStatus.offlineForMs < OFFLINE_AFTER_MS) continue;
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

export const refreshRegisteredApps = async (): Promise<void> => {
  await upsertRegisteredApps(await listApps());
};

const refreshRegisteredAppsOnce = async (): Promise<void> => {
  if (registryRefreshInFlight) return;
  registryRefreshInFlight = true;
  try {
    await refreshRegisteredApps();
  } catch (error) {
    log.error("Registered app refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    registryRefreshInFlight = false;
  }
};

const startRegistryWatcher = async (): Promise<void> => {
  registryWatcherAbort?.abort();
  registryWatcherAbort = new AbortController();
  const signal = registryWatcherAbort.signal;
  while (!signal.aborted) {
    try {
      const snap = await appRegistry.snapshot({ prefix: "apps/" });
      for await (const _ev of appRegistry.reader({ prefix: "apps/", after: snap.cursor }).stream({ signal })) {
        await refreshRegisteredAppsOnce();
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      log.error("Registry watcher failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await delay(5_000, signal);
    }
  }
};

const createOfflineAuditSchedule = async (): Promise<void> => {
  if (offlineScheduleRegistered) return;
  const [cron, tz] = await Promise.all([getCronSetting("app.cleanup_schedule", DEFAULT_CLEANUP_CRON), getTimezoneSetting()]);
  await gatewayOpsScheduler.create({
    id: "gateway:registered-apps:offline-audit",
    cron,
    tz,
    process: async ({ ctx }) => {
      await offlineAuditJob.submit({ key: `slot:${ctx.slotTs}` });
    },
  });
  offlineScheduleRegistered = true;
};

const createHealthWebhookSchedule = async (cronOverride?: string): Promise<void> => {
  const [cron, tz] = await Promise.all([
    cronOverride ? Promise.resolve(cronOverride) : getCronSetting("gateway.health_check_schedule", DEFAULT_HEALTH_CRON),
    getTimezoneSetting(),
  ]);
  await gatewayOpsScheduler.create({
    id: HEALTH_SCHEDULE_ID,
    cron,
    tz,
    process: async () => runHealthWebhookCheck(),
  });
};

const createTelemetryCleanupSchedule = async (): Promise<void> => {
  const tz = await getTimezoneSetting();
  await gatewayOpsScheduler.create({
    id: "gateway:telemetry:cleanup",
    cron: TELEMETRY_CLEANUP_CRON,
    tz,
    process: async () => {
      const deleted = await cleanupTelemetry();
      log.info("Gateway telemetry cleanup completed", { deleted });
    },
  });
};

export const updateHealthSchedule = async (cron: string): Promise<void> => {
  await createHealthWebhookSchedule(cron);
};

const startScheduler = async (): Promise<void> => {
  if (!schedulerStarted) {
    gatewayOpsScheduler.start();
    schedulerStarted = true;
  }
  await createOfflineAuditSchedule();
  await createHealthWebhookSchedule();
  await createTelemetryCleanupSchedule();
};

const startTelemetryConsumer = (): void => {
  if (telemetryTask) return;
  telemetryAbort = new AbortController();
  const signal = telemetryAbort.signal;
  telemetryTask = (async () => {
    while (!signal.aborted) {
      try {
        await consumeTelemetry(signal);
      } catch (error) {
        if (isAbortError(error) || signal.aborted) return;
        log.error("Gateway telemetry consumer failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        await delay(5_000, signal);
      }
    }
  })().finally(() => {
    if (telemetryAbort?.signal === signal) telemetryAbort = null;
    telemetryTask = null;
  });
};

const stopTelemetryConsumer = async (): Promise<void> => {
  telemetryAbort?.abort();
  const task = telemetryTask;
  telemetryAbort = null;
  telemetryTask = null;
  if (task) await task.catch(() => undefined);
};

export const gatewayOpsLifecycle: AppLifecycle = {
  setup: async () => {
    await migrate();
    await refreshRegisteredApps();
  },

  start: async () => {
    registryRefreshTimer = setInterval(() => void refreshRegisteredAppsOnce(), 5_000);
    void startRegistryWatcher();
    await startScheduler();
    startTelemetryConsumer();
    log.info("Gateway Ops started");
  },

  stop: async () => {
    if (registryRefreshTimer) clearInterval(registryRefreshTimer);
    registryRefreshTimer = null;
    registryWatcherAbort?.abort();
    registryWatcherAbort = null;
    await stopTelemetryConsumer();
    await gatewayOpsScheduler.stop();
    schedulerStarted = false;
    offlineScheduleRegistered = false;
  },
};
