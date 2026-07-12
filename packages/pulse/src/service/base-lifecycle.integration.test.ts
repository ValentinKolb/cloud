import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";

const runDbSmoke = process.env.PULSE_LIFECYCLE_DB_TEST === "1";
const postgresTest = runDbSmoke ? test : test.skip;

const uuid = () => crypto.randomUUID();
const jsonb = (value: unknown) => JSON.stringify(value);

const migratePulse = async () => {
  const { migrate } = await import("../migrate");
  await migrate();
};

const createBase = async (name: string, retentionDays = 30): Promise<string> => {
  const baseId = uuid();
  await sql`
    INSERT INTO pulse.bases (id, name, retention_days)
    VALUES (${baseId}::uuid, ${name}, ${retentionDays})
  `;
  return baseId;
};

const createSource = async (baseId: string): Promise<string> => {
  const sourceId = uuid();
  await sql`
    INSERT INTO pulse.sources (
      id,
      base_id,
      kind,
      name,
      last_seen_at,
      last_error,
      last_error_at
    )
    VALUES (
      ${sourceId}::uuid,
      ${baseId}::uuid,
      'http_ingest'::pulse.source_kind,
      'Lifecycle smoke source',
      now(),
      'previous error',
      now()
    )
  `;
  return sourceId;
};

const insertTelemetryFixture = async (baseId: string, sourceId: string, options?: { old?: boolean }) => {
  const ts = options?.old ? "2020-01-01T00:00:00Z" : "2099-01-01T00:00:00Z";
  const metricId = uuid();
  const seriesId = uuid();
  const eventId = uuid();
  const stateChangeId = uuid();
  const dims = { host: "lifecycle-smoke", service: "pulse" };

  await sql`
    INSERT INTO pulse.metric_defs (id, base_id, name, unit, type)
    VALUES (${metricId}::uuid, ${baseId}::uuid, ${`lifecycle.metric.${metricId}`}, 'count', 'gauge'::pulse.metric_type)
  `;
  await sql`
    INSERT INTO pulse.metric_series (
      id,
      base_id,
      metric_id,
      source_id,
      entity_id,
      entity_type,
      series_key,
      dimensions_hash,
      dimensions,
      last_seen_at
    )
    VALUES (
      ${seriesId}::uuid,
      ${baseId}::uuid,
      ${metricId}::uuid,
      ${sourceId}::uuid,
      'entity:lifecycle-smoke',
      'entity',
      ${`series:${seriesId}`},
      ${seriesId},
      ${jsonb(dims)}::jsonb,
      ${ts}::timestamptz
    )
  `;
  await sql`
    INSERT INTO pulse.metric_series_dimensions (series_id, key, value)
    VALUES (${seriesId}::uuid, 'host', 'lifecycle-smoke')
  `;
  await sql`
    INSERT INTO pulse.metric_samples (base_id, series_id, ts, value)
    VALUES (${baseId}::uuid, ${seriesId}::uuid, ${ts}::timestamptz, 42)
  `;
  await sql`
    INSERT INTO pulse.metric_rollups_hourly (
      base_id,
      series_id,
      bucket,
      sample_count,
      value_sum,
      value_min,
      value_max,
      last_value
    )
    VALUES (${baseId}::uuid, ${seriesId}::uuid, ${ts}::timestamptz, 1, 42, 42, 42, 42)
  `;
  await sql`
    INSERT INTO pulse.events (
      id,
      base_id,
      source_id,
      ts,
      kind,
      value,
      entity_id,
      entity_type,
      dimensions_hash,
      dimensions,
      payload
    )
    VALUES (
      ${eventId}::uuid,
      ${baseId}::uuid,
      ${sourceId}::uuid,
      ${ts}::timestamptz,
      ${`lifecycle.event.${eventId}`},
      1,
      'entity:lifecycle-smoke',
      'entity',
      ${eventId},
      ${jsonb(dims)}::jsonb,
      ${jsonb({ ok: true })}::jsonb
    )
  `;
  await sql`
    INSERT INTO pulse.states_current (
      base_id,
      state_key,
      source_id,
      entity_id,
      entity_type,
      value,
      dimensions_hash,
      dimensions,
      updated_at
    )
    VALUES (
      ${baseId}::uuid,
      ${`lifecycle.state.${stateChangeId}`},
      ${sourceId}::uuid,
      'entity:lifecycle-smoke',
      'entity',
      ${jsonb(true)}::jsonb,
      ${stateChangeId},
      ${jsonb(dims)}::jsonb,
      ${ts}::timestamptz
    )
  `;
  await sql`
    INSERT INTO pulse.state_changes (
      id,
      base_id,
      state_key,
      source_id,
      entity_id,
      entity_type,
      value,
      dimensions_hash,
      dimensions,
      changed_at
    )
    VALUES (
      ${stateChangeId}::uuid,
      ${baseId}::uuid,
      ${`lifecycle.state.${stateChangeId}`},
      ${sourceId}::uuid,
      'entity:lifecycle-smoke',
      'entity',
      ${jsonb(true)}::jsonb,
      ${stateChangeId},
      ${jsonb(dims)}::jsonb,
      ${ts}::timestamptz
    )
  `;
  await sql`
    INSERT INTO pulse.signal_fields (
      base_id, source_id, scope, signal_name, role, key, value_type, observed_count, first_seen_at, last_seen_at
    ) VALUES (
      ${baseId}::uuid, ${sourceId}::uuid, 'metric', 'lifecycle.metric', 'dimension', 'host', 'string', 1,
      ${ts}::timestamptz, ${ts}::timestamptz
    )
    ON CONFLICT (base_id, source_id, scope, signal_name, role, key) DO UPDATE SET
      observed_count = pulse.signal_fields.observed_count + 1,
      last_seen_at = GREATEST(pulse.signal_fields.last_seen_at, EXCLUDED.last_seen_at)
  `;
  await sql`
    INSERT INTO pulse.source_scrapes (
      base_id,
      source_id,
      started_at,
      finished_at,
      duration_ms,
      success,
      metrics_count,
      events_count,
      states_count
    )
    VALUES (${baseId}::uuid, ${sourceId}::uuid, ${ts}::timestamptz, ${ts}::timestamptz, 1, TRUE, 1, 1, 1)
  `;
};

const insertDashboardAndSavedQuery = async (baseId: string) => {
  await sql`
    INSERT INTO pulse.dashboards (base_id, name, config)
    VALUES (${baseId}::uuid, 'Lifecycle dashboard', '{}'::jsonb)
  `;
  await sql`
    INSERT INTO pulse.saved_queries (base_id, name, query)
    VALUES (${baseId}::uuid, 'Lifecycle query', 'metric lifecycle.metric latest since 1h')
  `;
};

const cleanupBase = async (baseId: string): Promise<void> => {
  await sql`DELETE FROM pulse.bases WHERE id = ${baseId}::uuid`;
};

const countRows = async (table: string, baseId: string): Promise<number> => {
  const [row] = await sql.unsafe<{ count: number }[]>(`SELECT COUNT(*)::int AS count FROM ${table} WHERE base_id = $1::uuid`, [baseId]);
  return row?.count ?? 0;
};

const countBase = async (baseId: string): Promise<number> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM pulse.bases
    WHERE id = ${baseId}::uuid
  `;
  return row?.count ?? 0;
};

const countMetricSeriesDimensions = async (baseId: string): Promise<number> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM pulse.metric_series_dimensions dims
    JOIN pulse.metric_series series ON series.id = dims.series_id
    WHERE series.base_id = ${baseId}::uuid
  `;
  return row?.count ?? 0;
};

const countAccessRowsForBase = async (baseId: string): Promise<number> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM pulse.base_access
    WHERE base_id = ${baseId}::uuid
  `;
  return row?.count ?? 0;
};

const runUntilDone = async (run: () => Promise<{ done: boolean }>, maxBatches = 24): Promise<void> => {
  for (let i = 0; i < maxBatches; i += 1) {
    const result = await run();
    if (result.done) return;
  }
  throw new Error(`Lifecycle batch did not finish within ${maxBatches} batches`);
};

const expectBaseTelemetryCleared = async (baseId: string) => {
  await expect(countRows("pulse.metric_samples", baseId)).resolves.toBe(0);
  await expect(countRows("pulse.metric_rollups_hourly", baseId)).resolves.toBe(0);
  await expect(countRows("pulse.state_changes", baseId)).resolves.toBe(0);
  await expect(countRows("pulse.events", baseId)).resolves.toBe(0);
  await expect(countRows("pulse.states_current", baseId)).resolves.toBe(0);
  await expect(countMetricSeriesDimensions(baseId)).resolves.toBe(0);
  await expect(countRows("pulse.source_scrapes", baseId)).resolves.toBe(0);
  await expect(countRows("pulse.metric_series", baseId)).resolves.toBe(0);
  await expect(countRows("pulse.metric_defs", baseId)).resolves.toBe(0);
  await expect(countRows("pulse.signal_fields", baseId)).resolves.toBe(0);
};

beforeAll(async () => {
  if (runDbSmoke) await migratePulse();
});

describe("Pulse lifecycle Postgres smoke", () => {
  postgresTest("clears telemetry in batches while preserving base, sources, dashboards, and saved queries", async () => {
    const { purgeBaseDataClearBatch } = await import("./base-lifecycle");
    const baseId = await createBase("Lifecycle clear smoke");
    const sourceId = await createSource(baseId);
    try {
      await insertTelemetryFixture(baseId, sourceId);
      await insertDashboardAndSavedQuery(baseId);
      await sql`
        INSERT INTO pulse.base_data_clears (base_id, status, phase)
        VALUES (${baseId}::uuid, 'queued', 'queued')
      `;

      await runUntilDone(() => purgeBaseDataClearBatch(baseId));

      await expectBaseTelemetryCleared(baseId);
      await expect(countRows("pulse.sources", baseId)).resolves.toBe(1);
      await expect(countRows("pulse.dashboards", baseId)).resolves.toBe(1);
      await expect(countRows("pulse.saved_queries", baseId)).resolves.toBe(1);

      const [base] = await sql<{ data_clear_completed_at: Date | null }[]>`
        SELECT data_clear_completed_at
        FROM pulse.bases
        WHERE id = ${baseId}::uuid
      `;
      expect(base?.data_clear_completed_at).toBeTruthy();

      const [source] = await sql<{ last_seen_at: Date | null; last_error: string | null; last_error_at: Date | null }[]>`
        SELECT last_seen_at, last_error, last_error_at
        FROM pulse.sources
        WHERE id = ${sourceId}::uuid
      `;
      expect(source).toEqual({ last_seen_at: null, last_error: null, last_error_at: null });
    } finally {
      await cleanupBase(baseId);
    }
  });

  postgresTest("deletes a base and its telemetry in bounded batches", async () => {
    const { purgeBaseDeletionBatch } = await import("./base-lifecycle");
    const baseId = await createBase("Lifecycle delete smoke");
    const sourceId = await createSource(baseId);
    try {
      await insertTelemetryFixture(baseId, sourceId);
      await insertDashboardAndSavedQuery(baseId);
      await sql`
        INSERT INTO pulse.base_deletions (base_id, status, phase)
        VALUES (${baseId}::uuid, 'queued', 'queued')
      `;

      await runUntilDone(() => purgeBaseDeletionBatch(baseId));

      await expect(countBase(baseId)).resolves.toBe(0);
      await expectBaseTelemetryCleared(baseId);
      await expect(countRows("pulse.sources", baseId)).resolves.toBe(0);
      await expect(countRows("pulse.dashboards", baseId)).resolves.toBe(0);
      await expect(countRows("pulse.saved_queries", baseId)).resolves.toBe(0);
      await expect(countAccessRowsForBase(baseId)).resolves.toBe(0);
    } finally {
      await cleanupBase(baseId);
    }
  });

  postgresTest("retention removes only expired telemetry for the scoped test base", async () => {
    const { runRetentionBatch } = await import("./runtime");
    const baseId = await createBase("Lifecycle retention smoke", 1);
    const sourceId = await createSource(baseId);
    try {
      await insertTelemetryFixture(baseId, sourceId, { old: true });
      await insertTelemetryFixture(baseId, sourceId);

      await runUntilDone(() => runRetentionBatch(baseId));

      await expect(countRows("pulse.metric_samples", baseId)).resolves.toBe(1);
      await expect(countRows("pulse.metric_rollups_hourly", baseId)).resolves.toBe(1);
      await expect(countRows("pulse.state_changes", baseId)).resolves.toBe(1);
      await expect(countRows("pulse.events", baseId)).resolves.toBe(1);
      await expect(countRows("pulse.states_current", baseId)).resolves.toBe(2);
    } finally {
      await cleanupBase(baseId);
    }
  });
});
