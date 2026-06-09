/**
 * Core-specific lifecycle helpers.
 * Migrations, background jobs — nothing generic here.
 */

import { lifecycleJobs, migrateWeather } from "@valentinkolb/cloud/services";
import { migrate as migrateAnnouncements } from "./migrate/core/announcements";
import { migrate as migrateAudit } from "./migrate/core/audit";
import { migrate as migrateAuth } from "./migrate/core/auth";
import { migrate as migrateLogging } from "./migrate/core/logging";
import { migrate as migrateNotifications } from "./migrate/core/notifications";
import { migrate as migrateSettings } from "./migrate/core/settings";

/** Run all core database migrations (auth, notifications, settings, logging). */
export const runCoreSetup = async (): Promise<void> => {
  const steps = [
    { name: "auth", run: migrateAuth },
    { name: "audit", run: migrateAudit },
    { name: "announcements", run: migrateAnnouncements },
    { name: "notifications", run: migrateNotifications },
    { name: "settings", run: migrateSettings },
    { name: "logging", run: migrateLogging },
    { name: "weather", run: migrateWeather },
  ];
  for (const step of steps) {
    console.log(`[setup] core:${step.name}`);
    await step.run();
  }
};

/** Start core background services (account lifecycle jobs). */
export const startCoreServices = async (): Promise<void> => {
  await lifecycleJobs.start();
};

/** Stop core background services. */
export const stopCoreServices = async (): Promise<void> => {
  await lifecycleJobs.stop();
};

/** Boot the full core runtime: setup, start services, register shutdown hooks. */
export const bootRuntime = async (options: {
  runtime: unknown;
  skipSetup: boolean;
  shutdownTimeoutMs?: number;
  onShutdown?: () => Promise<void>;
}): Promise<void> => {
  if (!options.skipSetup) {
    await runCoreSetup();
  }
  await startCoreServices();

  const shutdown = async () => {
    console.log("[shutdown] stopping core services…");
    await stopCoreServices();
    if (options.onShutdown) await options.onShutdown();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};
