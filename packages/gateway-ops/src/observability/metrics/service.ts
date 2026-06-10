import { listAppsDetailed } from "@valentinkolb/cloud";
import type { User } from "@valentinkolb/cloud/contracts";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { listGatewayRouteSnapshots, logging, serviceAccountCredentials, serviceAccounts } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { listRegisteredAppStatus } from "../../registered-apps";
import { getPostgresDiagnostics, getRedisDiagnostics } from "../data/service";

export const METRICS_ENDPOINT = "/metrics";
export const METRICS_SCOPE = "metrics:read";
export const METRICS_SERVICE_ACCOUNT = {
  name: "Cloud metrics scrape",
  appId: "gateway-ops",
  resourceType: "metrics",
  resourceId: "cloud",
} as const;

const CACHE_TTL_MS = 15_000;
const COLLECTOR_TIMEOUT_MS = 2_500;
const TOP_REDIS_PREFIXES = 10;

type MetricType = "counter" | "gauge";
type MetricLabels = Record<string, string | number | boolean>;

type MetricSample = {
  name: string;
  help: string;
  type: MetricType;
  value: number;
  labels?: MetricLabels;
};

export type MetricsCollectorStatus = {
  id: string;
  name: string;
  description: string;
  metricNames: string[];
  status: "ok" | "error";
  durationMs: number;
  series: number;
  lastRunAt: string;
  error: string | null;
};

export type MetricsSnapshot = {
  generatedAt: string;
  expiresAt: number;
  text: string;
  series: number;
  collectors: MetricsCollectorStatus[];
};

export type MetricsToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type CreateMetricsTokenInput = {
  name: string;
  expiresAt?: string | null;
};

export type CreatedMetricsToken = {
  token: string;
  credential: MetricsToken;
};

type CollectorDefinition = {
  id: string;
  name: string;
  description: string;
  metricNames: string[];
  collect: () => Promise<MetricSample[]>;
};

const seconds = (value: number): number => Math.floor(value / 1000);
const nowIso = (): string => new Date().toISOString();
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

const escapeLabelValue = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

const formatLabels = (labels: MetricLabels | undefined): string => {
  if (!labels || Object.keys(labels).length === 0) return "";
  const body = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${escapeLabelValue(String(value))}"`)
    .join(",");
  return `{${body}}`;
};

const formatMetricText = (samples: MetricSample[]): string => {
  const lines: string[] = ["# Cloud platform metrics exported by Gateway Ops.", `# Generated at ${nowIso()}`];
  const seen = new Set<string>();
  for (const sample of samples) {
    if (!seen.has(sample.name)) {
      seen.add(sample.name);
      lines.push(`# HELP ${sample.name} ${sample.help}`);
      lines.push(`# TYPE ${sample.name} ${sample.type}`);
    }
    lines.push(`${sample.name}${formatLabels(sample.labels)} ${finite(sample.value)}`);
  }
  lines.push("");
  return lines.join("\n");
};

const withTimeout = async <T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const metricCatalog: CollectorDefinition[] = [
  {
    id: "gateway",
    name: "Gateway",
    description: "Gateway router instances, routes, and proxy request counters from route snapshots.",
    metricNames: [
      "cloud_gateway_instances",
      "cloud_gateway_route_count",
      "cloud_gateway_route_warnings",
      "cloud_gateway_requests_total",
      "cloud_gateway_errors_total",
      "cloud_gateway_request_duration_ms_total",
      "cloud_gateway_unmatched_requests_total",
    ],
    collect: async () => {
      const snapshots = await listGatewayRouteSnapshots();
      const latest = snapshots.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
      const byApp = new Map<string, { requests: number; errors: number; durationMs: number }>();
      for (const snapshot of snapshots) {
        for (const row of snapshot.stats.byApp) {
          const current = byApp.get(row.appId) ?? { requests: 0, errors: 0, durationMs: 0 };
          current.requests += row.count;
          current.errors += row.errors;
          current.durationMs += row.totalMs;
          byApp.set(row.appId, current);
        }
      }
      return [
        {
          name: "cloud_gateway_instances",
          help: "Number of active gateway router instances publishing route snapshots.",
          type: "gauge",
          value: snapshots.length,
        },
        {
          name: "cloud_gateway_route_count",
          help: "Number of route prefixes in the latest gateway route table.",
          type: "gauge",
          value: latest?.routeCount ?? 0,
        },
        {
          name: "cloud_gateway_route_warnings",
          help: "Number of route warnings in the latest gateway route table.",
          type: "gauge",
          value: latest?.routeWarnings.length ?? 0,
        },
        {
          name: "cloud_gateway_unmatched_requests_total",
          help: "Total unmatched requests observed by gateway routers since process start.",
          type: "counter",
          value: snapshots.reduce((sum, snapshot) => sum + snapshot.stats.noRouteCount, 0),
        },
        ...[...byApp.entries()].flatMap(([appId, row]) => [
          {
            name: "cloud_gateway_requests_total",
            help: "Total proxied requests observed by gateway routers since process start.",
            type: "counter" as const,
            value: row.requests,
            labels: { app_id: appId },
          },
          {
            name: "cloud_gateway_errors_total",
            help: "Total gateway proxy errors observed since process start.",
            type: "counter" as const,
            value: row.errors,
            labels: { app_id: appId },
          },
          {
            name: "cloud_gateway_request_duration_ms_total",
            help: "Total gateway proxy request duration in milliseconds since process start.",
            type: "counter" as const,
            value: Math.round(row.durationMs),
            labels: { app_id: appId },
          },
        ]),
      ];
    },
  },
  {
    id: "apps",
    name: "App Registry",
    description: "Registered app health derived from live registry heartbeats and persisted Gateway Ops state.",
    metricNames: [
      "cloud_app_registered_total",
      "cloud_app_online_total",
      "cloud_app_degraded_total",
      "cloud_app_offline_total",
      "cloud_app_up",
    ],
    collect: async () => {
      const liveApps = await listAppsDetailed();
      const apps = await listRegisteredAppStatus(liveApps);
      const online = apps.filter((app) => app.isOnline);
      const healthy = apps.filter((app) => app.live && app.live.expiresAt - Date.now() > 30_000);
      const offline = apps.filter((app) => !app.isOnline);
      const degraded = apps.length - healthy.length - offline.length;
      return [
        {
          name: "cloud_app_registered_total",
          help: "Number of apps registered in Gateway Ops.",
          type: "gauge",
          value: apps.length,
        },
        {
          name: "cloud_app_online_total",
          help: "Number of registered apps with a live registry entry.",
          type: "gauge",
          value: online.length,
        },
        {
          name: "cloud_app_degraded_total",
          help: "Number of registered apps with stale live registry state.",
          type: "gauge",
          value: degraded,
        },
        {
          name: "cloud_app_offline_total",
          help: "Number of registered apps without a live registry entry.",
          type: "gauge",
          value: offline.length,
        },
        ...apps.map((app) => ({
          name: "cloud_app_up",
          help: "Whether a registered app has a fresh live registry heartbeat.",
          type: "gauge" as const,
          value: app.live && app.live.expiresAt - Date.now() > 30_000 ? 1 : 0,
          labels: { app_id: app.id },
        })),
      ];
    },
  },
  {
    id: "logs",
    name: "Logs",
    description: "Log volume and warning/error counts from the logging service summary.",
    metricNames: [
      "cloud_logs_entries_total",
      "cloud_logs_entries_24h_total",
      "cloud_logs_errors_24h_total",
      "cloud_logs_warnings_24h_total",
      "cloud_logs_sources_total",
      "cloud_logs_last_error_timestamp_seconds",
    ],
    collect: async () => {
      const summary = await logging.summary();
      return [
        {
          name: "cloud_logs_entries_total",
          help: "Total retained log entries.",
          type: "gauge",
          value: summary.total,
        },
        {
          name: "cloud_logs_entries_24h_total",
          help: "Log entries created in the last 24 hours.",
          type: "gauge",
          value: summary.total24h,
        },
        {
          name: "cloud_logs_errors_24h_total",
          help: "Error log entries created in the last 24 hours.",
          type: "gauge",
          value: summary.errors24h,
        },
        {
          name: "cloud_logs_warnings_24h_total",
          help: "Warning log entries created in the last 24 hours.",
          type: "gauge",
          value: summary.warnings24h,
        },
        {
          name: "cloud_logs_sources_total",
          help: "Distinct log sources with retained entries.",
          type: "gauge",
          value: summary.sources,
        },
        {
          name: "cloud_logs_last_error_timestamp_seconds",
          help: "Unix timestamp of the latest retained error log, or zero when none exists.",
          type: "gauge",
          value: summary.lastErrorAt ? seconds(new Date(summary.lastErrorAt).getTime()) : 0,
        },
      ];
    },
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "Postgres table, schema, extension, size, and warning diagnostics.",
    metricNames: [
      "cloud_postgres_up",
      "cloud_postgres_schema_count",
      "cloud_postgres_table_count",
      "cloud_postgres_relation_bytes_total",
      "cloud_postgres_extension_installed_total",
      "cloud_postgres_extension_available_total",
      "cloud_postgres_warnings_total",
    ],
    collect: async () => {
      const diagnostics = await getPostgresDiagnostics();
      return [
        {
          name: "cloud_postgres_up",
          help: "Whether Postgres diagnostics were collected successfully.",
          type: "gauge",
          value: diagnostics.available ? 1 : 0,
        },
        {
          name: "cloud_postgres_schema_count",
          help: "Number of non-system Postgres schemas.",
          type: "gauge",
          value: diagnostics.schemas,
        },
        {
          name: "cloud_postgres_table_count",
          help: "Number of user tables reported by pg_stat_user_tables.",
          type: "gauge",
          value: diagnostics.tables,
        },
        {
          name: "cloud_postgres_relation_bytes_total",
          help: "Total relation bytes across user tables.",
          type: "gauge",
          value: diagnostics.totalBytes,
        },
        {
          name: "cloud_postgres_extension_installed_total",
          help: "Number of installed Postgres extensions.",
          type: "gauge",
          value: diagnostics.installedExtensions,
        },
        {
          name: "cloud_postgres_extension_available_total",
          help: "Number of available Postgres extensions.",
          type: "gauge",
          value: diagnostics.availableExtensions,
        },
        {
          name: "cloud_postgres_warnings_total",
          help: "Number of Postgres diagnostic warnings.",
          type: "gauge",
          value: diagnostics.warnings.length,
        },
      ];
    },
  },
  {
    id: "redis",
    name: "Redis",
    description: "Redis keyspace, expiry, TTL, and bounded prefix sample diagnostics.",
    metricNames: [
      "cloud_redis_up",
      "cloud_redis_keys_total",
      "cloud_redis_keys_expiring_total",
      "cloud_redis_avg_ttl_ms",
      "cloud_redis_sampled_keys",
      "cloud_redis_scan_complete",
      "cloud_redis_prefix_sample_keys",
      "cloud_redis_warnings_total",
    ],
    collect: async () => {
      const diagnostics = await getRedisDiagnostics();
      const keyspaceSamples = diagnostics.keyspace.flatMap((row) => [
        {
          name: "cloud_redis_keys_total",
          help: "Redis keys reported by INFO keyspace.",
          type: "gauge" as const,
          value: row.keys,
          labels: { database: row.database },
        },
        {
          name: "cloud_redis_keys_expiring_total",
          help: "Redis keys with expiry reported by INFO keyspace.",
          type: "gauge" as const,
          value: row.expires,
          labels: { database: row.database },
        },
        {
          name: "cloud_redis_avg_ttl_ms",
          help: "Redis average TTL in milliseconds reported by INFO keyspace.",
          type: "gauge" as const,
          value: row.avgTtlMs,
          labels: { database: row.database },
        },
      ]);
      const prefixSamples = diagnostics.prefixes
        .filter((row) => row.depth === 1)
        .slice(0, TOP_REDIS_PREFIXES)
        .map((row) => ({
          name: "cloud_redis_prefix_sample_keys",
          help: "Bounded Redis key prefix sample count. Prefix labels are sampled and limited.",
          type: "gauge" as const,
          value: row.count,
          labels: { depth: row.depth, prefix: row.prefix },
        }));

      return [
        {
          name: "cloud_redis_up",
          help: "Whether Redis diagnostics were collected successfully.",
          type: "gauge",
          value: diagnostics.available ? 1 : 0,
        },
        {
          name: "cloud_redis_sampled_keys",
          help: "Number of Redis keys included in the bounded SCAN sample.",
          type: "gauge",
          value: diagnostics.sampledKeys,
        },
        {
          name: "cloud_redis_scan_complete",
          help: "Whether the Redis SCAN completed before the sample cap.",
          type: "gauge",
          value: diagnostics.scanComplete ? 1 : 0,
        },
        {
          name: "cloud_redis_warnings_total",
          help: "Number of Redis diagnostic warnings.",
          type: "gauge",
          value: diagnostics.warnings.length,
        },
        ...keyspaceSamples,
        ...prefixSamples,
      ];
    },
  },
];

export const metricsCollectors = metricCatalog.map(({ id, name, description, metricNames }) => ({ id, name, description, metricNames }));

const selfMetric = (name: string, help: string, value: number, labels?: MetricLabels): MetricSample => ({
  name,
  help,
  type: "gauge",
  value,
  labels,
});

const runCollector = async (collector: CollectorDefinition): Promise<{ status: MetricsCollectorStatus; samples: MetricSample[] }> => {
  const start = performance.now();
  const lastRunAt = nowIso();
  try {
    const samples = await withTimeout(collector.name, collector.collect(), COLLECTOR_TIMEOUT_MS);
    return {
      samples,
      status: {
        id: collector.id,
        name: collector.name,
        description: collector.description,
        metricNames: collector.metricNames,
        status: "ok",
        durationMs: Math.round(performance.now() - start),
        series: samples.length,
        lastRunAt,
        error: null,
      },
    };
  } catch (error) {
    return {
      samples: [],
      status: {
        id: collector.id,
        name: collector.name,
        description: collector.description,
        metricNames: collector.metricNames,
        status: "error",
        durationMs: Math.round(performance.now() - start),
        series: 0,
        lastRunAt,
        error: errorMessage(error),
      },
    };
  }
};

let cachedSnapshot: MetricsSnapshot | null = null;
let pendingSnapshot: Promise<MetricsSnapshot> | null = null;

const buildMetricsSnapshot = async (): Promise<MetricsSnapshot> => {
  const generatedAt = nowIso();
  const collected = await Promise.all(metricCatalog.map(runCollector));
  const statuses = collected.map((result) => result.status);
  const samples = collected.flatMap((result) => result.samples);
  for (const status of statuses) {
    samples.push(
      selfMetric(
        "cloud_metrics_collector_success",
        "Whether a Cloud metrics collector completed successfully.",
        status.status === "ok" ? 1 : 0,
        {
          collector: status.id,
        },
      ),
      selfMetric("cloud_metrics_collector_duration_ms", "Cloud metrics collector duration in milliseconds.", status.durationMs, {
        collector: status.id,
      }),
      selfMetric("cloud_metrics_collector_series", "Number of metric series emitted by a Cloud metrics collector.", status.series, {
        collector: status.id,
      }),
    );
  }
  samples.push(
    selfMetric("cloud_metrics_cache_ttl_seconds", "Configured Gateway Ops metrics cache TTL in seconds.", CACHE_TTL_MS / 1000),
    selfMetric(
      "cloud_metrics_generated_timestamp_seconds",
      "Unix timestamp when the Gateway Ops metrics payload was generated.",
      seconds(Date.now()),
    ),
  );
  return {
    generatedAt,
    expiresAt: Date.now() + CACHE_TTL_MS,
    text: formatMetricText(samples),
    series: samples.length,
    collectors: statuses,
  };
};

export const getMetricsSnapshot = async (): Promise<MetricsSnapshot> => {
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return cachedSnapshot;
  if (pendingSnapshot) return pendingSnapshot;
  pendingSnapshot = buildMetricsSnapshot()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      pendingSnapshot = null;
    });
  return pendingSnapshot;
};

export const getCachedMetricsSnapshot = (): MetricsSnapshot | null => cachedSnapshot;

const tokenFromCredential = (credential: {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}): MetricsToken => ({
  id: credential.id,
  name: credential.name,
  tokenPrefix: credential.tokenPrefix,
  scopes: credential.scopes,
  expiresAt: credential.expiresAt,
  lastUsedAt: credential.lastUsedAt,
  createdAt: credential.createdAt,
});

export const getOrCreateMetricsServiceAccount = async (actor: User): Promise<Result<{ id: string }>> => {
  const result = await serviceAccounts.getOrCreateResourceBound({
    ...METRICS_SERVICE_ACCOUNT,
    createdBy: actor.id,
  });
  if (!result.ok) return result;
  return ok({ id: result.data.id });
};

export const listMetricsTokens = async (): Promise<MetricsToken[]> => {
  const serviceAccount = await serviceAccounts.getByResource(METRICS_SERVICE_ACCOUNT);
  if (!serviceAccount) return [];
  const page = await serviceAccountCredentials.listOverview({
    pagination: { page: 1, perPage: 500 },
    filter: {
      serviceAccountId: serviceAccount.id,
      credentialStatus: "active",
    },
  });
  return page.items.map(tokenFromCredential);
};

export const createMetricsToken = async (input: CreateMetricsTokenInput, actor: User): Promise<Result<CreatedMetricsToken>> => {
  const serviceAccount = await getOrCreateMetricsServiceAccount(actor);
  if (!serviceAccount.ok) return fail(serviceAccount.error);
  const result = await serviceAccountCredentials.createResourceApiToken({
    serviceAccountId: serviceAccount.data.id,
    actor,
    name: input.name,
    expiresAt: input.expiresAt ?? null,
    scopes: [METRICS_SCOPE],
  });
  if (!result.ok) return result;
  return ok({
    token: result.data.token,
    credential: tokenFromCredential(result.data.credential),
  });
};

export const revokeMetricsToken = async (credentialId: string, actor: User): Promise<Result<void>> => {
  const serviceAccount = await serviceAccounts.getByResource(METRICS_SERVICE_ACCOUNT);
  if (!serviceAccount) return fail(err.notFound("Metrics service account"));
  const page = await serviceAccountCredentials.listOverview({
    pagination: { page: 1, perPage: 500 },
    filter: { serviceAccountId: serviceAccount.id, credentialStatus: "active" },
  });
  if (!page.items.some((item) => item.id === credentialId)) return fail(err.notFound("Metrics token"));
  return serviceAccountCredentials.revoke({ credentialId, actor });
};

export const canReadMetrics = (actor: AuthContext["Variables"]["actor"] | undefined): boolean => {
  if (!actor) return false;
  if (actor.kind === "user") return actor.user.roles.includes("admin");
  return (
    actor.serviceAccount.kind === "resource_bound" &&
    actor.serviceAccount.status === "active" &&
    actor.serviceAccount.appId === METRICS_SERVICE_ACCOUNT.appId &&
    actor.serviceAccount.resourceType === METRICS_SERVICE_ACCOUNT.resourceType &&
    actor.serviceAccount.resourceId === METRICS_SERVICE_ACCOUNT.resourceId &&
    actor.scopes.includes(METRICS_SCOPE)
  );
};
