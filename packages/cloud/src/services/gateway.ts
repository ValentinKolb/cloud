import { ephemeral, topic } from "@valentinkolb/sync";
import { logger } from "./logging";

const SNAPSHOT_TTL_MS = 30_000;
const TOPIC_PREFIX = "cloud:gateway:telemetry";
const TOPIC_ID = "events";
const TOPIC_RETENTION_MS = 24 * 60 * 60 * 1000;
const TOPIC_TENANT = "default";
const DROP_LOG_INTERVAL_MS = 30_000;

const log = logger("gateway:telemetry");

export type GatewayRouteWarning = {
  appId: string;
  prefix: string;
  reason: string;
  detail?: string;
};

export type GatewayRouteSnapshotInput = {
  instanceId: string;
  baseUrl: string;
  startedAt: number;
  routeHash: string;
  routeWarnings: GatewayRouteWarning[];
  table: {
    version: number;
    builtAt: number;
    routeCount: number;
    routes: Array<{ prefix: string; appId: string }>;
  };
  stats: {
    totalRequests: number;
    noRouteCount: number;
    byApp: Map<string, { count: number; totalMs: number; errors: number }>;
    byRoute: Map<string, { count: number; errors: number; lastSeen: number }>;
  };
};

export type GatewayRouteSnapshot = {
  instanceId: string;
  baseUrl: string;
  startedAt: number;
  updatedAt: number;
  tableVersion: number;
  tableBuiltAt: number;
  routeCount: number;
  routeHash: string;
  routeWarnings: GatewayRouteWarning[];
  routes: Array<{ prefix: string; appId: string }>;
  stats: {
    totalRequests: number;
    noRouteCount: number;
    byApp: Array<{ appId: string; count: number; totalMs: number; errors: number }>;
    byRoute: Array<{ prefix: string; count: number; errors: number; lastSeen: number }>;
  };
};

export type GatewayTelemetryEvent = {
  v: 1;
  kind: "request";
  appId: string;
  routePrefix: string;
  method: string;
  status: number;
  durationMs: number;
  errorKind: "upstream_unavailable" | "unmatched_route" | null;
  occurredAt: string;
};

const snapshots = ephemeral<GatewayRouteSnapshot>({
  id: "gateway-route-snapshots",
  ttlMs: SNAPSHOT_TTL_MS,
  limits: { maxPayloadBytes: 128_000 },
});

export const buildGatewayRouteSnapshot = (input: GatewayRouteSnapshotInput): GatewayRouteSnapshot => ({
  instanceId: input.instanceId,
  baseUrl: input.baseUrl,
  startedAt: input.startedAt,
  updatedAt: Date.now(),
  tableVersion: input.table.version,
  tableBuiltAt: input.table.builtAt,
  routeCount: input.table.routeCount,
  routeHash: input.routeHash,
  routeWarnings: input.routeWarnings,
  routes: input.table.routes,
  stats: {
    totalRequests: input.stats.totalRequests,
    noRouteCount: input.stats.noRouteCount,
    byApp: [...input.stats.byApp.entries()].map(([appId, value]) => ({ appId, ...value })),
    byRoute: [...input.stats.byRoute.entries()].map(([prefix, value]) => ({ prefix, ...value })),
  },
});

export const publishGatewayRouteSnapshot = async (snapshot: GatewayRouteSnapshot): Promise<void> => {
  await snapshots.upsert({ key: `instances/${snapshot.instanceId}`, value: snapshot });
};

export const removeGatewayRouteSnapshot = async (instanceId: string): Promise<void> => {
  await snapshots.remove({ key: `instances/${instanceId}` });
};

export const listGatewayRouteSnapshots = async (): Promise<GatewayRouteSnapshot[]> => {
  const snap = await snapshots.snapshot({ prefix: "instances/" });
  return snap.entries.map((entry) => entry.value).sort((a, b) => a.instanceId.localeCompare(b.instanceId));
};

export const latestGatewayRouteSnapshot = async (): Promise<GatewayRouteSnapshot | null> => {
  const all = await listGatewayRouteSnapshots();
  return all.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
};

export const gatewayTelemetryTopic = topic<GatewayTelemetryEvent>({
  id: TOPIC_ID,
  prefix: TOPIC_PREFIX,
  retentionMs: TOPIC_RETENTION_MS,
  limits: { payloadBytes: 8_000 },
});

export const GATEWAY_TELEMETRY_TENANT = TOPIC_TENANT;

const normalizeMethod = (method: string): string => method.toUpperCase().slice(0, 16);
const normalizeStatus = (status: number): number => (Number.isFinite(status) ? Math.max(0, Math.min(999, Math.round(status))) : 0);
const normalizeDuration = (durationMs: number): number => (Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0);
const normalizeText = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  return (trimmed.length ? trimmed : fallback).slice(0, 200);
};

export const publishRequestTelemetry = (event: Omit<GatewayTelemetryEvent, "v" | "kind" | "occurredAt">): void => {
  const payload: GatewayTelemetryEvent = {
    v: 1,
    kind: "request",
    appId: normalizeText(event.appId, "unknown"),
    routePrefix: normalizeText(event.routePrefix, "(unknown)"),
    method: normalizeMethod(event.method),
    status: normalizeStatus(event.status),
    durationMs: normalizeDuration(event.durationMs),
    errorKind: event.errorKind,
    occurredAt: new Date().toISOString(),
  };

  void gatewayTelemetryTopic
    .pub({
      tenantId: GATEWAY_TELEMETRY_TENANT,
      orderingKey: payload.appId,
      data: payload,
    })
    .catch((error) => {
      const now = Date.now();
      if (now - lastPublishErrorAt < DROP_LOG_INTERVAL_MS) return;
      lastPublishErrorAt = now;
      log.warn("Dropped gateway telemetry event", {
        appId: payload.appId,
        routePrefix: payload.routePrefix,
        error: error instanceof Error ? error.message : String(error),
      });
    });
};

let lastPublishErrorAt = 0;
