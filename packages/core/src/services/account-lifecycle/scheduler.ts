import { z } from "zod";
import { job, scheduler, type SchedulerMetric } from "@valentinkolb/sync";
import { logger, logging } from "@valentinkolb/cloud-core/services/logging";
import { providers } from "@valentinkolb/cloud-core/services/providers";
import { get as getSetting } from "@valentinkolb/cloud-core/services/settings";
import { accountLifecycle } from "./index";

const log = logger("auth:lifecycle:scheduler");
const ipaSyncLog = logger("auth:ipa:sync");
const reminderLog = logger("auth:reminder:daily");
const guestCleanupLog = logger("auth:guest:cleanup");
const localUserCleanupLog = logger("auth:local-user:cleanup");
const auditCleanupLog = logger("auth:lifecycle:audit:cleanup");
const ipaBackfillLog = logger("auth:ipa:backfill");
const localUserBackfillLog = logger("auth:local-user:backfill");
const guestBackfillLog = logger("auth:guest:backfill");
const logCleanupLog = logger("logging");

type EmptyJobInput = Record<string, never>;

type JobSummary = {
  scanned: number;
  changed: number;
  skipped: number;
  failed: number;
};

const abortedSummary = (): JobSummary => ({
  scanned: 0,
  changed: 0,
  skipped: 0,
  failed: 0,
});

const toDemotionLog = (summary: JobSummary) => ({
  expiredCandidates: summary.scanned,
  demotedToGuest: summary.changed,
  skipped: summary.skipped,
  failed: summary.failed,
});

const toReminderLog = (summary: JobSummary) => ({
  candidates: summary.scanned,
  sent: summary.changed,
  skipped: summary.skipped,
  failed: summary.failed,
});

const toCleanupLog = (summary: JobSummary) => ({
  candidates: summary.scanned,
  deleted: summary.changed,
  skipped: summary.skipped,
  failed: summary.failed,
});

const toBackfillLog = (summary: JobSummary) => ({
  candidates: summary.scanned,
  updated: summary.changed,
  skipped: summary.skipped,
  failed: summary.failed,
});

const getCronSetting = async (key: string, fallback: string): Promise<string> => {
  const value = String((await getSetting<string>(key)) || "").trim();
  return value.length > 0 ? value : fallback;
};

const getTimezoneSetting = async (): Promise<string> => {
  const value = String((await getSetting<string>("app.timezone")) || "").trim();
  return value.length > 0 ? value : "Europe/Berlin";
};

const onSchedulerMetric = (metric: SchedulerMetric): void => {
  log.info("metric", metric);
};

const ipaSyncJob = job({
  id: "auth:ipa:sync",
  schema: z.object({}),
  defaults: {
    maxAttempts: 3,
    backoff: { kind: "fixed", baseMs: 1000 },
    leaseMs: 120_000,
  },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    try {
      await ctx.step({ id: "sync", run: () => providers.ipa.sync.run() });
    } catch (error) {
      ipaSyncLog.error("Sync step failed", {
        step: "sync",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    await ctx.heartbeat();
    let summary: JobSummary;
    try {
      summary = await ctx.step({ id: "demote-expired", run: () => accountLifecycle.demoteExpiredIpaUsers() });
    } catch (error) {
      ipaSyncLog.error("Expired IPA demotion step failed", {
        step: "demote-expired",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    ipaSyncLog.info("Expired IPA demotion complete", toDemotionLog(summary));
    return summary;
  },
});

const reminderJob = job({
  id: "auth:reminder:daily",
  schema: z.object({}),
  defaults: {
    maxAttempts: 3,
    backoff: { kind: "fixed", baseMs: 1000 },
    leaseMs: 180_000,
  },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await ctx.step({ id: "send-reminders", run: () => accountLifecycle.sendExpiryReminders() });
    reminderLog.info("Reminder run complete", toReminderLog(summary));
    return summary;
  },
});

const guestCleanupJob = job({
  id: "auth:guest:cleanup",
  schema: z.object({}),
  defaults: {
    maxAttempts: 3,
    backoff: { kind: "fixed", baseMs: 1000 },
    leaseMs: 120_000,
  },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await ctx.step({ id: "cleanup-expired-guests", run: () => accountLifecycle.cleanupExpiredGuests() });
    guestCleanupLog.info("Expired guest cleanup complete", toCleanupLog(summary));
    return summary;
  },
});

const localUserCleanupJob = job({
  id: "auth:local-user:cleanup",
  schema: z.object({}),
  defaults: {
    maxAttempts: 3,
    backoff: { kind: "fixed", baseMs: 1000 },
    leaseMs: 120_000,
  },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await ctx.step({ id: "cleanup-expired-local-users", run: () => accountLifecycle.cleanupExpiredLocalUsers() });
    localUserCleanupLog.info("Expired local user cleanup complete", toCleanupLog(summary));
    return summary;
  },
});

const auditCleanupJob = job({
  id: "auth:lifecycle:audit:cleanup",
  schema: z.object({}),
  defaults: {
    maxAttempts: 3,
    backoff: { kind: "fixed", baseMs: 1000 },
    leaseMs: 120_000,
  },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await ctx.step({ id: "cleanup-audit", run: () => accountLifecycle.cleanupLifecycleAudit() });
    auditCleanupLog.info("Lifecycle audit cleanup complete", toCleanupLog(summary));
    return summary;
  },
});

const logCleanupJob = job({
  id: "app:logs:cleanup",
  schema: z.object({}),
  defaults: {
    maxAttempts: 3,
    backoff: { kind: "fixed", baseMs: 1000 },
    leaseMs: 120_000,
  },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return { deleted: 0, retentionDays: 0 };
    const retentionDays = Number((await getSetting<number | string | null>("logs.retention_days")) ?? 30);
    const summary = await ctx.step({
      id: "cleanup-log-entries",
      run: () => logging.cleanup(Number.isFinite(retentionDays) ? retentionDays : 30),
    });
    logCleanupLog.info("Log cleanup complete", {
      deleted: summary.deleted,
      retentionDays: Number.isFinite(retentionDays) ? retentionDays : 30,
    });
    return {
      deleted: summary.deleted,
      retentionDays: Number.isFinite(retentionDays) ? retentionDays : 30,
    };
  },
});

const ipaBackfillJob = job({
  id: "auth:ipa:backfill",
  schema: z.object({}),
  defaults: {
    maxAttempts: 2,
    backoff: { kind: "fixed", baseMs: 2000 },
    leaseMs: 300_000,
  },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await ctx.step({ id: "backfill-ipa-expiry", run: () => accountLifecycle.runIpaBackfill() });
    ipaBackfillLog.info("IPA expiry backfill complete", toBackfillLog(summary));
    return summary;
  },
});

const guestBackfillJob = job({
  id: "auth:guest:backfill",
  schema: z.object({}),
  defaults: {
    maxAttempts: 2,
    backoff: { kind: "fixed", baseMs: 2000 },
    leaseMs: 300_000,
  },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await ctx.step({ id: "backfill-guest-expiry", run: () => accountLifecycle.runGuestBackfill() });
    guestBackfillLog.info("Guest expiry backfill complete", toBackfillLog(summary));
    return summary;
  },
});

const localUserBackfillJob = job({
  id: "auth:local-user:backfill",
  schema: z.object({}),
  defaults: {
    maxAttempts: 2,
    backoff: { kind: "fixed", baseMs: 2000 },
    leaseMs: 300_000,
  },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await ctx.step({ id: "backfill-local-user-expiry", run: () => accountLifecycle.runLocalUserBackfill() });
    localUserBackfillLog.info("Local user expiry backfill complete", toBackfillLog(summary));
    return summary;
  },
});

const lifecycleScheduler = scheduler({
  id: "auth-lifecycle",
  strictHandlers: true,
  onMetric: onSchedulerMetric,
});

let started = false;
let registered = false;
let registerPromise: Promise<void> | null = null;

const doRegister = async (): Promise<void> => {
  const [scheduleTz, ipaSyncCron, reminderCron, cleanupCron] = await Promise.all([
    getTimezoneSetting(),
    getCronSetting("user.account.ipa_sync_cron", "*/5 * * * *"),
    getCronSetting("user.account.reminder_cron", "0 9 * * *"),
    getCronSetting("app.cleanup_schedule", "0 4 * * *"),
  ]);

  await lifecycleScheduler.register({
    id: "auth:ipa:sync",
    cron: ipaSyncCron,
    tz: scheduleTz,
    job: ipaSyncJob,
    input: {},
    misfire: "skip",
  });

  await lifecycleScheduler.register({
    id: "auth:reminder:daily",
    cron: reminderCron,
    tz: scheduleTz,
    job: reminderJob,
    input: {},
    misfire: "skip",
  });

  await lifecycleScheduler.register({
    id: "auth:guest:cleanup",
    cron: cleanupCron,
    tz: scheduleTz,
    job: guestCleanupJob,
    input: {},
    misfire: "skip",
  });

  await lifecycleScheduler.register({
    id: "auth:local-user:cleanup",
    cron: cleanupCron,
    tz: scheduleTz,
    job: localUserCleanupJob,
    input: {},
    misfire: "skip",
  });

  await lifecycleScheduler.register({
    id: "auth:lifecycle:audit:cleanup",
    cron: cleanupCron,
    tz: scheduleTz,
    job: auditCleanupJob,
    input: {},
    misfire: "skip",
  });

  await lifecycleScheduler.register({
    id: "app:logs:cleanup",
    cron: cleanupCron,
    tz: scheduleTz,
    job: logCleanupJob,
    input: {},
    misfire: "skip",
  });

  registered = true;
};

const ensureRegistered = async (): Promise<void> => {
  if (registered) return;
  if (!registerPromise) {
    registerPromise = doRegister().finally(() => {
      registerPromise = null;
    });
  }
  await registerPromise;
};

export const lifecycleJobs = {
  start: async (): Promise<void> => {
    if (!started) {
      lifecycleScheduler.start();
      started = true;
    }
    await ensureRegistered();
  },

  stop: async (): Promise<void> => {
    if (!started) return;
    await lifecycleScheduler.stop();
    started = false;
    registered = false;
    registerPromise = null;
  },

  submitIpaBackfill: async (): Promise<string> => ipaBackfillJob.submit({ input: {} satisfies EmptyJobInput }),
  submitLocalUserBackfill: async (): Promise<string> => localUserBackfillJob.submit({ input: {} satisfies EmptyJobInput }),
  submitGuestBackfill: async (): Promise<string> => guestBackfillJob.submit({ input: {} satisfies EmptyJobInput }),
  submitReminderRun: async (): Promise<string> => reminderJob.submit({ input: {} satisfies EmptyJobInput }),
  submitIpaSync: async (): Promise<string> => ipaSyncJob.submit({ input: {} satisfies EmptyJobInput }),

  metrics: () => lifecycleScheduler.metrics(),
  listSchedules: async () => lifecycleScheduler.list(),
};
