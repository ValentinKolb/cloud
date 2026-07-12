import { type BoundNotificationMap, notification } from "@valentinkolb/cloud";
import { coreSettings, logger, notifications, trace } from "@valentinkolb/cloud/services";
import { scheduler } from "@valentinkolb/sync";
import { sql } from "bun";
import { z } from "zod";

const RECOVERY_SCHEDULE_ID = "assistant:notifications:recover";
const RECOVERY_BATCH_SIZE = 100;

const log = logger("assistant:notifications");

export const NOTIFICATIONS = {
  turnCompleted: notification({
    recipient: "user",
    label: "Assistant responses",
    description: "A notification when a background Assistant response finishes.",
    delivery: { recommended: ["browser"] },
    data: z.object({ conversationId: z.uuid() }),
    render: ({ conversationId }) => ({
      title: "Assistant response ready",
      body: "Your Assistant response has finished.",
      targetHref: `/app/assistant?conversation=${encodeURIComponent(conversationId)}`,
    }),
    email: async ({ conversationId }) => {
      const configuredUrl = String((await coreSettings.get<string>("app.url")) || "").trim();
      const baseUrl = /^https?:\/\//.test(configuredUrl) ? configuredUrl : configuredUrl ? `https://${configuredUrl}` : "";
      const target = `/app/assistant?conversation=${encodeURIComponent(conversationId)}`;
      return {
        subject: "Assistant response ready",
        content: `Your Assistant response has finished. Open it at ${baseUrl ? `${baseUrl.replace(/\/+$/, "")}${target}` : target}`,
      };
    },
  }),
};

type AssistantNotificationDefinitions = BoundNotificationMap<"assistant", typeof NOTIFICATIONS>;

type CompletionCandidate = {
  turn_id: string;
  conversation_id: string;
  user_id: string;
};

export type AssistantNotificationRecoverySummary = {
  scanned: number;
  sent: number;
  failed: number;
};

export const createAssistantNotificationService = (definitions: AssistantNotificationDefinitions) => {
  const recoveryScheduler = scheduler({ id: "assistant-notifications" });
  let started = false;

  const recover = async (input: { turnId?: string; limit?: number } = {}): Promise<AssistantNotificationRecoverySummary> => {
    const limit = Math.min(Math.max(Math.floor(input.limit ?? RECOVERY_BATCH_SIZE), 1), 1_000);
    const candidates = await sql<CompletionCandidate[]>`
      SELECT turn.id AS turn_id,
             conversation.id AS conversation_id,
             conversation.created_by_user_id AS user_id
      FROM ai.turns turn
      JOIN ai.conversations conversation ON conversation.id = turn.conversation_id
      JOIN notifications.definitions definition ON definition.id = ${definitions.turnCompleted.id}
      WHERE turn.status = 'completed'
        AND turn.completed_at >= definition.first_seen_at
        AND turn.run_config->>'kind' = 'chat'
        AND conversation.app_id = 'assistant'
        AND conversation.resource_kind = 'direct'
        AND conversation.created_by_user_id IS NOT NULL
        AND (${input.turnId ?? null}::uuid IS NULL OR turn.id = ${input.turnId ?? null}::uuid)
        AND NOT EXISTS (
          SELECT 1
          FROM notifications.events event
          WHERE event.definition_id = ${definitions.turnCompleted.id}
            AND event.idempotency_key = 'turn:' || turn.id::text
        )
      ORDER BY turn.completed_at, turn.id
      LIMIT ${limit}
    `;

    let sent = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        await notifications.send(definitions.turnCompleted, {
          recipient: { userId: candidate.user_id },
          data: { conversationId: candidate.conversation_id },
          idempotencyKey: `turn:${candidate.turn_id}`,
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        log.warn("Failed to create Assistant completion notification", {
          conversationId: candidate.conversation_id,
          turnId: candidate.turn_id,
          error: error instanceof Error ? error.message : "Notification creation failed",
        });
      }
    }
    if (failed > 0) throw new Error(`Failed to create ${failed} Assistant completion notification(s).`);
    return { scanned: candidates.length, sent, failed };
  };

  return {
    notifyTurnCompleted: (turnId: string): Promise<AssistantNotificationRecoverySummary> => recover({ turnId, limit: 1 }),

    start: async (): Promise<void> => {
      if (started) return;
      recoveryScheduler.start();
      started = true;
      try {
        const timezone = String((await coreSettings.get<string>("app.timezone")) || "").trim() || "Europe/Berlin";
        await recoveryScheduler.create({
          id: RECOVERY_SCHEDULE_ID,
          cron: "* * * * *",
          tz: timezone,
          meta: {
            appId: "assistant",
            family: "ai:chat",
            label: "Assistant completion notifications",
            source: RECOVERY_SCHEDULE_ID,
            resourceKind: "notification-recovery",
            resourceId: "assistant-turns",
            resourceLabel: "Assistant chats",
            detailHref: "/me/notifications",
          },
          trace: trace.fromSyncSchedule<AssistantNotificationRecoverySummary>({
            name: "Assistant completion notification recovery",
            source: RECOVERY_SCHEDULE_ID,
            appId: "assistant",
            summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
          }),
          process: () => recover(),
          after: ({ ctx }) => {
            if (!ctx.error || ctx.failureCount >= 3) return;
            ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 60_000 }) });
          },
        });
        await recoveryScheduler.runNow({ id: RECOVERY_SCHEDULE_ID }).catch((error) => {
          log.warn("Initial Assistant notification recovery failed", {
            error: error instanceof Error ? error.message : "Notification recovery failed",
          });
        });
      } catch (error) {
        await recoveryScheduler.stop().catch(() => undefined);
        started = false;
        throw error;
      }
    },

    stop: async (): Promise<void> => {
      if (!started) return;
      await recoveryScheduler.stop();
      started = false;
    },
  } as const;
};
