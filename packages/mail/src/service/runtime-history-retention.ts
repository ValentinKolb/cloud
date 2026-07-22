import { sql } from "bun";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_MAX_BATCHES = 100;
const DEFAULT_MAX_DURATION_MS = 5_000;

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
};

export const cleanupMailRuntimeHistory = async (
  options: { retentionDays?: number; batchSize?: number; maxBatches?: number; maxDurationMs?: number } = {},
): Promise<{ syncRuns: number; workflowTriggerEvents: number }> => {
  const retentionDays = positiveInteger(options.retentionDays ?? DEFAULT_RETENTION_DAYS, "Retention days");
  const batchSize = Math.min(positiveInteger(options.batchSize ?? DEFAULT_BATCH_SIZE, "Batch size"), 10_000);
  const maxBatches = Math.min(positiveInteger(options.maxBatches ?? DEFAULT_MAX_BATCHES, "Max batches"), 1_000);
  const maxDurationMs = Math.min(positiveInteger(options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS, "Max duration"), 60_000);
  const deadline = Date.now() + maxDurationMs;
  let syncRuns = 0;
  let workflowTriggerEvents = 0;

  for (let batch = 0; batch < maxBatches && Date.now() < deadline; batch += 1) {
    const deleted = await sql.begin(async (tx) => {
      const runRows = await tx<{ id: string }[]>`
        WITH expired AS (
          SELECT id
          FROM mail.sync_runs
          WHERE state <> 'running'
            AND COALESCE(finished_at, started_at) < now() - (${retentionDays}::int * interval '1 day')
          ORDER BY COALESCE(finished_at, started_at), id
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM mail.sync_runs run
        USING expired
        WHERE run.id = expired.id
        RETURNING run.id
      `;
      const eventRows = await tx<{ id: string }[]>`
        WITH expired AS (
          SELECT id
          FROM mail.workflow_trigger_events
          WHERE state IN ('succeeded', 'failed')
            AND COALESCE(finished_at, updated_at) < now() - (${retentionDays}::int * interval '1 day')
          ORDER BY COALESCE(finished_at, updated_at), id
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM mail.workflow_trigger_events event
        USING expired
        WHERE event.id = expired.id
        RETURNING event.id
      `;
      return { syncRuns: runRows.length, workflowTriggerEvents: eventRows.length };
    });
    syncRuns += deleted.syncRuns;
    workflowTriggerEvents += deleted.workflowTriggerEvents;
    if (deleted.syncRuns < batchSize && deleted.workflowTriggerEvents < batchSize) break;
  }
  return { syncRuns, workflowTriggerEvents };
};
