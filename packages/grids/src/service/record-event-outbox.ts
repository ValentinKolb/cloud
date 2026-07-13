import { logger, trace } from "@valentinkolb/cloud/services";
import { job } from "@valentinkolb/sync";
import { sql } from "bun";
import type { SqlClient } from "./audit";
import { type GridsRecordEvent, GridsRecordEventSchema, publishRecordEvent } from "./record-events";

const log = logger("grids:record-event-outbox");
const RECONCILE_INTERVAL_MS = 15_000;
const RECONCILE_BATCH_SIZE = 500;
const RECONCILE_CLAIM_MS = 30_000;
const MAX_DELIVERY_ATTEMPTS = 20;
const DELIVERED_RETENTION_DAYS = 30;
const SHUTDOWN_DRAIN_MS = 30_000;

type OutboxRow = {
  id: string;
  payload: unknown;
  status: "pending" | "failed" | "delivered" | "dead";
  attempts: number;
};

class InvalidRecordEventPayloadError extends Error {}

const parsePayload = (value: unknown): GridsRecordEvent => {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new InvalidRecordEventPayloadError("Invalid record event payload: expected valid JSON");
    }
  }
  const result = GridsRecordEventSchema.safeParse(parsed);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  throw new InvalidRecordEventPayloadError(`Invalid record event payload: ${path}${issue?.message ?? "schema mismatch"}`);
};

export const enqueueRecordEvent = async (client: SqlClient, event: Omit<GridsRecordEvent, "v" | "occurredAt">): Promise<string> => {
  const payload = { v: 1, ...event };
  const [row] = await client<Array<{ id: string }>>`
    SELECT grids.enqueue_record_event(${event.tableId}::uuid, ${event.recordId}::uuid, ${payload}::jsonb)::text AS id
  `;
  if (!row) throw new Error("record event outbox insert returned no id");
  return row.id;
};

export const captureRecordEventSnapshot = async (
  client: SqlClient,
  input: {
    snapshotId: string;
    tableId: string;
    recordId: string;
    eventType: GridsRecordEvent["type"];
  },
): Promise<void> => {
  const rows = await client`
    INSERT INTO grids.record_event_snapshots (
      id, base_id, table_id, record_id, event_type, record_version, data, deleted_at
    )
    SELECT
      ${input.snapshotId}::uuid,
      table_ref.base_id,
      record.table_id,
      record.id,
      ${input.eventType},
      record.version,
      record.data || COALESCE(relations.data, '{}'::jsonb),
      record.deleted_at
    FROM grids.records record
    JOIN grids.tables table_ref ON table_ref.id = record.table_id
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(grouped.field_id, grouped.record_ids) AS data
      FROM (
        SELECT
          link.from_field_id::text AS field_id,
          jsonb_agg(link.to_record_id::text ORDER BY link.position, link.to_record_id) AS record_ids
        FROM grids.record_links link
        WHERE link.from_record_id = record.id
        GROUP BY link.from_field_id
      ) grouped
    ) relations ON TRUE
    WHERE record.id = ${input.recordId}::uuid
      AND record.table_id = ${input.tableId}::uuid
    RETURNING id
  `;
  if (rows.length !== 1) throw new Error("record event snapshot source record is missing");
};

export const dispatchRecordEventOutbox = async (
  id: string,
  publish: (event: GridsRecordEvent) => Promise<void> = publishRecordEvent,
): Promise<"delivered" | "already-delivered" | "dead"> => {
  const result = await sql.begin(async (tx) => {
    const [row] = await tx<OutboxRow[]>`
      SELECT id::text, payload, status, attempts
      FROM grids.record_event_outbox
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;
    if (!row || row.status === "delivered") return { status: "already-delivered" as const };
    if (row.status === "dead") return { status: "dead" as const };
    try {
      const event = parsePayload(row.payload);
      await publish(event);
      await tx`
        UPDATE grids.record_event_outbox
        SET status = 'delivered', delivered_at = now(), last_error = NULL
        WHERE id = ${id}::uuid
      `;
      return { status: "delivered" as const };
    } catch (error) {
      const attempts = row.attempts + 1;
      const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
      const status = error instanceof InvalidRecordEventPayloadError || attempts >= MAX_DELIVERY_ATTEMPTS ? "dead" : "failed";
      await tx`
        UPDATE grids.record_event_outbox
        SET status = ${status},
            attempts = ${attempts},
            next_attempt_at = now() + (${delaySeconds} * interval '1 second'),
            last_error = ${error instanceof Error ? error.message : String(error)}
        WHERE id = ${id}::uuid
      `;
      return { status, error };
    }
  });
  if ("error" in result) throw result.error;
  return result.status;
};

let activeDeliveries = 0;

const deliveryJob = job<{ outboxId: string }, { outboxId: string; status: string }>({
  id: "grids:record-event-outbox",
  defaults: { leaseMs: 30_000, keyTtlMs: 24 * 60 * 60 * 1000 },
  trace: trace.fromSyncJob<{ outboxId: string }, { outboxId: string; status: string }>({
    name: "Grid record event outbox",
    source: "grids:record-event-outbox",
    appId: "grids",
    attributes: (event) => ("input" in event && event.input ? { "cloud.grids.record_event_outbox_id": event.input.outboxId } : {}),
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: async ({ ctx }) => {
    activeDeliveries += 1;
    try {
      return { outboxId: ctx.input.outboxId, status: await dispatchRecordEventOutbox(ctx.input.outboxId) };
    } finally {
      activeDeliveries -= 1;
      if (runtimeStarted) {
        void runReconcile().catch((error) => {
          log.warn("Record event outbox follow-up reconcile failed", {
            outboxId: ctx.input.outboxId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
  },
});

const submitRecordEventOutbox = async (outboxId: string): Promise<void> => {
  if (!runtimeStarted) return;
  try {
    await deliveryJob.submit({ key: outboxId, input: { outboxId } });
  } catch (error) {
    log.warn("Record event outbox submit failed; reconciler will retry", {
      outboxId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

let runtimeStarted = false;

export const notifyRecordEventOutbox = (outboxId: string): void => {
  if (!runtimeStarted) return;
  void runReconcile().catch((error) => {
    log.warn("Record event outbox notification reconcile failed", {
      outboxId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};

export const claimRecordEventOutboxBatch = async (limit = RECONCILE_BATCH_SIZE): Promise<string[]> => {
  const cap = Math.min(Math.max(limit, 1), RECONCILE_BATCH_SIZE);
  const rows = await sql.begin(
    (tx) => tx<Array<{ id: string }>>`
    WITH candidates AS MATERIALIZED (
      SELECT candidate.id
      FROM grids.record_event_outbox candidate
      WHERE candidate.status IN ('pending', 'failed')
        AND candidate.next_attempt_at <= now()
        AND NOT EXISTS (
          SELECT 1
          FROM grids.record_event_outbox predecessor
          WHERE predecessor.record_id = candidate.record_id
            AND predecessor.status IN ('pending', 'failed')
            AND (predecessor.created_at, predecessor.id) < (candidate.created_at, candidate.id)
        )
      ORDER BY candidate.next_attempt_at, candidate.created_at, candidate.id
      LIMIT ${cap}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE grids.record_event_outbox outbox
    SET next_attempt_at = now() + (${RECONCILE_CLAIM_MS} * interval '1 millisecond')
    FROM candidates
    WHERE outbox.id = candidates.id
    RETURNING outbox.id::text AS id
  `,
  );
  return rows.map((row) => row.id);
};

const reconcileRecordEventOutbox = async (): Promise<number> => {
  await sql`
    DELETE FROM grids.record_event_outbox
    WHERE status = 'delivered' AND delivered_at < now() - (${DELIVERED_RETENTION_DAYS} * interval '1 day')
  `;
  const ids = await claimRecordEventOutboxBatch();
  await Promise.all(ids.map(submitRecordEventOutbox));
  return ids.length;
};

export const recordEventOutboxStats = async (): Promise<{
  pending: number;
  failed: number;
  dead: number;
  oldestPendingAt: string | null;
}> => {
  const [row] = await sql<
    Array<{ pending: number | string; failed: number | string; dead: number | string; oldest_pending_at: Date | string | null }>
  >`
    SELECT
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status = 'dead')::int AS dead,
      min(created_at) FILTER (WHERE status IN ('pending', 'failed')) AS oldest_pending_at
    FROM grids.record_event_outbox
  `;
  return {
    pending: Number(row?.pending ?? 0),
    failed: Number(row?.failed ?? 0),
    dead: Number(row?.dead ?? 0),
    oldestPendingAt: row?.oldest_pending_at ? new Date(row.oldest_pending_at).toISOString() : null,
  };
};

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let activeReconcile: Promise<number> | null = null;
let reconcileRequested = false;

type DrainState = { activeDeliveries: number; activeReconciles: number };

const currentDrainState = (): DrainState => ({
  activeDeliveries,
  activeReconciles: activeReconcile ? 1 : 0,
});

export const waitForRecordEventOutboxDrain = async (
  readState: () => DrainState = currentDrainState,
  timeoutMs = SHUTDOWN_DRAIN_MS,
): Promise<{ drained: boolean; state: DrainState }> => {
  const deadline = performance.now() + Math.max(timeoutMs, 0);
  while (true) {
    const state = readState();
    if (state.activeDeliveries === 0 && state.activeReconciles === 0) {
      return { drained: true, state };
    }
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) return { drained: false, state };
    await new Promise((resolve) => setTimeout(resolve, Math.min(25, remainingMs)));
  }
};

const runReconcile = (): Promise<number> => {
  if (activeReconcile) {
    reconcileRequested = true;
    return activeReconcile;
  }
  activeReconcile = (async () => {
    let claimed = 0;
    do {
      reconcileRequested = false;
      claimed = await reconcileRecordEventOutbox();
    } while (reconcileRequested && runtimeStarted);
    return claimed;
  })().finally(() => {
    activeReconcile = null;
    if (reconcileRequested && runtimeStarted) {
      reconcileRequested = false;
      void runReconcile().catch((error) => {
        log.warn("Record event outbox coalesced reconcile failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  });
  return activeReconcile;
};

export const startRecordEventOutbox = async (): Promise<void> => {
  runtimeStarted = true;
  await reconcileRecordEventOutbox();
  if (!reconcileTimer) {
    reconcileTimer = setInterval(() => {
      void runReconcile().catch((error) => {
        log.warn("Record event outbox reconcile failed", { error: error instanceof Error ? error.message : String(error) });
      });
    }, RECONCILE_INTERVAL_MS);
  }
};

export const stopRecordEventOutbox = async (): Promise<void> => {
  runtimeStarted = false;
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  const deadline = performance.now() + SHUTDOWN_DRAIN_MS;
  const producerDrain = await waitForRecordEventOutboxDrain(() => ({ ...currentDrainState(), activeDeliveries: 0 }), SHUTDOWN_DRAIN_MS);
  const stragglingProducers = activeReconcile ? [activeReconcile] : [];
  deliveryJob.stop();
  if (!producerDrain.drained && stragglingProducers.length > 0) {
    void Promise.allSettled(stragglingProducers).then(() => deliveryJob.stop());
  }
  const drain = await waitForRecordEventOutboxDrain(currentDrainState, Math.max(0, deadline - performance.now()));
  if (!producerDrain.drained || !drain.drained) {
    log.warn("Record event outbox did not drain before shutdown", currentDrainState());
  }
};
