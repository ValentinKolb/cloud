import { createHash } from "node:crypto";
import type { ServiceAccount } from "@valentinkolb/cloud/contracts";
import { err, fail, isServiceError, ok, type Result, type ServiceError } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import type { PulseEvent, PulseIngestBatch, PulseMetric, PulseState } from "../contracts";
import { derivePulseResource, type PulseResourceIdentity } from "../resource-model";
import { requireBaseActive } from "./access-control";
import { PULSE_INGEST_SCOPE, resolveIngestSourceForServiceAccount } from "./source-management";
import { jsonbObject, normalizeDimensions } from "./telemetry-values";

const MAX_INGEST_BATCH_ITEMS = 50_000;

type SqlClient = typeof sql;

class IngestTransactionFailure extends Error {
  constructor(readonly serviceError: ServiceError) {
    super(serviceError.message);
  }
}

const dimensionsHash = (dimensions: Record<string, string>): string =>
  createHash("sha256").update(JSON.stringify(dimensions)).digest("hex");

const metricSeriesKey = (params: { sourceId?: string | null; entityId?: string | null; dimensionsHash: string }): string =>
  [params.sourceId ?? "", params.entityId ?? "", params.dimensionsHash].join("\u001f");

const nullable = <T>(value: T | null | undefined): T | null => value ?? null;

const objectOrEmpty = (value: Record<string, unknown> | undefined): Record<string, unknown> => value ?? {};

const parseTime = (value: string | undefined): Result<Date> => {
  if (!value) return ok(new Date());
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fail(err.badInput("Invalid timestamp")) : ok(date);
};

const countBatchItems = (batch: PulseIngestBatch): number =>
  (batch.metrics?.length ?? 0) + (batch.events?.length ?? 0) + (batch.states?.length ?? 0);

const touchSourceLastSeen = async (sourceId: string | null | undefined, db: SqlClient = sql): Promise<void> => {
  if (!sourceId) return;
  await db`UPDATE pulse.sources SET last_seen_at = now(), updated_at = now() WHERE id = ${sourceId}::uuid`;
};

const deriveResourceForSignal = (params: {
  signalName: string;
  sourceId?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  dimensions: Record<string, string>;
}): PulseResourceIdentity | null =>
  derivePulseResource({
    signalName: params.signalName,
    sourceId: params.sourceId,
    entityId: params.entityId,
    entityType: params.entityType,
    dimensions: params.dimensions,
  });

const upsertObservedResource = async (params: {
  baseId: string;
  sourceId?: string | null;
  resource: PulseResourceIdentity | null;
  dimensions: Record<string, string>;
  seenAt: Date;
  db?: SqlClient;
}): Promise<void> => {
  if (!params.resource) return;
  const db = params.db ?? sql;
  await db`
    INSERT INTO pulse.observed_resources (
      base_id,
      resource_key,
      resource_id,
      resource_type,
      label,
      source_ids,
      dimensions,
      last_seen_at,
      updated_at
    )
    VALUES (
      ${params.baseId}::uuid,
      ${params.resource.key},
      ${params.resource.id},
      ${params.resource.type},
      ${params.resource.label},
      CASE
        WHEN ${params.sourceId ?? null}::uuid IS NULL THEN ARRAY[]::uuid[]
        ELSE ARRAY[${params.sourceId ?? null}::uuid]
      END,
      (${jsonbObject(params.dimensions)}::jsonb #>> '{}')::jsonb,
      ${params.seenAt},
      now()
    )
    ON CONFLICT (base_id, resource_key)
    DO UPDATE SET
      resource_id = EXCLUDED.resource_id,
      resource_type = COALESCE(EXCLUDED.resource_type, pulse.observed_resources.resource_type),
      label = EXCLUDED.label,
      source_ids = (
        SELECT COALESCE(array_agg(DISTINCT source_id), ARRAY[]::uuid[])
        FROM unnest(pulse.observed_resources.source_ids || EXCLUDED.source_ids) AS sources(source_id)
      ),
      dimensions = pulse.observed_resources.dimensions || EXCLUDED.dimensions,
      last_seen_at = GREATEST(pulse.observed_resources.last_seen_at, EXCLUDED.last_seen_at),
      updated_at = now()
  `;
};

const upsertDimensionMetadata = async (params: {
  baseId: string;
  sourceId?: string | null;
  scope: "metric" | "event" | "state";
  dimensions: Record<string, string>;
  db?: SqlClient;
}): Promise<void> => {
  if (!params.sourceId) return;
  const db = params.db ?? sql;
  for (const key of Object.keys(params.dimensions)) {
    await db`
      INSERT INTO pulse.dimension_metadata (base_id, source_id, scope, key, observed_cardinality, last_seen_at)
      VALUES (${params.baseId}::uuid, ${params.sourceId ?? null}::uuid, ${params.scope}, ${key}, 1, now())
      ON CONFLICT (base_id, source_id, scope, key)
      DO UPDATE SET last_seen_at = now()
    `;
  }
};

const resolveMetricSeries = async (params: {
  baseId: string;
  sourceId?: string | null;
  metric: PulseMetric;
  dimensions: Record<string, string>;
  resource: PulseResourceIdentity | null;
  db?: SqlClient;
}): Promise<{ metricId: string; seriesId: string }> => {
  const db = params.db ?? sql;
  const [metricDef] = await db<{ id: string }[]>`
    INSERT INTO pulse.metric_defs (base_id, name, unit, type)
    VALUES (${params.baseId}::uuid, ${params.metric.name}, ${params.metric.unit ?? null}, ${params.metric.type ?? "gauge"}::pulse.metric_type)
    ON CONFLICT (base_id, name)
    DO UPDATE SET unit = COALESCE(EXCLUDED.unit, pulse.metric_defs.unit)
    RETURNING id
  `;
  if (!metricDef) throw new Error("Failed to resolve metric definition");

  const hash = dimensionsHash(params.dimensions);
  const seriesKey = metricSeriesKey({ sourceId: params.sourceId, entityId: params.metric.entityId, dimensionsHash: hash });
  const [series] = await db<{ id: string }[]>`
    INSERT INTO pulse.metric_series (
      base_id,
      metric_id,
      source_id,
      entity_id,
      entity_type,
      series_key,
      dimensions_hash,
      dimensions,
      resource_key,
      resource_id,
      resource_type,
      resource_label,
      last_seen_at
    )
    VALUES (
      ${params.baseId}::uuid,
      ${metricDef.id}::uuid,
      ${params.sourceId ?? null}::uuid,
      ${params.metric.entityId ?? null},
      ${params.metric.entityType ?? null},
      ${seriesKey},
      ${hash},
      (${jsonbObject(params.dimensions)}::jsonb #>> '{}')::jsonb,
      ${params.resource?.key ?? null},
      ${params.resource?.id ?? null},
      ${params.resource?.type ?? null},
      ${params.resource?.label ?? null},
      now()
    )
    ON CONFLICT (base_id, metric_id, series_key)
    DO UPDATE SET
      source_id = EXCLUDED.source_id,
      entity_id = EXCLUDED.entity_id,
      entity_type = EXCLUDED.entity_type,
      dimensions = EXCLUDED.dimensions,
      resource_key = EXCLUDED.resource_key,
      resource_id = EXCLUDED.resource_id,
      resource_type = EXCLUDED.resource_type,
      resource_label = EXCLUDED.resource_label,
      last_seen_at = now()
    RETURNING id
  `;
  if (!series) throw new Error("Failed to resolve metric series");

  for (const [key, value] of Object.entries(params.dimensions)) {
    await db`
      INSERT INTO pulse.metric_series_dimensions (series_id, key, value)
      VALUES (${series.id}::uuid, ${key}, ${value})
      ON CONFLICT (series_id, key) DO UPDATE SET value = EXCLUDED.value
    `;
  }

  return { metricId: metricDef.id, seriesId: series.id };
};

const validateMetric = (metric: PulseMetric): Result<void> => {
  if (!metric.name.trim()) return fail(err.badInput("Metric name is required"));
  if (!Number.isFinite(metric.value)) return fail(err.badInput("Metric value must be finite"));
  const ts = parseTime(metric.ts);
  if (!ts.ok) return fail(ts.error);
  return ok();
};

const validateEvent = (event: PulseEvent): Result<void> => {
  if (!event.kind.trim()) return fail(err.badInput("Event kind is required"));
  const ts = parseTime(event.ts);
  if (!ts.ok) return fail(ts.error);
  return ok();
};

const validateState = (state: PulseState): Result<void> => {
  if (!state.key.trim()) return fail(err.badInput("State key is required"));
  const changedAt = parseTime(state.ts);
  if (!changedAt.ok) return fail(changedAt.error);
  return ok();
};

const validateBatch = (batch: PulseIngestBatch): Result<void> => {
  for (const metric of batch.metrics ?? []) {
    const result = validateMetric(metric);
    if (!result.ok) return result;
  }
  for (const event of batch.events ?? []) {
    const result = validateEvent(event);
    if (!result.ok) return result;
  }
  for (const state of batch.states ?? []) {
    const result = validateState(state);
    if (!result.ok) return result;
  }
  return ok();
};

const recordMetricInClient = async (params: { baseId: string; sourceId?: string | null; metric: PulseMetric; db?: SqlClient }): Promise<Result<void>> => {
  if (!params.metric.name.trim()) return fail(err.badInput("Metric name is required"));
  if (!Number.isFinite(params.metric.value)) return fail(err.badInput("Metric value must be finite"));

  const ts = parseTime(params.metric.ts);
  if (!ts.ok) return fail(ts.error);

  const dimensions = normalizeDimensions(params.metric.dimensions);
  const db = params.db ?? sql;
  const resource = deriveResourceForSignal({
    signalName: params.metric.name,
    sourceId: params.sourceId,
    entityId: params.metric.entityId,
    entityType: params.metric.entityType,
    dimensions,
  });
  const series = await resolveMetricSeries({ baseId: params.baseId, sourceId: params.sourceId, metric: params.metric, dimensions, resource, db });
  await db`
    INSERT INTO pulse.metric_samples (base_id, series_id, ts, value)
    VALUES (${params.baseId}::uuid, ${series.seriesId}::uuid, ${ts.data}, ${params.metric.value})
    ON CONFLICT (series_id, ts) DO UPDATE SET value = EXCLUDED.value, recorded_at = now()
  `;
  await upsertObservedResource({ baseId: params.baseId, sourceId: params.sourceId, resource, dimensions, seenAt: ts.data, db });
  await upsertDimensionMetadata({ baseId: params.baseId, sourceId: params.sourceId, scope: "metric", dimensions, db });
  return ok();
};

export const recordMetric = async (params: { baseId: string; sourceId?: string | null; metric: PulseMetric }): Promise<Result<void>> =>
  recordMetricInClient(params);

const insertEventRow = async (params: {
  baseId: string;
  sourceId?: string | null;
  event: PulseEvent;
  resource: PulseResourceIdentity | null;
  ts: Date;
  dimensions: Record<string, string>;
  dimensionsHash: string;
  db: SqlClient;
}): Promise<Result<string>> => {
  const [eventRow] = await params.db<{ id: string }[]>`
    INSERT INTO pulse.events (
      base_id,
      source_id,
      ts,
      kind,
      value,
      entity_id,
      entity_type,
      actor_id,
      session_id,
      correlation_id,
      dimensions_hash,
      dimensions,
      payload,
      resource_key,
      resource_id,
      resource_type,
      resource_label
    )
    VALUES (
      ${params.baseId}::uuid,
      ${nullable(params.sourceId)}::uuid,
      ${params.ts},
      ${params.event.kind},
      ${nullable(params.event.value)},
      ${nullable(params.event.entityId)},
      ${nullable(params.event.entityType)},
      ${nullable(params.event.actorId)},
      ${nullable(params.event.sessionId)},
      ${nullable(params.event.correlationId)},
      ${params.dimensionsHash},
      (${jsonbObject(params.dimensions)}::jsonb #>> '{}')::jsonb,
      (${jsonbObject(objectOrEmpty(params.event.payload))}::jsonb #>> '{}')::jsonb,
      ${params.resource?.key ?? null},
      ${params.resource?.id ?? null},
      ${params.resource?.type ?? null},
      ${params.resource?.label ?? null}
    )
    RETURNING id
  `;
  return eventRow ? ok(eventRow.id) : fail(err.internal("Failed to record event"));
};

const insertEventDimensionRows = async (params: {
  eventId: string;
  baseId: string;
  dimensions: Record<string, string>;
  db: SqlClient;
}): Promise<void> => {
  for (const [key, value] of Object.entries(params.dimensions)) {
    await params.db`
      INSERT INTO pulse.event_dimensions (event_id, base_id, key, value)
      VALUES (${params.eventId}::uuid, ${params.baseId}::uuid, ${key}, ${value})
    `;
  }
};

const recordEventInClient = async (params: { baseId: string; sourceId?: string | null; event: PulseEvent; db?: SqlClient }): Promise<Result<void>> => {
  if (!params.event.kind.trim()) return fail(err.badInput("Event kind is required"));
  const ts = parseTime(params.event.ts);
  if (!ts.ok) return fail(ts.error);

  const dimensions = normalizeDimensions(params.event.dimensions);
  const hash = dimensionsHash(dimensions);
  const db = params.db ?? sql;
  const resource = deriveResourceForSignal({
    signalName: params.event.kind,
    sourceId: params.sourceId,
    entityId: params.event.entityId,
    entityType: params.event.entityType,
    dimensions,
  });
  const eventRow = await insertEventRow({
    baseId: params.baseId,
    sourceId: params.sourceId,
    event: params.event,
    resource,
    ts: ts.data,
    dimensions,
    dimensionsHash: hash,
    db,
  });
  if (!eventRow.ok) return fail(eventRow.error);
  await insertEventDimensionRows({ eventId: eventRow.data, baseId: params.baseId, dimensions, db });
  await upsertObservedResource({ baseId: params.baseId, sourceId: params.sourceId, resource, dimensions, seenAt: ts.data, db });
  await upsertDimensionMetadata({ baseId: params.baseId, sourceId: params.sourceId, scope: "event", dimensions, db });
  return ok();
};

export const recordEvent = async (params: { baseId: string; sourceId?: string | null; event: PulseEvent }): Promise<Result<void>> =>
  recordEventInClient(params);

const setStateInClient = async (params: { baseId: string; sourceId?: string | null; state: PulseState; db?: SqlClient }): Promise<Result<void>> => {
  if (!params.state.key.trim()) return fail(err.badInput("State key is required"));
  const changedAt = parseTime(params.state.ts);
  if (!changedAt.ok) return fail(changedAt.error);

  const dimensions = normalizeDimensions(params.state.dimensions);
  const hash = dimensionsHash(dimensions);
  const encodedValue = JSON.stringify(params.state.value);
  const db = params.db ?? sql;
  const resource = deriveResourceForSignal({
    signalName: params.state.key,
    sourceId: params.sourceId,
    entityId: params.state.entityId,
    entityType: params.state.entityType,
    dimensions,
  });

  await db`
    INSERT INTO pulse.states_current (
      base_id,
      state_key,
      source_id,
      entity_id,
      entity_type,
      value,
      dimensions_hash,
      dimensions,
      resource_key,
      resource_id,
      resource_type,
      resource_label,
      updated_at
    )
    VALUES (
      ${params.baseId}::uuid,
      ${params.state.key},
      ${params.sourceId ?? null}::uuid,
      ${params.state.entityId ?? ""},
      ${params.state.entityType ?? null},
      ${encodedValue}::jsonb,
      ${hash},
      (${jsonbObject(dimensions)}::jsonb #>> '{}')::jsonb,
      ${resource?.key ?? null},
      ${resource?.id ?? null},
      ${resource?.type ?? null},
      ${resource?.label ?? null},
      ${changedAt.data}
    )
    ON CONFLICT (base_id, state_key, entity_id, dimensions_hash)
    DO UPDATE SET
      value = EXCLUDED.value,
      source_id = EXCLUDED.source_id,
      entity_type = EXCLUDED.entity_type,
      dimensions = EXCLUDED.dimensions,
      resource_key = EXCLUDED.resource_key,
      resource_id = EXCLUDED.resource_id,
      resource_type = EXCLUDED.resource_type,
      resource_label = EXCLUDED.resource_label,
      updated_at = EXCLUDED.updated_at
  `;
  await db`
    INSERT INTO pulse.state_changes (
      base_id,
      state_key,
      source_id,
      entity_id,
      entity_type,
      value,
      dimensions_hash,
      dimensions,
      resource_key,
      resource_id,
      resource_type,
      resource_label,
      changed_at
    )
    VALUES (
      ${params.baseId}::uuid,
      ${params.state.key},
      ${params.sourceId ?? null}::uuid,
      ${params.state.entityId ?? null},
      ${params.state.entityType ?? null},
      ${encodedValue}::jsonb,
      ${hash},
      (${jsonbObject(dimensions)}::jsonb #>> '{}')::jsonb,
      ${resource?.key ?? null},
      ${resource?.id ?? null},
      ${resource?.type ?? null},
      ${resource?.label ?? null},
      ${changedAt.data}
    )
  `;
  await upsertObservedResource({ baseId: params.baseId, sourceId: params.sourceId, resource, dimensions, seenAt: changedAt.data, db });
  await upsertDimensionMetadata({ baseId: params.baseId, sourceId: params.sourceId, scope: "state", dimensions, db });
  return ok();
};

export const setState = async (params: { baseId: string; sourceId?: string | null; state: PulseState }): Promise<Result<void>> =>
  setStateInClient(params);

const ingestMetricBatch = async (params: {
  baseId: string;
  sourceId?: string | null;
  metrics: PulseMetric[];
  db?: SqlClient;
}): Promise<Result<number>> => {
  let count = 0;
  for (const metric of params.metrics) {
    const result = await recordMetricInClient({ baseId: params.baseId, sourceId: params.sourceId, metric, db: params.db });
    if (!result.ok) return fail(result.error);
    count += 1;
  }
  return ok(count);
};

const ingestEventBatch = async (params: {
  baseId: string;
  sourceId?: string | null;
  events: PulseEvent[];
  db?: SqlClient;
}): Promise<Result<number>> => {
  let count = 0;
  for (const event of params.events) {
    const result = await recordEventInClient({ baseId: params.baseId, sourceId: params.sourceId, event, db: params.db });
    if (!result.ok) return fail(result.error);
    count += 1;
  }
  return ok(count);
};

const ingestStateBatch = async (params: {
  baseId: string;
  sourceId?: string | null;
  states: PulseState[];
  db?: SqlClient;
}): Promise<Result<number>> => {
  let count = 0;
  for (const state of params.states) {
    const result = await setStateInClient({ baseId: params.baseId, sourceId: params.sourceId, state, db: params.db });
    if (!result.ok) return fail(result.error);
    count += 1;
  }
  return ok(count);
};

const unwrapIngestResult = <T>(result: Result<T>): T => {
  if (result.ok) return result.data;
  throw new IngestTransactionFailure(result.error);
};

export const ingestBatch = async (params: {
  baseId: string;
  sourceId?: string | null;
  batch: PulseIngestBatch;
}): Promise<Result<{ metrics: number; events: number; states: number }>> => {
  const requestedCount = countBatchItems(params.batch);
  if (requestedCount === 0) return fail(err.badInput("Ingest batch is empty"));
  if (requestedCount > MAX_INGEST_BATCH_ITEMS) return fail(err.badInput(`Ingest batch exceeds ${MAX_INGEST_BATCH_ITEMS} items`));
  const valid = validateBatch(params.batch);
  if (!valid.ok) return fail(valid.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);

  // Ingest batches are all-or-nothing: once preflight passes, every write participates in this transaction.
  try {
    return await sql.begin(async (tx): Promise<Result<{ metrics: number; events: number; states: number }>> => {
      const metrics = unwrapIngestResult(await ingestMetricBatch({ baseId: params.baseId, sourceId: params.sourceId, metrics: params.batch.metrics ?? [], db: tx }));
      const events = unwrapIngestResult(await ingestEventBatch({ baseId: params.baseId, sourceId: params.sourceId, events: params.batch.events ?? [], db: tx }));
      const states = unwrapIngestResult(await ingestStateBatch({ baseId: params.baseId, sourceId: params.sourceId, states: params.batch.states ?? [], db: tx }));
      await touchSourceLastSeen(params.sourceId, tx);
      return ok({ metrics, events, states });
    });
  } catch (error) {
    if (error instanceof IngestTransactionFailure) return fail(error.serviceError);
    if (isServiceError(error)) return fail(error);
    return fail(err.internal("Failed to ingest Pulse batch"));
  }
};

export const ingestByApiKey = async (params: {
  serviceAccount: ServiceAccount;
  scopes: string[];
  batch: PulseIngestBatch;
}): Promise<Result<{ metrics: number; events: number; states: number }>> => {
  if (!params.scopes.includes(PULSE_INGEST_SCOPE) && !params.scopes.includes("write") && !params.scopes.includes("admin")) {
    return fail(err.forbidden("API key cannot ingest Pulse data"));
  }
  const source = await resolveIngestSourceForServiceAccount(params.serviceAccount);
  if (!source.ok) return fail(source.error);
  return ingestBatch({ baseId: source.data.baseId, sourceId: source.data.id, batch: params.batch });
};
