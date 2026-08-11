import { topic } from "@k2b/sync";
import { logger } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { type PublicSpaceEvent, type SpaceServiceEvent, type SpaceServiceEventData, toPublicSpaceEvent } from "../live-events";

const log = logger("spaces:events");
const TOPIC_PREFIX = "cloud:spaces:events";
const TOPIC_RETENTION_MS = 24 * 60 * 60 * 1000;
const TOPIC_ID = "items";

type StoredSpaceEvent = {
  internal: SpaceServiceEvent;
  public: PublicSpaceEvent;
};

type KnownPublicIds = {
  spaceId?: string;
  itemId?: string;
  wormholeId?: string;
};

const spaceTopic = topic<StoredSpaceEvent>({
  id: TOPIC_ID,
  prefix: TOPIC_PREFIX,
  retentionMs: TOPIC_RETENTION_MS,
  limits: { payloadBytes: 16_000 },
});

const shortId = async (table: "spaces" | "items" | "wormholes", id: string): Promise<string | null> => {
  let rows: { short_id: string }[];
  if (table === "spaces") rows = await sql`SELECT short_id FROM spaces.spaces WHERE id = ${id}::uuid`;
  else if (table === "items") rows = await sql`SELECT short_id FROM spaces.items WHERE id = ${id}::uuid`;
  else rows = await sql`SELECT short_id FROM spaces.wormholes WHERE id = ${id}::uuid`;
  return rows[0]?.short_id ?? null;
};

export const publishSpaceEvent = async (event: SpaceServiceEventData, known: KnownPublicIds = {}): Promise<void> => {
  const payload: SpaceServiceEvent = { ...event, at: new Date().toISOString() };
  const resourceId = "itemId" in payload ? payload.itemId : "wormholeId" in payload ? payload.wormholeId : payload.spaceId;
  try {
    const [spaceId, itemId, wormholeId] = await Promise.all([
      known.spaceId ? Promise.resolve(known.spaceId) : shortId("spaces", payload.spaceId),
      "itemId" in payload ? (known.itemId ? Promise.resolve(known.itemId) : shortId("items", payload.itemId)) : Promise.resolve(undefined),
      "wormholeId" in payload
        ? known.wormholeId
          ? Promise.resolve(known.wormholeId)
          : shortId("wormholes", payload.wormholeId)
        : Promise.resolve(undefined),
    ]);
    if (!spaceId) throw new Error("Missing public Space ID for live event");
    const publicEvent = toPublicSpaceEvent(payload, { spaceId, itemId: itemId ?? undefined, wormholeId: wormholeId ?? undefined });
    await spaceTopic.pub({
      tenantId: payload.spaceId,
      orderingKey: resourceId,
      idempotencyKey: `${payload.type}:${resourceId}:${payload.at}`,
      data: { internal: payload, public: publicEvent },
    });
  } catch (error) {
    log.warn("Failed to publish Spaces event", {
      type: payload.type,
      spaceId: payload.spaceId,
      resourceId,
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
