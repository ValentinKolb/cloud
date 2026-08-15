import { job, mutex, scheduler } from "@k2b/sync";
import { aiChatTasks, aiConversations, aiProjects, enqueueExistingAiTurn, validateAiTurnRequest } from "@valentinkolb/cloud/ai";
import { accounts, coreSettings, logger } from "@valentinkolb/cloud/services";
import { isAccountExpired } from "@valentinkolb/cloud/services/account-model";
import { assistantModelPolicy } from "./model-policy";
import { assistantChatPrompt } from "./prompt";

const APP_ID = "assistant";
const RECOVERY_ID = "assistant:chat-tasks:recover";
const SCHEDULE_PREFIX = "task:";
const log = logger("assistant:chat-tasks");

const taskScheduler = scheduler({ id: "assistant-chat-tasks" });
const reconcileMutex = mutex({ id: "assistant:chat-tasks:reconcile", defaultTtl: 60_000, retryCount: 0 });
let started = false;

const taskJob = job<{ occurrenceId: string }, { status: "gone" | "failed" | "not_found" | "busy" | "stale" | "delivered"; retry: boolean }>(
  {
    id: "assistant-chat-task-occurrence",
    defaults: { leaseMs: 60_000, keyTtlMs: 24 * 60 * 60_000 },
    process: async ({ ctx }) => {
      const pending = await aiChatTasks.getQueuedOccurrence(APP_ID, ctx.input.occurrenceId);
      if (!pending) return { status: "gone" as const, retry: false };
      const { occurrence, task } = pending;
      const [user, conversation] = await Promise.all([
        accounts.users.get({ id: task.sponsorUserId }),
        aiConversations.getConversation({ conversationId: task.conversationId, appId: APP_ID, ownerUserId: task.sponsorUserId }),
      ]);
      if (!user || isAccountExpired(user.accountExpires) || !conversation) {
        const status = await aiChatTasks.failOccurrence({ occurrenceId: occurrence.id, error: "Task sponsor or chat is unavailable" });
        return { status: status === "gone" ? ("not_found" as const) : status, retry: status === "stale" };
      }
      const project = conversation.projectId
        ? await aiProjects.snapshot(conversation.projectId, APP_ID, { type: "user", userId: user.id })
        : null;
      if (conversation.projectId && !project) {
        const status = await aiChatTasks.failOccurrence({ occurrenceId: occurrence.id, error: "Current Project access is unavailable" });
        return { status: status === "gone" ? ("not_found" as const) : status, retry: status === "stale" };
      }
      const text = `Scheduled task ${task.shortId} (${occurrence.scheduledFor}):\n\n${task.prompt}`;
      const { resolved } = await validateAiTurnRequest({
        input: text,
        modelPolicy: assistantModelPolicy,
        requestedModelId: project?.defaultModelProfileId ?? undefined,
      });
      const delivered = await aiChatTasks.deliverOccurrence({
        occurrenceId: occurrence.id,
        modelProfileId: resolved.profile.id,
        runConfig: {
          kind: "chat",
          input: text,
          actor: { kind: "user", user },
          modelPolicy: assistantModelPolicy,
          requestedModelId: project?.defaultModelProfileId ?? undefined,
          systemPrompt: assistantChatPrompt(conversation.shortId),
          project: project ?? undefined,
          toolSource: { kind: "default", capabilities: true },
          toolApprovalContext: { actorUserId: user.id, appId: APP_ID, resource: { kind: "direct" } },
        },
        userMessage: { role: "user", content: [{ type: "text", text }] },
        expectedRevision: task.revision,
      });
      if (!delivered.delivered) return { status: delivered.reason, retry: delivered.reason === "busy" || delivered.reason === "stale" };
      await enqueueExistingAiTurn({ conversationId: delivered.conversationId, turnId: delivered.turnId });
      return { status: "delivered" as const, retry: false };
    },
    after: async ({ ctx }) => {
      if (ctx.data?.retry) {
        ctx.reschedule({ delayMs: 60_000 });
        return;
      }
      if (!ctx.error) return;
      if (ctx.failureCount < 2) {
        ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 60_000 }) });
        return;
      }
      const status = await aiChatTasks
        .failOccurrence({
          occurrenceId: ctx.input.occurrenceId,
          error: ctx.error instanceof Error ? ctx.error.message : "Scheduled task delivery failed",
        })
        .catch(() => "gone" as const);
      if (status === "stale") ctx.reschedule({ delayMs: 60_000 });
    },
  },
);

const submitOccurrence = (occurrenceId: string): Promise<string> =>
  taskJob.submit({ key: `occurrence:${occurrenceId}`, input: { occurrenceId } });

const registerRecurringTask = async (task: Awaited<ReturnType<typeof aiChatTasks.listActiveCron>>[number]): Promise<void> => {
  if (task.schedule.kind !== "cron") return;
  await taskScheduler.create({
    id: `${SCHEDULE_PREFIX}${task.id}`,
    cron: task.schedule.cron,
    tz: task.timezone,
    meta: {
      appId: APP_ID,
      family: "ai:chat-task",
      resourceKind: "chat-task",
      resourceId: task.shortId,
      resourceLabel: task.prompt.slice(0, 200),
    },
    process: async ({ ctx }) => {
      const slot = new Date(ctx.slotTs).toISOString();
      const occurrence = await aiChatTasks.createOccurrence({
        taskId: task.id,
        scheduledFor: slot,
        trigger: "scheduled",
        requestKey: `cron:${task.id}:${slot}`,
        expectedRevision: task.revision,
      });
      if (occurrence?.state === "queued") await submitOccurrence(occurrence.id);
    },
  });
};

export const reconcileAssistantChatTasks = async (): Promise<void> => {
  const lock = await reconcileMutex.acquire(APP_ID, 60_000);
  if (!lock) return;
  try {
    const tasks = await aiChatTasks.listActiveCron(APP_ID);
    const desired = new Set(tasks.map((task) => `${SCHEDULE_PREFIX}${task.id}`));
    for (const task of tasks) await registerRecurringTask(task);
    for (const current of await taskScheduler.list()) {
      if (current.id.startsWith(SCHEDULE_PREFIX) && !desired.has(current.id)) await taskScheduler.delete({ id: current.id });
    }
  } finally {
    await reconcileMutex.release(lock).catch(() => undefined);
  }
};

const recover = async (): Promise<{ queued: number }> => {
  await reconcileAssistantChatTasks();
  for (const terminal of await aiChatTasks.listTerminalRunningTurns(APP_ID)) {
    await aiChatTasks.finalizeTurn(terminal);
  }
  await aiChatTasks.materializeDueOnce(APP_ID);
  const queued = await aiChatTasks.listQueuedOccurrences(APP_ID);
  for (const { occurrence } of queued) await submitOccurrence(occurrence.id);
  return { queued: queued.length };
};

export const assistantChatTaskRuntime = {
  start: async (): Promise<void> => {
    if (started) return;
    taskScheduler.start();
    started = true;
    try {
      const timezone = String((await coreSettings.get<string>("app.timezone")) || "").trim() || "UTC";
      await reconcileAssistantChatTasks();
      await taskScheduler.create({
        id: RECOVERY_ID,
        cron: "* * * * *",
        tz: timezone,
        meta: { appId: APP_ID, family: "ai:chat-task", label: "Scheduled chat task recovery" },
        process: recover,
      });
      await taskScheduler.runNow({ id: RECOVERY_ID }).catch((error) => {
        log.warn("Initial scheduled chat task recovery failed", { error: error instanceof Error ? error.message : String(error) });
      });
    } catch (error) {
      await taskScheduler.stop().catch(() => undefined);
      started = false;
      throw error;
    }
  },

  stop: async (): Promise<void> => {
    if (!started) return;
    taskJob.stop();
    await taskScheduler.stop();
    started = false;
  },

  recover,
} as const;
