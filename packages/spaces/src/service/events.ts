import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";

const log = logger("spaces:events");
const TOPIC_PREFIX = "cloud:spaces:events";
const TOPIC_RETENTION_MS = 24 * 60 * 60 * 1000;
const TOPIC_ID = "items";

export type SpaceServiceEvent = {
  type: "item.created" | "item.updated" | "item.deleted" | "item.moved" | "item.completed";
  spaceId: string;
  itemId: string;
  at: string;
};

const spaceTopic = topic<SpaceServiceEvent>({
  id: TOPIC_ID,
  prefix: TOPIC_PREFIX,
  retentionMs: TOPIC_RETENTION_MS,
  limits: { payloadBytes: 16_000 },
});

export const publishSpaceEvent = async (event: Omit<SpaceServiceEvent, "at">): Promise<void> => {
  const payload: SpaceServiceEvent = { ...event, at: new Date().toISOString() };
  try {
    await spaceTopic.pub({
      tenantId: payload.spaceId,
      orderingKey: payload.itemId,
      idempotencyKey: `${payload.type}:${payload.itemId}:${payload.at}`,
      data: payload,
    });
  } catch (error) {
    log.warn("Failed to publish Spaces event", {
      type: payload.type,
      spaceId: payload.spaceId,
      itemId: payload.itemId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const liveSpaceEvents = (config: { spaceId: string; after?: string | null; signal?: AbortSignal }) =>
  spaceTopic.live({
    tenantId: config.spaceId,
    after: config.after ?? undefined,
    signal: config.signal,
  });

export const latestSpaceEventCursor = async (spaceId: string): Promise<string | null> => {
  return spaceTopic.latestCursor({ tenantId: spaceId });
};
