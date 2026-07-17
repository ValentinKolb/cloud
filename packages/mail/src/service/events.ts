import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";
import type { MailCollaborationEvent, MailConversationChangedEvent, MailMailboxChangedEvent } from "../live-events";

const log = logger("mail:events");

export type { MailCollaborationEvent, MailConversationChangedEvent, MailMailboxChangedEvent } from "../live-events";

const collaborationTopic = topic<MailCollaborationEvent>({
  id: "collaboration",
  prefix: "cloud:mail:events",
  retentionMs: 24 * 60 * 60 * 1_000,
  limits: { payloadBytes: 8_000 },
});

export const publishMailCollaborationEvent = async (
  event: Omit<MailConversationChangedEvent, "type" | "at">,
): Promise<void> => {
  const payload: MailConversationChangedEvent = {
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

export const publishMailMailboxEvent = async (
  event: Omit<MailMailboxChangedEvent, "type" | "at">,
): Promise<void> => {
  const payload: MailMailboxChangedEvent = {
    type: "mailbox.changed",
    ...event,
    at: new Date().toISOString(),
  };
  try {
    await collaborationTopic.pub({
      tenantId: payload.mailboxId,
      orderingKey: payload.mailboxId,
      idempotencyKey: `activity:${payload.activityId}`,
      data: payload,
    });
  } catch (error) {
    log.warn("Failed to publish Mail mailbox event", {
      mailboxId: payload.mailboxId,
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
