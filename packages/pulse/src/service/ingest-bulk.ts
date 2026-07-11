import { createHash, randomUUID } from "node:crypto";
import type { sql } from "bun";
import type { PulseIngestBatch } from "../contracts";
import { derivePulseResource } from "../resource-model";
import { normalizeDimensions } from "./telemetry-values";

export type PulseSqlClient = typeof sql;

type PreparedResource = {
  key: string;
  id: string;
  type: string | null;
  label: string;
  dimensions: Record<string, string>;
  seenAt: string;
};

type PreparedMetric = PreparedResourceFields & {
  ordinal: number;
  name: string;
  value: number;
  ts: string;
  unit: string | null;
  metricType: string;
  entityId: string | null;
  entityType: string | null;
  seriesKey: string;
  dimensionsHash: string;
  dimensions: Record<string, string>;
};

type PreparedEvent = PreparedResourceFields & {
  id: string;
  kind: string;
  ts: string;
  value: number | null;
  entityId: string | null;
  entityType: string | null;
  actorId: string | null;
  sessionId: string | null;
  correlationId: string | null;
  dimensionsHash: string;
  dimensions: Record<string, string>;
  payload: Record<string, unknown>;
};

type PreparedState = PreparedResourceFields & {
  ordinal: number;
  key: string;
  value: string | number | boolean | null;
  ts: string;
  entityId: string;
  entityType: string | null;
  dimensionsHash: string;
  dimensions: Record<string, string>;
};

type PreparedResourceFields = {
  resourceKey: string | null;
  resourceId: string | null;
  resourceType: string | null;
  resourceLabel: string | null;
};

type PreparedIngestBatch = {
  metrics: PreparedMetric[];
  events: PreparedEvent[];
  states: PreparedState[];
  resources: PreparedResource[];
  dimensionKeys: Array<{ scope: "metric" | "event" | "state"; key: string }>;
};

const dimensionsHash = (dimensions: Record<string, string>): string =>
  createHash("sha256").update(JSON.stringify(dimensions)).digest("hex");

const resourceFields = (resource: ReturnType<typeof derivePulseResource>): PreparedResourceFields => ({
  resourceKey: resource?.key ?? null,
  resourceId: resource?.id ?? null,
  resourceType: resource?.type ?? null,
  resourceLabel: resource?.label ?? null,
});

const isoTime = (value?: string): string => (value ? new Date(value) : new Date()).toISOString();

export const prepareIngestBatch = (batch: PulseIngestBatch, sourceId?: string | null): PreparedIngestBatch => {
  const resources = new Map<string, PreparedResource>();
  const dimensionKeys = new Map<string, { scope: "metric" | "event" | "state"; key: string }>();

  const observe = (
    scope: "metric" | "event" | "state",
    signalName: string,
    entityId: string | null | undefined,
    entityType: string | null | undefined,
    dimensions: Record<string, string>,
    seenAt: string,
  ) => {
    for (const key of Object.keys(dimensions)) dimensionKeys.set(`${scope}\u001f${key}`, { scope, key });
    const resource = derivePulseResource({ signalName, sourceId, entityId, entityType, dimensions });
    if (!resource) return null;
    const current = resources.get(resource.key);
    resources.set(resource.key, {
      key: resource.key,
      id: resource.id,
      type: resource.type ?? current?.type ?? null,
      label: resource.label,
      dimensions: { ...(current?.dimensions ?? {}), ...dimensions },
      seenAt: !current || Date.parse(seenAt) > Date.parse(current.seenAt) ? seenAt : current.seenAt,
    });
    return resource;
  };

  const metrics = (batch.metrics ?? []).map((metric, ordinal) => {
    const dimensions = normalizeDimensions(metric.dimensions);
    const hash = dimensionsHash(dimensions);
    const ts = isoTime(metric.ts);
    const resource = observe("metric", metric.name, metric.entityId, metric.entityType, dimensions, ts);
    return {
      ordinal,
      name: metric.name,
      value: metric.value,
      ts,
      unit: metric.unit ?? null,
      metricType: metric.type ?? "gauge",
      entityId: metric.entityId ?? null,
      entityType: metric.entityType ?? null,
      seriesKey: [sourceId ?? "", metric.entityId ?? "", hash].join("\u001f"),
      dimensionsHash: hash,
      dimensions,
      ...resourceFields(resource),
    };
  });

  const events = (batch.events ?? []).map((event) => {
    const dimensions = normalizeDimensions(event.dimensions);
    const hash = dimensionsHash(dimensions);
    const ts = isoTime(event.ts);
    const resource = observe("event", event.kind, event.entityId, event.entityType, dimensions, ts);
    return {
      id: randomUUID(),
      kind: event.kind,
      ts,
      value: event.value ?? null,
      entityId: event.entityId ?? null,
      entityType: event.entityType ?? null,
      actorId: event.actorId ?? null,
      sessionId: event.sessionId ?? null,
      correlationId: event.correlationId ?? null,
      dimensionsHash: hash,
      dimensions,
      payload: event.payload ?? {},
      ...resourceFields(resource),
    };
  });

  const states = (batch.states ?? []).map((state, ordinal) => {
    const dimensions = normalizeDimensions(state.dimensions);
    const hash = dimensionsHash(dimensions);
    const ts = isoTime(state.ts);
    const resource = observe("state", state.key, state.entityId, state.entityType, dimensions, ts);
    return {
      ordinal,
      key: state.key,
      value: state.value,
      ts,
      entityId: state.entityId ?? "",
      entityType: state.entityType ?? null,
      dimensionsHash: hash,
      dimensions,
      ...resourceFields(resource),
    };
  });

  return { metrics, events, states, resources: [...resources.values()], dimensionKeys: [...dimensionKeys.values()] };
};

const json = (value: unknown): string => JSON.stringify(value);

const writeMetrics = async (baseId: string, sourceId: string | null | undefined, rows: PreparedMetric[], db: PulseSqlClient) => {
  if (rows.length === 0) return;
  const input = json(rows);
  await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset((${input}::jsonb #>> '{}')::jsonb) AS row(
        ordinal int, name text, unit text, "metricType" text
      )
    ), definitions AS (
      SELECT DISTINCT ON (name) name, unit, "metricType"
      FROM input
      ORDER BY name, ordinal
    )
    INSERT INTO pulse.metric_defs (base_id, name, unit, type)
    SELECT ${baseId}::uuid, name, unit, "metricType"::pulse.metric_type FROM definitions
    ON CONFLICT (base_id, name) DO UPDATE SET unit = COALESCE(EXCLUDED.unit, pulse.metric_defs.unit)
  `;
  await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset((${input}::jsonb #>> '{}')::jsonb) AS row(
        ordinal int, name text, "entityId" text, "entityType" text, "seriesKey" text,
        "dimensionsHash" text, dimensions jsonb, "resourceKey" text, "resourceId" text,
        "resourceType" text, "resourceLabel" text, ts timestamptz
      )
    ), series AS (
      SELECT DISTINCT ON (name, "seriesKey") * FROM input ORDER BY name, "seriesKey", ordinal DESC
    )
    INSERT INTO pulse.metric_series (
      base_id, metric_id, source_id, entity_id, entity_type, series_key, dimensions_hash,
      dimensions, resource_key, resource_id, resource_type, resource_label, last_seen_at
    )
    SELECT ${baseId}::uuid, md.id, ${sourceId ?? null}::uuid, i."entityId", i."entityType", i."seriesKey",
      i."dimensionsHash", i.dimensions, i."resourceKey", i."resourceId", i."resourceType", i."resourceLabel", i.ts
    FROM series i
    JOIN pulse.metric_defs md ON md.base_id = ${baseId}::uuid AND md.name = i.name
    ON CONFLICT (base_id, metric_id, series_key) DO UPDATE SET
      source_id = EXCLUDED.source_id, entity_id = EXCLUDED.entity_id, entity_type = EXCLUDED.entity_type,
      dimensions = EXCLUDED.dimensions, resource_key = EXCLUDED.resource_key, resource_id = EXCLUDED.resource_id,
      resource_type = EXCLUDED.resource_type, resource_label = EXCLUDED.resource_label,
      last_seen_at = GREATEST(pulse.metric_series.last_seen_at, EXCLUDED.last_seen_at)
  `;
  await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset((${input}::jsonb #>> '{}')::jsonb) AS row(name text, "seriesKey" text, dimensions jsonb)
    )
    INSERT INTO pulse.metric_series_dimensions (series_id, key, value)
    SELECT DISTINCT ms.id, dimension.key, dimension.value
    FROM input i
    JOIN pulse.metric_defs md ON md.base_id = ${baseId}::uuid AND md.name = i.name
    JOIN pulse.metric_series ms ON ms.base_id = ${baseId}::uuid AND ms.metric_id = md.id AND ms.series_key = i."seriesKey"
    CROSS JOIN LATERAL jsonb_each_text(i.dimensions) dimension
    ON CONFLICT (series_id, key) DO UPDATE SET value = EXCLUDED.value
  `;
  await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset((${input}::jsonb #>> '{}')::jsonb) AS row(
        ordinal int, name text, "seriesKey" text, ts timestamptz, value double precision
      )
    ), samples AS (
      SELECT DISTINCT ON (name, "seriesKey", ts) * FROM input ORDER BY name, "seriesKey", ts, ordinal DESC
    )
    INSERT INTO pulse.metric_samples (base_id, series_id, ts, value)
    SELECT ${baseId}::uuid, ms.id, i.ts, i.value
    FROM samples i
    JOIN pulse.metric_defs md ON md.base_id = ${baseId}::uuid AND md.name = i.name
    JOIN pulse.metric_series ms ON ms.base_id = ${baseId}::uuid AND ms.metric_id = md.id AND ms.series_key = i."seriesKey"
    ON CONFLICT (series_id, ts) DO UPDATE SET value = EXCLUDED.value, recorded_at = now()
  `;
};

const writeEvents = async (baseId: string, sourceId: string | null | undefined, rows: PreparedEvent[], db: PulseSqlClient) => {
  if (rows.length === 0) return;
  const input = json(rows);
  await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset((${input}::jsonb #>> '{}')::jsonb) AS row(
        id uuid, kind text, ts timestamptz, value double precision, "entityId" text, "entityType" text,
        "actorId" text, "sessionId" text, "correlationId" text, "dimensionsHash" text, dimensions jsonb,
        payload jsonb, "resourceKey" text, "resourceId" text, "resourceType" text, "resourceLabel" text
      )
    )
    INSERT INTO pulse.events (
      id, base_id, source_id, ts, kind, value, entity_id, entity_type, actor_id, session_id,
      correlation_id, dimensions_hash, dimensions, payload, resource_key, resource_id, resource_type, resource_label
    )
    SELECT id, ${baseId}::uuid, ${sourceId ?? null}::uuid, ts, kind, value, "entityId", "entityType", "actorId",
      "sessionId", "correlationId", "dimensionsHash", dimensions, payload, "resourceKey", "resourceId", "resourceType", "resourceLabel"
    FROM input
  `;
  await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset((${input}::jsonb #>> '{}')::jsonb) AS row(id uuid, dimensions jsonb)
    )
    INSERT INTO pulse.event_dimensions (event_id, base_id, key, value)
    SELECT i.id, ${baseId}::uuid, dimension.key, dimension.value
    FROM input i CROSS JOIN LATERAL jsonb_each_text(i.dimensions) dimension
  `;
};

const writeStates = async (baseId: string, sourceId: string | null | undefined, rows: PreparedState[], db: PulseSqlClient) => {
  if (rows.length === 0) return;
  const input = json(rows);
  const columns = `ordinal int, key text, value jsonb, ts timestamptz, \"entityId\" text, \"entityType\" text, \"dimensionsHash\" text, dimensions jsonb, \"resourceKey\" text, \"resourceId\" text, \"resourceType\" text, \"resourceLabel\" text`;
  await db.unsafe(
    `
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(($1::jsonb #>> '{}')::jsonb) AS row(${columns})
    ), current_rows AS (
      SELECT DISTINCT ON (key, "entityId", "dimensionsHash") *
      FROM input ORDER BY key, "entityId", "dimensionsHash", ts DESC, ordinal DESC
    )
    INSERT INTO pulse.states_current (
      base_id, state_key, source_id, entity_id, entity_type, value, dimensions_hash, dimensions,
      resource_key, resource_id, resource_type, resource_label, updated_at
    )
    SELECT $2::uuid, key, $3::uuid, "entityId", "entityType", value, "dimensionsHash", dimensions,
      "resourceKey", "resourceId", "resourceType", "resourceLabel", ts
    FROM current_rows
    ON CONFLICT (base_id, state_key, entity_id, dimensions_hash) DO UPDATE SET
      value = EXCLUDED.value, source_id = EXCLUDED.source_id, entity_type = EXCLUDED.entity_type,
      dimensions = EXCLUDED.dimensions, resource_key = EXCLUDED.resource_key, resource_id = EXCLUDED.resource_id,
      resource_type = EXCLUDED.resource_type, resource_label = EXCLUDED.resource_label, updated_at = EXCLUDED.updated_at
    WHERE pulse.states_current.updated_at <= EXCLUDED.updated_at
  `,
    [input, baseId, sourceId ?? null],
  );
  await db.unsafe(
    `
    WITH input AS (SELECT * FROM jsonb_to_recordset(($1::jsonb #>> '{}')::jsonb) AS row(${columns}))
    INSERT INTO pulse.state_changes (
      base_id, state_key, source_id, entity_id, entity_type, value, dimensions_hash, dimensions,
      resource_key, resource_id, resource_type, resource_label, changed_at
    )
    SELECT $2::uuid, key, $3::uuid, NULLIF("entityId", ''), "entityType", value, "dimensionsHash", dimensions,
      "resourceKey", "resourceId", "resourceType", "resourceLabel", ts
    FROM input
  `,
    [input, baseId, sourceId ?? null],
  );
};

const writeResources = async (baseId: string, sourceId: string | null | undefined, resources: PreparedResource[], db: PulseSqlClient) => {
  if (resources.length === 0) return;
  await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset((${json(resources)}::jsonb #>> '{}')::jsonb) AS row(
        key text, id text, type text, label text, dimensions jsonb, "seenAt" timestamptz
      )
    )
    INSERT INTO pulse.observed_resources (
      base_id, resource_key, resource_id, resource_type, label, source_ids, dimensions, last_seen_at, updated_at
    )
    SELECT ${baseId}::uuid, key, id, type, label,
      CASE WHEN ${sourceId ?? null}::uuid IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[${sourceId ?? null}::uuid] END,
      dimensions, "seenAt", now()
    FROM input
    ON CONFLICT (base_id, resource_key) DO UPDATE SET
      resource_id = EXCLUDED.resource_id,
      resource_type = COALESCE(EXCLUDED.resource_type, pulse.observed_resources.resource_type),
      label = EXCLUDED.label,
      source_ids = ARRAY(SELECT DISTINCT unnest(pulse.observed_resources.source_ids || EXCLUDED.source_ids)),
      dimensions = pulse.observed_resources.dimensions || EXCLUDED.dimensions,
      last_seen_at = GREATEST(pulse.observed_resources.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = now()
  `;
};

const writeDimensionMetadata = async (
  baseId: string,
  sourceId: string | null | undefined,
  keys: PreparedIngestBatch["dimensionKeys"],
  db: PulseSqlClient,
) => {
  if (!sourceId || keys.length === 0) return;
  await db`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset((${json(keys)}::jsonb #>> '{}')::jsonb) AS row(scope text, key text)
    )
    INSERT INTO pulse.dimension_metadata (base_id, source_id, scope, key, observed_cardinality, last_seen_at)
    SELECT ${baseId}::uuid, ${sourceId}::uuid, scope, key, 1, now() FROM input
    ON CONFLICT (base_id, source_id, scope, key) DO UPDATE SET last_seen_at = now()
  `;
};

export const writePreparedIngestBatch = async (params: {
  baseId: string;
  sourceId?: string | null;
  batch: PreparedIngestBatch;
  db: PulseSqlClient;
}): Promise<void> => {
  await writeMetrics(params.baseId, params.sourceId, params.batch.metrics, params.db);
  await writeEvents(params.baseId, params.sourceId, params.batch.events, params.db);
  await writeStates(params.baseId, params.sourceId, params.batch.states, params.db);
  await writeResources(params.baseId, params.sourceId, params.batch.resources, params.db);
  await writeDimensionMetadata(params.baseId, params.sourceId, params.batch.dimensionKeys, params.db);
};
