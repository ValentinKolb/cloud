import { logger } from "@valentinkolb/cloud/services";
import { job, scheduler } from "@valentinkolb/sync";
import { sql } from "bun";
import {
  resumePulseBaseDataClearJobs,
  resumePulseBaseDeletionJobs,
  scrapeMetricsSource,
  stopPulseBaseDataClearJob,
  stopPulseBaseDeletionJob,
} from "./index";

const log = logger("pulse:runtime");

type ScrapeInput = {
  baseId: string;
  sourceId: string;
};

const scrapeJob = job<ScrapeInput, { metrics: number; events: number; states: number }>({
  id: "pulse:metrics:scrape",
  defaults: { leaseMs: 60_000 },
  process: async ({ ctx }) => {
    const result = await scrapeMetricsSource(ctx.input);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  },
  after: ({ ctx }) => {
    if (ctx.error && ctx.failureCount < 3) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 30_000, maxMs: 5 * 60_000 }) });
    }
  },
});

const retentionJob = job<void, { metricSamples: number; events: number; stateChanges: number }>({
  id: "pulse:retention",
  defaults: { leaseMs: 5 * 60_000 },
  process: async () => {
    const metricSamples = await sql`
      DELETE FROM pulse.metric_samples ms
      USING pulse.bases b
      WHERE ms.base_id = b.id
        AND ms.ts < now() - (b.retention_days * interval '1 day')
    `;
    const events = await sql`
      DELETE FROM pulse.events e
      USING pulse.bases b
      WHERE e.base_id = b.id
        AND e.ts < now() - (b.retention_days * interval '1 day')
    `;
    const stateChanges = await sql`
      DELETE FROM pulse.state_changes sc
      USING pulse.bases b
      WHERE sc.base_id = b.id
        AND sc.changed_at < now() - (b.retention_days * interval '1 day')
    `;
    await sql`
      DELETE FROM pulse.metric_rollups_hourly mr
      USING pulse.bases b
      WHERE mr.base_id = b.id
        AND mr.bucket < now() - (b.retention_days * interval '1 day')
    `;
    return {
      metricSamples: metricSamples.count ?? 0,
      events: events.count ?? 0,
      stateChanges: stateChanges.count ?? 0,
    };
  },
  after: ({ ctx }) => {
    if (ctx.error && ctx.failureCount < 3) {
      ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 60_000, maxMs: 10 * 60_000 }) });
    }
  },
});

const hourlyRollupJob = job<void, { buckets: number }>({
  id: "pulse:rollup:hourly",
  defaults: { leaseMs: 5 * 60_000 },
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
        s.last_seen_at IS NULL
        OR s.last_seen_at <= now() - (s.scrape_interval_seconds * interval '1 second')
      )
    ORDER BY s.last_seen_at NULLS FIRST, s.created_at ASC
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
      process: async ({ ctx }) => submitDueScrapes(ctx.slotTs),
      after: ({ ctx }) => {
        if (ctx.error && ctx.failureCount < 3) {
          log.warn("Pulse scrape scheduler failed", {
            error: ctx.error.message,
            failureCount: ctx.failureCount,
          });
          ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 30_000, maxMs: 5 * 60_000 }) });
        }
      },
    });
    await pulseScheduler.create({
      id: "pulse:rollup:hourly",
      cron: "23 * * * *",
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
        }
      },
    });
    await pulseScheduler.create({
      id: "pulse:retention",
      cron: "17 3 * * *",
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
