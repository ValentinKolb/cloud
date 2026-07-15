import { sql } from "bun";

export const RECORD_EVENT_MAX_INVALID_ATTEMPTS = 5;

export type RecordEventDeliveryFailure = {
  attempts: number;
  dead: boolean;
};

export type RecordEventDeliveryFailureInput = {
  baseId: string;
  consumerGroup: string;
  eventId: string;
  payload: string | null;
  error: string;
  maxAttempts: number;
};

export type DeadRecordEventDeliveryFailure = {
  id: string;
  baseId: string;
  consumerGroup: string;
  eventId: string;
  payload: string | null;
  error: string;
  attempts: number;
  deadAt: string;
};

export const recordRecordEventDeliveryFailure = async (input: RecordEventDeliveryFailureInput): Promise<RecordEventDeliveryFailure> => {
  const [row] = await sql<Array<{ attempts: number | string; status: "retrying" | "dead" }>>`
    INSERT INTO grids.record_event_delivery_failures (
      base_id,
      consumer_group,
      event_id,
      payload,
      error,
      status,
      dead_at
    ) VALUES (
      ${input.baseId}::uuid,
      ${input.consumerGroup},
      ${input.eventId},
      ${input.payload},
      ${input.error},
      'retrying',
      NULL
    )
    ON CONFLICT (base_id, consumer_group, event_id) DO UPDATE SET
      payload = CASE
        WHEN grids.record_event_delivery_failures.status = 'dead' THEN grids.record_event_delivery_failures.payload
        ELSE EXCLUDED.payload
      END,
      error = CASE
        WHEN grids.record_event_delivery_failures.status = 'dead' THEN grids.record_event_delivery_failures.error
        ELSE EXCLUDED.error
      END,
      attempts = CASE
        WHEN grids.record_event_delivery_failures.status = 'dead' THEN grids.record_event_delivery_failures.attempts
        ELSE grids.record_event_delivery_failures.attempts + 1
      END,
      status = CASE
        WHEN grids.record_event_delivery_failures.status = 'dead'
          OR grids.record_event_delivery_failures.attempts + 1 >= ${input.maxAttempts} THEN 'dead'
        ELSE 'retrying'
      END,
      last_seen_at = now(),
      dead_at = CASE
        WHEN grids.record_event_delivery_failures.status = 'dead'
          OR grids.record_event_delivery_failures.attempts + 1 >= ${input.maxAttempts}
          THEN COALESCE(grids.record_event_delivery_failures.dead_at, now())
        ELSE NULL
      END
    RETURNING attempts, status
  `;
  if (!row) throw new Error("Record event delivery failure was not persisted");
  return { attempts: Number(row.attempts), dead: row.status === "dead" };
};

export const recordInvalidRecordEventDelivery = (
  input: Omit<RecordEventDeliveryFailureInput, "maxAttempts">,
): Promise<RecordEventDeliveryFailure> => recordRecordEventDeliveryFailure({ ...input, maxAttempts: RECORD_EVENT_MAX_INVALID_ATTEMPTS });

export const listDeadRecordEventDeliveryFailures = async (baseId: string, limit = 100): Promise<DeadRecordEventDeliveryFailure[]> => {
  const rows = await sql<
    Array<{
      id: string;
      base_id: string;
      consumer_group: string;
      event_id: string;
      payload: string | null;
      error: string;
      attempts: number | string;
      dead_at: Date;
    }>
  >`
    SELECT id::text, base_id::text, consumer_group, event_id, payload, error, attempts, dead_at
    FROM grids.record_event_delivery_failures
    WHERE base_id = ${baseId}::uuid AND status = 'dead'
    ORDER BY dead_at DESC, id DESC
    LIMIT ${Math.max(1, Math.min(limit, 500))}
  `;
  return rows.map((row) => ({
    id: row.id,
    baseId: row.base_id,
    consumerGroup: row.consumer_group,
    eventId: row.event_id,
    payload: row.payload,
    error: row.error,
    attempts: Number(row.attempts),
    deadAt: row.dead_at.toISOString(),
  }));
};

export const getDeadRecordEventDeliveryFailure = async (baseId: string, id: string): Promise<DeadRecordEventDeliveryFailure | null> => {
  const [row] = await sql<
    Array<{
      id: string;
      base_id: string;
      consumer_group: string;
      event_id: string;
      payload: string | null;
      error: string;
      attempts: number | string;
      dead_at: Date;
    }>
  >`
    SELECT id::text, base_id::text, consumer_group, event_id, payload, error, attempts, dead_at
    FROM grids.record_event_delivery_failures
    WHERE base_id = ${baseId}::uuid AND id = ${id}::uuid AND status = 'dead'
  `;
  return row
    ? {
        id: row.id,
        baseId: row.base_id,
        consumerGroup: row.consumer_group,
        eventId: row.event_id,
        payload: row.payload,
        error: row.error,
        attempts: Number(row.attempts),
        deadAt: row.dead_at.toISOString(),
      }
    : null;
};
