import { job, scheduler } from "@valentinkolb/sync";
import { logger, get as settingsGet } from "@valentinkolb/cloud/services";
import * as automations from "./automations";
import type { Automation, AutomationSubject } from "./types";

const log = logger("grids:automations");
const automationScheduler = scheduler({ id: "grids:automations" });
const RUN_RETENTION_SCHEDULE_ID = "maintenance:automation-runs";

type AutomationJobInput = {
  automationId: string;
  triggerKind: "schedule";
  reason: string;
  input: null;
  subject: AutomationSubject;
  slotTs: number;
};

const automationJob = job<AutomationJobInput, { runId: string | null; status: string }>({
  id: "grids:automations:webhook",
  defaults: { leaseMs: 120_000, keyTtlMs: 24 * 60 * 60 * 1000 },
  process: async ({ ctx }) => {
    const result = await automations.execute(ctx.input);
    if (!result.ok) {
      log.warn("Scheduled automation execution failed before run creation", {
        automationId: ctx.input.automationId,
        error: result.error.message,
      });
      return { runId: null, status: "failed" };
    }
    return { runId: result.data.id, status: result.data.status };
  },
});

let started = false;
let registerPromise: Promise<void> | null = null;

const scheduleId = (automationId: string): string => `automation:${automationId}`;

const getTimezone = async (automation: Automation): Promise<string> => {
  if (automation.trigger.kind === "schedule" && automation.trigger.timezone) {
    return automation.trigger.timezone;
  }
  const value = String((await settingsGet<string>("app.timezone")) || "").trim();
  return value.length > 0 ? value : "Europe/Berlin";
};

const createSchedule = async (automation: Automation): Promise<void> => {
  if (automation.trigger.kind !== "schedule" || !automation.enabled) {
    await automationScheduler.delete({ id: scheduleId(automation.id) });
    return;
  }
  const tz = await getTimezone(automation);
  await automationScheduler.create({
    id: scheduleId(automation.id),
    cron: automation.trigger.cron,
    tz,
    process: async ({ ctx }) => {
      await automationJob.submit({
        key: `${automation.id}:${ctx.slotTs}`,
        input: {
          automationId: automation.id,
          triggerKind: "schedule",
          reason: ctx.trigger === "manual" ? "schedule.manual-run" : "schedule",
          input: null,
          subject: { type: "base" },
          slotTs: ctx.slotTs,
        },
      });
    },
  });
  log.info("Automation schedule registered", {
    automationId: automation.id,
    cron: automation.trigger.cron,
    timezone: tz,
  });
};

const registerAll = async (): Promise<void> => {
  const staleRuns = await automations.markStaleRunningRunsFailed();
  if (staleRuns > 0) {
    log.warn("Stale automation runs marked failed", { count: staleRuns });
  }

  await automationScheduler.create({
    id: RUN_RETENTION_SCHEDULE_ID,
    cron: "17 3 * * *",
    tz: "Europe/Berlin",
    process: async () => {
      const deleted = await automations.purgeOldRuns();
      if (deleted > 0) log.info("Old automation runs purged", { deleted });
    },
  });

  const scheduled = await automations.listScheduledEnabled();
  const activeIds = new Set(scheduled.map((automation) => scheduleId(automation.id)));
  for (const automation of scheduled) {
    try {
      await createSchedule(automation);
    } catch (error) {
      log.warn("Automation schedule registration failed", {
        automationId: automation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const registered = await automationScheduler.list();
  for (const item of registered) {
    if (item.id.startsWith("automation:") && !activeIds.has(item.id)) {
      await automationScheduler.delete({ id: item.id });
      log.info("Orphan automation schedule removed", { scheduleId: item.id });
    }
  }
};

export const automationRuntime = {
  start: async (): Promise<void> => {
    if (!started) {
      automationScheduler.start();
      started = true;
    }
    if (!registerPromise) {
      registerPromise = registerAll().finally(() => {
        registerPromise = null;
      });
    }
    await registerPromise;
  },

  stop: async (): Promise<void> => {
    if (!started) return;
    await automationScheduler.stop();
    automationJob.stop();
    started = false;
    registerPromise = null;
  },

  sync: async (automation: Automation): Promise<void> => {
    if (!started) {
      automationScheduler.start();
      started = true;
    }
    await createSchedule(automation);
  },

  delete: async (automationId: string): Promise<void> => {
    await automationScheduler.delete({ id: scheduleId(automationId) });
  },
};
