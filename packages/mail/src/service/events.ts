import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";

const log = logger("mail:events");

export type MailCollaborationEvent = {
  type: "conversation.changed";
  mailboxId: string;
  conversationId: string;
  reason: "collaboration" | "watcher" | "comment" | "inbound";
  targetId: string | null;
  activityId: string;
  at: string;
};

const collaborationTopic = topic<MailCollaborationEvent>({
  id: "collaboration",
  prefix: "cloud:mail:events",
  retentionMs: 24 * 60 * 60 * 1_000,
  limits: { payloadBytes: 8_000 },
});

export const publishMailCollaborationEvent = async (event: Omit<MailCollaborationEvent, "type" | "at">): Promise<void> => {
  const payload: MailCollaborationEvent = {
    type: "conversation.changed",
    ...event,
    at: new Date().toISOString(),
  };
  try {
    await collaborationTopic.pub({
      tenantId: payload.mailboxId,
      orderingKey: payload.conversationId,
      idempotencyKey: `activity:${payload.activityId}`,
      data: payload,
    });
  } catch (error) {
    log.warn("Failed to publish Mail collaboration event", {
      mailboxId: payload.mailboxId,
      conversationId: payload.conversationId,
      activityId: payload.activityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const liveMailCollaborationEvents = (params: { mailboxId: string; after?: string | null; signal?: AbortSignal }) =>
  collaborationTopic.live({
    tenantId: params.mailboxId,
    after: params.after ?? undefined,
    signal: params.signal,
  });

export const latestMailCollaborationEventCursor = (mailboxId: string): Promise<string | null> =>
  collaborationTopic.latestCursor({ tenantId: mailboxId });
