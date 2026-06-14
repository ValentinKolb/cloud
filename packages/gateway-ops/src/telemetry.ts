import { GATEWAY_TELEMETRY_TENANT, type GatewayTelemetryEvent, gatewayTelemetryTopic, logger } from "@valentinkolb/cloud/services";
import type { TopicDelivery } from "@valentinkolb/sync";
import { sql } from "bun";

const log = logger("gateway:telemetry");

const WORKER_GROUP = "postgres-writer";
const BATCH_SIZE = 100;
const SLOW_REQUEST_MS = 800;

export type TelemetrySummary = {
  requests: number;
  errors: number;
  slowRequests: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

export type TelemetryRouteSummary = {
  appId: string;
  routePrefix: string;
  requests: number;
  errors: number;
  slowRequests: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
};

export type TelemetryEventFilter = {
  search?: string;
  appId?: string;
  routePrefix?: string;
  slowOnly?: boolean;
  errorsOnly?: boolean;
  page?: number;
  perPage?: number;
};

export type TelemetryEventRow = {
  id: number;
  appId: string;
  routePrefix: string;
  method: string;
  status: number;
  durationMs: number;
  errorKind: string | null;
  occurredAt: string;
};

export type TelemetryEventList = {
  items: TelemetryEventRow[];
  total: number;
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (match) => `\\${match}`);

const persistDelivery = async (delivery: TopicDelivery<GatewayTelemetryEvent>): Promise<void> => {
  const event = delivery.data;
  const statusClass = Math.floor(event.status / 100) * 100;
  const isError = event.status >= 500 || event.errorKind !== null;
  const isSlow = event.durationMs >= SLOW_REQUEST_MS;

  await sql`
    WITH inserted AS (
      INSERT INTO gateway.telemetry_events (
        event_id, cursor, kind, app_id, route_prefix, method, status_code,
        status_class, duration_ms, error_kind, occurred_at
      )
      VALUES (
        ${delivery.eventId},
        ${delivery.cursor},
        ${event.kind},
        ${event.appId},
        ${event.routePrefix},
        ${event.method},
        ${event.status},
        ${statusClass},
        ${event.durationMs},
        ${event.errorKind},
        ${event.occurredAt}::timestamptz
      )
      ON CONFLICT (event_id) DO NOTHING
      RETURNING 1
    )
    INSERT INTO gateway.telemetry_rollups_minute (
      bucket, app_id, route_prefix, method, status_code, request_count,
      error_count, slow_count, total_duration_ms, max_duration_ms
    )
    SELECT
      date_trunc('minute', ${event.occurredAt}::timestamptz),
      ${event.appId},
      ${event.routePrefix},
      ${event.method},
      ${event.status},
      1,
      ${isError ? 1 : 0},
      ${isSlow ? 1 : 0},
      ${event.durationMs},
      ${event.durationMs}
    WHERE EXISTS (SELECT 1 FROM inserted)
    ON CONFLICT (bucket, app_id, route_prefix, method, status_code) DO UPDATE SET
      request_count = gateway.telemetry_rollups_minute.request_count + EXCLUDED.request_count,
      error_count = gateway.telemetry_rollups_minute.error_count + EXCLUDED.error_count,
      slow_count = gateway.telemetry_rollups_minute.slow_count + EXCLUDED.slow_count,
      total_duration_ms = gateway.telemetry_rollups_minute.total_duration_ms + EXCLUDED.total_duration_ms,
      max_duration_ms = GREATEST(gateway.telemetry_rollups_minute.max_duration_ms, EXCLUDED.max_duration_ms)
  `;
};

const persistBatch = async (deliveries: TopicDelivery<GatewayTelemetryEvent>[]): Promise<void> => {
  for (const delivery of deliveries) {
    await persistDelivery(delivery);
  }
  for (const delivery of deliveries) {
    await delivery.commit();
  }
};

export const consumeTelemetry = async (signal: AbortSignal): Promise<void> => {
  const reader = gatewayTelemetryTopic.reader(WORKER_GROUP);
  while (!signal.aborted) {
    const first = await reader.recv({ tenantId: GATEWAY_TELEMETRY_TENANT, wait: true, timeoutMs: 1000, signal });
    if (!first) continue;

    const batch = [first];
    while (batch.length < BATCH_SIZE && !signal.aborted) {
      const next = await reader.recv({ tenantId: GATEWAY_TELEMETRY_TENANT, wait: false, signal });
      if (!next) break;
      batch.push(next);
    }

    try {
      await persistBatch(batch);
    } catch (error) {
      log.error("Failed to persist gateway telemetry batch", {
        count: batch.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

export const cleanupTelemetry = async (retentionDays = 14): Promise<number> => {
  const [eventsResult, rollupsResult] = await Promise.all([
    sql`
    DELETE FROM gateway.telemetry_events
    WHERE occurred_at < now() - (${retentionDays}::int * INTERVAL '1 day')
    `,
    sql`
    DELETE FROM gateway.telemetry_rollups_minute
    WHERE bucket < date_trunc('minute', now() - (${retentionDays}::int * INTERVAL '1 day'))
    `,
  ]);
  return eventsResult.count + rollupsResult.count;
};

export const getTelemetrySummary = async (hours = 24): Promise<TelemetrySummary> => {
  const [row] = await sql<
    {
      requests: number;
      errors: number;
      slow_requests: number;
      avg_duration_ms: number | null;
      p95_duration_ms: number | null;
    }[]
  >`
    SELECT
      COUNT(*)::int AS requests,
      COUNT(*) FILTER (WHERE status_code >= 500 OR error_kind IS NOT NULL)::int AS errors,
      COUNT(*) FILTER (WHERE duration_ms >= ${SLOW_REQUEST_MS})::int AS slow_requests,
      AVG(duration_ms)::float AS avg_duration_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float AS p95_duration_ms
    FROM gateway.telemetry_events
    WHERE occurred_at >= now() - (${hours}::int * INTERVAL '1 hour')
  `;
  return {
    requests: row?.requests ?? 0,
    errors: row?.errors ?? 0,
    slowRequests: row?.slow_requests ?? 0,
    avgDurationMs: row?.avg_duration_ms ?? null,
    p95DurationMs: row?.p95_duration_ms ?? null,
  };
};

export const listSlowTelemetryRoutes = async (hours = 24, limit = 8): Promise<TelemetryRouteSummary[]> => {
  const rows = await sql<
    {
      app_id: string;
      route_prefix: string;
      requests: number;
      errors: number;
      slow_requests: number;
      avg_duration_ms: number | null;
      max_duration_ms: number | null;
    }[]
  >`
    SELECT
      app_id,
      route_prefix,
      COUNT(*)::int AS requests,
      COUNT(*) FILTER (WHERE status_code >= 500 OR error_kind IS NOT NULL)::int AS errors,
      COUNT(*) FILTER (WHERE duration_ms >= ${SLOW_REQUEST_MS})::int AS slow_requests,
      AVG(duration_ms)::float AS avg_duration_ms,
      MAX(duration_ms)::float AS max_duration_ms
    FROM gateway.telemetry_events
    WHERE occurred_at >= now() - (${hours}::int * INTERVAL '1 hour')
    GROUP BY app_id, route_prefix
    ORDER BY slow_requests DESC, avg_duration_ms DESC NULLS LAST, requests DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    appId: row.app_id,
    routePrefix: row.route_prefix,
    requests: row.requests,
    errors: row.errors,
    slowRequests: row.slow_requests,
    avgDurationMs: row.avg_duration_ms,
    maxDurationMs: row.max_duration_ms,
  }));
};

export const listTelemetryApps = async (hours = 24): Promise<string[]> => {
  const rows = await sql<{ app_id: string }[]>`
    SELECT DISTINCT app_id
    FROM gateway.telemetry_events
    WHERE occurred_at >= now() - (${hours}::int * INTERVAL '1 hour')
    ORDER BY app_id ASC
  `;
  return rows.map((row) => row.app_id);
};

export const listTelemetryEvents = async (filter: TelemetryEventFilter = {}): Promise<TelemetryEventList> => {
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const perPage = Math.max(1, Math.min(200, Math.floor(filter.perPage ?? 100)));
  const offset = (page - 1) * perPage;
  const searchPattern = filter.search?.trim() ? `%${escapeLike(filter.search.trim())}%` : null;
  const appId = filter.appId?.trim() || null;
  const routePrefix = filter.routePrefix?.trim() || null;
  const slowOnly = filter.slowOnly === true;
  const errorsOnly = filter.errorsOnly === true;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM gateway.telemetry_events
    WHERE (${searchPattern}::text IS NULL OR app_id ILIKE ${searchPattern} ESCAPE '\' OR route_prefix ILIKE ${searchPattern} ESCAPE '\' OR method ILIKE ${searchPattern} ESCAPE '\' OR error_kind ILIKE ${searchPattern} ESCAPE '\')
      AND (${appId}::text IS NULL OR app_id = ${appId})
      AND (${routePrefix}::text IS NULL OR route_prefix = ${routePrefix})
      AND (${slowOnly}::boolean IS FALSE OR duration_ms >= ${SLOW_REQUEST_MS})
      AND (${errorsOnly}::boolean IS FALSE OR status_code >= 500 OR error_kind IS NOT NULL)
  `;

  const rows = await sql<
    {
      id: number;
      app_id: string;
      route_prefix: string;
      method: string;
      status_code: number;
      duration_ms: number;
      error_kind: string | null;
      occurred_at: string;
    }[]
  >`
    SELECT id, app_id, route_prefix, method, status_code, duration_ms, error_kind, occurred_at::text
    FROM gateway.telemetry_events
    WHERE (${searchPattern}::text IS NULL OR app_id ILIKE ${searchPattern} ESCAPE '\' OR route_prefix ILIKE ${searchPattern} ESCAPE '\' OR method ILIKE ${searchPattern} ESCAPE '\' OR error_kind ILIKE ${searchPattern} ESCAPE '\')
      AND (${appId}::text IS NULL OR app_id = ${appId})
      AND (${routePrefix}::text IS NULL OR route_prefix = ${routePrefix})
      AND (${slowOnly}::boolean IS FALSE OR duration_ms >= ${SLOW_REQUEST_MS})
      AND (${errorsOnly}::boolean IS FALSE OR status_code >= 500 OR error_kind IS NOT NULL)
    ORDER BY gateway.telemetry_events.occurred_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return {
    total: countRow?.count ?? 0,
    items: rows.map((row) => ({
      id: row.id,
      appId: row.app_id,
      routePrefix: row.route_prefix,
      method: row.method,
      status: row.status_code,
      durationMs: row.duration_ms,
      errorKind: row.error_kind,
      occurredAt: row.occurred_at,
    })),
  };
};
