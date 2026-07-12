import { logger, trace } from "@valentinkolb/cloud/services";
import { job } from "@valentinkolb/sync";
import { sql } from "bun";

const BASE_DELETE_BATCH_SIZE = 50_000;
const log = logger("pulse:base-lifecycle");

type BaseDeletionBatch = {
  phase: string;
  deletedRows: number;
  done: boolean;
};

const recordBaseDeletionProgress = async (params: {
  baseId: string;
  phase: string;
  deletedRows: number;
  status?: "queued" | "deleting" | "failed";
  errorMessage?: string | null;
}): Promise<void> => {
  await sql`
    INSERT INTO pulse.base_deletions (
      base_id,
      status,
      phase,
      deleted_rows,
      last_batch_rows,
      error_message,
      updated_at
    )
    VALUES (
      ${params.baseId}::uuid,
      ${params.status ?? "deleting"},
      ${params.phase},
      ${params.deletedRows},
      ${params.deletedRows},
      ${params.errorMessage ?? null},
      now()
    )
    ON CONFLICT (base_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      phase = EXCLUDED.phase,
      deleted_rows = pulse.base_deletions.deleted_rows + EXCLUDED.deleted_rows,
      last_batch_rows = EXCLUDED.last_batch_rows,
      error_message = EXCLUDED.error_message,
      updated_at = now()
  `;
};

const deleteMetricSamplesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.metric_samples
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_samples item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteMetricRollupsChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.metric_rollups_hourly
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_rollups_hourly item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteStateChangesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.state_changes
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.state_changes item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteEventsChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.events
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.events item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteCurrentStatesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.states_current
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.states_current item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteMetricSeriesDimensionsChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT dims.series_id, dims.key
      FROM pulse.metric_series_dimensions dims
      JOIN pulse.metric_series series ON series.id = dims.series_id
      WHERE series.base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_series_dimensions item
    USING victim
    WHERE item.series_id = victim.series_id
      AND item.key = victim.key
  `;
  return result.count ?? 0;
};

const deleteSourceScrapesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.source_scrapes
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.source_scrapes item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteIngestIdempotencyChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT item.source_id, item.idempotency_key
      FROM pulse.ingest_idempotency item
      JOIN pulse.sources source ON source.id = item.source_id
      WHERE source.base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.ingest_idempotency item
    USING victim
    WHERE item.source_id = victim.source_id
      AND item.idempotency_key = victim.idempotency_key
  `;
  return result.count ?? 0;
};

const deleteMetricSeriesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.metric_series
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_series item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteMetricDefsChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.metric_defs
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_defs item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteDimensionMetadataChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.dimension_metadata
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.dimension_metadata item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteObservedResourcesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.observed_resources
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.observed_resources item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteSavedQueriesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.saved_queries
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.saved_queries item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteDashboardsChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.dashboards
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.dashboards item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteSourcesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.sources
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.sources item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteBaseAccessChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT access_id
      FROM pulse.base_access
      WHERE base_id = ${baseId}::uuid
      LIMIT 1000
    )
    DELETE FROM auth.access item
    USING victim
    WHERE item.id = victim.access_id
  `;
  return result.count ?? 0;
};

const BASE_DELETE_STEPS: Array<{ phase: string; run: (baseId: string) => Promise<number> }> = [
  { phase: "metric_samples", run: deleteMetricSamplesChunk },
  { phase: "metric_rollups_hourly", run: deleteMetricRollupsChunk },
  { phase: "state_changes", run: deleteStateChangesChunk },
  { phase: "events", run: deleteEventsChunk },
  { phase: "states_current", run: deleteCurrentStatesChunk },
  { phase: "metric_series_dimensions", run: deleteMetricSeriesDimensionsChunk },
  { phase: "source_scrapes", run: deleteSourceScrapesChunk },
  { phase: "ingest_idempotency", run: deleteIngestIdempotencyChunk },
  { phase: "metric_series", run: deleteMetricSeriesChunk },
  { phase: "metric_defs", run: deleteMetricDefsChunk },
  { phase: "dimension_metadata", run: deleteDimensionMetadataChunk },
  { phase: "observed_resources", run: deleteObservedResourcesChunk },
  { phase: "saved_queries", run: deleteSavedQueriesChunk },
  { phase: "dashboards", run: deleteDashboardsChunk },
  { phase: "sources", run: deleteSourcesChunk },
  { phase: "access", run: deleteBaseAccessChunk },
];

const BASE_DATA_CLEAR_STEPS: Array<{ phase: string; run: (baseId: string) => Promise<number> }> = [
  { phase: "metric_samples", run: deleteMetricSamplesChunk },
  { phase: "metric_rollups_hourly", run: deleteMetricRollupsChunk },
  { phase: "state_changes", run: deleteStateChangesChunk },
  { phase: "events", run: deleteEventsChunk },
  { phase: "states_current", run: deleteCurrentStatesChunk },
  { phase: "metric_series_dimensions", run: deleteMetricSeriesDimensionsChunk },
  { phase: "source_scrapes", run: deleteSourceScrapesChunk },
  { phase: "ingest_idempotency", run: deleteIngestIdempotencyChunk },
  { phase: "metric_series", run: deleteMetricSeriesChunk },
  { phase: "metric_defs", run: deleteMetricDefsChunk },
  { phase: "dimension_metadata", run: deleteDimensionMetadataChunk },
  { phase: "observed_resources", run: deleteObservedResourcesChunk },
];

const recordBaseDataClearProgress = async (params: {
  baseId: string;
  phase: string;
  deletedRows: number;
  status?: "queued" | "clearing" | "failed" | "completed";
  errorMessage?: string | null;
}): Promise<void> => {
  await sql`
    INSERT INTO pulse.base_data_clears (
      base_id,
      status,
      phase,
      deleted_rows,
      last_batch_rows,
      error_message,
      updated_at
    )
    VALUES (
      ${params.baseId}::uuid,
      ${params.status ?? "clearing"},
      ${params.phase},
      ${params.deletedRows},
      ${params.deletedRows},
      ${params.errorMessage ?? null},
      now()
    )
    ON CONFLICT (base_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      phase = EXCLUDED.phase,
      deleted_rows = pulse.base_data_clears.deleted_rows + EXCLUDED.deleted_rows,
      last_batch_rows = EXCLUDED.last_batch_rows,
      error_message = EXCLUDED.error_message,
      updated_at = now()
  `;
};

export const purgeBaseDeletionBatch = async (baseId: string): Promise<BaseDeletionBatch> => {
  await sql`
    UPDATE pulse.base_deletions
    SET status = 'deleting', phase = 'deleting', updated_at = now()
    WHERE base_id = ${baseId}::uuid
  `;

  for (const step of BASE_DELETE_STEPS) {
    const deletedRows = await step.run(baseId);
    if (deletedRows > 0) {
      await recordBaseDeletionProgress({ baseId, phase: step.phase, deletedRows });
      return { phase: step.phase, deletedRows, done: false };
    }
  }

  const finalDelete = await sql`
    DELETE FROM pulse.bases
    WHERE id = ${baseId}::uuid
  `;
  return { phase: "base", deletedRows: finalDelete.count ?? 0, done: true };
};

export const purgeBaseDataClearBatch = async (baseId: string): Promise<BaseDeletionBatch> => {
  const [base] = await sql<{ data_clear_completed_at: Date | string | null }[]>`
    SELECT data_clear_completed_at
    FROM pulse.bases
    WHERE id = ${baseId}::uuid
  `;
  if (!base) return { phase: "base", deletedRows: 0, done: true };
  if (base.data_clear_completed_at) return { phase: "completed", deletedRows: 0, done: true };

  await sql`
    UPDATE pulse.base_data_clears
    SET status = 'clearing', phase = 'clearing', updated_at = now()
    WHERE base_id = ${baseId}::uuid
  `;

  for (const step of BASE_DATA_CLEAR_STEPS) {
    const deletedRows = await step.run(baseId);
    if (deletedRows > 0) {
      await recordBaseDataClearProgress({ baseId, phase: step.phase, deletedRows });
      return { phase: step.phase, deletedRows, done: false };
    }
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE pulse.sources
      SET last_seen_at = NULL,
          last_error = NULL,
          last_error_at = NULL,
          updated_at = now()
      WHERE base_id = ${baseId}::uuid
    `;
    await tx`
      UPDATE pulse.bases
      SET data_clear_completed_at = now(),
          data_clear_failed_at = NULL,
          data_clear_error = NULL,
          updated_at = now()
      WHERE id = ${baseId}::uuid
    `;
    await tx`
      UPDATE pulse.base_data_clears
      SET status = 'completed',
          phase = 'completed',
          last_batch_rows = 0,
          error_message = NULL,
          completed_at = now(),
          updated_at = now()
      WHERE base_id = ${baseId}::uuid
    `;
  });

  return { phase: "completed", deletedRows: 0, done: true };
};

const baseDeletionJob = job<{ baseId: string }, BaseDeletionBatch>({
  id: "pulse:base-delete",
  defaults: { leaseMs: 2 * 60_000 },
  trace: trace.fromSyncJob<{ baseId: string }, BaseDeletionBatch>({
    name: "Pulse base deletion",
    source: "pulse:base-delete",
    appId: "pulse",
    attributes: (event) => ("input" in event && event.input ? { "cloud.pulse.base_id": event.input.baseId } : {}),
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: async ({ ctx }) => purgeBaseDeletionBatch(ctx.input.baseId),
  after: async ({ ctx }) => {
    if (ctx.error) {
      const message = ctx.error instanceof Error ? ctx.error.message : "Pulse base deletion failed";
      const failed = ctx.failureCount >= 10;
      await sql`
        UPDATE pulse.base_deletions
        SET status = ${failed ? "failed" : "deleting"},
            error_message = ${message},
            updated_at = now()
        WHERE base_id = ${ctx.input.baseId}::uuid
      `;
      await sql`
        UPDATE pulse.bases
        SET deletion_failed_at = CASE WHEN ${failed} THEN now() ELSE deletion_failed_at END,
            deletion_error = ${message},
            updated_at = now()
        WHERE id = ${ctx.input.baseId}::uuid
      `;
      if (!failed) ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 5 * 60_000 }) });
      else log.error("Pulse base deletion exhausted retries", { baseId: ctx.input.baseId, error: message, failureCount: ctx.failureCount });
      return;
    }
    if (ctx.data && !ctx.data.done) ctx.reschedule({ delayMs: 0 });
  },
});

const baseDataClearJob = job<{ baseId: string }, BaseDeletionBatch>({
  id: "pulse:base-data-clear",
  defaults: { leaseMs: 2 * 60_000 },
  trace: trace.fromSyncJob<{ baseId: string }, BaseDeletionBatch>({
    name: "Pulse base data clear",
    source: "pulse:base-data-clear",
    appId: "pulse",
    attributes: (event) => ("input" in event && event.input ? { "cloud.pulse.base_id": event.input.baseId } : {}),
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: async ({ ctx }) => purgeBaseDataClearBatch(ctx.input.baseId),
  after: async ({ ctx }) => {
    if (ctx.error) {
      const message = ctx.error instanceof Error ? ctx.error.message : "Pulse data clear failed";
      const failed = ctx.failureCount >= 10;
      await sql`
        UPDATE pulse.base_data_clears
        SET status = ${failed ? "failed" : "clearing"},
            error_message = ${message},
            updated_at = now()
        WHERE base_id = ${ctx.input.baseId}::uuid
      `;
      await sql`
        UPDATE pulse.bases
        SET data_clear_failed_at = CASE WHEN ${failed} THEN now() ELSE data_clear_failed_at END,
            data_clear_error = ${message},
            updated_at = now()
        WHERE id = ${ctx.input.baseId}::uuid
      `;
      if (!failed) ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 5 * 60_000 }) });
      else log.error("Pulse data clear exhausted retries", { baseId: ctx.input.baseId, error: message, failureCount: ctx.failureCount });
      return;
    }
    if (ctx.data && !ctx.data.done) ctx.reschedule({ delayMs: 0 });
  },
});

export const submitBaseDeletionJob = async (baseId: string): Promise<void> => {
  await baseDeletionJob.submit({
    key: `base:${baseId}`,
    input: { baseId },
  });
};

export const submitBaseDataClearJob = async (baseId: string): Promise<void> => {
  await baseDataClearJob.submit({
    key: `base:${baseId}`,
    input: { baseId },
  });
};

export const resumePulseBaseDeletionJobs = async (): Promise<void> => {
  const rows = await sql<{ base_id: string }[]>`
    SELECT base_id
    FROM pulse.base_deletions
    WHERE status IN ('queued', 'deleting')
    ORDER BY updated_at ASC
    LIMIT 100
  `;
  for (const row of rows) await submitBaseDeletionJob(row.base_id);
};

export const resumePulseBaseDataClearJobs = async (): Promise<void> => {
  const rows = await sql<{ base_id: string }[]>`
    SELECT base_id
    FROM pulse.base_data_clears
    WHERE status IN ('queued', 'clearing')
    ORDER BY updated_at ASC
    LIMIT 100
  `;
  for (const row of rows) await submitBaseDataClearJob(row.base_id);
};

export const stopPulseBaseDeletionJob = (): void => baseDeletionJob.stop();
export const stopPulseBaseDataClearJob = (): void => baseDataClearJob.stop();
