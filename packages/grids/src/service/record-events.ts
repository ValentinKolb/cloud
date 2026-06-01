import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";

const log = logger("grids:record-events");

const TOPIC_PREFIX = "cloud:grids:events";
const TOPIC_RETENTION_MS = 24 * 60 * 60 * 1000;
const TOPIC_ID = "records";

export type GridsRecordEvent = {
  v: 1;
  type: "record.created" | "record.updated" | "record.deleted" | "record.restored";
  baseId: string;
  tableId: string;
  recordId: string;
  version: number | null;
  changedFieldIds: string[];
  actorId: string | null;
  occurredAt: string;
};

type GridsRecordEventHandler = (event: GridsRecordEvent) => Promise<void> | void;

const recordTopic = topic<GridsRecordEvent>({
  id: TOPIC_ID,
  prefix: TOPIC_PREFIX,
  retentionMs: TOPIC_RETENTION_MS,
  limits: { payloadBytes: 64_000 },
});

const recordEventHandlers = new Set<GridsRecordEventHandler>();

const streamKey = (baseId: string): string => `${TOPIC_PREFIX}:${baseId}:${TOPIC_ID}:stream`;

const parseLatestCursor = (raw: unknown): string | null => {
  if (!Array.isArray(raw)) return null;
  const first = raw[0];
  if (!Array.isArray(first)) return null;
  return typeof first[0] === "string" ? first[0] : null;
};

export const publishRecordEvent = async (event: GridsRecordEvent): Promise<void> => {
  try {
    await recordTopic.pub({
      tenantId: event.baseId,
      orderingKey: event.tableId,
      idempotencyKey: `${event.type}:${event.recordId}:${event.version ?? "deleted"}:${event.occurredAt}`,
      data: event,
    });
  } catch (error) {
    log.warn("Failed to publish Grids record event", {
      type: event.type,
      baseId: event.baseId,
      tableId: event.tableId,
      recordId: event.recordId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  for (const handler of recordEventHandlers) {
    try {
      await handler(event);
    } catch (error) {
      log.warn("Failed to handle Grids record event", {
        type: event.type,
        baseId: event.baseId,
        tableId: event.tableId,
        recordId: event.recordId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

export const registerRecordEventHandler = (handler: GridsRecordEventHandler): (() => void) => {
  recordEventHandlers.add(handler);
  return () => recordEventHandlers.delete(handler);
};

export const liveRecordEvents = (config: { baseId: string; after?: string | null; signal?: AbortSignal }) =>
  recordTopic.live({
    tenantId: config.baseId,
    after: config.after ?? undefined,
    signal: config.signal,
  });

export const latestRecordEventCursor = async (baseId: string): Promise<string | null> => {
  try {
    return parseLatestCursor(await Bun.redis.send("XREVRANGE", [streamKey(baseId), "+", "-", "COUNT", "1"]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no such key") || message.includes("ERR no such key")) return null;
    throw error;
  }
};
