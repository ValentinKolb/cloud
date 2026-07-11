import { err, fail, ok, type Result } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import type {
  MetricType,
  PulseCurrentState,
  PulseInventory,
  PulseMetricSeries,
  PulseMetricSummary,
  PulseRecordedEvent,
  PulseResourceMetric,
  PulseResourceSummary,
} from "../contracts";
import { derivePulseResource } from "../resource-model";
import { requireBaseAccess, type UserScope } from "./access-control";
import {
  type CurrentStateRow,
  type RecordedEventRow,
  isoNullable,
  mapCurrentState,
  mapRecordedEvent,
  normalizeDimensions,
  parseJsonObject,
} from "./telemetry-values";

type InventoryMetricRow = {
  series_id: string;
  metric: string;
  type: MetricType;
  unit: string | null;
  source_id: string | null;
  entity_id: string | null;
  entity_type: string | null;
  dimensions: unknown;
  last_seen_at: Date | string | null;
  latest_value: number | null;
  latest_sample_at: Date | string | null;
};

type ObservedResourceRow = {
  resource_key: string;
  resource_id: string;
  resource_type: string | null;
  label: string;
  source_ids: unknown;
  dimensions: unknown;
  last_seen_at: Date | string | null;
};

type ResourceCountRow = {
  resource_key: string;
  count: number;
};

type ResourceMetricCountRow = {
  resource_key: string;
  series_count: number;
  metric_count: number;
};

type ResourceMetricRow = InventoryMetricRow & {
  resource_key: string;
  resource_id: string;
  resource_type: string | null;
};

const escapeLikePattern = (value: string): string => value.replace(/([\\%_])/g, "\\$1");

const searchPattern = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? `%${escapeLikePattern(trimmed)}%` : null;
};

const mergeResourceDimensions = (current: Record<string, string>, next: Record<string, string>): Record<string, string> => {
  const merged = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (key in merged) continue;
    merged[key] = value;
    if (Object.keys(merged).length >= 8) break;
  }
  return merged;
};

const maxIsoNullable = (left: string | null, right: string | null): string | null => {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
};

const parseUuidArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const mapObservedResource = (
  row: ObservedResourceRow,
  counts: {
    metrics: Map<string, { series: number; metrics: number }>;
    events: Map<string, number>;
    states: Map<string, number>;
  },
): PulseResourceSummary => {
  const metricCounts = counts.metrics.get(row.resource_key);
  return {
    key: row.resource_key,
    id: row.resource_id,
    label: row.label,
    type: row.resource_type,
    sourceIds: parseUuidArray(row.source_ids),
    metricSeriesCount: metricCounts?.series ?? 0,
    metricCount: metricCounts?.metrics ?? 0,
    eventCount: counts.events.get(row.resource_key) ?? 0,
    stateCount: counts.states.get(row.resource_key) ?? 0,
    lastSeenAt: isoNullable(row.last_seen_at),
    dimensions: normalizeDimensions(parseJsonObject(row.dimensions)),
  };
};

const mapResourceMetric = (row: ResourceMetricRow): PulseResourceMetric => ({
  seriesId: row.series_id,
  resourceKey: row.resource_key,
  resourceId: row.resource_id,
  resourceType: row.resource_type,
  metric: row.metric,
  type: row.type,
  unit: row.unit,
  sourceId: row.source_id,
  dimensions: normalizeDimensions(parseJsonObject(row.dimensions)),
  lastSeenAt: isoNullable(row.last_seen_at),
  latestValue: row.latest_value,
  latestSampleAt: isoNullable(row.latest_sample_at),
});

export const listMetrics = async (
  baseId: string,
  user: UserScope,
  params: { q?: string | null; sourceId?: string | null; type?: MetricType | null } = {},
): Promise<Result<PulseMetricSummary[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const pattern = searchPattern(params.q);
  const sourceId = params.sourceId ?? null;
  const rows = await sql<
    { name: string; unit: string | null; type: MetricType; series_count: number; last_seen_at: Date | string | null }[]
  >`
    SELECT
      md.name,
      md.unit,
      md.type,
      COUNT(ms.id)::int AS series_count,
      MAX(ms.last_seen_at) AS last_seen_at
    FROM pulse.metric_defs md
    LEFT JOIN pulse.metric_series ms
      ON ms.metric_id = md.id
      AND (${sourceId}::uuid IS NULL OR ms.source_id = ${sourceId}::uuid)
    WHERE md.base_id = ${baseId}::uuid
      AND (${pattern}::text IS NULL OR md.name ILIKE ${pattern} ESCAPE '\\')
      AND (${params.type ?? null}::pulse.metric_type IS NULL OR md.type = ${params.type ?? null}::pulse.metric_type)
    GROUP BY md.id, md.name, md.unit, md.type
    HAVING ${sourceId}::uuid IS NULL OR COUNT(ms.id) > 0
    ORDER BY md.name ASC
  `;
  return ok(
    rows.map((row) => ({
      name: row.name,
      unit: row.unit,
      type: row.type,
      seriesCount: row.series_count,
      lastSeenAt: isoNullable(row.last_seen_at),
    })),
  );
};

export const listMetricSeries = async (
  baseId: string,
  user: UserScope,
  params: { metric: string; sourceId?: string | null; q?: string | null; limit?: number; offset?: number },
): Promise<Result<PulseMetricSeries[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const metric = params.metric.trim();
  if (!metric) return fail(err.badInput("Metric is required"));
  const pattern = searchPattern(params.q);
  const limit = Math.min(500, Math.max(1, params.limit ?? 500));
  const offset = Math.max(0, params.offset ?? 0);
  const rows = await sql<
    {
      id: string;
      metric: string;
      source_id: string | null;
      entity_id: string | null;
      entity_type: string | null;
      dimensions: unknown;
      last_seen_at: Date | string | null;
      latest_value: number | null;
      latest_sample_at: Date | string | null;
    }[]
  >`
    SELECT
      ms.id,
      md.name AS metric,
      ms.source_id,
      ms.entity_id,
      ms.entity_type,
      ms.dimensions,
      ms.last_seen_at,
      latest.value AS latest_value,
      latest.ts AS latest_sample_at
    FROM pulse.metric_series ms
    JOIN pulse.metric_defs md ON md.id = ms.metric_id
    LEFT JOIN LATERAL (
      SELECT sample.value, sample.ts
      FROM pulse.metric_samples sample
      WHERE sample.series_id = ms.id
      ORDER BY sample.ts DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE ms.base_id = ${baseId}::uuid
      AND md.name = ${metric}
      AND ms.source_id IS NOT DISTINCT FROM COALESCE(${params.sourceId ?? null}::uuid, ms.source_id)
      AND (
        ${pattern}::text IS NULL
        OR ms.entity_id ILIKE ${pattern} ESCAPE '\\'
        OR ms.entity_type ILIKE ${pattern} ESCAPE '\\'
        OR ms.dimensions::text ILIKE ${pattern} ESCAPE '\\'
      )
    ORDER BY ms.last_seen_at DESC NULLS LAST, ms.entity_id ASC NULLS LAST
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return ok(
    rows.map((row) => ({
      id: row.id,
      metric: row.metric,
      sourceId: row.source_id,
      entityId: row.entity_id,
      entityType: row.entity_type,
      dimensions: normalizeDimensions(parseJsonObject(row.dimensions)),
      lastSeenAt: isoNullable(row.last_seen_at),
      latestValue: row.latest_value,
      latestSampleAt: isoNullable(row.latest_sample_at),
    })),
  );
};

export const listRecentEvents = async (
  baseId: string,
  user: UserScope,
  params: { q?: string | null; kind?: string | null; sourceId?: string | null; limit?: number; offset?: number } = {},
): Promise<Result<PulseRecordedEvent[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const pattern = searchPattern(params.q);
  const limit = Math.min(500, Math.max(1, params.limit ?? 500));
  const offset = Math.max(0, params.offset ?? 0);
  const rows = await sql<RecordedEventRow[]>`
    SELECT id, kind, ts, value, source_id, entity_id, entity_type, dimensions, payload, recorded_at
    FROM pulse.events
    WHERE base_id = ${baseId}::uuid
      AND (${params.kind ?? null}::text IS NULL OR kind = ${params.kind ?? null})
      AND (${params.sourceId ?? null}::uuid IS NULL OR source_id = ${params.sourceId ?? null}::uuid)
      AND (
        ${pattern}::text IS NULL
        OR kind ILIKE ${pattern} ESCAPE '\\'
        OR entity_id ILIKE ${pattern} ESCAPE '\\'
        OR entity_type ILIKE ${pattern} ESCAPE '\\'
        OR dimensions::text ILIKE ${pattern} ESCAPE '\\'
        OR payload::text ILIKE ${pattern} ESCAPE '\\'
      )
    ORDER BY ts DESC, recorded_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return ok(rows.map(mapRecordedEvent));
};

export const listCurrentStates = async (
  baseId: string,
  user: UserScope,
  params: { q?: string | null; key?: string | null; sourceId?: string | null; limit?: number; offset?: number } = {},
): Promise<Result<PulseCurrentState[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const pattern = searchPattern(params.q);
  const limit = Math.min(500, Math.max(1, params.limit ?? 500));
  const offset = Math.max(0, params.offset ?? 0);
  const rows = await sql<CurrentStateRow[]>`
    SELECT state_key, value, source_id, entity_id, entity_type, dimensions, updated_at
    FROM pulse.states_current
    WHERE base_id = ${baseId}::uuid
      AND (${params.key ?? null}::text IS NULL OR state_key = ${params.key ?? null})
      AND (${params.sourceId ?? null}::uuid IS NULL OR source_id = ${params.sourceId ?? null}::uuid)
      AND (
        ${pattern}::text IS NULL
        OR state_key ILIKE ${pattern} ESCAPE '\\'
        OR entity_id ILIKE ${pattern} ESCAPE '\\'
        OR entity_type ILIKE ${pattern} ESCAPE '\\'
        OR dimensions::text ILIKE ${pattern} ESCAPE '\\'
        OR value::text ILIKE ${pattern} ESCAPE '\\'
      )
    ORDER BY updated_at DESC, state_key ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return ok(rows.map(mapCurrentState));
};

export const listResources = async (
  baseId: string,
  user: UserScope,
  params: { q?: string | null; ref?: string | null; type?: string | null; sourceId?: string | null; limit?: number; offset?: number } = {},
): Promise<Result<PulseResourceSummary[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const pattern = searchPattern(params.q);
  const ref = params.ref?.trim() || null;
  const type = params.type?.trim() || null;
  const limit = Math.min(500, Math.max(1, params.limit ?? 100));
  const offset = Math.max(0, params.offset ?? 0);
  const rows = await sql<ObservedResourceRow[]>`
    SELECT resource_key, resource_id, resource_type, label, source_ids, dimensions, last_seen_at
    FROM pulse.observed_resources
    WHERE base_id = ${baseId}::uuid
      AND (${ref}::text IS NULL OR resource_key = ${ref} OR resource_id = ${ref} OR label = ${ref})
      AND (${type}::text IS NULL OR resource_type = ${type})
      AND (${params.sourceId ?? null}::uuid IS NULL OR source_ids @> ARRAY[${params.sourceId ?? null}::uuid])
      AND (
        ${pattern}::text IS NULL
        OR label ILIKE ${pattern} ESCAPE '\\'
        OR resource_id ILIKE ${pattern} ESCAPE '\\'
        OR resource_type ILIKE ${pattern} ESCAPE '\\'
        OR dimensions::text ILIKE ${pattern} ESCAPE '\\'
      )
    ORDER BY last_seen_at DESC NULLS LAST, label ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  if (rows.length === 0) return ok([]);

  const resourceKeys = rows.map((row) => row.resource_key);
  const [metricRows, eventRows, stateRows] = await Promise.all([
    sql<ResourceMetricCountRow[]>`
      SELECT
        ms.resource_key,
        COUNT(*)::int AS series_count,
        COUNT(DISTINCT md.name)::int AS metric_count
      FROM pulse.metric_series ms
      JOIN pulse.metric_defs md ON md.id = ms.metric_id
      WHERE ms.base_id = ${baseId}::uuid
        AND ms.resource_key = ANY(${sql.array(resourceKeys, "TEXT")})
      GROUP BY ms.resource_key
    `,
    sql<ResourceCountRow[]>`
      SELECT resource_key, COUNT(*)::int AS count
      FROM pulse.events
      WHERE base_id = ${baseId}::uuid
        AND resource_key = ANY(${sql.array(resourceKeys, "TEXT")})
      GROUP BY resource_key
    `,
    sql<ResourceCountRow[]>`
      SELECT resource_key, COUNT(*)::int AS count
      FROM pulse.states_current
      WHERE base_id = ${baseId}::uuid
        AND resource_key = ANY(${sql.array(resourceKeys, "TEXT")})
      GROUP BY resource_key
    `,
  ]);

  const counts = {
    metrics: new Map(metricRows.map((row) => [row.resource_key, { series: row.series_count, metrics: row.metric_count }])),
    events: new Map(eventRows.map((row) => [row.resource_key, row.count])),
    states: new Map(stateRows.map((row) => [row.resource_key, row.count])),
  };

  return ok(rows.map((row) => mapObservedResource(row, counts)));
};

export const listResourceMetrics = async (
  baseId: string,
  user: UserScope,
  params: { resourceKey: string; q?: string | null; sourceId?: string | null; type?: MetricType | null; limit?: number; offset?: number },
): Promise<Result<PulseResourceMetric[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const resourceKey = params.resourceKey.trim();
  if (!resourceKey) return fail(err.badInput("Resource key is required"));
  const pattern = searchPattern(params.q);
  const limit = Math.min(500, Math.max(1, params.limit ?? 100));
  const offset = Math.max(0, params.offset ?? 0);
  const rows = await sql<ResourceMetricRow[]>`
    SELECT
      ms.id AS series_id,
      ms.resource_key,
      ms.resource_id,
      ms.resource_type,
      md.name AS metric,
      md.type,
      md.unit,
      ms.source_id,
      ms.entity_id,
      ms.entity_type,
      ms.dimensions,
      ms.last_seen_at,
      latest.value AS latest_value,
      latest.ts AS latest_sample_at
    FROM pulse.metric_series ms
    JOIN pulse.metric_defs md ON md.id = ms.metric_id
    LEFT JOIN LATERAL (
      SELECT sample.value, sample.ts
      FROM pulse.metric_samples sample
      WHERE sample.series_id = ms.id
      ORDER BY sample.ts DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE ms.base_id = ${baseId}::uuid
      AND ms.resource_key = ${resourceKey}
      AND (${params.sourceId ?? null}::uuid IS NULL OR ms.source_id = ${params.sourceId ?? null}::uuid)
      AND (${params.type ?? null}::pulse.metric_type IS NULL OR md.type = ${params.type ?? null}::pulse.metric_type)
      AND (
        ${pattern}::text IS NULL
        OR md.name ILIKE ${pattern} ESCAPE '\\'
        OR ms.resource_id ILIKE ${pattern} ESCAPE '\\'
        OR ms.resource_type ILIKE ${pattern} ESCAPE '\\'
        OR ms.dimensions::text ILIKE ${pattern} ESCAPE '\\'
      )
    ORDER BY ms.last_seen_at DESC NULLS LAST, md.name ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return ok(rows.map(mapResourceMetric));
};

export const listResourceEvents = async (
  baseId: string,
  user: UserScope,
  params: { resourceKey: string; q?: string | null; kind?: string | null; sourceId?: string | null; limit?: number; offset?: number },
): Promise<Result<PulseRecordedEvent[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const resourceKey = params.resourceKey.trim();
  if (!resourceKey) return fail(err.badInput("Resource key is required"));
  const pattern = searchPattern(params.q);
  const limit = Math.min(500, Math.max(1, params.limit ?? 100));
  const offset = Math.max(0, params.offset ?? 0);
  const rows = await sql<RecordedEventRow[]>`
    SELECT id, kind, ts, value, source_id, entity_id, entity_type, dimensions, payload, recorded_at
    FROM pulse.events
    WHERE base_id = ${baseId}::uuid
      AND resource_key = ${resourceKey}
      AND (${params.kind ?? null}::text IS NULL OR kind = ${params.kind ?? null})
      AND (${params.sourceId ?? null}::uuid IS NULL OR source_id = ${params.sourceId ?? null}::uuid)
      AND (
        ${pattern}::text IS NULL
        OR kind ILIKE ${pattern} ESCAPE '\\'
        OR entity_id ILIKE ${pattern} ESCAPE '\\'
        OR entity_type ILIKE ${pattern} ESCAPE '\\'
        OR dimensions::text ILIKE ${pattern} ESCAPE '\\'
        OR payload::text ILIKE ${pattern} ESCAPE '\\'
      )
    ORDER BY ts DESC, recorded_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return ok(rows.map(mapRecordedEvent));
};

export const listResourceStates = async (
  baseId: string,
  user: UserScope,
  params: { resourceKey: string; q?: string | null; key?: string | null; sourceId?: string | null; limit?: number; offset?: number },
): Promise<Result<PulseCurrentState[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const resourceKey = params.resourceKey.trim();
  if (!resourceKey) return fail(err.badInput("Resource key is required"));
  const pattern = searchPattern(params.q);
  const limit = Math.min(500, Math.max(1, params.limit ?? 100));
  const offset = Math.max(0, params.offset ?? 0);
  const rows = await sql<CurrentStateRow[]>`
    SELECT state_key, value, source_id, entity_id, entity_type, dimensions, updated_at
    FROM pulse.states_current
    WHERE base_id = ${baseId}::uuid
      AND resource_key = ${resourceKey}
      AND (${params.key ?? null}::text IS NULL OR state_key = ${params.key ?? null})
      AND (${params.sourceId ?? null}::uuid IS NULL OR source_id = ${params.sourceId ?? null}::uuid)
      AND (
        ${pattern}::text IS NULL
        OR state_key ILIKE ${pattern} ESCAPE '\\'
        OR entity_id ILIKE ${pattern} ESCAPE '\\'
        OR entity_type ILIKE ${pattern} ESCAPE '\\'
        OR dimensions::text ILIKE ${pattern} ESCAPE '\\'
        OR value::text ILIKE ${pattern} ESCAPE '\\'
      )
    ORDER BY updated_at DESC, state_key ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return ok(rows.map(mapCurrentState));
};

export const listInventory = async (baseId: string, user: UserScope): Promise<Result<PulseInventory>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);

  const [metricRows, eventRows, stateRows] = await Promise.all([
    sql<InventoryMetricRow[]>`
      SELECT
        ms.id AS series_id,
        md.name AS metric,
        md.type,
        md.unit,
        ms.source_id,
        ms.entity_id,
        ms.entity_type,
        ms.dimensions,
        ms.last_seen_at,
        latest.value AS latest_value,
        latest.ts AS latest_sample_at
      FROM pulse.metric_series ms
      JOIN pulse.metric_defs md ON md.id = ms.metric_id
      LEFT JOIN LATERAL (
        SELECT sample.value, sample.ts
        FROM pulse.metric_samples sample
        WHERE sample.series_id = ms.id
        ORDER BY sample.ts DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE ms.base_id = ${baseId}::uuid
      ORDER BY ms.last_seen_at DESC NULLS LAST, md.name ASC
      LIMIT 5000
    `,
    sql<RecordedEventRow[]>`
      SELECT id, kind, ts, value, source_id, entity_id, entity_type, dimensions, payload, recorded_at
      FROM pulse.events
      WHERE base_id = ${baseId}::uuid
      ORDER BY ts DESC, recorded_at DESC
      LIMIT 1000
    `,
    sql<CurrentStateRow[]>`
      SELECT state_key, value, source_id, entity_id, entity_type, dimensions, updated_at
      FROM pulse.states_current
      WHERE base_id = ${baseId}::uuid
      ORDER BY updated_at DESC, state_key ASC
      LIMIT 5000
    `,
  ]);

  const resources = new Map<string, PulseResourceSummary & { metricNames: Set<string> }>();
  const ensureResource = (params: {
    signalName: string;
    entityId?: string | null;
    entityType?: string | null;
    sourceId?: string | null;
    dimensions: Record<string, string>;
    lastSeenAt: string | null;
  }) => {
    const identity = derivePulseResource(params);
    if (!identity) return null;
    const current =
      resources.get(identity.key) ??
      ({
        key: identity.key,
        id: identity.id,
        label: identity.label,
        type: identity.type,
        sourceIds: [],
        metricSeriesCount: 0,
        metricCount: 0,
        eventCount: 0,
        stateCount: 0,
        lastSeenAt: null,
        dimensions: {},
        metricNames: new Set<string>(),
      } satisfies PulseResourceSummary & { metricNames: Set<string> });
    if (!current.type && identity.type) current.type = identity.type;
    if (!current.label && identity.label) current.label = identity.label;
    if (params.sourceId && !current.sourceIds.includes(params.sourceId)) current.sourceIds.push(params.sourceId);
    current.lastSeenAt = maxIsoNullable(current.lastSeenAt, params.lastSeenAt);
    current.dimensions = mergeResourceDimensions(current.dimensions, params.dimensions);
    resources.set(identity.key, current);
    return current;
  };

  const metrics: PulseResourceMetric[] = [];
  for (const row of metricRows) {
    const dimensions = normalizeDimensions(parseJsonObject(row.dimensions));
    const lastSeenAt = isoNullable(row.last_seen_at);
    const resource = ensureResource({
      signalName: row.metric,
      entityId: row.entity_id,
      entityType: row.entity_type,
      sourceId: row.source_id,
      dimensions,
      lastSeenAt,
    });
    if (!resource) continue;
    resource.metricSeriesCount += 1;
    resource.metricNames.add(row.metric);
    resource.metricCount = resource.metricNames.size;
    metrics.push({
      seriesId: row.series_id,
      resourceKey: resource.key,
      resourceId: resource.id,
      resourceType: resource.type,
      metric: row.metric,
      type: row.type,
      unit: row.unit,
      sourceId: row.source_id,
      dimensions,
      lastSeenAt,
      latestValue: row.latest_value,
      latestSampleAt: isoNullable(row.latest_sample_at),
    });
  }

  const events = eventRows.map(mapRecordedEvent);
  for (const event of events) {
    const resource = ensureResource({
      signalName: event.kind,
      entityId: event.entityId,
      entityType: event.entityType,
      sourceId: event.sourceId,
      dimensions: event.dimensions,
      lastSeenAt: event.ts,
    });
    if (resource) resource.eventCount += 1;
  }

  const states = stateRows.map(mapCurrentState);
  for (const state of states) {
    const resource = ensureResource({
      signalName: state.key,
      entityId: state.entityId,
      entityType: state.entityType,
      sourceId: state.sourceId,
      dimensions: state.dimensions,
      lastSeenAt: state.updatedAt,
    });
    if (resource) resource.stateCount += 1;
  }

  return ok({
    resources: [...resources.values()]
      .map(({ metricNames: _metricNames, ...resource }) => resource)
      .sort((left, right) => {
        const leftCount = left.metricSeriesCount + left.stateCount + left.eventCount;
        const rightCount = right.metricSeriesCount + right.stateCount + right.eventCount;
        return rightCount - leftCount || left.id.localeCompare(right.id);
      }),
    metrics,
    events,
    states,
  });
};
