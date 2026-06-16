import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";
import { sql } from "bun";

const log = logger("grids:metadata-events");

const TOPIC_PREFIX = "cloud:grids:events";
const TOPIC_RETENTION_MS = 24 * 60 * 60 * 1000;
const TOPIC_ID = "metadata";

export type GridsMetadataEvent = {
  v: 1;
  type:
    | "base.created"
    | "base.updated"
    | "base.deleted"
    | "base.restored"
    | "table.created"
    | "table.updated"
    | "table.deleted"
    | "table.restored"
    | "field.created"
    | "field.updated"
    | "field.deleted"
    | "field.restored"
    | "field.reordered"
    | "view.created"
    | "view.updated"
    | "view.deleted"
    | "view.restored"
    | "form.created"
    | "form.updated"
    | "form.deleted"
    | "form.restored"
    | "dashboard.created"
    | "dashboard.updated"
    | "dashboard.deleted"
    | "dashboard.restored"
    | "access.changed";
  baseId: string;
  resource: {
    kind: "base" | "table" | "field" | "view" | "form" | "dashboard" | "access";
    id: string;
    tableId?: string;
  };
  actorId: string | null;
  occurredAt: string;
};

const metadataTopic = topic<GridsMetadataEvent>({
  id: TOPIC_ID,
  prefix: TOPIC_PREFIX,
  retentionMs: TOPIC_RETENTION_MS,
  limits: { payloadBytes: 16_000 },
});

const streamKey = (baseId: string): string => `${TOPIC_PREFIX}:${baseId}:${TOPIC_ID}:stream`;

const parseLatestCursor = (raw: unknown): string | null => {
  if (!Array.isArray(raw)) return null;
  const first = raw[0];
  if (!Array.isArray(first)) return null;
  return typeof first[0] === "string" ? first[0] : null;
};

export const publishMetadataEvent = async (event: GridsMetadataEvent): Promise<void> => {
  try {
    await metadataTopic.pub({
      tenantId: event.baseId,
      orderingKey: event.resource.kind === "base" ? event.baseId : `${event.resource.kind}:${event.resource.id}`,
      idempotencyKey: `${event.type}:${event.resource.id}:${event.occurredAt}`,
      data: event,
    });
  } catch (error) {
    log.warn("Failed to publish Grids metadata event", {
      type: event.type,
      baseId: event.baseId,
      resource: event.resource,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const liveMetadataEvents = (config: { baseId: string; after?: string | null; signal?: AbortSignal }) =>
  metadataTopic.live({
    tenantId: config.baseId,
    after: config.after ?? undefined,
    signal: config.signal,
  });

export const latestMetadataEventCursor = async (baseId: string): Promise<string | null> => {
  try {
    return parseLatestCursor(await Bun.redis.send("XREVRANGE", [streamKey(baseId), "+", "-", "COUNT", "1"]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("no such key") || message.includes("ERR no such key")) return null;
    throw error;
  }
};

export const emitMetadataEvent = (event: Omit<GridsMetadataEvent, "v" | "occurredAt"> & { occurredAt?: string }): Promise<void> =>
  publishMetadataEvent({
    v: 1,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    ...event,
  });

export const emitTableMetadataEvent = async (
  tableId: string,
  event: Omit<GridsMetadataEvent, "v" | "baseId" | "occurredAt"> & { occurredAt?: string },
): Promise<void> => {
  const [row] = await sql<{ base_id: string }[]>`
    SELECT base_id::text AS base_id
    FROM grids.tables
    WHERE id = ${tableId}::uuid
  `;
  if (!row) return;
  await emitMetadataEvent({ ...event, baseId: row.base_id });
};
