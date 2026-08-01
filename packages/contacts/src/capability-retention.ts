import { scheduler } from "@k2b/sync";
import { logger } from "@valentinkolb/cloud/services";
import { sql } from "bun";

const log = logger("contacts:capability-retention");
const RETENTION_DAYS = 30;
const DELETE_BATCH_SIZE = 10_000;
const retentionScheduler = scheduler({ id: "contacts-capability-retention" });

const deleteExpiredResults = async (): Promise<number> => {
  const rows = await sql<{ idempotency_key_hash: string }[]>`
    WITH expired AS (
      SELECT ctid
      FROM contacts.capability_action_results
      WHERE created_at < now() - (${RETENTION_DAYS} * interval '1 day')
      ORDER BY created_at
      LIMIT ${DELETE_BATCH_SIZE}
    )
    DELETE FROM contacts.capability_action_results result
    USING expired
    WHERE result.ctid = expired.ctid
    RETURNING result.idempotency_key_hash
  `;
  if (rows.length > 0) log.info("Removed expired capability idempotency records", { count: rows.length });
  return rows.length;
};

let started = false;

export const capabilityRetention = {
  start: async (): Promise<void> => {
    if (!started) {
      retentionScheduler.start();
      started = true;
    }
    await retentionScheduler.create({
      id: "contacts:capability-results:cleanup",
      cron: "17 * * * *",
      tz: "UTC",
      meta: {
        appId: "contacts",
        family: "maintenance",
        label: "Capability idempotency retention",
      },
      process: async () => ({ deleted: await deleteExpiredResults() }),
      after: ({ ctx }) => {
        if (ctx.error && ctx.failureCount < 3) {
          ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 60_000 }) });
          return;
        }
        if (ctx.error) {
          log.error("Capability idempotency retention exhausted retries", {
            failureCount: ctx.failureCount,
            error: ctx.error.message,
          });
          return;
        }
        if (ctx.data?.deleted === DELETE_BATCH_SIZE) ctx.reschedule({ delayMs: 0 });
      },
    });
  },
  stop: async (): Promise<void> => {
    if (!started) return;
    await retentionScheduler.stop();
    started = false;
  },
};
