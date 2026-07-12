import { logger, trace } from "@valentinkolb/cloud/services";
import { job } from "@valentinkolb/sync";
import { sql } from "bun";
import type { SqlClient } from "./audit";
import { type GridsRecordEvent, publishRecordEvent } from "./record-events";

const log = logger("grids:record-event-outbox");
const RECONCILE_INTERVAL_MS = 15_000;
const RECONCILE_BATCH_SIZE = 500;
const MAX_DELIVERY_ATTEMPTS = 20;
const DELIVERED_RETENTION_DAYS = 30;
const SHUTDOWN_DRAIN_MS = 30_000;

type OutboxRow = {
  id: string;
  payload: GridsRecordEvent | string;
  status: "pending" | "failed" | "delivered" | "dead";
  attempts: number;
};

const parsePayload = (value: GridsRecordEvent | string): GridsRecordEvent =>
  typeof value === "string" ? (JSON.parse(value) as GridsRecordEvent) : value;

export const enqueueRecordEvent = async (client: SqlClient, event: Omit<GridsRecordEvent, "v" | "occurredAt">): Promise<string> => {
  const payload: GridsRecordEvent = { v: 1, occurredAt: new Date().toISOString(), ...event };
  const [row] = await client<Array<{ id: string }>>`
    SELECT grids.enqueue_record_event(${event.tableId}::uuid, ${event.recordId}::uuid, ${payload}::jsonb)::text AS id
  `;
  if (!row) throw new Error("record event outbox insert returned no id");
  return row.id;
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
      await publish(parsePayload(row.payload));
      await tx`
        UPDATE grids.record_event_outbox
        SET status = 'delivered', delivered_at = now(), last_error = NULL
        WHERE id = ${id}::uuid
      `;
      return { status: "delivered" as const };
    } catch (error) {
      const attempts = row.attempts + 1;
      const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
      const status = attempts >= MAX_DELIVERY_ATTEMPTS ? "dead" : "failed";
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
    }
  },
});

const submitRecordEventOutbox = async (outboxId: string): Promise<void> => {
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
const pendingSubmissions = new Set<Promise<void>>();

export const notifyRecordEventOutbox = (outboxId: string): void => {
  if (!runtimeStarted) return;
  const submission = submitRecordEventOutbox(outboxId);
  pendingSubmissions.add(submission);
  void submission.finally(() => pendingSubmissions.delete(submission));
};

const reconcileRecordEventOutbox = async (): Promise<number> => {
  await sql`
    DELETE FROM grids.record_event_outbox
    WHERE status = 'delivered' AND delivered_at < now() - (${DELIVERED_RETENTION_DAYS} * interval '1 day')
  `;
  const rows = await sql<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM grids.record_event_outbox
    WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
    ORDER BY next_attempt_at, created_at
    LIMIT ${RECONCILE_BATCH_SIZE}
  `;
  await Promise.all(rows.map((row) => submitRecordEventOutbox(row.id)));
  return rows.length;
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

const runReconcile = (): Promise<number> => {
  if (activeReconcile) return activeReconcile;
  activeReconcile = reconcileRecordEventOutbox().finally(() => {
    activeReconcile = null;
  });
  return activeReconcile;
};

export const startRecordEventOutbox = async (): Promise<void> => {
  runtimeStarted = true;
  await runReconcile();
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
  if (activeReconcile) await Promise.allSettled([activeReconcile]);
  await Promise.allSettled([...pendingSubmissions]);
  deliveryJob.stop();
  const deadline = Date.now() + SHUTDOWN_DRAIN_MS;
  while (activeDeliveries > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
