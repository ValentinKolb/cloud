import { job, scheduler } from "@valentinkolb/sync";
import { coreSettings } from "../services";
import { logger, trace } from "../services/logging";
import type { AiEnrichmentRunSummary } from "./enrich";
import { enrichDirtyAiConversations } from "./enrich";

const log = logger("ai:maintenance");

export const AI_ENRICH_CRON_SETTING_KEY = "ai.enrich_cron";
const DEFAULT_ENRICH_CRON = "*/10 * * * *";

const getCronSetting = async (key: string, fallback: string): Promise<string> => {
  const value = String((await coreSettings.get<string>(key)) || "").trim();
  return value.length > 0 ? value : fallback;
};

const getTimezoneSetting = async (): Promise<string> => {
  const value = String((await coreSettings.get<string>("app.timezone")) || "").trim();
  return value.length > 0 ? value : "Europe/Berlin";
};

// ── Job ────────────────────────────────────────────────────────────────

const enrichJob = job<void, AiEnrichmentRunSummary>({
  id: "ai:chat:enrich",
  // Generous lease: one slow local model call can take minutes; heartbeat per
  // conversation extends it, but the lease must cover the slowest single item.
  defaults: { leaseMs: 900_000 },
  trace: trace.fromSyncJob<void, AiEnrichmentRunSummary>({
    name: "AI chat enrichment",
    source: "ai:chat:enrich",
    appId: "assistant",
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: async ({ ctx }) => {
    const summary = await enrichDirtyAiConversations({
      signal: ctx.signal,
      heartbeat: () => ctx.heartbeat(),
    });
    if (summary.scanned > 0) log.info("Chat enrichment run complete", { ...summary });
    return summary;
  },
  after: ({ ctx }) => {
    if (!ctx.error) return;
    if (ctx.failureCount >= 2) return;
    ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 2_000, maxMs: 60_000 }) });
  },
});

/**
 * User-triggered single-chat reindex. Its own job (and therefore its own
 * queue worker) so a click never waits behind a long scheduled batch run.
 */
const reindexJob = job<{ conversationId: string }, AiEnrichmentRunSummary>({
  id: "ai:chat:reindex",
  defaults: { leaseMs: 300_000 },
  trace: trace.fromSyncJob<{ conversationId: string }, AiEnrichmentRunSummary>({
    name: "AI chat reindex (manual)",
    source: "ai:chat:reindex",
    appId: "assistant",
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: async ({ ctx }) => {
    return enrichDirtyAiConversations({
      conversationId: ctx.input.conversationId,
      signal: ctx.signal,
      heartbeat: () => ctx.heartbeat(),
    });
  },
  after: ({ ctx }) => {
    if (!ctx.error) return;
    if (ctx.failureCount >= 1) return;
    ctx.reschedule({ delayMs: 2_000 });
  },
});

// ── Schedule ───────────────────────────────────────────────────────────

const aiScheduler = scheduler({ id: "ai-maintenance" });

let started = false;
let registered = false;
let registerPromise: Promise<void> | null = null;

const createSchedule = async (config: {
  id: string;
  cron: string;
  tz: string;
  submit: (key: string) => Promise<string>;
}): Promise<void> => {
  await aiScheduler.create({
    id: config.id,
    cron: config.cron,
    tz: config.tz,
    meta: {
      appId: "assistant",
      family: "ai:chat",
      label: "Chat enrichment",
      source: config.id,
      resourceKind: "ai-enrichment",
      resourceId: "chat-enrichment",
      resourceLabel: "Assistant chats",
      detailHref: "/admin/settings?tab=ai",
    },
    trace: trace.fromSyncSchedule<void>({ name: config.id, source: config.id, appId: "assistant" }),
    process: async ({ ctx }) => {
      await config.submit(`slot:${ctx.slotTs}`);
    },
  });
};

/**
 * Coalescing submit for scheduled runs: one stable idempotency key means at
 * most one scheduled run is queued or running at a time. On slow models a run
 * can outlast the cron interval — extra slots must not pile up in the queue
 * (they would also starve manual work); the dirty scan catches up next slot.
 * The key is released on completion; the TTL is only a crash backstop.
 */
const submitScheduledRun = (): Promise<string> => enrichJob.submit({ key: "scheduled", keyTtlMs: 30 * 60_000 });

const doRegister = async (): Promise<void> => {
  const [tz, enrichCron] = await Promise.all([getTimezoneSetting(), getCronSetting(AI_ENRICH_CRON_SETTING_KEY, DEFAULT_ENRICH_CRON)]);
  try {
    await createSchedule({ id: "ai:chat:enrich", cron: enrichCron, tz, submit: () => submitScheduledRun() });
  } catch (error) {
    if (enrichCron === DEFAULT_ENRICH_CRON) throw error;
    log.warn("Invalid configured enrichment cron, falling back to default", {
      key: AI_ENRICH_CRON_SETTING_KEY,
      configuredCron: enrichCron,
      fallbackCron: DEFAULT_ENRICH_CRON,
      error: error instanceof Error ? error.message : String(error),
    });
    await createSchedule({ id: "ai:chat:enrich", cron: DEFAULT_ENRICH_CRON, tz, submit: () => submitScheduledRun() });
  }
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

/** Well-formed but never-existing id — boot warm-up submit that starts the reindex queue worker as a no-op. */
const WARMUP_CONVERSATION_ID = "00000000-0000-0000-0000-000000000000";

/** AI maintenance jobs (chat enrichment). Started next to the AI runtime; leases make this horizontally safe. */
export const aiMaintenanceJobs = {
  start: async (): Promise<void> => {
    if (!started) {
      aiScheduler.start();
      started = true;
    }
    await ensureRegistered();
    // Queue workers only start on submit — kick both at boot so (a) a deploy
    // catches up on dirty chats immediately and (b) reindex requests queued
    // before a restart drain without waiting for the next user click.
    await submitScheduledRun().catch(() => undefined);
    await reindexJob
      .submit({ key: "boot-warmup", keyTtlMs: 60_000, input: { conversationId: WARMUP_CONVERSATION_ID } })
      .catch(() => undefined);
  },

  stop: async (): Promise<void> => {
    if (!started) return;
    await aiScheduler.stop();
    enrichJob.stop();
    reindexJob.stop();
    started = false;
    registered = false;
    registerPromise = null;
  },

  /** Manual full run (admin/testing). */
  submitEnrichmentRun: (): Promise<string> => enrichJob.submit({ key: `manual:${Date.now()}` }),

  /**
   * User-triggered reindex of one conversation on the dedicated reindex queue
   * (never waits behind scheduled batch runs). The stable per-conversation key
   * coalesces rapid clicks while a reindex is queued or running; it is
   * released on completion, so the next click after that starts a fresh run.
   */
  submitConversationReindex: (conversationId: string): Promise<string> =>
    reindexJob.submit({
      key: `reindex:${conversationId}`,
      keyTtlMs: 15 * 60_000,
      input: { conversationId },
    }),
};
