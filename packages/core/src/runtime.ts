import { migrate as migrateAuth } from "@/migrate/core/auth";
import { migrate as migrateLogging } from "@/migrate/core/logging";
import { migrate as migrateNotifications } from "@/migrate/core/notifications";
import { migrate as migrateSettings } from "@/migrate/core/settings";
import type { AppFacade, AppSearchTagHelpEntry, CloudContext, CloudRuntime } from "@valentinkolb/cloud-contracts/app";
import { logger } from "@valentinkolb/cloud-core/services/logging";
import { lifecycleJobs } from "@valentinkolb/cloud-core/services";
import { loadCache as loadSettingsCache } from "@valentinkolb/cloud-core/services/settings";
import { getSync, set } from "@valentinkolb/cloud-core/services/settings";

export type RuntimeContext = CloudRuntime;

type RuntimeCarrier = {
  get: (key: any) => unknown;
};

type SetupStep = {
  name: string;
  run: () => Promise<void>;
};

type RunSetupOptions = {
  apps: readonly AppFacade[];
  runtime: RuntimeContext;
  skipSetup?: boolean;
};

type BootRuntimeOptions = RunSetupOptions & {
  shutdownTimeoutMs?: number;
};

const coreSetupSteps: readonly SetupStep[] = [
  { name: "auth", run: migrateAuth },
  { name: "notifications", run: migrateNotifications },
  { name: "settings", run: migrateSettings },
  { name: "logging", run: migrateLogging },
];

const uniqueBy = (field: string, entries: Array<{ appId: string; value: string }>): void => {
  const grouped = new Map<string, string[]>();
  for (const entry of entries) {
    grouped.set(entry.value, [...(grouped.get(entry.value) ?? []), entry.appId]);
  }

  const duplicates = [...grouped.entries()].filter(([, appIds]) => appIds.length > 1);
  if (duplicates.length === 0) return;

  const details = duplicates.map(([value, appIds]) => `- ${field}="${value}" used by: ${appIds.join(", ")}`).join("\n");
  throw new Error(`App registry has duplicate ${field} values:\n${details}`);
};

const createCloudContext = (runtime: RuntimeContext): CloudContext => ({
  logger,
  settings: {
    get: getSync,
    set,
  },
  runtime,
});

const runCoreSetup = async (): Promise<void> => {
  for (const step of coreSetupSteps) {
    console.log(`[setup] core:${step.name}`);
    await step.run();
  }
};

const runAppSetup = async (apps: readonly AppFacade[], ctx: CloudContext): Promise<void> => {
  for (const app of apps) {
    const setup = app.lifecycle?.setup;
    if (!setup) continue;

    try {
      console.log(`[setup] app:${app.meta.id}`);
      await setup(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`App setup failed for "${app.meta.id}": ${message}`);
    }
  }
};

const runAppStart = async (apps: readonly AppFacade[], ctx: CloudContext): Promise<void> => {
  const log = ctx.logger("startup:start");

  for (const app of apps) {
    if (!app.lifecycle?.start) continue;
    log.info(`Starting app lifecycle: ${app.meta.id}`);
    await app.lifecycle.start(ctx);
  }
};

const runAppStop = async (apps: readonly AppFacade[], ctx: CloudContext): Promise<void> => {
  const log = ctx.logger("startup:stop");

  for (const app of [...apps].reverse()) {
    const stop = app.lifecycle?.stop;
    if (!stop) continue;

    try {
      log.info(`Stopping app lifecycle: ${app.meta.id}`);
      await stop(ctx);
    } catch (error) {
      log.error(`Failed to stop app lifecycle: ${app.meta.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

const startCoreServices = async (): Promise<void> => {
  await lifecycleJobs.start();
};

const stopCoreServices = async (): Promise<void> => {
  await lifecycleJobs.stop();
};

const installShutdown = (options: { apps: readonly AppFacade[]; ctx: CloudContext; timeoutMs?: number }): void => {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const log = options.ctx.logger("shutdown");
  let stopping = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;

    log.info(`Received ${signal}, starting graceful shutdown`, { timeoutMs });

    const forceExitTimer = setTimeout(() => {
      log.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, timeoutMs);
    forceExitTimer.unref?.();

    try {
      await runAppStop(options.apps, options.ctx);
      await stopCoreServices();
      clearTimeout(forceExitTimer);
      log.info("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimer);
      log.error("Graceful shutdown failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

/**
 * Validates uniqueness constraints for a concrete app list.
 */
export const validateApps = (apps: readonly AppFacade[]): void => {
  uniqueBy(
    "meta.id",
    apps.map((app) => ({ appId: app.meta.id, value: app.meta.id })),
  );

  uniqueBy(
    "meta.nav.href",
    apps.filter((app) => !!app.meta.nav?.href).map((app) => ({ appId: app.meta.id, value: app.meta.nav!.href })),
  );

  uniqueBy(
    "meta.adminHref",
    apps.filter((app) => !!app.meta.adminHref).map((app) => ({ appId: app.meta.id, value: app.meta.adminHref! })),
  );
};

const normalizeSearchTags = (tags?: readonly string[]): string[] | undefined => {
  if (!tags || tags.length === 0) return undefined;

  const normalized = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))];
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeSearchHelp = (help?: string): string | undefined => {
  const normalized = help?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const normalizeSearchTagHelp = (tagHelp?: readonly AppSearchTagHelpEntry[]): AppSearchTagHelpEntry[] | undefined => {
  if (!tagHelp || tagHelp.length === 0) return undefined;

  const map = new Map<string, string>();
  for (const entry of tagHelp) {
    const tag = entry.tag.trim().toLowerCase();
    const help = entry.help.trim();
    if (!tag || !help) continue;
    map.set(tag, help);
  }

  if (map.size === 0) return undefined;
  return [...map.entries()].map(([tag, help]) => ({ tag, help }));
};

/**
 * Builds request runtime data from app facades (meta only, no routes/services).
 */
export const createRuntimeContext = (apps: readonly AppFacade[]): RuntimeContext => ({
  apps: apps.map((app) => ({
    ...app.meta,
    searchTags: normalizeSearchTags(app.capabilities?.search?.tags),
    searchHelp: normalizeSearchHelp(app.capabilities?.search?.help),
    searchTagHelp: normalizeSearchTagHelp(app.capabilities?.search?.tagHelp),
  })),
});

/**
 * Reads the runtime context from a Hono request context carrier.
 */
export const getRuntimeContext = (carrier: RuntimeCarrier): RuntimeContext => {
  const runtime = carrier.get("runtime");
  if (!runtime || typeof runtime !== "object" || !Array.isArray((runtime as RuntimeContext).apps)) {
    throw new Error("Runtime context is missing on request context");
  }
  return runtime as RuntimeContext;
};

/**
 * Runs setup steps only (core + app lifecycle.setup), used for migrate flows.
 */
export const runSetupPhase = async (options: RunSetupOptions): Promise<void> => {
  if (options.skipSetup) {
    console.log("[setup] skipped (--skip-setup or SKIP_SETUP)");
    return;
  }

  const ctx = createCloudContext(options.runtime);
  await runCoreSetup();
  await runAppSetup(options.apps, ctx);
};

/**
 * Boots runtime lifecycle: optional setup, cache load, app starts, core services, graceful shutdown.
 */
export const bootRuntime = async (options: BootRuntimeOptions): Promise<void> => {
  const ctx = createCloudContext(options.runtime);

  if (!options.skipSetup) {
    await runCoreSetup();
    await runAppSetup(options.apps, ctx);
  } else {
    console.log("[setup] skipped (--skip-setup or SKIP_SETUP)");
  }

  await loadSettingsCache();
  await runAppStart(options.apps, ctx);
  await startCoreServices();
  installShutdown({ apps: options.apps, ctx, timeoutMs: options.shutdownTimeoutMs });
};
