import { topic } from "@valentinkolb/sync";

const TOPIC_PREFIX = "cloud:grids:events";
const TOPIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TOPIC_ID = "records";
const RECLAIM_CONSUMER = `grids:record-events:${process.pid}:${Bun.randomUUIDv7()}`;

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

const recordTopic = topic<GridsRecordEvent>({
  id: TOPIC_ID,
  prefix: TOPIC_PREFIX,
  retentionMs: TOPIC_RETENTION_MS,
  limits: { payloadBytes: 64_000 },
});

const streamKey = (baseId: string): string => `${TOPIC_PREFIX}:${baseId}:${TOPIC_ID}:stream`;

type ReclaimedRecordEvent = { data: GridsRecordEvent; commit: () => Promise<boolean> };

const parseReclaimedEntries = (raw: unknown): Array<{ id: string; data: GridsRecordEvent }> => {
  if (!Array.isArray(raw) || !Array.isArray(raw[1])) return [];
  const entries: Array<{ id: string; data: GridsRecordEvent }> = [];
  for (const item of raw[1]) {
    if (!Array.isArray(item) || typeof item[0] !== "string" || !Array.isArray(item[1])) continue;
    const fields = item[1];
    const payloadIndex = fields.findIndex((value) => value === "payload");
    const payloadRaw = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
    if (typeof payloadRaw !== "string") continue;
    try {
      const parsed = JSON.parse(payloadRaw) as { data?: GridsRecordEvent };
      if (parsed.data?.v === 1) entries.push({ id: item[0], data: parsed.data });
    } catch {}
  }
  return entries;
};

const parseLatestCursor = (raw: unknown): string | null => {
  if (!Array.isArray(raw)) return null;
  const first = raw[0];
  if (!Array.isArray(first)) return null;
  return typeof first[0] === "string" ? first[0] : null;
};

export const publishRecordEvent = async (event: GridsRecordEvent): Promise<void> => {
  await recordTopic.pub({
    tenantId: event.baseId,
    orderingKey: event.tableId,
    idempotencyKey: `${event.type}:${event.recordId}:${event.version ?? "deleted"}:${event.occurredAt}`,
    data: event,
  });
};

export const recordEventReader = (group: string) => recordTopic.reader(group);

export const reclaimRecordEventDeliveries = async (baseId: string, group: string, minIdleMs = 60_000): Promise<ReclaimedRecordEvent[]> => {
  const key = streamKey(baseId);
  try {
    await Bun.redis.send("XGROUP", ["CREATE", key, group, "0", "MKSTREAM"]);
  } catch (error) {
    if (!String(error).includes("BUSYGROUP")) throw error;
  }
  const raw = await Bun.redis.send("XAUTOCLAIM", [key, group, RECLAIM_CONSUMER, String(minIdleMs), "0-0", "COUNT", "25"]);
  return parseReclaimedEntries(raw).map((entry) => ({
    data: entry.data,
    commit: async () => Number(await Bun.redis.send("XACK", [key, group, entry.id])) > 0,
  }));
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
