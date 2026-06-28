import { job, scheduler } from "@valentinkolb/sync";
import { logger, logging } from "../logging";
import { providers } from "../providers";
import { get as getSetting } from "../settings";
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
const DEFAULT_IPA_SYNC_CRON = "*/5 * * * *";

type JobSummary = {
  scanned: number;
  changed: number;
  skipped: number;
  failed: number;
};

const abortedSummary = (): JobSummary => ({ scanned: 0, changed: 0, skipped: 0, failed: 0 });

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

/**
 * Retry policy shared by all lifecycle jobs: on transient failure, reschedule
 * up to `maxAttempts - 1` times with exponential backoff from `baseMs`. Beyond
 * that we go terminal and the next cron slot picks up the work.
 */
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

// ── Jobs ───────────────────────────────────────────────────────────────

const ipaSyncJob = job<void, JobSummary>({
  id: "auth:ipa:sync",
  defaults: { leaseMs: 120_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    try {
      await providers.ipa.sync.run();
    } catch (error) {
      ipaSyncLog.error("Sync step failed", { step: "sync", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    await ctx.heartbeat();
    try {
      const summary = await accountLifecycle.demoteExpiredIpaUsers();
      ipaSyncLog.info("Expired IPA demotion complete", toDemotionLog(summary));
      return summary;
    } catch (error) {
      ipaSyncLog.error("Expired IPA demotion step failed", {
        step: "demote-expired",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  after: retryOnError({ maxAttempts: 3, baseMs: 1000 }),
});

const reminderJob = job<void, JobSummary>({
  id: "auth:reminder:daily",
  defaults: { leaseMs: 180_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await accountLifecycle.sendExpiryReminders();
    reminderLog.info("Reminder run complete", toReminderLog(summary));
    return summary;
  },
  after: retryOnError({ maxAttempts: 3, baseMs: 1000 }),
});

const guestCleanupJob = job<void, JobSummary>({
  id: "auth:guest:cleanup",
  defaults: { leaseMs: 120_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await accountLifecycle.cleanupExpiredGuests();
    guestCleanupLog.info("Expired guest cleanup complete", toCleanupLog(summary));
    return summary;
  },
  after: retryOnError({ maxAttempts: 3, baseMs: 1000 }),
});

const localUserCleanupJob = job<void, JobSummary>({
  id: "auth:local-user:cleanup",
  defaults: { leaseMs: 120_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await accountLifecycle.cleanupExpiredLocalUsers();
    localUserCleanupLog.info("Expired local user cleanup complete", toCleanupLog(summary));
    return summary;
  },
  after: retryOnError({ maxAttempts: 3, baseMs: 1000 }),
});

const auditCleanupJob = job<void, JobSummary>({
  id: "auth:lifecycle:audit:cleanup",
  defaults: { leaseMs: 120_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await accountLifecycle.cleanupLifecycleAudit();
    auditCleanupLog.info("Lifecycle audit cleanup complete", toCleanupLog(summary));
    return summary;
  },
  after: retryOnError({ maxAttempts: 3, baseMs: 1000 }),
});

const logCleanupJob = job<void, { deleted: number; retentionDays: number }>({
  id: "app:logs:cleanup",
  defaults: { leaseMs: 120_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return { deleted: 0, retentionDays: 0 };
    const configured = Number((await getSetting<number | string | null>("logs.retention_days")) ?? 30);
    const retentionDays = Number.isFinite(configured) ? configured : 30;
    const summary = await logging.cleanup(retentionDays);
    logCleanupLog.info("Log cleanup complete", { deleted: summary.deleted, retentionDays });
    return { deleted: summary.deleted, retentionDays };
  },
  after: retryOnError({ maxAttempts: 3, baseMs: 1000 }),
});

const ipaBackfillJob = job<void, JobSummary>({
  id: "auth:ipa:backfill",
  defaults: { leaseMs: 300_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await accountLifecycle.runIpaBackfill();
    ipaBackfillLog.info("IPA expiry backfill complete", toBackfillLog(summary));
    return summary;
  },
  after: retryOnError({ maxAttempts: 2, baseMs: 2000 }),
});

const guestBackfillJob = job<void, JobSummary>({
  id: "auth:guest:backfill",
  defaults: { leaseMs: 300_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await accountLifecycle.runGuestBackfill();
    guestBackfillLog.info("Guest expiry backfill complete", toBackfillLog(summary));
    return summary;
  },
  after: retryOnError({ maxAttempts: 2, baseMs: 2000 }),
});

const localUserBackfillJob = job<void, JobSummary>({
  id: "auth:local-user:backfill",
  defaults: { leaseMs: 300_000 },
  process: async ({ ctx }) => {
    if (ctx.signal.aborted) return abortedSummary();
    const summary = await accountLifecycle.runLocalUserBackfill();
    localUserBackfillLog.info("Local user expiry backfill complete", toBackfillLog(summary));
    return summary;
  },
  after: retryOnError({ maxAttempts: 2, baseMs: 2000 }),
});

// ── Scheduler ──────────────────────────────────────────────────────────

const lifecycleScheduler = scheduler({ id: "auth-lifecycle" });

let started = false;
let registered = false;
let registerPromise: Promise<void> | null = null;

/**
 * Register (or update) a cron-triggered schedule that fans out to the given
 * job. `scheduler.create` is idempotent by id — same cron/tz keeps `nextRunAt`
 * intact; a change resets it. We submit one dispatch per slot using the slot
 * timestamp as idempotency key so misfires don't double-run.
 */
const createSchedule = async (config: {
  id: string;
  cron: string;
  tz: string;
  submit: (key: string) => Promise<string>;
}): Promise<void> => {
  await lifecycleScheduler.create({
    id: config.id,
    cron: config.cron,
    tz: config.tz,
    process: async ({ ctx }) => {
      await config.submit(`slot:${ctx.slotTs}`);
    },
  });
};

const createScheduleWithFallback = async (config: {
  id: string;
  cron: string;
  fallbackCron: string;
  tz: string;
  submit: (key: string) => Promise<string>;
  settingsKey: string;
}): Promise<void> => {
  try {
    await createSchedule({ id: config.id, cron: config.cron, tz: config.tz, submit: config.submit });
  } catch (error) {
    if (config.cron === config.fallbackCron) throw error;
    log.warn("Invalid configured cron, falling back to default", {
      key: config.settingsKey,
      configuredCron: config.cron,
      fallbackCron: config.fallbackCron,
      timezone: config.tz,
      error: error instanceof Error ? error.message : String(error),
    });
    await createSchedule({ id: config.id, cron: config.fallbackCron, tz: config.tz, submit: config.submit });
  }
};

const doRegister = async (): Promise<void> => {
  const [scheduleTz, ipaSyncCron, reminderCron, cleanupCron] = await Promise.all([
    getTimezoneSetting(),
    getCronSetting("freeipa.sync_cron", DEFAULT_IPA_SYNC_CRON),
    getCronSetting("user.account.reminder_cron", "0 9 * * *"),
    getCronSetting("app.cleanup_schedule", "0 4 * * *"),
  ]);

  await createScheduleWithFallback({
    id: "auth:ipa:sync",
    cron: ipaSyncCron,
    fallbackCron: DEFAULT_IPA_SYNC_CRON,
    tz: scheduleTz,
    settingsKey: "freeipa.sync_cron",
    submit: (key) => ipaSyncJob.submit({ key }),
  });

  await createSchedule({
    id: "auth:reminder:daily",
    cron: reminderCron,
    tz: scheduleTz,
    submit: (key) => reminderJob.submit({ key }),
  });

  await createSchedule({
    id: "auth:guest:cleanup",
    cron: cleanupCron,
    tz: scheduleTz,
    submit: (key) => guestCleanupJob.submit({ key }),
  });

  await createSchedule({
    id: "auth:local-user:cleanup",
    cron: cleanupCron,
    tz: scheduleTz,
    submit: (key) => localUserCleanupJob.submit({ key }),
  });

  await createSchedule({
    id: "auth:lifecycle:audit:cleanup",
    cron: cleanupCron,
    tz: scheduleTz,
    submit: (key) => auditCleanupJob.submit({ key }),
  });

  await createSchedule({
    id: "app:logs:cleanup",
    cron: cleanupCron,
    tz: scheduleTz,
    submit: (key) => logCleanupJob.submit({ key }),
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

  // Manual triggers — use a timestamp key so repeated presses within the same
  // millisecond are deduped but subsequent calls always enqueue a new run.
  submitIpaBackfill: (): Promise<string> => ipaBackfillJob.submit({ key: `manual:${Date.now()}` }),
  submitLocalUserBackfill: (): Promise<string> => localUserBackfillJob.submit({ key: `manual:${Date.now()}` }),
  submitGuestBackfill: (): Promise<string> => guestBackfillJob.submit({ key: `manual:${Date.now()}` }),
  submitReminderRun: (): Promise<string> => reminderJob.submit({ key: `manual:${Date.now()}` }),
  submitIpaSync: (): Promise<string> => ipaSyncJob.submit({ key: `manual:${Date.now()}` }),

  metrics: () => lifecycleScheduler.metric(),
  listSchedules: async () => lifecycleScheduler.list(),
};
