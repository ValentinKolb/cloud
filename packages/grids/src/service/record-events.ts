import { topic } from "@valentinkolb/sync";
import { z } from "zod";

const TOPIC_PREFIX = "cloud:grids:events";
const TOPIC_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TOPIC_ID = "records";

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

export const publishRecordEvent = async (event: GridsRecordEvent): Promise<void> => {
  await recordTopic.pub({
    tenantId: event.baseId,
    orderingKey: event.tableId,
    idempotencyKey: `${event.type}:${event.recordId}:${event.version ?? "deleted"}:${event.occurredAt}`,
    data: event,
  });
};

export const recordEventReader = (group: string) => recordTopic.reader(group);

export const liveRecordEvents = (config: { baseId: string; after?: string | null; signal?: AbortSignal }) =>
  recordTopic.live({
    tenantId: config.baseId,
    after: config.after ?? undefined,
    signal: config.signal,
  });

export const latestRecordEventCursor = (baseId: string): Promise<string | null> => recordTopic.latestCursor({ tenantId: baseId });
