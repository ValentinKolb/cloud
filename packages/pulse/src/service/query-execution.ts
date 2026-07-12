import { fail, ok, err, type Result } from "@valentinkolb/cloud/server";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type {
  EventQuery,
  MetricQuery,
  MetricQueryPoint,
  PulseCurrentState,
  PulseRecordedEvent,
  StateQuery,
} from "../contracts";
import { durationToInterval, intervalToMs } from "../query-dsl";
import {
  type CurrentStateRow,
  type RecordedEventRow,
  iso,
  jsonbObject,
  mapCurrentState,
  mapRecordedEvent,
  normalizeDimensions,
  parseJsonObject,
} from "./telemetry-values";

const MAX_METRIC_BUCKETS = 2_000;
const MAX_MATCHED_SERIES = 250;

type MetricWindow = {
  bucketInterval: string;
  bucketMs: number;
  since: Date;
  sinceMs: number;
};

type MetricValueRow = {
  bucket: Date | string;
  value: number | null;
};

type StateQueryParams = {
  state: string | null;
  sourceId: string | null;
  entityId: string | null;
  entityType: string | null;
  dimensionsJson: string;
  since: Date | null;
  limit: number;
};

const metricRowsToPoints = (rows: MetricValueRow[]): MetricQueryPoint[] =>
  rows.map((row) => ({ bucket: iso(row.bucket), value: row.value }));

const resolveMetricWindow = (query: MetricQuery): Result<MetricWindow> => {
  const bucketInterval = durationToInterval(query.bucket);
  const sinceMs = intervalToMs(query.since);
  if (!bucketInterval || !sinceMs) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));

  const bucketMs = intervalToMs(query.bucket) ?? 0;
  if (!bucketMs || Math.ceil(sinceMs / bucketMs) > MAX_METRIC_BUCKETS) {
    return fail(err.badInput(`This query creates too many buckets. Use a larger bucket or a shorter range.`));
  }

  return ok({
    bucketInterval,
    bucketMs,
    since: new Date(Date.now() - sinceMs),
    sinceMs,
  });
};

const filterMetricSeriesByDimensions = async (seriesIds: string[], dimensions: Record<string, string>): Promise<string[]> => {
  let filtered = seriesIds;
  for (const [key, value] of Object.entries(dimensions)) {
    if (filtered.length === 0) break;
    const rows = await sql<{ series_id: string }[]>`
      SELECT series_id
      FROM pulse.metric_series_dimensions
      WHERE series_id = ANY(${toPgUuidArray(filtered)}::uuid[])
        AND key = ${key}
        AND value = ${value}
    `;
    const allowed = new Set(rows.map((row) => row.series_id));
    filtered = filtered.filter((id) => allowed.has(id));
  }
  return filtered;
};

const resolveMetricSeriesIds = async (query: MetricQuery): Promise<string[]> => {
  const rows = await sql<{ id: string }[]>`
    SELECT ms.id
    FROM pulse.metric_series ms
    JOIN pulse.metric_defs md ON md.id = ms.metric_id
    WHERE ms.base_id = ${query.baseId}::uuid
      AND md.name = ${query.metric}
      AND ms.source_id IS NOT DISTINCT FROM COALESCE(${query.sourceId ?? null}::uuid, ms.source_id)
      AND (${query.entityId ?? null}::text IS NULL OR ms.entity_id = ${query.entityId ?? null})
      AND (${query.entityType ?? null}::text IS NULL OR ms.entity_type = ${query.entityType ?? null})
  `;
  return filterMetricSeriesByDimensions(
    rows.map((row) => row.id),
    normalizeDimensions(query.dimensions),
  );
};

const canUseHourlyRollup = (query: MetricQuery, window: MetricWindow): boolean =>
  window.sinceMs >= 7 * 24 * 60 * 60_000 &&
  window.bucketMs >= 60 * 60_000 &&
  (query.aggregation === "avg" ||
    query.aggregation === "sum" ||
    query.aggregation === "min" ||
    query.aggregation === "max" ||
    query.aggregation === "count" ||
    query.aggregation === "latest");

const hourlyRollupAggregateSql = (aggregation: MetricQuery["aggregation"]) => {
  switch (aggregation) {
    case "sum":
      return sql`SUM(value_sum)`;
    case "min":
      return sql`MIN(value_min)`;
    case "max":
      return sql`MAX(value_max)`;
    case "count":
      return sql`SUM(sample_count)::double precision`;
    case "latest":
      return sql`AVG(last_value)`;
    default:
      return sql`SUM(value_sum) / NULLIF(SUM(sample_count), 0)`;
  }
};

const queryHourlyRollup = async (
  query: MetricQuery,
  window: MetricWindow,
  seriesIds: string[],
): Promise<MetricQueryPoint[] | null> => {
  if (!canUseHourlyRollup(query, window)) return null;

  const rows = await sql<MetricValueRow[]>`
    SELECT date_bin(${window.bucketInterval}::interval, bucket, '1970-01-01'::timestamptz) AS bucket,
      ${hourlyRollupAggregateSql(query.aggregation)} AS value
    FROM pulse.metric_rollups_hourly
    WHERE base_id = ${query.baseId}::uuid
      AND series_id = ANY(${toPgUuidArray(seriesIds)}::uuid[])
      AND bucket >= ${window.since}
    GROUP BY 1
    ORDER BY bucket ASC
    LIMIT 2000
  `;

  const firstRollup = rows[0];
  if (!firstRollup) return null;
  const firstBucketMs = new Date(firstRollup.bucket).getTime();
  if (!Number.isFinite(firstBucketMs) || firstBucketMs > window.since.getTime() + window.bucketMs) return null;
  return metricRowsToPoints(rows);
};

const queryLatestMetric = async (query: MetricQuery, window: MetricWindow, seriesIds: string[]): Promise<MetricQueryPoint[]> => {
  const rows = await sql<MetricValueRow[]>`
    WITH bucketed AS (
      SELECT
        date_bin(${window.bucketInterval}::interval, ts, '1970-01-01'::timestamptz) AS bucket,
        series_id,
        ts,
        value
      FROM pulse.metric_samples
      WHERE base_id = ${query.baseId}::uuid
        AND series_id = ANY(${toPgUuidArray(seriesIds)}::uuid[])
        AND ts >= ${window.since}
    ),
    latest_per_series AS (
      SELECT DISTINCT ON (series_id, bucket)
        bucket,
        series_id,
        value
      FROM bucketed
      ORDER BY series_id, bucket, ts DESC
    )
    SELECT bucket, AVG(value) AS value
    FROM latest_per_series
    GROUP BY bucket
    ORDER BY bucket ASC
    LIMIT 2000
  `;
  return metricRowsToPoints(rows);
};

const queryCounterDeltaMetric = async (query: MetricQuery, window: MetricWindow, seriesIds: string[]): Promise<MetricQueryPoint[]> => {
  const valueSql =
    query.aggregation === "rate"
      ? sql`AVG(GREATEST(last_value - first_value, 0) / NULLIF(seconds, 0))`
      : sql`AVG(GREATEST(last_value - first_value, 0))`;
  const rows = await sql<MetricValueRow[]>`
    WITH bucketed AS (
      SELECT
        date_bin(${window.bucketInterval}::interval, ts, '1970-01-01'::timestamptz) AS bucket,
        series_id,
        ts,
        value
      FROM pulse.metric_samples
      WHERE base_id = ${query.baseId}::uuid
        AND series_id = ANY(${toPgUuidArray(seriesIds)}::uuid[])
        AND ts >= ${window.since}
    ),
    series_bucket AS (
      SELECT
        bucket,
        series_id,
        (array_agg(value ORDER BY ts ASC))[1] AS first_value,
        (array_agg(value ORDER BY ts DESC))[1] AS last_value,
        EXTRACT(epoch FROM MAX(ts) - MIN(ts))::double precision AS seconds
      FROM bucketed
      GROUP BY bucket, series_id
    )
    SELECT bucket, ${valueSql} AS value
    FROM series_bucket
    GROUP BY bucket
    ORDER BY bucket ASC
    LIMIT 2000
  `;
  return metricRowsToPoints(rows);
};

const sampleAggregateSql = (aggregation: MetricQuery["aggregation"]) => {
  switch (aggregation) {
    case "sum":
      return sql`SUM(value)`;
    case "min":
      return sql`MIN(value)`;
    case "max":
      return sql`MAX(value)`;
    case "count":
      return sql`COUNT(*)::double precision`;
    case "p50":
      return sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY value)`;
    case "p90":
      return sql`percentile_cont(0.9) WITHIN GROUP (ORDER BY value)`;
    case "p95":
      return sql`percentile_cont(0.95) WITHIN GROUP (ORDER BY value)`;
    case "p99":
      return sql`percentile_cont(0.99) WITHIN GROUP (ORDER BY value)`;
    default:
      return sql`AVG(value)`;
  }
};

const querySampleAggregateMetric = async (query: MetricQuery, window: MetricWindow, seriesIds: string[]): Promise<MetricQueryPoint[]> => {
  const rows = await sql<MetricValueRow[]>`
    SELECT date_bin(${window.bucketInterval}::interval, ts, '1970-01-01'::timestamptz) AS bucket,
      ${sampleAggregateSql(query.aggregation)} AS value
    FROM pulse.metric_samples
    WHERE base_id = ${query.baseId}::uuid
      AND series_id = ANY(${toPgUuidArray(seriesIds)}::uuid[])
      AND ts >= ${window.since}
    GROUP BY bucket
    ORDER BY bucket ASC
    LIMIT 2000
  `;
  return metricRowsToPoints(rows);
};

export const queryMetricData = async (query: MetricQuery): Promise<Result<MetricQueryPoint[]>> => {
  const window = resolveMetricWindow(query);
  if (!window.ok) return window;

  const seriesIds = await resolveMetricSeriesIds(query);
  if (seriesIds.length === 0) return ok([]);
  if (seriesIds.length > MAX_MATCHED_SERIES) {
    return fail(err.badInput("This query matches too many series. Add a source or dimension filter."));
  }

  const rollupPoints = await queryHourlyRollup(query, window.data, seriesIds);
  if (rollupPoints) return ok(rollupPoints);

  if (query.aggregation === "latest") return ok(await queryLatestMetric(query, window.data, seriesIds));
  if (query.aggregation === "rate" || query.aggregation === "increase") {
    return ok(await queryCounterDeltaMetric(query, window.data, seriesIds));
  }

  return ok(await querySampleAggregateMetric(query, window.data, seriesIds));
};

export const queryEventsData = async (query: EventQuery): Promise<Result<PulseRecordedEvent[]>> => {
  const sinceMs = intervalToMs(query.since);
  if (!sinceMs) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  const since = new Date(Date.now() - sinceMs);
  const dimensions = normalizeDimensions(query.dimensions);
  const rows = await sql<RecordedEventRow[]>`
    SELECT id, kind, ts, value, source_id, entity_id, entity_type, dimensions, attributes, payload, recorded_at
    FROM pulse.events
    WHERE base_id = ${query.baseId}::uuid
      AND (${query.event ?? null}::text IS NULL OR kind = ${query.event ?? null})
      AND (${query.sourceId ?? null}::uuid IS NULL OR source_id = ${query.sourceId ?? null}::uuid)
      AND (${query.entityId ?? null}::text IS NULL OR entity_id = ${query.entityId ?? null})
      AND (${query.entityType ?? null}::text IS NULL OR entity_type = ${query.entityType ?? null})
      AND dimensions @> (${jsonbObject(dimensions)}::jsonb #>> '{}')::jsonb
      AND ts >= ${since}
    ORDER BY ts DESC, recorded_at DESC
    LIMIT ${query.limit}
  `;
  return ok(rows.map(mapRecordedEvent));
};

type EventAggregateRow = {
  bucket: Date | string;
  value: number | string | null;
  group_data: unknown;
};

const eventAggregateExpression = (aggregation: NonNullable<EventQuery["aggregation"]>) => {
  switch (aggregation) {
    case "count":
      return sql`COUNT(*)::double precision`;
    case "sum":
      return sql`SUM(value)::double precision`;
    case "unique_actor":
      return sql`COUNT(DISTINCT actor_id)::double precision`;
    case "unique_session":
      return sql`COUNT(DISTINCT session_id)::double precision`;
    default:
      throw new Error("Rows are not an event aggregation");
  }
};

export const queryEventAggregateData = async (query: EventQuery): Promise<Result<MetricQueryPoint[]>> => {
  const aggregation = query.aggregation ?? "rows";
  if (aggregation === "rows") return fail(err.badInput("Event aggregation is required"));
  const sinceMs = intervalToMs(query.since);
  const bucketInterval = query.bucket ? durationToInterval(query.bucket) : null;
  if (!sinceMs || !bucketInterval) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  const groupBy = query.groupBy ?? [];
  if (groupBy.length > 4) return fail(err.badInput("Group by cannot exceed 4 dimension keys"));

  const dimensions = jsonbObject(normalizeDimensions(query.dimensions));
  const since = new Date(Date.now() - sinceMs);
  const rows = await sql<EventAggregateRow[]>`
    WITH scoped AS (
      SELECT
        date_bin(${bucketInterval}::interval, event.ts, '1970-01-01'::timestamptz) AS bucket,
        event.value,
        event.actor_id,
        event.session_id,
        COALESCE((
          SELECT jsonb_object_agg(group_key, event.dimensions -> group_key)
          FROM unnest(${sql.array(groupBy, "TEXT")}) AS group_key
        ), '{}'::jsonb) AS group_data
      FROM pulse.events event
      WHERE event.base_id = ${query.baseId}::uuid
        AND (${query.event ?? null}::text IS NULL OR event.kind = ${query.event ?? null})
        AND (${query.sourceId ?? null}::uuid IS NULL OR event.source_id = ${query.sourceId ?? null}::uuid)
        AND (${query.entityId ?? null}::text IS NULL OR event.entity_id = ${query.entityId ?? null})
        AND (${query.entityType ?? null}::text IS NULL OR event.entity_type = ${query.entityType ?? null})
        AND event.dimensions @> (${dimensions}::jsonb #>> '{}')::jsonb
        AND event.ts >= ${since}
    )
    SELECT bucket, ${eventAggregateExpression(aggregation)} AS value, group_data
    FROM scoped
    GROUP BY bucket, group_data
    ORDER BY bucket ASC, group_data::text ASC
    LIMIT 1000
  `;
  return ok(
    rows.map((row) => ({
      bucket: iso(row.bucket),
      value: row.value === null ? null : Number(row.value),
      group: normalizeDimensions(parseJsonObject(row.group_data)),
    })),
  );
};

export const queryStatesData = async (query: StateQuery): Promise<Result<PulseCurrentState[]>> => {
  const params = resolveStateQueryParams(query);
  if (!params.ok) return params;
  const rows = await queryCurrentStateRows(query.baseId, params.data);
  return ok(rows.map(mapCurrentState));
};

const resolveStateQueryParams = (query: StateQuery): Result<StateQueryParams> => {
  const dimensions = normalizeDimensions(query.dimensions);
  const sinceMs = query.since ? intervalToMs(query.since) : null;
  if (query.since && !sinceMs) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  return ok({
    state: query.state ?? null,
    sourceId: query.sourceId ?? null,
    entityId: query.entityId ?? null,
    entityType: query.entityType ?? null,
    dimensionsJson: jsonbObject(dimensions),
    since: sinceMs ? new Date(Date.now() - sinceMs) : null,
    limit: query.limit,
  });
};

const queryCurrentStateRows = async (baseId: string, params: StateQueryParams): Promise<CurrentStateRow[]> =>
  sql<CurrentStateRow[]>`
    SELECT state_key, value, source_id, entity_id, entity_type, dimensions, updated_at
    FROM pulse.states_current
    WHERE base_id = ${baseId}::uuid
      AND (${params.state}::text IS NULL OR state_key = ${params.state})
      AND (${params.sourceId}::uuid IS NULL OR source_id = ${params.sourceId}::uuid)
      AND (${params.entityId}::text IS NULL OR entity_id = ${params.entityId})
      AND (${params.entityType}::text IS NULL OR entity_type = ${params.entityType})
      AND dimensions @> (${params.dimensionsJson}::jsonb #>> '{}')::jsonb
      AND (${params.since}::timestamptz IS NULL OR updated_at >= ${params.since}::timestamptz)
    ORDER BY updated_at DESC, state_key ASC
    LIMIT ${params.limit}
  `;
