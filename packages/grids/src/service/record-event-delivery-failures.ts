import { sql } from "bun";

export const RECORD_EVENT_MAX_INVALID_ATTEMPTS = 5;

export type RecordEventDeliveryFailure = {
  attempts: number;
  dead: boolean;
};

export const recordInvalidRecordEventDelivery = async (input: {
  baseId: string;
  consumerGroup: string;
  eventId: string;
  payload: string | null;
  error: string;
}): Promise<RecordEventDeliveryFailure> => {
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
          OR grids.record_event_delivery_failures.attempts + 1 >= ${RECORD_EVENT_MAX_INVALID_ATTEMPTS} THEN 'dead'
        ELSE 'retrying'
      END,
      last_seen_at = now(),
      dead_at = CASE
        WHEN grids.record_event_delivery_failures.status = 'dead'
          OR grids.record_event_delivery_failures.attempts + 1 >= ${RECORD_EVENT_MAX_INVALID_ATTEMPTS}
          THEN COALESCE(grids.record_event_delivery_failures.dead_at, now())
        ELSE NULL
      END
    RETURNING attempts, status
  `;
  if (!row) throw new Error("Record event delivery failure was not persisted");
  return { attempts: Number(row.attempts), dead: row.status === "dead" };
};
