import { queue, topic } from "@valentinkolb/sync";
import { z } from "zod";

const TOPIC_PREFIX = "cloud:grids:events";
const TOPIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TOPIC_ID = "records";
const WORK_QUEUE_PREFIX = "cloud:grids:workflow-events";
const WORK_QUEUE_TENANT = "workflow-kernel";
export const RECORD_EVENT_WORK_PARTITIONS = 32;
export const RECORD_EVENT_WORK_LEASE_MS = 120_000;
// At the five-minute retry cap this outlives the queue's 30-day message-age limit.
// The application dead-letter budget remains intentionally smaller and is tracked in PostgreSQL.
export const RECORD_EVENT_WORK_MAX_DELIVERIES = 10_000;

export const GridsRecordEventSchema = z
  .object({
    v: z.literal(1),
    type: z.enum(["record.created", "record.updated", "record.deleted", "record.restored"]),
    baseId: z.string().uuid(),
    tableId: z.string().uuid(),
    recordId: z.string().uuid(),
    version: z.number().int().positive().nullable(),
    changedFieldIds: z.array(z.string().uuid()),
    actorId: z.string().uuid().nullable(),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type GridsRecordEvent = z.infer<typeof GridsRecordEventSchema>;

const recordTopic = topic<GridsRecordEvent>({
  id: TOPIC_ID,
  prefix: TOPIC_PREFIX,
  retentionMs: TOPIC_RETENTION_MS,
  limits: { payloadBytes: 64_000 },
});

const recordWorkQueues = Array.from({ length: RECORD_EVENT_WORK_PARTITIONS }, (_, partition) =>
  queue<GridsRecordEvent>({
    id: `records:${partition}`,
    prefix: WORK_QUEUE_PREFIX,
    tenantId: WORK_QUEUE_TENANT,
    ordering: { mode: "ordering_key_partitioned", partitions: 1 },
    limits: {
      payloadBytes: 64_000,
      maxMessageAgeMs: TOPIC_RETENTION_MS,
      dlqRetentionMs: TOPIC_RETENTION_MS,
    },
    delivery: { defaultLeaseMs: RECORD_EVENT_WORK_LEASE_MS, maxDeliveries: RECORD_EVENT_WORK_MAX_DELIVERIES },
  }),
);

export const recordEventWorkPartition = (recordId: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < recordId.length; index += 1) {
    hash ^= recordId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % RECORD_EVENT_WORK_PARTITIONS;
};

const recordEventIdempotencyKey = (event: GridsRecordEvent): string =>
  `${event.type}:${event.recordId}:${event.version ?? "deleted"}:${event.occurredAt}`;

export const publishRecordEvent = async (event: GridsRecordEvent, options: { replayKey?: string } = {}): Promise<void> => {
  const idempotencyKey = recordEventIdempotencyKey(event);
  const workIdempotencyKey = options.replayKey ? `${idempotencyKey}:replay:${options.replayKey}` : idempotencyKey;
  const workQueue = recordWorkQueues[recordEventWorkPartition(event.recordId)];
  if (!workQueue) throw new Error("record event work partition is unavailable");
  await Promise.all([
    recordTopic.pub({
      tenantId: event.baseId,
      orderingKey: event.recordId,
      idempotencyKey,
      data: event,
    }),
    workQueue.send({
      orderingKey: event.recordId,
      idempotencyKey: `${event.baseId}:${workIdempotencyKey}`,
      idempotencyTtlMs: TOPIC_RETENTION_MS,
      meta: { baseId: event.baseId },
      data: event,
    }),
  ]);
};

export const recordEventReader = (group: string) => recordTopic.reader(group);

export const recordEventWorkReader = (partition: number) => {
  const workQueue = recordWorkQueues[partition];
  if (!workQueue) throw new RangeError(`record event work partition ${partition} is unavailable`);
  return workQueue.reader();
};

export const liveRecordEvents = (config: { baseId: string; after?: string | null; signal?: AbortSignal }) =>
  recordTopic.live({
    tenantId: config.baseId,
    after: config.after ?? undefined,
    signal: config.signal,
  });

export const latestRecordEventCursor = (baseId: string): Promise<string | null> => recordTopic.latestCursor({ tenantId: baseId });
