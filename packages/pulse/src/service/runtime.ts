import { logger, trace } from "@valentinkolb/cloud/services";
import { job, scheduler } from "@valentinkolb/sync";
import { sql } from "bun";
import {
  resumePulseBaseDataClearJobs,
  resumePulseBaseDeletionJobs,
  stopPulseBaseDataClearJob,
  stopPulseBaseDeletionJob,
} from "./base-lifecycle";
import { scrapeMetricsSource } from "./index";

const log = logger("pulse:runtime");

type ScrapeInput = {
  baseId: string;
  sourceId: string;
};

const RETENTION_DELETE_BATCH_SIZE = 50_000;

type RetentionResult = {
  phase: string;
  sensitiveEvents: number;
  metricSamples: number;
  metricRollups: number;
  events: number;
  stateChanges: number;
  idempotencyRecords: number;
  done: boolean;
};

const clearExpiredEventSensitiveChunk = async (baseId?: string): Promise<number> => {
  const scopedBaseId = baseId ?? null;
  const result = await sql`
    WITH victim AS (
      SELECT e.id, e.ts
      FROM pulse.events e
      JOIN pulse.bases b ON b.id = e.base_id
      WHERE e.ts < now() - (b.sensitive_retention_hours * interval '1 hour')
        AND e.sensitive <> '{}'::jsonb
        AND b.deletion_started_at IS NULL
        AND (
          b.data_clear_started_at IS NULL
          OR b.data_clear_completed_at IS NOT NULL
          OR b.data_clear_failed_at IS NOT NULL
        )
        AND (${scopedBaseId}::uuid IS NULL OR b.id = ${scopedBaseId}::uuid)
      LIMIT ${RETENTION_DELETE_BATCH_SIZE}
    )
    UPDATE pulse.events item
    SET sensitive = '{}'::jsonb
    FROM victim
    WHERE item.id = victim.id
      AND item.ts = victim.ts
  `;
  return result.count ?? 0;
};

const scrapeJob = job<ScrapeInput, { metrics: number; events: number; states: number }>({
  id: "pulse:metrics:scrape",
  defaults: { leaseMs: 60_000 },
  trace: trace.fromSyncJob<ScrapeInput, { metrics: number; events: number; states: number }>({
    name: "Pulse metrics scrape",
    source: "pulse:metrics:scrape",
    appId: "pulse",
    attributes: (event) =>
      "input" in event && event.input
        ? {
            "cloud.pulse.base_id": event.input.baseId,
            "cloud.pulse.source_id": event.input.sourceId,
          }
        : {},
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: async ({ ctx }) => {
    const result = await scrapeMetricsSource(ctx.input);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
  after: ({ ctx }) => {
    if (ctx.error && ctx.failureCount < 3) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 30_000, maxMs: 5 * 60_000 }) });
      return;
    }
    if (ctx.error) {
      log.error("Pulse metrics scrape exhausted retries", {
        baseId: ctx.input.baseId,
        sourceId: ctx.input.sourceId,
        failureCount: ctx.failureCount,
        error: ctx.error.message,
      });
    }
  },
});

const deleteExpiredMetricSamplesChunk = async (baseId?: string): Promise<number> => {
  const scopedBaseId = baseId ?? null;
  const result = await sql`
    WITH victim AS (
      SELECT ms.series_id, ms.ts
      FROM pulse.metric_samples ms
      JOIN pulse.bases b ON b.id = ms.base_id
      WHERE ms.ts < now() - (b.retention_days * interval '1 day')
        AND b.deletion_started_at IS NULL
        AND (
          b.data_clear_started_at IS NULL
          OR b.data_clear_completed_at IS NOT NULL
          OR b.data_clear_failed_at IS NOT NULL
        )
        AND (${scopedBaseId}::uuid IS NULL OR b.id = ${scopedBaseId}::uuid)
      LIMIT ${RETENTION_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_samples item
    USING victim
    WHERE item.series_id = victim.series_id
      AND item.ts = victim.ts
  `;
  return result.count ?? 0;
};

const deleteExpiredMetricRollupsChunk = async (baseId?: string): Promise<number> => {
  const scopedBaseId = baseId ?? null;
  const result = await sql`
    WITH victim AS (
      SELECT mr.series_id, mr.bucket
      FROM pulse.metric_rollups_hourly mr
      JOIN pulse.bases b ON b.id = mr.base_id
      WHERE mr.bucket < now() - (b.rollup_retention_days * interval '1 day')
        AND b.deletion_started_at IS NULL
        AND (
          b.data_clear_started_at IS NULL
          OR b.data_clear_completed_at IS NOT NULL
          OR b.data_clear_failed_at IS NOT NULL
        )
        AND (${scopedBaseId}::uuid IS NULL OR b.id = ${scopedBaseId}::uuid)
      LIMIT ${RETENTION_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_rollups_hourly item
    USING victim
    WHERE item.series_id = victim.series_id
      AND item.bucket = victim.bucket
  `;
  return result.count ?? 0;
};

const deleteExpiredEventsChunk = async (baseId?: string): Promise<number> => {
  const scopedBaseId = baseId ?? null;
  const result = await sql`
    WITH victim AS (
      SELECT e.id, e.ts
      FROM pulse.events e
      JOIN pulse.bases b ON b.id = e.base_id
      WHERE e.ts < now() - (b.retention_days * interval '1 day')
        AND b.deletion_started_at IS NULL
        AND (
          b.data_clear_started_at IS NULL
          OR b.data_clear_completed_at IS NOT NULL
          OR b.data_clear_failed_at IS NOT NULL
        )
        AND (${scopedBaseId}::uuid IS NULL OR b.id = ${scopedBaseId}::uuid)
      LIMIT ${RETENTION_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.events item
    USING victim
    WHERE item.id = victim.id
      AND item.ts = victim.ts
  `;
  return result.count ?? 0;
};

const deleteExpiredStateChangesChunk = async (baseId?: string): Promise<number> => {
  const scopedBaseId = baseId ?? null;
  const result = await sql`
    WITH victim AS (
      SELECT sc.id
      FROM pulse.state_changes sc
      JOIN pulse.bases b ON b.id = sc.base_id
      WHERE sc.changed_at < now() - (b.retention_days * interval '1 day')
        AND b.deletion_started_at IS NULL
        AND (
          b.data_clear_started_at IS NULL
          OR b.data_clear_completed_at IS NOT NULL
          OR b.data_clear_failed_at IS NOT NULL
        )
        AND (${scopedBaseId}::uuid IS NULL OR b.id = ${scopedBaseId}::uuid)
      LIMIT ${RETENTION_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.state_changes item
    USING victim
    WHERE item.id = victim.id
  `;
  return result.count ?? 0;
};

const deleteExpiredIdempotencyChunk = async (baseId?: string): Promise<number> => {
  const scopedBaseId = baseId ?? null;
  const result = await sql`
    WITH victim AS (
      SELECT item.source_id, item.idempotency_key
      FROM pulse.ingest_idempotency item
      JOIN pulse.sources source ON source.id = item.source_id
      WHERE item.expires_at <= now()
        AND (${scopedBaseId}::uuid IS NULL OR source.base_id = ${scopedBaseId}::uuid)
      LIMIT ${RETENTION_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.ingest_idempotency item
    USING victim
    WHERE item.source_id = victim.source_id
      AND item.idempotency_key = victim.idempotency_key
  `;
  return result.count ?? 0;
};

export const runRetentionBatch = async (baseId?: string): Promise<RetentionResult> => {
  const sensitiveEvents = await clearExpiredEventSensitiveChunk(baseId);
  if (sensitiveEvents > 0) {
    return {
      phase: "event_sensitive",
      sensitiveEvents,
      metricSamples: 0,
      metricRollups: 0,
      events: 0,
      stateChanges: 0,
      idempotencyRecords: 0,
      done: false,
    };
  }

  const metricSamples = await deleteExpiredMetricSamplesChunk(baseId);
  if (metricSamples > 0) {
    return {
      phase: "metric_samples",
      sensitiveEvents: 0,
      metricSamples,
      metricRollups: 0,
      events: 0,
      stateChanges: 0,
      idempotencyRecords: 0,
      done: false,
    };
  }

  const metricRollups = await deleteExpiredMetricRollupsChunk(baseId);
  if (metricRollups > 0) {
    return {
      phase: "metric_rollups_hourly",
      sensitiveEvents: 0,
      metricSamples: 0,
      metricRollups,
      events: 0,
      stateChanges: 0,
      idempotencyRecords: 0,
      done: false,
    };
  }

  const events = await deleteExpiredEventsChunk(baseId);
  if (events > 0) {
    return {
      phase: "events",
      sensitiveEvents: 0,
      metricSamples: 0,
      metricRollups: 0,
      events,
      stateChanges: 0,
      idempotencyRecords: 0,
      done: false,
    };
  }

  const stateChanges = await deleteExpiredStateChangesChunk(baseId);
  if (stateChanges > 0) {
    return {
      phase: "state_changes",
      sensitiveEvents: 0,
      metricSamples: 0,
      metricRollups: 0,
      events: 0,
      stateChanges,
      idempotencyRecords: 0,
      done: false,
    };
  }

  const idempotencyRecords = await deleteExpiredIdempotencyChunk(baseId);
  if (idempotencyRecords > 0) {
    return {
      phase: "ingest_idempotency",
      sensitiveEvents: 0,
      metricSamples: 0,
      metricRollups: 0,
      events: 0,
      stateChanges: 0,
      idempotencyRecords,
      done: false,
    };
  }

  return {
    phase: "done",
    sensitiveEvents: 0,
    metricSamples: 0,
    metricRollups: 0,
    events: 0,
    stateChanges: 0,
    idempotencyRecords: 0,
    done: true,
  };
};

const retentionJob = job<void, RetentionResult>({
  id: "pulse:retention",
  defaults: { leaseMs: 5 * 60_000 },
  trace: trace.fromSyncJob<void, RetentionResult>({
    name: "Pulse retention cleanup",
    source: "pulse:retention",
    appId: "pulse",
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: () => runRetentionBatch(),
  after: ({ ctx }) => {
    if (ctx.error && ctx.failureCount < 3) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 60_000, maxMs: 10 * 60_000 }) });
      return;
    }
    if (ctx.error) {
      log.error("Pulse retention cleanup exhausted retries", {
        failureCount: ctx.failureCount,
        error: ctx.error.message,
      });
      return;
    }
    if (ctx.data && !ctx.data.done) ctx.reschedule({ delayMs: 0 });
  },
});

const hourlyRollupJob = job<void, { buckets: number }>({
  id: "pulse:rollup:hourly",
  defaults: { leaseMs: 5 * 60_000 },
  trace: trace.fromSyncJob<void, { buckets: number }>({
    name: "Pulse hourly rollup",
    source: "pulse:rollup:hourly",
    appId: "pulse",
    summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
  }),
  process: async () => {
    const result = await sql`
      INSERT INTO pulse.metric_rollups_hourly (
        base_id,
        series_id,
        bucket,
        sample_count,
        value_sum,
        value_min,
        value_max,
        last_value,
        updated_at
      )
      SELECT
        base_id,
        series_id,
        date_bin('1 hour'::interval, ts, '1970-01-01'::timestamptz) AS bucket,
        COUNT(*)::bigint AS sample_count,
        SUM(value) AS value_sum,
        MIN(value) AS value_min,
        MAX(value) AS value_max,
        (array_agg(value ORDER BY ts DESC))[1] AS last_value,
        now() AS updated_at
      FROM pulse.metric_samples
      WHERE ts >= now() - interval '48 hours'
      GROUP BY base_id, series_id, bucket
      ON CONFLICT (series_id, bucket)
      DO UPDATE SET
        sample_count = EXCLUDED.sample_count,
        value_sum = EXCLUDED.value_sum,
        value_min = EXCLUDED.value_min,
        value_max = EXCLUDED.value_max,
        last_value = EXCLUDED.last_value,
        updated_at = now()
    `;
    return { buckets: result.count ?? 0 };
  },
  after: ({ ctx }) => {
    if (ctx.error && ctx.failureCount < 3) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 60_000, maxMs: 10 * 60_000 }) });
      return;
    }
    if (ctx.error) {
      log.error("Pulse hourly rollup exhausted retries", {
        failureCount: ctx.failureCount,
        error: ctx.error.message,
      });
    }
  },
});

const pulseScheduler = scheduler({ id: "pulse" });

let started = false;

const submitDueScrapes = async (slotTs: number): Promise<{ submitted: number }> => {
  const rows = await sql<{ id: string; base_id: string }[]>`
    SELECT s.id, s.base_id
    FROM pulse.sources s
    JOIN pulse.bases b ON b.id = s.base_id
    WHERE s.kind = 'metrics'::pulse.source_kind
      AND s.enabled = TRUE
      AND s.endpoint_url IS NOT NULL
      AND s.scrape_interval_seconds IS NOT NULL
      AND b.deletion_started_at IS NULL
      AND (
        b.data_clear_started_at IS NULL
        OR b.data_clear_completed_at IS NOT NULL
        OR b.data_clear_failed_at IS NOT NULL
      )
      AND (
        GREATEST(
          COALESCE(s.last_seen_at, '-infinity'::timestamptz),
          COALESCE(s.last_error_at, '-infinity'::timestamptz)
        ) <= now() - (s.scrape_interval_seconds * interval '1 second')
      )
    ORDER BY
      GREATEST(
        COALESCE(s.last_seen_at, '-infinity'::timestamptz),
        COALESCE(s.last_error_at, '-infinity'::timestamptz)
      ) ASC,
      s.created_at ASC
    LIMIT 200
  `;

  for (const row of rows) {
    await scrapeJob.submit({
      key: `source:${row.id}:slot:${slotTs}`,
      input: { baseId: row.base_id, sourceId: row.id },
    });
  }

  return { submitted: rows.length };
};

export const pulseRuntime = {
  start: async (): Promise<void> => {
    if (started) return;
    await pulseScheduler.create({
      id: "pulse:metrics:scrape-due",
      cron: "* * * * *",
      meta: {
        appId: "pulse",
        family: "pulse:metrics",
        label: "Pulse due metrics scrape",
        source: "pulse:metrics:scrape-due",
      },
      trace: trace.fromSyncSchedule<{ submitted: number }>({
        name: "Pulse due metrics scrape schedule",
        source: "pulse:metrics:scrape-due",
        appId: "pulse",
        summarize: (event) => (event.type === "succeeded" ? event.data : undefined),
      }),
      process: async ({ ctx }) => submitDueScrapes(ctx.slotTs),
      after: ({ ctx }) => {
        if (ctx.error && ctx.failureCount < 3) {
          log.warn("Pulse scrape scheduler failed", {
            error: ctx.error.message,
            failureCount: ctx.failureCount,
          });
          ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 30_000, maxMs: 5 * 60_000 }) });
          return;
        }
        if (ctx.error) {
          log.error("Pulse scrape scheduler exhausted retries", {
            error: ctx.error.message,
            failureCount: ctx.failureCount,
          });
        }
      },
    });
    await pulseScheduler.create({
      id: "pulse:rollup:hourly",
      cron: "23 * * * *",
      meta: {
        appId: "pulse",
        family: "pulse:rollups",
        label: "Pulse hourly rollup",
        source: "pulse:rollup:hourly",
      },
      trace: trace.fromSyncSchedule<void>({
        name: "Pulse hourly rollup schedule",
        source: "pulse:rollup:hourly",
        appId: "pulse",
      }),
      process: async ({ ctx }) => {
        await hourlyRollupJob.submit({ key: `slot:${ctx.slotTs}` });
      },
      after: ({ ctx }) => {
        if (ctx.error && ctx.failureCount < 3) {
          log.warn("Pulse hourly rollup scheduler failed", {
            error: ctx.error.message,
            failureCount: ctx.failureCount,
          });
          ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 60_000, maxMs: 10 * 60_000 }) });
          return;
        }
        if (ctx.error) {
          log.error("Pulse hourly rollup scheduler exhausted retries", {
            error: ctx.error.message,
            failureCount: ctx.failureCount,
          });
        }
      },
    });
    await pulseScheduler.create({
      id: "pulse:retention",
      cron: "17 3 * * *",
      meta: {
        appId: "pulse",
        family: "pulse:retention",
        label: "Pulse retention",
        source: "pulse:retention",
      },
      trace: trace.fromSyncSchedule<void>({
        name: "Pulse retention schedule",
        source: "pulse:retention",
        appId: "pulse",
      }),
      process: async ({ ctx }) => {
        await retentionJob.submit({ key: `slot:${ctx.slotTs}` });
      },
      after: ({ ctx }) => {
        if (ctx.error && ctx.failureCount < 3) {
          log.warn("Pulse retention scheduler failed", {
            error: ctx.error.message,
            failureCount: ctx.failureCount,
          });
          ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 60_000, maxMs: 10 * 60_000 }) });
          return;
        }
        if (ctx.error) {
          log.error("Pulse retention scheduler exhausted retries", {
            error: ctx.error.message,
            failureCount: ctx.failureCount,
          });
        }
      },
    });
    pulseScheduler.start();
    await resumePulseBaseDeletionJobs();
    await resumePulseBaseDataClearJobs();
    started = true;
  },
  stop: async (): Promise<void> => {
    if (!started) return;
    await pulseScheduler.stop();
    scrapeJob.stop();
    hourlyRollupJob.stop();
    retentionJob.stop();
    stopPulseBaseDeletionJob();
    stopPulseBaseDataClearJob();
    started = false;
  },
};
