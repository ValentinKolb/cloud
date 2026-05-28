import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";

const log = logger("grids:record-events");

const TOPIC_PREFIX = "cloud:grids:events";
const TOPIC_RETENTION_MS = 24 * 60 * 60 * 1000;

export type GridsRecordEvent = {
  v: 1;
  type: "record.created" | "record.updated" | "record.deleted";
  baseId: string;
  tableId: string;
  recordId: string;
  version: number | null;
  changedFieldIds: string[];
  actorId: string | null;
  occurredAt: string;
};

const recordTopic = topic<GridsRecordEvent>({
  id: "records",
  prefix: TOPIC_PREFIX,
  retentionMs: TOPIC_RETENTION_MS,
  limits: { payloadBytes: 64_000 },
});

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
};

export const liveRecordEvents = (config: { baseId: string; after?: string | null; signal?: AbortSignal }) =>
  recordTopic.live({
    tenantId: config.baseId,
    after: config.after ?? undefined,
    signal: config.signal,
  });
