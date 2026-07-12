import { topic } from "@valentinkolb/sync";
import type { NotificationPresentation } from "../../contracts/notification-types";
import { logger } from "../logging";

const LIVE_TOPIC_ID = "events";
const LIVE_TOPIC_PREFIX = "cloud:notifications:live";
const LIVE_RETENTION_MS = 60 * 60 * 1_000;

const log = logger("notifications:live");

export type NotificationLiveEvent = {
  type: "cloud-notification";
  eventId: string;
  title: string;
  targetHref?: `/${string}`;
};

const liveTopic = topic<NotificationLiveEvent>({
  id: LIVE_TOPIC_ID,
  prefix: LIVE_TOPIC_PREFIX,
  retentionMs: LIVE_RETENTION_MS,
  limits: { payloadBytes: 8_000 },
});

const publish = async (input: { userId: string; eventId: string; presentation: NotificationPresentation }): Promise<void> => {
  const event: NotificationLiveEvent = {
    type: "cloud-notification",
    eventId: input.eventId,
    title: input.presentation.title,
    ...(input.presentation.targetHref ? { targetHref: input.presentation.targetHref } : {}),
  };
  try {
    await liveTopic.pub({
      tenantId: input.userId,
      orderingKey: input.userId,
      idempotencyKey: `event:${input.eventId}`,
      data: event,
    });
  } catch (error) {
    log.warn("Failed to publish foreground notification", {
      eventId: input.eventId,
      error: error instanceof Error ? error.message : "Foreground notification publish failed",
    });
  }
};

export const notificationLive = {
  publish,
  latestCursor: (userId: string): Promise<string | null> => liveTopic.latestCursor({ tenantId: userId }),
  events: (input: { userId: string; after?: string; signal?: AbortSignal }) =>
    liveTopic.live({ tenantId: input.userId, after: input.after, signal: input.signal }),
} as const;
