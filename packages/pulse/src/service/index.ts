import { createHash, randomUUID } from "node:crypto";
import type { ServiceAccount, ServiceAccountCredential, User } from "@valentinkolb/cloud/contracts";
import {
  err,
  fail,
  ok,
  resolveDisplayNames,
  type AccessEntry,
  type PermissionLevel,
  type Principal,
  type Result,
} from "@valentinkolb/cloud/server";
import { decryptSecret, encryptSecret, serviceAccountCredentials, serviceAccounts, toPgUuidArray } from "@valentinkolb/cloud/services";
import { job } from "@valentinkolb/sync";
import { sql } from "bun";
import { AGGREGATIONS, PANEL_VISUALS } from "../contracts";
import { compileDashboardDsl } from "../dashboard-dsl";
import { compilePulseQueryText, durationToInterval, intervalToMs } from "../query-dsl";
import type {
  Aggregation,
  DashboardRefreshInterval,
  MetricType,
  PulseBase,
  PulseCapabilitySnapshot,
  PulseDashboardCondition,
  PulseDashboardControl,
  PulseDashboard,
  PulseDashboardCardWidget,
  PulseDashboardConfig,
  PulseDashboardDslCompileResult,
  PulseDashboardEventsWidget,
  PulseDashboardLayout,
  PulseDashboardMarkdownWidget,
  PulseDashboardMetricQuery,
  PulseDashboardMetricWidget,
  PulsePublicDashboardCardWidget,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardStateQuery,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
  PulseDashboardSnapshot,
  PulseExplorerQuery,
  PulseEvent,
  EventQuery,
  PulseIngestBatch,
  PulseCurrentState,
  PulseMetricSummary,
  PulseMetric,
  PulseMetricSeries,
  PulseInventory,
  PulsePublicCurrentState,
  PulseQueryCompileResult,
  PulsePublicDashboard,
  PulsePublicDashboardEventsWidget,
  PulsePublicDashboardLayout,
  PulsePublicDashboardMetricWidget,
  PulsePublicDashboardRow,
  PulsePublicDashboardSection,
  PulsePublicDashboardStatesWidget,
  PulsePublicDashboardWidget,
  PulsePublicRecordedEvent,
  PulseRecordedEvent,
  PulseResourceMetric,
  PulseResourceSummary,
  PulseSavedQuery,
  PulseSource,
  PulseState,
  StateQuery,
  SourceKind,
  PulseSourceScrape,
  MetricQuery,
  MetricQueryPoint,
} from "../contracts";
import { derivePulseResource } from "../resource-model";

const PULSE_APP_ID = "pulse";
const PULSE_SOURCE_RESOURCE_TYPE = "pulse_source";
const PULSE_INGEST_SCOPE = "pulse:ingest";
const BASE_DELETE_BATCH_SIZE = 50_000;
const MAX_INGEST_BATCH_ITEMS = 50_000;
const MAX_METRIC_BUCKETS = 2_000;
const MAX_PUBLIC_EXECUTED_WIDGETS = 36;
const MAX_SCRAPE_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_SCRAPE_SAMPLES = 50_000;

type UserScope = {
  id: string;
  memberofGroupIds?: string[];
};

type BaseRow = {
  id: string;
  name: string;
  description: string | null;
  retention_days: number;
  created_by: string | null;
  deletion_started_at: Date | string | null;
  deletion_failed_at: Date | string | null;
  deletion_error: string | null;
  data_clear_started_at: Date | string | null;
  data_clear_completed_at: Date | string | null;
  data_clear_failed_at: Date | string | null;
  data_clear_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SourceRow = {
  id: string;
  base_id: string;
  kind: SourceKind;
  name: string;
  enabled: boolean;
  endpoint_url: string | null;
  bearer_token_encrypted: string | null;
  scrape_interval_seconds: number | null;
  last_seen_at: Date | string | null;
  last_error: string | null;
  last_error_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type DashboardRow = {
  id: string;
  base_id: string;
  name: string;
  config: unknown;
  public_enabled: boolean;
  public_token: string | null;
  public_token_hash: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type SavedQueryRow = {
  id: string;
  base_id: string;
  name: string;
  description: string | null;
  query: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type RecordedEventRow = {
  id: string;
  kind: string;
  ts: Date | string;
  value: number | null;
  source_id: string | null;
  entity_id: string | null;
  entity_type: string | null;
  dimensions: unknown;
  payload: unknown;
  recorded_at: Date | string;
};

type CurrentStateRow = {
  state_key: string;
  value: unknown;
  source_id: string | null;
  entity_id: string;
  entity_type: string | null;
  dimensions: unknown;
  updated_at: Date | string;
};

type AccessRow = {
  id: string;
  user_id: string | null;
  group_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date | string;
};

type SourceScrapeRow = {
  id: string;
  source_id: string;
  started_at: Date | string;
  finished_at: Date | string;
  duration_ms: number;
  success: boolean;
  metrics_count: number;
  events_count: number;
  states_count: number;
  error_message: string | null;
};

export type PulseSourceApiKey = ServiceAccountCredential & { permission: PermissionLevel };

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
const isoNullable = (value: Date | string | null): string | null => (value ? iso(value) : null);

const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  const parsed = parseJson(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
};

const mapBase = (row: BaseRow): PulseBase => ({
  id: row.id,
  name: row.name,
  description: row.description,
  retentionDays: row.retention_days,
  createdBy: row.created_by,
  deletionStartedAt: isoNullable(row.deletion_started_at),
  deletionFailedAt: isoNullable(row.deletion_failed_at),
  deletionError: row.deletion_error,
  dataClearStartedAt: isoNullable(row.data_clear_started_at),
  dataClearCompletedAt: isoNullable(row.data_clear_completed_at),
  dataClearFailedAt: isoNullable(row.data_clear_failed_at),
  dataClearError: row.data_clear_error,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapSource = (row: SourceRow): PulseSource => ({
  id: row.id,
  baseId: row.base_id,
  kind: row.kind,
  name: row.name,
  enabled: row.enabled,
  endpointUrl: row.endpoint_url,
  bearerTokenConfigured: Boolean(row.bearer_token_encrypted),
  scrapeIntervalSeconds: row.scrape_interval_seconds,
  lastSeenAt: isoNullable(row.last_seen_at),
  lastError: row.last_error,
  lastErrorAt: isoNullable(row.last_error_at),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const principalFromAccessRow = (row: Pick<AccessRow, "user_id" | "group_id" | "authenticated_only">): Principal => {
  if (row.user_id) return { type: "user", userId: row.user_id };
  if (row.group_id) return { type: "group", groupId: row.group_id };
  if (row.authenticated_only) return { type: "authenticated" };
  return { type: "public" };
};

const mapAccessRow = (row: AccessRow): AccessEntry => ({
  id: row.id,
  principal: principalFromAccessRow(row),
  permission: row.permission,
  createdAt: iso(row.created_at),
});

const mapSourceScrape = (row: SourceScrapeRow): PulseSourceScrape => ({
  id: row.id,
  sourceId: row.source_id,
  startedAt: iso(row.started_at),
  finishedAt: iso(row.finished_at),
  durationMs: row.duration_ms,
  success: row.success,
  metrics: row.metrics_count,
  events: row.events_count,
  states: row.states_count,
  errorMessage: row.error_message,
});

const mapRecordedEvent = (row: RecordedEventRow): PulseRecordedEvent => ({
  id: row.id,
  kind: row.kind,
  ts: iso(row.ts),
  value: row.value,
  sourceId: row.source_id,
  entityId: row.entity_id,
  entityType: row.entity_type,
  dimensions: normalizeDimensions(parseJsonObject(row.dimensions)),
  payload: parseJsonObject(row.payload),
  recordedAt: iso(row.recorded_at),
});

const mapCurrentState = (row: CurrentStateRow): PulseCurrentState => ({
  key: row.state_key,
  value: parseJson(row.value),
  sourceId: row.source_id,
  entityId: row.entity_id,
  entityType: row.entity_type,
  dimensions: normalizeDimensions(parseJsonObject(row.dimensions)),
  updatedAt: iso(row.updated_at),
});

const normalizeDimensions = (dimensions: Record<string, unknown> | undefined): Record<string, string> => {
  const entries = Object.entries(dimensions ?? {})
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key, value]) => key.length > 0 && value !== null && value !== undefined)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
};

const dimensionsHash = (dimensions: Record<string, string>): string =>
  createHash("sha256").update(JSON.stringify(dimensions)).digest("hex");

const jsonbObject = (value: Record<string, unknown>): string => JSON.stringify(value);

const metricSeriesKey = (params: { sourceId?: string | null; entityId?: string | null; dimensionsHash: string }): string =>
  [params.sourceId ?? "", params.entityId ?? "", params.dimensionsHash].join("\u001f");

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

const normalizeEndpointUrl = (input: string | null | undefined): string | null => {
  const value = input?.trim();
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
};

const escapeLikePattern = (value: string): string => value.replace(/([\\%_])/g, "\\$1");

const searchPattern = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? `%${escapeLikePattern(trimmed)}%` : null;
};

const normalizeDashboardMetricWidgetBase = (value: Record<string, unknown>) => {
  const metric = typeof value.metric === "string" ? value.metric.trim() : "";
  if (!metric) return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 80) : randomUUID();
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 160) : metric;
  const visual = PANEL_VISUALS.includes(value.visual as (typeof PANEL_VISUALS)[number])
    ? (value.visual as PulseDashboardMetricWidget["visual"])
    : "line";
  const aggregation = AGGREGATIONS.includes(value.aggregation as Aggregation) ? (value.aggregation as Aggregation) : "avg";
  const bucket = typeof value.bucket === "string" && /^\d+[mhd]$/.test(value.bucket) ? value.bucket : "5m";
  const since = typeof value.since === "string" && /^\d+[mhd]$/.test(value.since) ? value.since : "24h";
  const sourceId = typeof value.sourceId === "string" && value.sourceId.trim() ? value.sourceId : null;
  const entityId = typeof value.entityId === "string" && value.entityId.trim() ? value.entityId.trim().slice(0, 240) : null;
  const entityType = typeof value.entityType === "string" && value.entityType.trim() ? value.entityType.trim().slice(0, 80) : null;
  const dimensions =
    typeof value.dimensions === "object" && value.dimensions !== null
      ? normalizeDimensions(value.dimensions as Record<string, string | number | boolean | null>)
      : undefined;
  return { id, title, metric, visual, aggregation, bucket, since, sourceId, entityId, entityType, dimensions };
};

const normalizeDashboardSpan = (value: unknown): number | undefined => {
  const span = typeof value === "number" && Number.isInteger(value) ? value : undefined;
  return span ? Math.min(12, Math.max(1, span)) : undefined;
};

const normalizeDashboardDescription = (value: unknown, max = 500): string | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

const normalizeRefreshInterval = (value: unknown): DashboardRefreshInterval | null | undefined => {
  if (value === null) return null;
  return value === 1 || value === 5 || value === 10 || value === 60 ? value : undefined;
};

const normalizeDashboardCondition = (condition: unknown): PulseDashboardCondition | null => {
  if (typeof condition !== "object" || condition === null) return null;
  const value = condition as Record<string, unknown>;
  const level = value.level === "warn" || value.level === "critical" ? value.level : null;
  const operator =
    value.operator === ">" || value.operator === ">=" || value.operator === "<" || value.operator === "<=" || value.operator === "=" || value.operator === "!="
      ? value.operator
      : null;
  if (!level || !operator) return null;
  if (typeof value.value !== "string" && typeof value.value !== "number" && typeof value.value !== "boolean") return null;
  return {
    level,
    operator,
    value: value.value,
    message: typeof value.message === "string" ? value.message.trim().slice(0, 240) : null,
  };
};

const normalizeDashboardConditions = (conditions: unknown): PulseDashboardCondition[] | undefined => {
  if (!Array.isArray(conditions)) return undefined;
  const normalized = conditions.map(normalizeDashboardCondition).filter((item): item is PulseDashboardCondition => item !== null).slice(0, 8);
  return normalized.length ? normalized : undefined;
};

const normalizeDashboardControl = (control: unknown): PulseDashboardControl | null => {
  if (typeof control !== "object" || control === null) return null;
  const value = control as Record<string, unknown>;
  const kind =
    value.kind === "range" ||
    value.kind === "source" ||
    value.kind === "entity" ||
    value.kind === "entity_type" ||
    value.kind === "label" ||
    value.kind === "text"
      ? value.kind
      : null;
  const variable = typeof value.variable === "string" && value.variable.trim() ? value.variable.trim().slice(0, 80) : "";
  const label = typeof value.label === "string" && value.label.trim() ? value.label.trim().slice(0, 160) : variable;
  if (!kind || !variable || !label) return null;
  const options = Array.isArray(value.options)
    ? value.options
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 240))
        .slice(0, 100)
    : undefined;
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 80) : randomUUID(),
    kind,
    variable,
    label,
    defaultValue: typeof value.defaultValue === "string" ? value.defaultValue.trim().slice(0, 240) : "",
    options: options?.length ? options : undefined,
    entityType: typeof value.entityType === "string" && value.entityType.trim() ? value.entityType.trim().slice(0, 80) : null,
  };
};

const normalizeDashboardWidget = (widget: unknown): PulseDashboardWidget | null => {
  if (typeof widget !== "object" || widget === null) return null;
  const value = widget as Record<string, unknown>;
  if (value.kind === "markdown") {
    const markdown = typeof value.markdown === "string" ? value.markdown.trim().slice(0, 8_000) : "";
    if (!markdown) return null;
    const result: PulseDashboardMarkdownWidget = {
      id: typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 80) : randomUUID(),
      kind: "markdown",
      markdown,
      span: normalizeDashboardSpan(value.span),
    };
    const title = normalizeDashboardDescription(value.title, 160);
    const description = normalizeDashboardDescription(value.description);
    if (title !== undefined) result.title = title;
    if (description !== undefined) result.description = description;
    return result;
  }
  if (value.kind === "metric") {
    const base = normalizeDashboardMetricWidgetBase(value);
    if (!base) return null;
    const query = typeof value.query === "object" && value.query !== null ? (value.query as Partial<PulseDashboardMetricQuery>) : null;
    const result: PulseDashboardMetricWidget = {
      ...base,
      kind: "metric",
      span: normalizeDashboardSpan(value.span),
      queryText: typeof value.queryText === "string" ? value.queryText.trim().slice(0, 8_000) : undefined,
      query:
        query?.kind === "metric" && typeof query.metric === "string"
          ? {
              kind: "metric",
              metric: query.metric,
              aggregation: AGGREGATIONS.includes(query.aggregation as Aggregation) ? (query.aggregation as Aggregation) : base.aggregation,
              bucket: typeof query.bucket === "string" && /^\d+[mhd]$/.test(query.bucket) ? query.bucket : base.bucket,
              since: typeof query.since === "string" && /^\d+[mhd]$/.test(query.since) ? query.since : base.since,
              sourceId: typeof query.sourceId === "string" && query.sourceId.trim() ? query.sourceId : null,
              entityId: typeof query.entityId === "string" && query.entityId.trim() ? query.entityId : null,
              entityType: typeof query.entityType === "string" && query.entityType.trim() ? query.entityType : null,
              dimensions:
                typeof query.dimensions === "object" && query.dimensions !== null
                  ? normalizeDimensions(query.dimensions as Record<string, string | number | boolean | null>)
                  : undefined,
            }
          : undefined,
      conditions: normalizeDashboardConditions(value.conditions),
    };
    const description = normalizeDashboardDescription(value.description);
    if (description !== undefined) result.description = description;
    return result;
  }
  if (value.kind === "events" || value.kind === "states") {
    const id = typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 80) : randomUUID();
    const title = typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 160) : value.kind === "events" ? "Events" : "States";
    const queryText = typeof value.queryText === "string" ? value.queryText.trim().slice(0, 8_000) : "";
    const rawQuery = typeof value.query === "object" && value.query !== null ? (value.query as Record<string, unknown>) : null;
    const dimensions =
      typeof rawQuery?.dimensions === "object" && rawQuery.dimensions !== null
        ? normalizeDimensions(rawQuery.dimensions as Record<string, string | number | boolean | null>)
        : undefined;
    const queryBase = {
      sourceId: typeof rawQuery?.sourceId === "string" && rawQuery.sourceId.trim() ? rawQuery.sourceId : null,
      entityId: typeof rawQuery?.entityId === "string" && rawQuery.entityId.trim() ? rawQuery.entityId : null,
      entityType: typeof rawQuery?.entityType === "string" && rawQuery.entityType.trim() ? rawQuery.entityType : null,
      dimensions,
      limit: typeof rawQuery?.limit === "number" && Number.isInteger(rawQuery.limit) ? Math.min(1_000, Math.max(1, rawQuery.limit)) : 500,
    };
    const description = normalizeDashboardDescription(value.description);
    if (value.kind === "events") {
      if (rawQuery?.kind !== "events") return null;
      const result: PulseDashboardEventsWidget = {
        id,
        kind: "events",
        title,
        visual: "table",
        queryText,
        query: {
          kind: "events",
          event: typeof rawQuery.event === "string" && rawQuery.event.trim() ? rawQuery.event : null,
          since: typeof rawQuery.since === "string" && /^\d+[mhd]$/.test(rawQuery.since) ? rawQuery.since : "24h",
          ...queryBase,
        },
        conditions: normalizeDashboardConditions(value.conditions),
        span: normalizeDashboardSpan(value.span),
      };
      if (description !== undefined) result.description = description;
      return result;
    }
    if (rawQuery?.kind !== "states") return null;
    const result: PulseDashboardStatesWidget = {
      id,
      kind: "states",
      title,
      visual: value.visual === "stat" ? "stat" : "table",
      queryText,
      query: {
        kind: "states",
        state: typeof rawQuery.state === "string" && rawQuery.state.trim() ? rawQuery.state : null,
        since: typeof rawQuery.since === "string" && /^\d+[mhd]$/.test(rawQuery.since) ? rawQuery.since : null,
        ...queryBase,
      },
      conditions: normalizeDashboardConditions(value.conditions),
      span: normalizeDashboardSpan(value.span),
    };
    if (description !== undefined) result.description = description;
    return result;
  }
  if (value.kind === "card") {
    const title = typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 160) : "";
    if (!title) return null;
    const rows = Array.isArray(value.rows)
      ? value.rows
          .map(normalizeDashboardRow)
          .filter((row): row is PulseDashboardRow => row !== null)
          .slice(0, 24)
      : [];
    if (rows.length === 0) return null;
    const result: PulseDashboardCardWidget = {
      id: typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 80) : randomUUID(),
      kind: "card",
      title,
      rows,
      span: normalizeDashboardSpan(value.span),
    };
    const description = normalizeDashboardDescription(value.description);
    if (description !== undefined) result.description = description;
    return result;
  }
  return null;
};

const normalizeDashboardRow = (row: unknown): PulseDashboardRow | null => {
  if (typeof row !== "object" || row === null) return null;
  const value = row as Record<string, unknown>;
  if (value.kind !== "row") return null;
  const cells = Array.isArray(value.cells)
    ? value.cells.map(normalizeDashboardWidget).filter((cell): cell is PulseDashboardWidget => cell !== null)
    : [];
  if (cells.length === 0) return null;
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 80) : randomUUID(),
    kind: "row",
    height: value.height === "sm" || value.height === "lg" ? value.height : "md",
    cells: cells.slice(0, 12),
  };
};

const normalizeDashboardSection = (section: unknown, depth = 0): PulseDashboardSection | null => {
  if (depth > 3 || typeof section !== "object" || section === null) return null;
  const value = section as Record<string, unknown>;
  if (value.kind !== "section") return null;
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 160) : "";
  if (!title) return null;
  const rows = Array.isArray(value.rows)
    ? value.rows.map(normalizeDashboardRow).filter((row): row is PulseDashboardRow => row !== null)
    : [];
  const sections = Array.isArray(value.sections)
    ? value.sections
        .map((item) => normalizeDashboardSection(item, depth + 1))
        .filter((item): item is PulseDashboardSection => item !== null)
        .slice(0, 12)
    : [];
  if (rows.length === 0 && sections.length === 0) return null;
  const result: PulseDashboardSection = {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 80) : randomUUID(),
    kind: "section",
    title,
    rows: rows.slice(0, 24),
  };
  const description = normalizeDashboardDescription(value.description);
  if (description !== undefined) result.description = description;
  if (sections.length) result.sections = sections;
  return result;
};

const normalizeDashboardLayout = (layout: unknown): PulseDashboardLayout | null => {
  if (typeof layout !== "object" || layout === null) return null;
  const value = layout as Record<string, unknown>;
  if (value.version !== 1) return null;
  const sections = Array.isArray(value.sections)
    ? value.sections
        .map((section) => normalizeDashboardSection(section))
        .filter((section): section is PulseDashboardSection => section !== null)
    : [];
  if (sections.length === 0) return null;
  const result: PulseDashboardLayout = { version: 1, sections: sections.slice(0, 24) };
  const description = normalizeDashboardDescription(value.description, 1_000);
  if (description !== undefined) result.description = description;
  const controls = Array.isArray(value.controls)
    ? value.controls.map(normalizeDashboardControl).filter((control): control is PulseDashboardControl => control !== null).slice(0, 24)
    : [];
  if (controls.length) result.controls = controls;
  return result;
};

const normalizeDashboardConfig = (config: unknown): PulseDashboardConfig => {
  const parsed = parseJson(config);
  const raw =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { layout?: unknown; dsl?: unknown; refreshIntervalSeconds?: unknown })
      : {};
  const dsl = typeof raw.dsl === "string" && raw.dsl.trim() ? raw.dsl.trim().slice(0, 40_000) : "";
  const result: PulseDashboardConfig = {
    dsl,
    layout: null,
  };
  const refreshIntervalSeconds = normalizeRefreshInterval(raw.refreshIntervalSeconds);
  if (refreshIntervalSeconds !== undefined) result.refreshIntervalSeconds = refreshIntervalSeconds;
  if (dsl) {
    const layout = normalizeDashboardLayout(raw.layout);
    if (layout) result.layout = layout;
  }
  return result;
};

const compileDashboardConfigForSave = (baseId: string, name: string, config: unknown): Result<PulseDashboardConfig> => {
  const normalized = normalizeDashboardConfig(config);
  if (!normalized.dsl) return fail(err.badInput("Dashboard DSL is required"));
  const compiled = compileDashboardDsl(normalized.dsl, (query) => {
    const result = compilePulseQueryText(baseId, query);
    return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.error.message };
  });
  if (!compiled.ok) {
    const first = compiled.diagnostics[0];
    return fail(err.badInput(first ? first.message : "Dashboard DSL is invalid"));
  }
  return ok({
    ...normalizeDashboardConfig(compiled.data),
    refreshIntervalSeconds: normalized.refreshIntervalSeconds,
  });
};

const mapDashboard = (row: DashboardRow): PulseDashboard => ({
  id: row.id,
  baseId: row.base_id,
  name: row.name,
  config: normalizeDashboardConfig(row.config),
  publicEnabled: row.public_enabled,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const mapSavedQuery = (row: SavedQueryRow): PulseSavedQuery => ({
  id: row.id,
  baseId: row.base_id,
  name: row.name,
  description: row.description,
  query: row.query,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const dashboardWidgetDescendants = (widget: PulseDashboardWidget): PulseDashboardWidget[] => {
  if (widget.kind !== "card") return [widget];
  return [widget, ...widget.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants))];
};

const dashboardSectionWidgets = (section: PulseDashboardSection): PulseDashboardWidget[] => [
  ...section.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants)),
  ...(section.sections ?? []).flatMap(dashboardSectionWidgets),
];

const dashboardLayoutWidgets = (config: PulseDashboardConfig): PulseDashboardWidget[] =>
  config.layout?.sections.flatMap(dashboardSectionWidgets) ?? [];

const dashboardMetricWidgets = (config: PulseDashboardConfig): PulseDashboardMetricWidget[] => [
  ...dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardMetricWidget => widget.kind === "metric"),
];

const dashboardEventsWidgets = (config: PulseDashboardConfig): PulseDashboardEventsWidget[] =>
  dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardEventsWidget => widget.kind === "events");

const dashboardStatesWidgets = (config: PulseDashboardConfig): PulseDashboardStatesWidget[] =>
  dashboardLayoutWidgets(config).filter((widget): widget is PulseDashboardStatesWidget => widget.kind === "states");

const dashboardRenderConfig = (dashboard: PulseDashboard): PulseDashboardConfig => {
  if (dashboard.config.layout) return dashboard.config;
  const compiled = compileDashboardConfigForSave(dashboard.baseId, dashboard.name, dashboard.config);
  return compiled.ok ? compiled.data : dashboard.config;
};

const publicMetricWidget = (widget: PulseDashboardMetricWidget): PulsePublicDashboardMetricWidget => ({
  id: widget.id,
  kind: "metric",
  title: widget.title,
  metric: widget.metric,
  visual: widget.visual,
  aggregation: widget.aggregation,
  bucket: widget.bucket,
  since: widget.since,
  description: widget.description,
  conditions: widget.conditions,
  span: widget.span,
});

const publicEventsWidget = (widget: PulseDashboardEventsWidget): PulsePublicDashboardEventsWidget => ({
  id: widget.id,
  kind: "events",
  title: widget.title,
  visual: widget.visual,
  description: widget.description,
  conditions: widget.conditions,
  span: widget.span,
});

const publicStatesWidget = (widget: PulseDashboardStatesWidget): PulsePublicDashboardStatesWidget => ({
  id: widget.id,
  kind: "states",
  title: widget.title,
  visual: widget.visual,
  description: widget.description,
  conditions: widget.conditions,
  span: widget.span,
});

const publicDashboardWidget = (widget: PulseDashboardWidget): PulsePublicDashboardWidget => {
  if (widget.kind === "metric") return publicMetricWidget(widget);
  if (widget.kind === "events") return publicEventsWidget(widget);
  if (widget.kind === "states") return publicStatesWidget(widget);
  if (widget.kind === "markdown") return widget;
  const card: PulsePublicDashboardCardWidget = {
    id: widget.id,
    kind: "card",
    title: widget.title,
    description: widget.description,
    span: widget.span,
    rows: widget.rows.map(publicDashboardRow),
  };
  return card;
};

const publicDashboardRow = (row: PulseDashboardRow): PulsePublicDashboardRow => ({
  id: row.id,
  kind: "row",
  height: row.height,
  cells: row.cells.map(publicDashboardWidget),
});

const publicDashboardSection = (section: PulseDashboardSection): PulsePublicDashboardSection => ({
  id: section.id,
  kind: "section",
  title: section.title,
  description: section.description,
  rows: section.rows.map(publicDashboardRow),
  sections: section.sections?.map(publicDashboardSection),
});

const publicDashboardLayout = (layout: PulseDashboardLayout | null): PulsePublicDashboardLayout | null =>
  layout
    ? {
        version: 1,
        description: layout.description,
        sections: layout.sections.map(publicDashboardSection),
      }
    : null;

const publicRecordedEvent = (event: PulseRecordedEvent): PulsePublicRecordedEvent => ({
  id: event.id,
  kind: event.kind,
  ts: event.ts,
  value: event.value,
  entityId: event.entityId,
  entityType: event.entityType,
});

const publicCurrentState = (state: PulseCurrentState): PulsePublicCurrentState => ({
  key: state.key,
  value: state.value,
  entityId: state.entityId,
  entityType: state.entityType,
  updatedAt: state.updatedAt,
});

const publicRefreshInterval = (value: DashboardRefreshInterval | null | undefined): DashboardRefreshInterval | null | undefined => (value === 1 ? 5 : value);

const parseTime = (value: string | undefined): Date => {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const requireBaseAccess = async (baseId: string, user: UserScope, required: PermissionLevel): Promise<Result<void>> => {
  const groups = toPgUuidArray(user.memberofGroupIds ?? []);
  const [row] = await sql<{ permission: PermissionLevel }[]>`
    SELECT MAX(a.permission)::text AS permission
    FROM pulse.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${baseId}::uuid
      AND (
        a.user_id = ${user.id}::uuid
        OR a.group_id = ANY(${groups}::uuid[])
        OR a.authenticated_only = TRUE
      )
  `;
  const level = row?.permission ?? "none";
  const rank: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2, admin: 3 };
  return rank[level] >= rank[required] ? ok() : fail(err.forbidden("Access denied"));
};

const requireBaseActive = async (baseId: string): Promise<Result<void>> => {
  const [row] = await sql<{
    deletion_started_at: Date | string | null;
    data_clear_started_at: Date | string | null;
    data_clear_completed_at: Date | string | null;
    data_clear_failed_at: Date | string | null;
  }[]>`
    SELECT deletion_started_at, data_clear_started_at, data_clear_completed_at, data_clear_failed_at
    FROM pulse.bases
    WHERE id = ${baseId}::uuid
  `;
  if (!row) return fail(err.notFound("Pulse base"));
  if (row.deletion_started_at) return fail(err.conflict("Pulse base is being deleted"));
  if (row.data_clear_started_at && !row.data_clear_completed_at && !row.data_clear_failed_at) {
    return fail(err.conflict("Pulse base data is being cleared"));
  }
  return ok();
};

type BaseDeletionBatch = {
  phase: string;
  deletedRows: number;
  done: boolean;
};

const recordBaseDeletionProgress = async (params: {
  baseId: string;
  phase: string;
  deletedRows: number;
  status?: "queued" | "deleting" | "failed";
  errorMessage?: string | null;
}): Promise<void> => {
  await sql`
    INSERT INTO pulse.base_deletions (
      base_id,
      status,
      phase,
      deleted_rows,
      last_batch_rows,
      error_message,
      updated_at
    )
    VALUES (
      ${params.baseId}::uuid,
      ${params.status ?? "deleting"},
      ${params.phase},
      ${params.deletedRows},
      ${params.deletedRows},
      ${params.errorMessage ?? null},
      now()
    )
    ON CONFLICT (base_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      phase = EXCLUDED.phase,
      deleted_rows = pulse.base_deletions.deleted_rows + EXCLUDED.deleted_rows,
      last_batch_rows = EXCLUDED.last_batch_rows,
      error_message = EXCLUDED.error_message,
      updated_at = now()
  `;
};

const deleteMetricSamplesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.metric_samples
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_samples item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteMetricRollupsChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.metric_rollups_hourly
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_rollups_hourly item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteStateChangesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.state_changes
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.state_changes item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteEventDimensionsChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.event_dimensions
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.event_dimensions item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteEventsChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.events
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.events item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteCurrentStatesChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT ctid
      FROM pulse.states_current
      WHERE base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.states_current item
    USING victim
    WHERE item.ctid = victim.ctid
  `;
  return result.count ?? 0;
};

const deleteMetricSeriesDimensionsChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT dims.series_id, dims.key
      FROM pulse.metric_series_dimensions dims
      JOIN pulse.metric_series series ON series.id = dims.series_id
      WHERE series.base_id = ${baseId}::uuid
      LIMIT ${BASE_DELETE_BATCH_SIZE}
    )
    DELETE FROM pulse.metric_series_dimensions item
    USING victim
    WHERE item.series_id = victim.series_id
      AND item.key = victim.key
  `;
  return result.count ?? 0;
};

const deleteRowsByBaseChunk = async (
  baseId: string,
  table:
    | "pulse.source_scrapes"
    | "pulse.metric_series"
    | "pulse.metric_defs"
    | "pulse.dimension_metadata"
    | "pulse.saved_queries"
    | "pulse.dashboards"
    | "pulse.sources",
): Promise<number> => {
  switch (table) {
    case "pulse.source_scrapes": {
      const result = await sql`
        WITH victim AS (SELECT ctid FROM pulse.source_scrapes WHERE base_id = ${baseId}::uuid LIMIT ${BASE_DELETE_BATCH_SIZE})
        DELETE FROM pulse.source_scrapes item USING victim WHERE item.ctid = victim.ctid
      `;
      return result.count ?? 0;
    }
    case "pulse.metric_series": {
      const result = await sql`
        WITH victim AS (SELECT ctid FROM pulse.metric_series WHERE base_id = ${baseId}::uuid LIMIT ${BASE_DELETE_BATCH_SIZE})
        DELETE FROM pulse.metric_series item USING victim WHERE item.ctid = victim.ctid
      `;
      return result.count ?? 0;
    }
    case "pulse.metric_defs": {
      const result = await sql`
        WITH victim AS (SELECT ctid FROM pulse.metric_defs WHERE base_id = ${baseId}::uuid LIMIT ${BASE_DELETE_BATCH_SIZE})
        DELETE FROM pulse.metric_defs item USING victim WHERE item.ctid = victim.ctid
      `;
      return result.count ?? 0;
    }
    case "pulse.dimension_metadata": {
      const result = await sql`
        WITH victim AS (SELECT ctid FROM pulse.dimension_metadata WHERE base_id = ${baseId}::uuid LIMIT ${BASE_DELETE_BATCH_SIZE})
        DELETE FROM pulse.dimension_metadata item USING victim WHERE item.ctid = victim.ctid
      `;
      return result.count ?? 0;
    }
    case "pulse.saved_queries": {
      const result = await sql`
        WITH victim AS (SELECT ctid FROM pulse.saved_queries WHERE base_id = ${baseId}::uuid LIMIT ${BASE_DELETE_BATCH_SIZE})
        DELETE FROM pulse.saved_queries item USING victim WHERE item.ctid = victim.ctid
      `;
      return result.count ?? 0;
    }
    case "pulse.dashboards": {
      const result = await sql`
        WITH victim AS (SELECT ctid FROM pulse.dashboards WHERE base_id = ${baseId}::uuid LIMIT ${BASE_DELETE_BATCH_SIZE})
        DELETE FROM pulse.dashboards item USING victim WHERE item.ctid = victim.ctid
      `;
      return result.count ?? 0;
    }
    case "pulse.sources": {
      const result = await sql`
        WITH victim AS (SELECT ctid FROM pulse.sources WHERE base_id = ${baseId}::uuid LIMIT ${BASE_DELETE_BATCH_SIZE})
        DELETE FROM pulse.sources item USING victim WHERE item.ctid = victim.ctid
      `;
      return result.count ?? 0;
    }
  }
};

const deleteBaseAccessChunk = async (baseId: string): Promise<number> => {
  const result = await sql`
    WITH victim AS (
      SELECT access_id
      FROM pulse.base_access
      WHERE base_id = ${baseId}::uuid
      LIMIT 1000
    )
    DELETE FROM auth.access item
    USING victim
    WHERE item.id = victim.access_id
  `;
  return result.count ?? 0;
};

const BASE_DELETE_STEPS: Array<{ phase: string; run: (baseId: string) => Promise<number> }> = [
  { phase: "metric_samples", run: deleteMetricSamplesChunk },
  { phase: "metric_rollups_hourly", run: deleteMetricRollupsChunk },
  { phase: "state_changes", run: deleteStateChangesChunk },
  { phase: "event_dimensions", run: deleteEventDimensionsChunk },
  { phase: "events", run: deleteEventsChunk },
  { phase: "states_current", run: deleteCurrentStatesChunk },
  { phase: "metric_series_dimensions", run: deleteMetricSeriesDimensionsChunk },
  { phase: "source_scrapes", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.source_scrapes") },
  { phase: "metric_series", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.metric_series") },
  { phase: "metric_defs", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.metric_defs") },
  { phase: "dimension_metadata", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.dimension_metadata") },
  { phase: "saved_queries", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.saved_queries") },
  { phase: "dashboards", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.dashboards") },
  { phase: "sources", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.sources") },
  { phase: "access", run: deleteBaseAccessChunk },
];

const BASE_DATA_CLEAR_STEPS: Array<{ phase: string; run: (baseId: string) => Promise<number> }> = [
  { phase: "metric_samples", run: deleteMetricSamplesChunk },
  { phase: "metric_rollups_hourly", run: deleteMetricRollupsChunk },
  { phase: "state_changes", run: deleteStateChangesChunk },
  { phase: "event_dimensions", run: deleteEventDimensionsChunk },
  { phase: "events", run: deleteEventsChunk },
  { phase: "states_current", run: deleteCurrentStatesChunk },
  { phase: "metric_series_dimensions", run: deleteMetricSeriesDimensionsChunk },
  { phase: "source_scrapes", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.source_scrapes") },
  { phase: "metric_series", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.metric_series") },
  { phase: "metric_defs", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.metric_defs") },
  { phase: "dimension_metadata", run: (baseId) => deleteRowsByBaseChunk(baseId, "pulse.dimension_metadata") },
];

const recordBaseDataClearProgress = async (params: {
  baseId: string;
  phase: string;
  deletedRows: number;
  status?: "queued" | "clearing" | "failed" | "completed";
  errorMessage?: string | null;
}): Promise<void> => {
  await sql`
    INSERT INTO pulse.base_data_clears (
      base_id,
      status,
      phase,
      deleted_rows,
      last_batch_rows,
      error_message,
      updated_at
    )
    VALUES (
      ${params.baseId}::uuid,
      ${params.status ?? "clearing"},
      ${params.phase},
      ${params.deletedRows},
      ${params.deletedRows},
      ${params.errorMessage ?? null},
      now()
    )
    ON CONFLICT (base_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      phase = EXCLUDED.phase,
      deleted_rows = pulse.base_data_clears.deleted_rows + EXCLUDED.deleted_rows,
      last_batch_rows = EXCLUDED.last_batch_rows,
      error_message = EXCLUDED.error_message,
      updated_at = now()
  `;
};

const purgeBaseDeletionBatch = async (baseId: string): Promise<BaseDeletionBatch> => {
  await sql`
    UPDATE pulse.base_deletions
    SET status = 'deleting', phase = 'deleting', updated_at = now()
    WHERE base_id = ${baseId}::uuid
  `;

  for (const step of BASE_DELETE_STEPS) {
    const deletedRows = await step.run(baseId);
    if (deletedRows > 0) {
      await recordBaseDeletionProgress({ baseId, phase: step.phase, deletedRows });
      return { phase: step.phase, deletedRows, done: false };
    }
  }

  const finalDelete = await sql`
    DELETE FROM pulse.bases
    WHERE id = ${baseId}::uuid
  `;
  return { phase: "base", deletedRows: finalDelete.count ?? 0, done: true };
};

const purgeBaseDataClearBatch = async (baseId: string): Promise<BaseDeletionBatch> => {
  const [base] = await sql<{ data_clear_completed_at: Date | string | null }[]>`
    SELECT data_clear_completed_at
    FROM pulse.bases
    WHERE id = ${baseId}::uuid
  `;
  if (!base) return { phase: "base", deletedRows: 0, done: true };
  if (base.data_clear_completed_at) return { phase: "completed", deletedRows: 0, done: true };

  await sql`
    UPDATE pulse.base_data_clears
    SET status = 'clearing', phase = 'clearing', updated_at = now()
    WHERE base_id = ${baseId}::uuid
  `;

  for (const step of BASE_DATA_CLEAR_STEPS) {
    const deletedRows = await step.run(baseId);
    if (deletedRows > 0) {
      await recordBaseDataClearProgress({ baseId, phase: step.phase, deletedRows });
      return { phase: step.phase, deletedRows, done: false };
    }
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE pulse.sources
      SET last_seen_at = NULL,
          last_error = NULL,
          last_error_at = NULL,
          updated_at = now()
      WHERE base_id = ${baseId}::uuid
    `;
    await tx`
      UPDATE pulse.bases
      SET data_clear_completed_at = now(),
          data_clear_failed_at = NULL,
          data_clear_error = NULL,
          updated_at = now()
      WHERE id = ${baseId}::uuid
    `;
    await tx`
      UPDATE pulse.base_data_clears
      SET status = 'completed',
          phase = 'completed',
          last_batch_rows = 0,
          error_message = NULL,
          completed_at = now(),
          updated_at = now()
      WHERE base_id = ${baseId}::uuid
    `;
  });

  return { phase: "completed", deletedRows: 0, done: true };
};

const baseDeletionJob = job<{ baseId: string }, BaseDeletionBatch>({
  id: "pulse:base-delete",
  defaults: { leaseMs: 2 * 60_000 },
  process: async ({ ctx }) => purgeBaseDeletionBatch(ctx.input.baseId),
  after: async ({ ctx }) => {
    if (ctx.error) {
      const message = ctx.error instanceof Error ? ctx.error.message : "Pulse base deletion failed";
      const failed = ctx.failureCount >= 10;
      await sql`
        UPDATE pulse.base_deletions
        SET status = ${failed ? "failed" : "deleting"},
            error_message = ${message},
            updated_at = now()
        WHERE base_id = ${ctx.input.baseId}::uuid
      `;
      await sql`
        UPDATE pulse.bases
        SET deletion_failed_at = CASE WHEN ${failed} THEN now() ELSE deletion_failed_at END,
            deletion_error = ${message},
            updated_at = now()
        WHERE id = ${ctx.input.baseId}::uuid
      `;
      if (!failed) ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 5 * 60_000 }) });
      return;
    }
    if (ctx.data && !ctx.data.done) ctx.reschedule({ delayMs: 0 });
  },
});

const baseDataClearJob = job<{ baseId: string }, BaseDeletionBatch>({
  id: "pulse:base-data-clear",
  defaults: { leaseMs: 2 * 60_000 },
  process: async ({ ctx }) => purgeBaseDataClearBatch(ctx.input.baseId),
  after: async ({ ctx }) => {
    if (ctx.error) {
      const message = ctx.error instanceof Error ? ctx.error.message : "Pulse data clear failed";
      const failed = ctx.failureCount >= 10;
      await sql`
        UPDATE pulse.base_data_clears
        SET status = ${failed ? "failed" : "clearing"},
            error_message = ${message},
            updated_at = now()
        WHERE base_id = ${ctx.input.baseId}::uuid
      `;
      await sql`
        UPDATE pulse.bases
        SET data_clear_failed_at = CASE WHEN ${failed} THEN now() ELSE data_clear_failed_at END,
            data_clear_error = ${message},
            updated_at = now()
        WHERE id = ${ctx.input.baseId}::uuid
      `;
      if (!failed) ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 5_000, maxMs: 5 * 60_000 }) });
      return;
    }
    if (ctx.data && !ctx.data.done) ctx.reschedule({ delayMs: 0 });
  },
});

const submitBaseDeletionJob = async (baseId: string): Promise<void> => {
  await baseDeletionJob.submit({
    key: `base:${baseId}`,
    input: { baseId },
  });
};

const submitBaseDataClearJob = async (baseId: string): Promise<void> => {
  await baseDataClearJob.submit({
    key: `base:${baseId}`,
    input: { baseId },
  });
};

export const resumePulseBaseDeletionJobs = async (): Promise<void> => {
  const rows = await sql<{ base_id: string }[]>`
    SELECT base_id
    FROM pulse.base_deletions
    WHERE status IN ('queued', 'deleting')
    ORDER BY updated_at ASC
    LIMIT 100
  `;
  for (const row of rows) await submitBaseDeletionJob(row.base_id);
};

export const resumePulseBaseDataClearJobs = async (): Promise<void> => {
  const rows = await sql<{ base_id: string }[]>`
    SELECT base_id
    FROM pulse.base_data_clears
    WHERE status IN ('queued', 'clearing')
    ORDER BY updated_at ASC
    LIMIT 100
  `;
  for (const row of rows) await submitBaseDataClearJob(row.base_id);
};

export const stopPulseBaseDeletionJob = (): void => baseDeletionJob.stop();
export const stopPulseBaseDataClearJob = (): void => baseDataClearJob.stop();

const upsertDimensionMetadata = async (params: {
  baseId: string;
  sourceId?: string | null;
  scope: "metric" | "event" | "state";
  dimensions: Record<string, string>;
}): Promise<void> => {
  if (!params.sourceId) return;
  for (const key of Object.keys(params.dimensions)) {
    await sql`
      INSERT INTO pulse.dimension_metadata (base_id, source_id, scope, key, observed_cardinality, last_seen_at)
      VALUES (${params.baseId}::uuid, ${params.sourceId ?? null}::uuid, ${params.scope}, ${key}, 1, now())
      ON CONFLICT (base_id, source_id, scope, key)
      DO UPDATE SET last_seen_at = now()
    `;
  }
};

const listBases = async (user: UserScope): Promise<Result<PulseBase[]>> => {
  const groups = toPgUuidArray(user.memberofGroupIds ?? []);
  const rows = await sql<BaseRow[]>`
    SELECT DISTINCT b.*
    FROM pulse.bases b
    JOIN pulse.base_access ba ON ba.base_id = b.id
    JOIN auth.access a ON a.id = ba.access_id
    WHERE b.deletion_started_at IS NULL
      AND (
        a.user_id = ${user.id}::uuid
        OR a.group_id = ANY(${groups}::uuid[])
        OR a.authenticated_only = TRUE
      )
    ORDER BY b.updated_at DESC, b.name ASC
  `;
  return ok(rows.map(mapBase));
};

const createBase = async (params: { name: string; description?: string | null; user: UserScope }): Promise<Result<PulseBase>> => {
  const name = params.name.trim();
  if (!name) return fail(err.badInput("Base name is required"));

  const created = await sql.begin(async (tx): Promise<Result<BaseRow>> => {
    const [base] = await tx<BaseRow[]>`
      INSERT INTO pulse.bases (name, description, created_by)
      VALUES (${name}, ${params.description?.trim() || null}, ${params.user.id}::uuid)
      RETURNING *
    `;
    if (!base) return fail(err.internal("Failed to create Pulse base"));

    const [access] = await tx<{ id: string }[]>`
      INSERT INTO auth.access (user_id, permission)
      VALUES (${params.user.id}::uuid, 'admin'::auth.permission_level)
      RETURNING id
    `;
    if (!access) return fail(err.internal("Failed to create base access"));
    await tx`
      INSERT INTO pulse.base_access (base_id, access_id)
      VALUES (${base.id}::uuid, ${access.id}::uuid)
    `;
    return ok(base);
  });

  if (!created.ok) return created;
  return ok(mapBase(created.data));
};

const listBaseAccess = async (baseId: string, user: UserScope): Promise<Result<AccessEntry[]>> => {
  const access = await requireBaseAccess(baseId, user, "admin");
  if (!access.ok) return fail(access.error);
  const rows = await sql<AccessRow[]>`
    SELECT a.id, a.user_id, a.group_id, a.authenticated_only, a.permission, a.created_at
    FROM pulse.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${baseId}::uuid
    ORDER BY a.created_at
  `;
  return ok(await resolveDisplayNames(rows.map(mapAccessRow)));
};

const grantBaseAccess = async (params: {
  baseId: string;
  user: UserScope;
  principal: Principal;
  permission: Exclude<PermissionLevel, "none">;
}): Promise<Result<AccessEntry>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);

  const created = await sql.begin(async (tx): Promise<Result<AccessRow>> => {
    let userId: string | null = null;
    let groupId: string | null = null;
    let authenticatedOnly = false;

    if (params.principal.type === "user") {
      userId = params.principal.userId;
      const [userRow] = await tx<{ id: string }[]>`SELECT id FROM auth.users WHERE id = ${userId}::uuid`;
      if (!userRow) return fail(err.notFound("User"));
    } else if (params.principal.type === "group") {
      groupId = params.principal.groupId;
      const [groupRow] = await tx<{ id: string }[]>`SELECT id FROM auth.groups WHERE id = ${groupId}::uuid`;
      if (!groupRow) return fail(err.notFound("Group"));
    } else if (params.principal.type === "authenticated") {
      authenticatedOnly = true;
    }

    const [row] = await tx<AccessRow[]>`
      INSERT INTO auth.access (user_id, group_id, authenticated_only, permission)
      VALUES (${userId}::uuid, ${groupId}::uuid, ${authenticatedOnly}, ${params.permission}::auth.permission_level)
      RETURNING id, user_id, group_id, authenticated_only, permission, created_at
    `;
    if (!row) return fail(err.internal("Failed to create access entry"));
    await tx`
      INSERT INTO pulse.base_access (base_id, access_id)
      VALUES (${params.baseId}::uuid, ${row.id}::uuid)
    `;
    return ok(row);
  });

  if (!created.ok) return fail(created.error);
  const [entry] = await resolveDisplayNames([mapAccessRow(created.data)]);
  return entry ? ok(entry) : fail(err.internal("Failed to resolve access entry"));
};

const resolveBaseAccessBinding = async (accessId: string): Promise<string | null> => {
  const [row] = await sql<{ base_id: string }[]>`
    SELECT base_id FROM pulse.base_access WHERE access_id = ${accessId}::uuid
  `;
  return row?.base_id ?? null;
};

const updateBaseAccess = async (params: {
  accessId: string;
  user: UserScope;
  permission: Exclude<PermissionLevel, "none">;
}): Promise<Result<void>> => {
  const baseId = await resolveBaseAccessBinding(params.accessId);
  if (!baseId) return fail(err.notFound("Access entry"));
  const access = await requireBaseAccess(baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);
  const updated = await sql`
    UPDATE auth.access
    SET permission = ${params.permission}::auth.permission_level
    WHERE id = ${params.accessId}::uuid
  `;
  if (updated.count === 0) return fail(err.notFound("Access entry"));
  return ok();
};

const revokeBaseAccess = async (params: { accessId: string; user: UserScope }): Promise<Result<void>> => {
  const baseId = await resolveBaseAccessBinding(params.accessId);
  if (!baseId) return fail(err.notFound("Access entry"));
  const access = await requireBaseAccess(baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);
  const deleted = await sql`DELETE FROM auth.access WHERE id = ${params.accessId}::uuid`;
  if (deleted.count === 0) return fail(err.notFound("Access entry"));
  return ok();
};

const getBase = async (baseId: string, user: UserScope): Promise<Result<PulseBase>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const [row] = await sql<BaseRow[]>`
    SELECT *
    FROM pulse.bases
    WHERE id = ${baseId}::uuid
      AND deletion_started_at IS NULL
  `;
  return row ? ok(mapBase(row)) : fail(err.notFound("Pulse base"));
};

const updateBase = async (params: {
  baseId: string;
  user: UserScope;
  name?: string;
  description?: string | null;
  retentionDays?: number;
}): Promise<Result<PulseBase>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const [existing] = await sql<BaseRow[]>`SELECT * FROM pulse.bases WHERE id = ${params.baseId}::uuid`;
  if (!existing) return fail(err.notFound("Pulse base"));
  if (existing.deletion_started_at) return fail(err.conflict("Pulse base is being deleted"));

  const name = params.name?.trim() || existing.name;
  const description = params.description === undefined ? existing.description : params.description?.trim() || null;
  const retentionDays = params.retentionDays ?? existing.retention_days;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650)
    return fail(err.badInput("Retention must be between 1 and 3650 days"));

  const [row] = await sql<BaseRow[]>`
    UPDATE pulse.bases
    SET name = ${name}, description = ${description}, retention_days = ${retentionDays}, updated_at = now()
    WHERE id = ${params.baseId}::uuid
    RETURNING *
  `;
  if (!row) return fail(err.internal("Failed to update Pulse base"));
  return ok(mapBase(row));
};

const deleteBase = async (params: { baseId: string; user: UserScope }): Promise<Result<void>> => {
  const [existing] = await sql<BaseRow[]>`SELECT * FROM pulse.bases WHERE id = ${params.baseId}::uuid`;
  if (!existing) return fail(err.notFound("Pulse base"));

  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);

  if (existing.deletion_started_at) {
    await submitBaseDeletionJob(params.baseId);
    return ok();
  }

  const queued = await sql.begin(async (tx): Promise<Result<void>> => {
    await tx`
      UPDATE pulse.bases
      SET deletion_started_at = now(),
          deletion_failed_at = NULL,
          deletion_error = NULL,
          updated_at = now()
      WHERE id = ${params.baseId}::uuid
    `;
    await tx`
      UPDATE pulse.sources
      SET enabled = FALSE, updated_at = now()
      WHERE base_id = ${params.baseId}::uuid
    `;
    await tx`
      DELETE FROM auth.service_accounts
      WHERE kind = 'resource_bound'
        AND app_id = ${PULSE_APP_ID}
        AND resource_type = ${PULSE_SOURCE_RESOURCE_TYPE}
        AND resource_id IN (
          SELECT id::text
          FROM pulse.sources
          WHERE base_id = ${params.baseId}::uuid
        )
    `;
    await tx`
      INSERT INTO pulse.base_deletions (base_id, requested_by, status, phase, updated_at)
      VALUES (${params.baseId}::uuid, ${params.user.id}::uuid, 'queued', 'queued', now())
      ON CONFLICT (base_id)
      DO UPDATE SET
        requested_by = EXCLUDED.requested_by,
        status = 'queued',
        phase = 'queued',
        error_message = NULL,
        updated_at = now()
    `;
    return ok();
  });

  if (!queued.ok) return fail(queued.error);
  await submitBaseDeletionJob(params.baseId);
  return ok();
};

const clearBaseData = async (params: { baseId: string; user: UserScope }): Promise<Result<void>> => {
  const [existing] = await sql<BaseRow[]>`SELECT * FROM pulse.bases WHERE id = ${params.baseId}::uuid`;
  if (!existing) return fail(err.notFound("Pulse base"));

  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);

  if (existing.deletion_started_at) return fail(err.conflict("Pulse base is being deleted"));
  if (existing.data_clear_started_at && !existing.data_clear_completed_at && !existing.data_clear_failed_at) {
    await submitBaseDataClearJob(params.baseId);
    return ok();
  }

  const queued = await sql.begin(async (tx): Promise<Result<void>> => {
    await tx`
      UPDATE pulse.bases
      SET data_clear_started_at = now(),
          data_clear_completed_at = NULL,
          data_clear_failed_at = NULL,
          data_clear_error = NULL,
          updated_at = now()
      WHERE id = ${params.baseId}::uuid
    `;
    await tx`
      INSERT INTO pulse.base_data_clears (
        base_id,
        requested_by,
        status,
        phase,
        deleted_rows,
        last_batch_rows,
        error_message,
        completed_at,
        updated_at
      )
      VALUES (
        ${params.baseId}::uuid,
        ${params.user.id}::uuid,
        'queued',
        'queued',
        0,
        0,
        NULL,
        NULL,
        now()
      )
      ON CONFLICT (base_id)
      DO UPDATE SET
        requested_by = EXCLUDED.requested_by,
        status = 'queued',
        phase = 'queued',
        deleted_rows = 0,
        last_batch_rows = 0,
        error_message = NULL,
        completed_at = NULL,
        updated_at = now()
    `;
    return ok();
  });

  if (!queued.ok) return fail(queued.error);
  await submitBaseDataClearJob(params.baseId);
  return ok();
};

const listSources = async (baseId: string, user: UserScope): Promise<Result<PulseSource[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const rows = await sql<SourceRow[]>`
    SELECT *
    FROM pulse.sources
    WHERE base_id = ${baseId}::uuid
    ORDER BY created_at DESC
  `;
  return ok(rows.map(mapSource));
};

const listSourceScrapes = async (params: { baseId: string; sourceId: string; user: UserScope }): Promise<Result<PulseSourceScrape[]>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "read");
  if (!access.ok) return fail(access.error);
  const rows = await sql<SourceScrapeRow[]>`
    SELECT id, source_id, started_at, finished_at, duration_ms, success, metrics_count, events_count, states_count, error_message
    FROM pulse.source_scrapes
    WHERE base_id = ${params.baseId}::uuid
      AND source_id = ${params.sourceId}::uuid
    ORDER BY started_at DESC
    LIMIT 10
  `;
  return ok(rows.map(mapSourceScrape));
};

const listDashboards = async (baseId: string, user: UserScope): Promise<Result<PulseDashboard[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const rows = await sql<DashboardRow[]>`
    SELECT *
    FROM pulse.dashboards
    WHERE base_id = ${baseId}::uuid
    ORDER BY updated_at DESC, name ASC
  `;
  return ok(rows.map(mapDashboard));
};

const createDashboard = async (params: {
  baseId: string;
  user: UserScope;
  name: string;
  config?: PulseDashboardConfig;
}): Promise<Result<PulseDashboard>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);
  const name = params.name.trim();
  if (!name) return fail(err.badInput("Dashboard name is required"));
  const configResult = compileDashboardConfigForSave(params.baseId, name, params.config ?? {});
  if (!configResult.ok) return fail(configResult.error);
  const config = configResult.data;
  const [row] = await sql<DashboardRow[]>`
    INSERT INTO pulse.dashboards (base_id, name, config, created_by)
    VALUES (${params.baseId}::uuid, ${name}, ${JSON.stringify(config)}::jsonb, ${params.user.id}::uuid)
    RETURNING *
  `;
  if (!row) return fail(err.internal("Failed to create Pulse dashboard"));
  return ok(mapDashboard(row));
};

const updateDashboard = async (params: {
  dashboardId: string;
  user: UserScope;
  name?: string;
  config?: PulseDashboardConfig;
}): Promise<Result<PulseDashboard>> => {
  const [existing] = await sql<{ base_id: string; name: string; config: unknown }[]>`
    SELECT base_id, name, config
    FROM pulse.dashboards
    WHERE id = ${params.dashboardId}::uuid
  `;
  if (!existing) return fail(err.notFound("Pulse dashboard"));
  const access = await requireBaseAccess(existing.base_id, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(existing.base_id);
  if (!active.ok) return fail(active.error);
  const name = params.name?.trim() || existing.name;
  const configResult = compileDashboardConfigForSave(existing.base_id, name, params.config ?? existing.config);
  if (!configResult.ok) return fail(configResult.error);
  const config = configResult.data;
  const [row] = await sql<DashboardRow[]>`
    UPDATE pulse.dashboards
    SET name = ${name}, config = ${JSON.stringify(config)}::jsonb, updated_at = now()
    WHERE id = ${params.dashboardId}::uuid
    RETURNING *
  `;
  if (!row) return fail(err.internal("Failed to update Pulse dashboard"));
  return ok(mapDashboard(row));
};

const deleteDashboard = async (params: { dashboardId: string; user: UserScope }): Promise<Result<void>> => {
  const [existing] = await sql<{ base_id: string }[]>`
    SELECT base_id
    FROM pulse.dashboards
    WHERE id = ${params.dashboardId}::uuid
  `;
  if (!existing) return fail(err.notFound("Pulse dashboard"));
  const access = await requireBaseAccess(existing.base_id, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(existing.base_id);
  if (!active.ok) return fail(active.error);
  const deleted = await sql`DELETE FROM pulse.dashboards WHERE id = ${params.dashboardId}::uuid`;
  if ((deleted.count ?? 0) === 0) return fail(err.notFound("Pulse dashboard"));
  return ok();
};

const enablePublicDashboard = async (params: {
  dashboardId: string;
  user: UserScope;
}): Promise<Result<{ dashboard: PulseDashboard; token: string }>> => {
  const [existing] = await sql<{ base_id: string; public_enabled: boolean; public_token: string | null }[]>`
    SELECT base_id, public_enabled, public_token
    FROM pulse.dashboards
    WHERE id = ${params.dashboardId}::uuid
  `;
  if (!existing) return fail(err.notFound("Pulse dashboard"));
  const access = await requireBaseAccess(existing.base_id, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(existing.base_id);
  if (!active.ok) return fail(active.error);

  const token = existing.public_enabled && existing.public_token ? existing.public_token : randomUUID();
  const [row] = await sql<DashboardRow[]>`
    UPDATE pulse.dashboards
    SET public_enabled = TRUE, public_token = ${token}, public_token_hash = ${tokenHash(token)}, updated_at = now()
    WHERE id = ${params.dashboardId}::uuid
    RETURNING *
  `;
  if (!row) return fail(err.internal("Failed to publish Pulse dashboard"));
  return ok({ dashboard: mapDashboard(row), token });
};

const disablePublicDashboard = async (params: { dashboardId: string; user: UserScope }): Promise<Result<PulseDashboard>> => {
  const [existing] = await sql<{ base_id: string }[]>`
    SELECT base_id
    FROM pulse.dashboards
    WHERE id = ${params.dashboardId}::uuid
  `;
  if (!existing) return fail(err.notFound("Pulse dashboard"));
  const access = await requireBaseAccess(existing.base_id, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(existing.base_id);
  if (!active.ok) return fail(active.error);

  const [row] = await sql<DashboardRow[]>`
    UPDATE pulse.dashboards
    SET public_enabled = FALSE, public_token = NULL, public_token_hash = NULL, updated_at = now()
    WHERE id = ${params.dashboardId}::uuid
    RETURNING *
  `;
  if (!row) return fail(err.internal("Failed to unpublish Pulse dashboard"));
  return ok(mapDashboard(row));
};

const listSavedQueries = async (baseId: string, user: UserScope): Promise<Result<PulseSavedQuery[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const rows = await sql<SavedQueryRow[]>`
    SELECT id, base_id, name, description, query, created_at, updated_at
    FROM pulse.saved_queries
    WHERE base_id = ${baseId}::uuid
    ORDER BY updated_at DESC, name ASC
    LIMIT 100
  `;
  return ok(rows.map(mapSavedQuery));
};

const createSavedQuery = async (params: {
  baseId: string;
  user: UserScope;
  name: string;
  description?: string | null;
  query: string;
}): Promise<Result<PulseSavedQuery>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);
  const name = params.name.trim();
  const query = params.query.trim();
  if (!name) return fail(err.badInput("Query name is required"));
  if (!query) return fail(err.badInput("Query is required"));
  const compiled = compilePulseQueryText(params.baseId, query);
  if (!compiled.ok) return fail(compiled.error);
  const [row] = await sql<SavedQueryRow[]>`
    INSERT INTO pulse.saved_queries (base_id, name, description, query, created_by)
    VALUES (${params.baseId}::uuid, ${name}, ${params.description?.trim() || null}, ${query}, ${params.user.id}::uuid)
    RETURNING id, base_id, name, description, query, created_at, updated_at
  `;
  if (!row) return fail(err.internal("Failed to save query"));
  return ok(mapSavedQuery(row));
};

const deleteSavedQuery = async (params: { baseId: string; queryId: string; user: UserScope }): Promise<Result<void>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);
  const deleted = await sql`
    DELETE FROM pulse.saved_queries
    WHERE base_id = ${params.baseId}::uuid
      AND id = ${params.queryId}::uuid
  `;
  if (deleted.count === 0) return fail(err.notFound("Saved query"));
  return ok();
};

const getPublicDashboardByToken = async (token: string): Promise<Result<PulseDashboard>> => {
  const [row] = await sql<DashboardRow[]>`
    SELECT d.*
    FROM pulse.dashboards d
    JOIN pulse.bases b ON b.id = d.base_id
    WHERE d.public_enabled = TRUE
      AND b.deletion_started_at IS NULL
      AND (d.public_token = ${token} OR d.public_token_hash = ${tokenHash(token)})
  `;
  return row ? ok(mapDashboard(row)) : fail(err.notFound("Pulse dashboard"));
};

const createSource = async (params: {
  baseId: string;
  user: UserScope;
  kind: SourceKind;
  name: string;
  endpointUrl?: string | null;
  bearerToken?: string | null;
  scrapeIntervalSeconds?: number | null;
}): Promise<Result<PulseSource>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);

  const encryptedBearer = params.bearerToken?.trim() ? await encryptSecret(params.bearerToken.trim()) : null;
  const endpointUrl = normalizeEndpointUrl(params.endpointUrl);
  if (params.kind === "metrics" && !endpointUrl) return fail(err.badInput("A valid metrics endpoint URL is required"));

  const [row] = await sql<SourceRow[]>`
    INSERT INTO pulse.sources (
      base_id,
      kind,
      name,
      endpoint_url,
      bearer_token_encrypted,
      scrape_interval_seconds
    )
    VALUES (
      ${params.baseId}::uuid,
      ${params.kind}::pulse.source_kind,
      ${params.name.trim()},
      ${endpointUrl},
      ${encryptedBearer},
      ${params.scrapeIntervalSeconds ?? null}
    )
    RETURNING *
  `;
  if (!row) return fail(err.internal("Failed to create Pulse source"));
  return ok(mapSource(row));
};

const removeSource = async (params: { baseId: string; sourceId: string; user: UserScope }): Promise<Result<void>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);
  const result = await sql`
    DELETE FROM pulse.sources
    WHERE id = ${params.sourceId}::uuid
      AND base_id = ${params.baseId}::uuid
  `;
  if ((result.count ?? 0) === 0) return fail(err.notFound("Pulse source"));
  return ok();
};

const updateSource = async (params: {
  baseId: string;
  sourceId: string;
  user: UserScope;
  name?: string;
  enabled?: boolean;
  endpointUrl?: string | null;
  bearerToken?: string | null;
  scrapeIntervalSeconds?: number | null;
}): Promise<Result<PulseSource>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);
  const [existing] = await sql<SourceRow[]>`
    SELECT *
    FROM pulse.sources
    WHERE id = ${params.sourceId}::uuid
      AND base_id = ${params.baseId}::uuid
  `;
  if (!existing) return fail(err.notFound("Pulse source"));

  const name = params.name?.trim() || existing.name;
  const endpointUrl = params.endpointUrl === undefined ? existing.endpoint_url : normalizeEndpointUrl(params.endpointUrl);
  if (existing.kind === "metrics" && !endpointUrl) return fail(err.badInput("A valid metrics endpoint URL is required"));
  const bearerTokenEncrypted =
    params.bearerToken === undefined
      ? existing.bearer_token_encrypted
      : params.bearerToken?.trim()
        ? await encryptSecret(params.bearerToken.trim())
        : null;
  const scrapeIntervalSeconds =
    params.scrapeIntervalSeconds === undefined ? existing.scrape_interval_seconds : params.scrapeIntervalSeconds;

  const [row] = await sql<SourceRow[]>`
    UPDATE pulse.sources
    SET
      name = ${name},
      enabled = ${params.enabled ?? existing.enabled},
      endpoint_url = ${endpointUrl},
      bearer_token_encrypted = ${bearerTokenEncrypted},
      scrape_interval_seconds = ${scrapeIntervalSeconds},
      updated_at = now()
    WHERE id = ${params.sourceId}::uuid
      AND base_id = ${params.baseId}::uuid
    RETURNING *
  `;
  if (!row) return fail(err.internal("Failed to update Pulse source"));
  return ok(mapSource(row));
};

const sourceApiKeyPermission = (scopes: string[]): PermissionLevel => {
  if (scopes.includes("admin")) return "admin";
  if (scopes.includes("write") || scopes.includes(PULSE_INGEST_SCOPE)) return "write";
  if (scopes.includes("read")) return "read";
  return "none";
};

const ensureHttpIngestSource = async (params: { baseId: string; sourceId: string }): Promise<Result<PulseSource>> => {
  const [source] = await sql<SourceRow[]>`
    SELECT *
    FROM pulse.sources
    WHERE id = ${params.sourceId}::uuid
      AND base_id = ${params.baseId}::uuid
      AND kind = 'http_ingest'::pulse.source_kind
  `;
  return source ? ok(mapSource(source)) : fail(err.notFound("Ingest source"));
};

const listSourceApiKeys = async (params: { baseId: string; sourceId: string; user: UserScope }): Promise<Result<PulseSourceApiKey[]>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);
  const source = await ensureHttpIngestSource({ baseId: params.baseId, sourceId: params.sourceId });
  if (!source.ok) return fail(source.error);

  const keys = await serviceAccountCredentials.listOverview({
    pagination: { page: 1, perPage: 500 },
    filter: {
      serviceAccountKind: "resource_bound",
      credentialStatus: "active",
      appId: PULSE_APP_ID,
      resourceType: PULSE_SOURCE_RESOURCE_TYPE,
      resourceId: params.sourceId,
    },
  });

  return ok(
    keys.items.map((item) => {
      const { serviceAccount: _serviceAccount, owner: _owner, ...credential } = item;
      return { ...credential, permission: sourceApiKeyPermission(credential.scopes) };
    }),
  );
};

const createSourceApiKey = async (params: {
  baseId: string;
  sourceId: string;
  user: User;
  name: string;
  expiresAt?: string | null;
  permission: Exclude<PermissionLevel, "none">;
}): Promise<Result<{ credential: PulseSourceApiKey; token: string }>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);
  const source = await ensureHttpIngestSource({ baseId: params.baseId, sourceId: params.sourceId });
  if (!source.ok) return fail(source.error);
  const name = params.name.trim();
  if (!name) return fail(err.badInput("API key name is required"));
  if (params.permission !== "write") return fail(err.badInput("Source API keys can only use ingest permission"));

  const serviceAccount = await serviceAccounts.getOrCreateResourceBound({
    name: `${source.data.name} ingest API keys`,
    appId: PULSE_APP_ID,
    resourceType: PULSE_SOURCE_RESOURCE_TYPE,
    resourceId: params.sourceId,
    createdBy: params.user.id,
  });
  if (!serviceAccount.ok) return fail(serviceAccount.error);

  const created = await serviceAccountCredentials.createResourceApiToken({
    serviceAccountId: serviceAccount.data.id,
    actor: params.user,
    name,
    expiresAt: params.expiresAt ?? null,
    scopes: [PULSE_INGEST_SCOPE, "write"],
  });
  if (!created.ok) return fail(created.error);

  return ok({
    credential: {
      ...created.data.credential,
      permission: sourceApiKeyPermission(created.data.credential.scopes),
    },
    token: created.data.token,
  });
};

const removeSourceApiKey = async (params: {
  baseId: string;
  sourceId: string;
  credentialId: string;
  user: User;
}): Promise<Result<void>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "admin");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);
  const keys = await listSourceApiKeys(params);
  if (!keys.ok) return fail(keys.error);
  if (!keys.data.some((key) => key.id === params.credentialId)) return fail(err.notFound("API key"));
  return serviceAccountCredentials.revoke({ credentialId: params.credentialId, actor: params.user });
};

const resolveIngestSourceForServiceAccount = async (serviceAccount: ServiceAccount): Promise<Result<{ id: string; baseId: string }>> => {
  if (
    serviceAccount.kind !== "resource_bound" ||
    serviceAccount.appId !== PULSE_APP_ID ||
    serviceAccount.resourceType !== PULSE_SOURCE_RESOURCE_TYPE ||
    !serviceAccount.resourceId
  ) {
    return fail(err.forbidden("API key is not bound to a Pulse ingest source"));
  }
  const [source] = await sql<{ id: string; base_id: string }[]>`
    SELECT s.id, s.base_id
    FROM pulse.sources s
    JOIN pulse.bases b ON b.id = s.base_id
    WHERE s.id = ${serviceAccount.resourceId}::uuid
      AND s.kind = 'http_ingest'::pulse.source_kind
      AND s.enabled = TRUE
      AND b.deletion_started_at IS NULL
      AND (
        b.data_clear_started_at IS NULL
        OR b.data_clear_completed_at IS NOT NULL
        OR b.data_clear_failed_at IS NOT NULL
      )
  `;
  return source ? ok({ id: source.id, baseId: source.base_id }) : fail(err.notFound("Ingest source"));
};

const resolveMetricSeries = async (params: {
  baseId: string;
  sourceId?: string | null;
  metric: PulseMetric;
  dimensions: Record<string, string>;
}): Promise<{ metricId: string; seriesId: string }> => {
  const [metricDef] = await sql<{ id: string }[]>`
    INSERT INTO pulse.metric_defs (base_id, name, unit, type)
    VALUES (${params.baseId}::uuid, ${params.metric.name}, ${params.metric.unit ?? null}, ${params.metric.type ?? "gauge"}::pulse.metric_type)
    ON CONFLICT (base_id, name)
    DO UPDATE SET unit = COALESCE(EXCLUDED.unit, pulse.metric_defs.unit)
    RETURNING id
  `;
  if (!metricDef) throw new Error("Failed to resolve metric definition");

  const hash = dimensionsHash(params.dimensions);
  const seriesKey = metricSeriesKey({ sourceId: params.sourceId, entityId: params.metric.entityId, dimensionsHash: hash });
  const [series] = await sql<{ id: string }[]>`
    INSERT INTO pulse.metric_series (base_id, metric_id, source_id, entity_id, entity_type, series_key, dimensions_hash, dimensions, last_seen_at)
    VALUES (
      ${params.baseId}::uuid,
      ${metricDef.id}::uuid,
      ${params.sourceId ?? null}::uuid,
      ${params.metric.entityId ?? null},
      ${params.metric.entityType ?? null},
      ${seriesKey},
      ${hash},
      (${jsonbObject(params.dimensions)}::jsonb #>> '{}')::jsonb,
      now()
    )
    ON CONFLICT (base_id, metric_id, series_key)
    DO UPDATE SET
      source_id = EXCLUDED.source_id,
      entity_id = EXCLUDED.entity_id,
      entity_type = EXCLUDED.entity_type,
      dimensions = EXCLUDED.dimensions,
      last_seen_at = now()
    RETURNING id
  `;
  if (!series) throw new Error("Failed to resolve metric series");

  for (const [key, value] of Object.entries(params.dimensions)) {
    await sql`
      INSERT INTO pulse.metric_series_dimensions (series_id, key, value)
      VALUES (${series.id}::uuid, ${key}, ${value})
      ON CONFLICT (series_id, key) DO UPDATE SET value = EXCLUDED.value
    `;
  }

  return { metricId: metricDef.id, seriesId: series.id };
};

const recordMetric = async (params: { baseId: string; sourceId?: string | null; metric: PulseMetric }): Promise<Result<void>> => {
  if (!params.metric.name.trim()) return fail(err.badInput("Metric name is required"));
  if (!Number.isFinite(params.metric.value)) return fail(err.badInput("Metric value must be finite"));

  const dimensions = normalizeDimensions(params.metric.dimensions);
  const series = await resolveMetricSeries({ baseId: params.baseId, sourceId: params.sourceId, metric: params.metric, dimensions });
  await sql`
    INSERT INTO pulse.metric_samples (base_id, series_id, ts, value)
    VALUES (${params.baseId}::uuid, ${series.seriesId}::uuid, ${parseTime(params.metric.ts)}, ${params.metric.value})
    ON CONFLICT (series_id, ts) DO UPDATE SET value = EXCLUDED.value, recorded_at = now()
  `;
  await upsertDimensionMetadata({ baseId: params.baseId, sourceId: params.sourceId, scope: "metric", dimensions });
  return ok();
};

const recordEvent = async (params: { baseId: string; sourceId?: string | null; event: PulseEvent }): Promise<Result<void>> => {
  if (!params.event.kind.trim()) return fail(err.badInput("Event kind is required"));
  const dimensions = normalizeDimensions(params.event.dimensions);
  const hash = dimensionsHash(dimensions);
  const [eventRow] = await sql<{ id: string }[]>`
    INSERT INTO pulse.events (
      base_id, source_id, ts, kind, value, entity_id, entity_type, actor_id, session_id, correlation_id, dimensions_hash, dimensions, payload
    )
    VALUES (
      ${params.baseId}::uuid,
      ${params.sourceId ?? null}::uuid,
      ${parseTime(params.event.ts)},
      ${params.event.kind},
      ${params.event.value ?? null},
      ${params.event.entityId ?? null},
      ${params.event.entityType ?? null},
      ${params.event.actorId ?? null},
      ${params.event.sessionId ?? null},
      ${params.event.correlationId ?? null},
      ${hash},
      (${jsonbObject(dimensions)}::jsonb #>> '{}')::jsonb,
      (${jsonbObject(params.event.payload ?? {})}::jsonb #>> '{}')::jsonb
    )
    RETURNING id
  `;
  if (!eventRow) return fail(err.internal("Failed to record event"));
  for (const [key, value] of Object.entries(dimensions)) {
    await sql`
      INSERT INTO pulse.event_dimensions (event_id, base_id, key, value)
      VALUES (${eventRow.id}::uuid, ${params.baseId}::uuid, ${key}, ${value})
    `;
  }
  await upsertDimensionMetadata({ baseId: params.baseId, sourceId: params.sourceId, scope: "event", dimensions });
  return ok();
};

const setState = async (params: { baseId: string; sourceId?: string | null; state: PulseState }): Promise<Result<void>> => {
  if (!params.state.key.trim()) return fail(err.badInput("State key is required"));
  const dimensions = normalizeDimensions(params.state.dimensions);
  const hash = dimensionsHash(dimensions);
  const changedAt = parseTime(params.state.ts);
  const encodedValue = JSON.stringify(params.state.value);

  await sql`
    INSERT INTO pulse.states_current (
      base_id, state_key, source_id, entity_id, entity_type, value, dimensions_hash, dimensions, updated_at
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
      ${changedAt}
    )
    ON CONFLICT (base_id, state_key, entity_id, dimensions_hash)
    DO UPDATE SET value = EXCLUDED.value, source_id = EXCLUDED.source_id, entity_type = EXCLUDED.entity_type, dimensions = EXCLUDED.dimensions, updated_at = EXCLUDED.updated_at
  `;
  await sql`
    INSERT INTO pulse.state_changes (
      base_id, state_key, source_id, entity_id, entity_type, value, dimensions_hash, dimensions, changed_at
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
      ${changedAt}
    )
  `;
  await upsertDimensionMetadata({ baseId: params.baseId, sourceId: params.sourceId, scope: "state", dimensions });
  return ok();
};

const ingestBatch = async (params: {
  baseId: string;
  sourceId?: string | null;
  batch: PulseIngestBatch;
}): Promise<Result<{ metrics: number; events: number; states: number }>> => {
  const requestedCount = (params.batch.metrics?.length ?? 0) + (params.batch.events?.length ?? 0) + (params.batch.states?.length ?? 0);
  if (requestedCount === 0) return fail(err.badInput("Ingest batch is empty"));
  if (requestedCount > MAX_INGEST_BATCH_ITEMS) return fail(err.badInput(`Ingest batch exceeds ${MAX_INGEST_BATCH_ITEMS} items`));
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);

  let metrics = 0;
  let events = 0;
  let states = 0;

  for (const metric of params.batch.metrics ?? []) {
    const result = await recordMetric({ baseId: params.baseId, sourceId: params.sourceId, metric });
    if (!result.ok) return fail(result.error);
    metrics += 1;
  }
  for (const event of params.batch.events ?? []) {
    const result = await recordEvent({ baseId: params.baseId, sourceId: params.sourceId, event });
    if (!result.ok) return fail(result.error);
    events += 1;
  }
  for (const state of params.batch.states ?? []) {
    const result = await setState({ baseId: params.baseId, sourceId: params.sourceId, state });
    if (!result.ok) return fail(result.error);
    states += 1;
  }
  if (params.sourceId) {
    await sql`UPDATE pulse.sources SET last_seen_at = now(), updated_at = now() WHERE id = ${params.sourceId}::uuid`;
  }
  return ok({ metrics, events, states });
};

const ingestByApiKey = async (params: {
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

const markSourceError = async (params: { baseId: string; sourceId: string; message: string | null }): Promise<void> => {
  await sql`
    UPDATE pulse.sources
    SET last_error = ${params.message}, last_error_at = CASE WHEN ${params.message}::text IS NULL THEN NULL ELSE now() END, updated_at = now()
    WHERE id = ${params.sourceId}::uuid
  `;
};

const recordSourceScrape = async (params: {
  baseId: string;
  sourceId: string;
  startedAt: Date;
  success: boolean;
  counts?: { metrics: number; events: number; states: number };
  errorMessage?: string | null;
}): Promise<void> => {
  const finishedAt = new Date();
  const durationMs = Math.max(0, finishedAt.getTime() - params.startedAt.getTime());
  try {
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
        states_count,
        error_message
      )
      VALUES (
        ${params.baseId}::uuid,
        ${params.sourceId}::uuid,
        ${params.startedAt},
        ${finishedAt},
        ${durationMs},
        ${params.success},
        ${params.counts?.metrics ?? 0},
        ${params.counts?.events ?? 0},
        ${params.counts?.states ?? 0},
        ${params.errorMessage ?? null}
      )
    `;
  } catch {
    // Scrape history is diagnostic; never make the scrape itself fail because
    // the audit row could not be persisted.
  }
};

const readScrapeResponseText = async (response: Response): Promise<Result<string>> => {
  if (!response.body) return ok(await response.text());
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_SCRAPE_RESPONSE_BYTES) {
      await reader.cancel();
      return fail(err.badInput(`Metrics endpoint response exceeds ${Math.round(MAX_SCRAPE_RESPONSE_BYTES / 1024 / 1024)} MB`));
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return ok(text);
};

const programmaticPulse = {
  recordMetric: (params: { baseId: string; sourceId?: string | null; metric: PulseMetric }) => recordMetric(params),
  emitEvent: (params: { baseId: string; sourceId?: string | null; event: PulseEvent }) => recordEvent(params),
  setState: (params: { baseId: string; sourceId?: string | null; state: PulseState }) => setState(params),
  batch: (params: { baseId: string; sourceId?: string | null; batch: PulseIngestBatch }) => ingestBatch(params),
};

const listMetrics = async (
  baseId: string,
  user: UserScope,
  params: { q?: string | null; type?: MetricType | null } = {},
): Promise<Result<PulseMetricSummary[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const pattern = searchPattern(params.q);
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
    LEFT JOIN pulse.metric_series ms ON ms.metric_id = md.id
    WHERE md.base_id = ${baseId}::uuid
      AND (${pattern}::text IS NULL OR md.name ILIKE ${pattern} ESCAPE '\\')
      AND (${params.type ?? null}::pulse.metric_type IS NULL OR md.type = ${params.type ?? null}::pulse.metric_type)
    GROUP BY md.id, md.name, md.unit, md.type
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

const listMetricSeries = async (
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

const listRecentEvents = async (
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

const listCurrentStates = async (
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

const listInventory = async (baseId: string, user: UserScope): Promise<Result<PulseInventory>> => {
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

const unescapePrometheusLabelValue = (value: string): string =>
  value
    .replace(/\\\\/g, "\u0000")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\u0000/g, "\\");

const parsePrometheusLabels = (labelText: string): Record<string, string> => {
  const labels: Record<string, string> = {};
  let index = 0;
  while (index < labelText.length) {
    while (/\s|,/.test(labelText[index] ?? "")) index += 1;
    const keyMatch = labelText.slice(index).match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"/);
    if (!keyMatch?.[1]) break;
    const key = keyMatch[1];
    index += keyMatch[0].length;
    let value = "";
    while (index < labelText.length) {
      const char = labelText[index]!;
      if (char === "\\") {
        if (index + 1 < labelText.length) {
          value += char + labelText[index + 1]!;
          index += 2;
          continue;
        }
        value += char;
        index += 1;
        continue;
      }
      if (char === '"') {
        index += 1;
        break;
      }
      value += char;
      index += 1;
    }
    labels[key] = unescapePrometheusLabelValue(value);
    while (/\s/.test(labelText[index] ?? "")) index += 1;
    if (labelText[index] === ",") index += 1;
  }
  return labels;
};

const inferPrometheusMetricType = (name: string, explicit?: MetricType): MetricType => {
  if (explicit) return explicit;
  if (name.endsWith("_bucket")) return "histogram";
  if (name.endsWith("_sum") || name.endsWith("_count") || name.endsWith("_total")) return "counter";
  return "gauge";
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const parsePrometheusMetrics = (text: string): PulseMetric[] => {
  const metrics: PulseMetric[] = [];
  const typeByName = new Map<string, MetricType>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("# TYPE ")) {
      const [, name, type] = line.match(/^# TYPE\s+(\S+)\s+(\S+)/) ?? [];
      if (name && (type === "gauge" || type === "counter" || type === "histogram" || type === "summary")) {
        typeByName.set(name, type);
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    const match = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|NaN|Inf|\+Inf|-Inf)(?:\s+\d+)?$/i,
    );
    if (!match) continue;
    const [, name, labelText, rawValue] = match;
    if (!name || !rawValue) continue;
    const value = Number(rawValue.replace("+Inf", "Infinity").replace("Inf", "Infinity"));
    if (!Number.isFinite(value)) continue;
    const dimensions = labelText ? parsePrometheusLabels(labelText) : {};
    const entityId = dimensions.instance ?? dimensions.host ?? dimensions.node ?? null;
    metrics.push({
      name,
      value,
      type: inferPrometheusMetricType(name, typeByName.get(name)),
      entityId,
      entityType: entityId ? "target" : null,
      dimensions,
    });
  }
  return metrics;
};

export const scrapeMetricsSource = async (params: {
  baseId: string;
  sourceId: string;
}): Promise<Result<{ metrics: number; events: number; states: number }>> => {
  const startedAt = new Date();
  const [source] = await sql<{ endpoint_url: string | null; bearer_token_encrypted: string | null }[]>`
    SELECT s.endpoint_url, s.bearer_token_encrypted
    FROM pulse.sources s
    JOIN pulse.bases b ON b.id = s.base_id
    WHERE s.id = ${params.sourceId}::uuid
      AND s.base_id = ${params.baseId}::uuid
      AND s.kind = 'metrics'::pulse.source_kind
      AND s.enabled = TRUE
      AND b.deletion_started_at IS NULL
      AND (
        b.data_clear_started_at IS NULL
        OR b.data_clear_completed_at IS NOT NULL
        OR b.data_clear_failed_at IS NOT NULL
      )
  `;
  if (!source?.endpoint_url) {
    const message = "Metrics source is missing or disabled";
    await recordSourceScrape({ baseId: params.baseId, sourceId: params.sourceId, startedAt, success: false, errorMessage: message });
    await markSourceError({ baseId: params.baseId, sourceId: params.sourceId, message });
    return fail(err.notFound("Metrics source"));
  }

  const headers: Record<string, string> = {};
  if (source.bearer_token_encrypted) {
    const token = await decryptSecret<string>(source.bearer_token_encrypted);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  headers["User-Agent"] = "Pulse/1.0 metrics scraper";

  try {
    const response = await fetchWithTimeout(source.endpoint_url, { headers }, 15_000);
    if (!response.ok) {
      const message = `Metrics endpoint returned HTTP ${response.status}`;
      await recordSourceScrape({ baseId: params.baseId, sourceId: params.sourceId, startedAt, success: false, errorMessage: message });
      await markSourceError({ baseId: params.baseId, sourceId: params.sourceId, message });
      return fail(err.internal(message));
    }
    const textResult = await readScrapeResponseText(response);
    if (!textResult.ok) {
      const message = textResult.error.message;
      await recordSourceScrape({ baseId: params.baseId, sourceId: params.sourceId, startedAt, success: false, errorMessage: message });
      await markSourceError({ baseId: params.baseId, sourceId: params.sourceId, message });
      return fail(textResult.error);
    }
    const text = textResult.data;
    const metrics = parsePrometheusMetrics(text).map((metric) => ({ ...metric, sourceId: params.sourceId }));
    if (metrics.length === 0) {
      const message = "Metrics endpoint returned no parseable samples";
      await recordSourceScrape({ baseId: params.baseId, sourceId: params.sourceId, startedAt, success: false, errorMessage: message });
      await markSourceError({ baseId: params.baseId, sourceId: params.sourceId, message });
      return fail(err.badInput(message));
    }
    if (metrics.length > MAX_SCRAPE_SAMPLES) {
      const message = `Metrics endpoint returned ${metrics.length} samples, above the ${MAX_SCRAPE_SAMPLES} sample limit`;
      await recordSourceScrape({ baseId: params.baseId, sourceId: params.sourceId, startedAt, success: false, errorMessage: message });
      await markSourceError({ baseId: params.baseId, sourceId: params.sourceId, message });
      return fail(err.badInput(message));
    }
    const result = await ingestBatch({ baseId: params.baseId, sourceId: params.sourceId, batch: { metrics } });
    if (result.ok) {
      await recordSourceScrape({ baseId: params.baseId, sourceId: params.sourceId, startedAt, success: true, counts: result.data });
      await markSourceError({ baseId: params.baseId, sourceId: params.sourceId, message: null });
    } else {
      await recordSourceScrape({
        baseId: params.baseId,
        sourceId: params.sourceId,
        startedAt,
        success: false,
        errorMessage: result.error.message,
      });
      await markSourceError({ baseId: params.baseId, sourceId: params.sourceId, message: result.error.message });
    }
    return result;
  } catch (scrapeError) {
    const message =
      scrapeError instanceof DOMException && scrapeError.name === "AbortError"
        ? "Metrics scrape timed out after 15 seconds"
        : scrapeError instanceof Error
          ? scrapeError.message
          : "Metrics scrape failed";
    await recordSourceScrape({ baseId: params.baseId, sourceId: params.sourceId, startedAt, success: false, errorMessage: message });
    await markSourceError({ baseId: params.baseId, sourceId: params.sourceId, message });
    return fail(err.internal(message));
  }
};

const scrapeSource = async (params: {
  baseId: string;
  sourceId: string;
  user: UserScope;
}): Promise<Result<{ metrics: number; events: number; states: number }>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  return scrapeMetricsSource({ baseId: params.baseId, sourceId: params.sourceId });
};

const compileDashboardDslText = async (params: {
  baseId: string;
  text: string;
  user: UserScope;
}): Promise<Result<PulseDashboardDslCompileResult>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "read");
  if (!access.ok) return fail(access.error);
  const compiled = compileDashboardDsl(params.text, (query) => {
    const result = compilePulseQueryText(params.baseId, query);
    return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.error.message };
  });
  if (!compiled.ok) {
    return ok({ ok: false, diagnostics: compiled.diagnostics, config: null });
  }
  return ok({ ok: true, diagnostics: compiled.diagnostics, config: normalizeDashboardConfig(compiled.data) });
};

const queryMetricData = async (query: MetricQuery): Promise<Result<MetricQueryPoint[]>> => {
  const bucketInterval = durationToInterval(query.bucket);
  const sinceMs = intervalToMs(query.since);
  if (!bucketInterval || !sinceMs) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  const bucketMs = intervalToMs(query.bucket) ?? 0;
  if (!bucketMs || Math.ceil(sinceMs / bucketMs) > MAX_METRIC_BUCKETS) {
    return fail(err.badInput(`This query creates too many buckets. Use a larger bucket or a shorter range.`));
  }

  const since = new Date(Date.now() - sinceMs);
  const dimensions = normalizeDimensions(query.dimensions);
  let seriesIds = (
    await sql<{ id: string }[]>`
      SELECT ms.id
      FROM pulse.metric_series ms
      JOIN pulse.metric_defs md ON md.id = ms.metric_id
      WHERE ms.base_id = ${query.baseId}::uuid
        AND md.name = ${query.metric}
        AND ms.source_id IS NOT DISTINCT FROM COALESCE(${query.sourceId ?? null}::uuid, ms.source_id)
        AND (${query.entityId ?? null}::text IS NULL OR ms.entity_id = ${query.entityId ?? null})
        AND (${query.entityType ?? null}::text IS NULL OR ms.entity_type = ${query.entityType ?? null})
    `
  ).map((row) => row.id);

  for (const [key, value] of Object.entries(dimensions)) {
    if (seriesIds.length === 0) break;
    const rows = await sql<{ series_id: string }[]>`
      SELECT series_id
      FROM pulse.metric_series_dimensions
      WHERE series_id = ANY(${toPgUuidArray(seriesIds)}::uuid[])
        AND key = ${key}
        AND value = ${value}
    `;
    const allowed = new Set(rows.map((row) => row.series_id));
    seriesIds = seriesIds.filter((id) => allowed.has(id));
  }

  if (seriesIds.length === 0) return ok([]);
  if (seriesIds.length > 250) {
    return fail(err.badInput("This query matches too many series. Add a source or dimension filter."));
  }

  const aggregation = query.aggregation;
  const canUseHourlyRollup =
    sinceMs >= 7 * 24 * 60 * 60_000 &&
    bucketMs >= 60 * 60_000 &&
    (aggregation === "avg" ||
      aggregation === "sum" ||
      aggregation === "min" ||
      aggregation === "max" ||
      aggregation === "count" ||
      aggregation === "latest");
  if (canUseHourlyRollup) {
    const rollupAggregateSql =
      aggregation === "sum"
        ? sql`SUM(value_sum)`
        : aggregation === "min"
          ? sql`MIN(value_min)`
          : aggregation === "max"
            ? sql`MAX(value_max)`
            : aggregation === "count"
              ? sql`SUM(sample_count)::double precision`
              : aggregation === "latest"
                ? sql`AVG(last_value)`
                : sql`SUM(value_sum) / NULLIF(SUM(sample_count), 0)`;
    const rows = await sql<{ bucket: Date | string; value: number | null }[]>`
      SELECT date_bin(${bucketInterval}::interval, bucket, '1970-01-01'::timestamptz) AS bucket, ${rollupAggregateSql} AS value
      FROM pulse.metric_rollups_hourly
      WHERE base_id = ${query.baseId}::uuid
        AND series_id = ANY(${toPgUuidArray(seriesIds)}::uuid[])
        AND bucket >= ${since}
      GROUP BY 1
      ORDER BY bucket ASC
      LIMIT 2000
    `;
    if (rows.length > 0) {
      const firstRollup = rows[0];
      if (!firstRollup) return ok([]);
      const firstBucketMs = new Date(firstRollup.bucket).getTime();
      if (Number.isFinite(firstBucketMs) && firstBucketMs <= since.getTime() + bucketMs) {
        return ok(rows.map((row) => ({ bucket: iso(row.bucket), value: row.value })));
      }
    }
  }

  if (aggregation === "latest") {
    const rows = await sql<{ bucket: Date | string; value: number | null }[]>`
      WITH bucketed AS (
        SELECT
          date_bin(${bucketInterval}::interval, ts, '1970-01-01'::timestamptz) AS bucket,
          series_id,
          ts,
          value
        FROM pulse.metric_samples
        WHERE base_id = ${query.baseId}::uuid
          AND series_id = ANY(${toPgUuidArray(seriesIds)}::uuid[])
          AND ts >= ${since}
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
    return ok(rows.map((row) => ({ bucket: iso(row.bucket), value: row.value })));
  }

  if (aggregation === "rate" || aggregation === "increase") {
    const valueSql =
      aggregation === "rate"
        ? sql`AVG(GREATEST(last_value - first_value, 0) / NULLIF(seconds, 0))`
        : sql`AVG(GREATEST(last_value - first_value, 0))`;
    const rows = await sql<{ bucket: Date | string; value: number | null }[]>`
      WITH bucketed AS (
        SELECT
          date_bin(${bucketInterval}::interval, ts, '1970-01-01'::timestamptz) AS bucket,
          series_id,
          ts,
          value
        FROM pulse.metric_samples
        WHERE base_id = ${query.baseId}::uuid
          AND series_id = ANY(${toPgUuidArray(seriesIds)}::uuid[])
          AND ts >= ${since}
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
    return ok(rows.map((row) => ({ bucket: iso(row.bucket), value: row.value })));
  }

  const aggregateSql =
    aggregation === "sum"
      ? sql`SUM(value)`
      : aggregation === "min"
        ? sql`MIN(value)`
        : aggregation === "max"
          ? sql`MAX(value)`
          : aggregation === "count"
            ? sql`COUNT(*)::double precision`
            : aggregation === "p50"
              ? sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY value)`
              : aggregation === "p90"
                ? sql`percentile_cont(0.9) WITHIN GROUP (ORDER BY value)`
                : aggregation === "p95"
                  ? sql`percentile_cont(0.95) WITHIN GROUP (ORDER BY value)`
                  : aggregation === "p99"
                    ? sql`percentile_cont(0.99) WITHIN GROUP (ORDER BY value)`
                    : sql`AVG(value)`;

  const rows = await sql<{ bucket: Date | string; value: number | null }[]>`
    SELECT date_bin(${bucketInterval}::interval, ts, '1970-01-01'::timestamptz) AS bucket, ${aggregateSql} AS value
    FROM pulse.metric_samples
    WHERE base_id = ${query.baseId}::uuid
      AND series_id = ANY(${toPgUuidArray(seriesIds)}::uuid[])
      AND ts >= ${since}
    GROUP BY bucket
    ORDER BY bucket ASC
    LIMIT 2000
  `;

  return ok(rows.map((row) => ({ bucket: iso(row.bucket), value: row.value })));
};

const queryMetric = async (query: MetricQuery, user: UserScope): Promise<Result<MetricQueryPoint[]>> => {
  const access = await requireBaseAccess(query.baseId, user, "read");
  if (!access.ok) return fail(access.error);
  return queryMetricData(query);
};

const queryEventsData = async (query: EventQuery): Promise<Result<PulseRecordedEvent[]>> => {
  const sinceMs = intervalToMs(query.since);
  if (!sinceMs) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  const since = new Date(Date.now() - sinceMs);
  const dimensions = normalizeDimensions(query.dimensions);
  const rows = await sql<RecordedEventRow[]>`
    SELECT id, kind, ts, value, source_id, entity_id, entity_type, dimensions, payload, recorded_at
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

const queryEvents = async (query: EventQuery, user: UserScope): Promise<Result<PulseRecordedEvent[]>> => {
  const access = await requireBaseAccess(query.baseId, user, "read");
  if (!access.ok) return fail(access.error);
  return queryEventsData(query);
};

const queryStatesData = async (query: StateQuery): Promise<Result<PulseCurrentState[]>> => {
  const dimensions = normalizeDimensions(query.dimensions);
  const sinceMs = query.since ? intervalToMs(query.since) : null;
  if (query.since && !sinceMs) return fail(err.badInput("Use compact durations like 5m, 1h, or 7d"));
  const since = sinceMs ? new Date(Date.now() - sinceMs) : null;
  const rows = await sql<CurrentStateRow[]>`
    SELECT state_key, value, source_id, entity_id, entity_type, dimensions, updated_at
    FROM pulse.states_current
    WHERE base_id = ${query.baseId}::uuid
      AND (${query.state ?? null}::text IS NULL OR state_key = ${query.state ?? null})
      AND (${query.sourceId ?? null}::uuid IS NULL OR source_id = ${query.sourceId ?? null}::uuid)
      AND (${query.entityId ?? null}::text IS NULL OR entity_id = ${query.entityId ?? null})
      AND (${query.entityType ?? null}::text IS NULL OR entity_type = ${query.entityType ?? null})
      AND dimensions @> (${jsonbObject(dimensions)}::jsonb #>> '{}')::jsonb
      AND (${since}::timestamptz IS NULL OR updated_at >= ${since}::timestamptz)
    ORDER BY updated_at DESC, state_key ASC
    LIMIT ${query.limit}
  `;
  return ok(rows.map(mapCurrentState));
};

const queryStates = async (query: StateQuery, user: UserScope): Promise<Result<PulseCurrentState[]>> => {
  const access = await requireBaseAccess(query.baseId, user, "read");
  if (!access.ok) return fail(access.error);
  return queryStatesData(query);
};

const queryMetricText = async (params: {
  baseId: string;
  query: string;
  user: UserScope;
}): Promise<
  Result<{ compiled: PulseExplorerQuery; points: MetricQueryPoint[]; events: PulseRecordedEvent[]; states: PulseCurrentState[] }>
> => {
  const compiled = compilePulseQueryText(params.baseId, params.query);
  if (!compiled.ok) return fail(compiled.error);
  if (compiled.data.kind === "metric") {
    const points = await queryMetric(compiled.data, params.user);
    if (!points.ok) return fail(points.error);
    return ok({ compiled: compiled.data, points: points.data, events: [], states: [] });
  }
  if (compiled.data.kind === "events") {
    const events = await queryEvents(compiled.data, params.user);
    if (!events.ok) return fail(events.error);
    return ok({ compiled: compiled.data, points: [], events: events.data, states: [] });
  }
  const states = await queryStates(compiled.data, params.user);
  if (!states.ok) return fail(states.error);
  return ok({ compiled: compiled.data, points: [], events: [], states: states.data });
};

const compileQueryText = async (params: { baseId: string; query: string; user: UserScope }): Promise<Result<PulseQueryCompileResult>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "read");
  if (!access.ok) return fail(access.error);
  const compiled = compilePulseQueryText(params.baseId, params.query);
  if (!compiled.ok) {
    return ok({
      ok: false,
      diagnostics: [{ severity: "error", message: compiled.error.message }],
      compiled: null,
    });
  }
  return ok({
    ok: true,
    diagnostics: [{ severity: "info", message: "Query is valid." }],
    compiled: compiled.data,
  });
};

const getPublicDashboardSnapshot = async (token: string): Promise<Result<PulseDashboardSnapshot>> => {
  const dashboardResult = await getPublicDashboardByToken(token);
  if (!dashboardResult.ok) return fail(dashboardResult.error);
  const dashboard = dashboardResult.data;
  const config = dashboardRenderConfig(dashboard);
  const points: Record<string, MetricQueryPoint[]> = {};
  const events: Record<string, PulsePublicRecordedEvent[]> = {};
  const states: Record<string, PulsePublicCurrentState[]> = {};
  let remainingWidgets = MAX_PUBLIC_EXECUTED_WIDGETS;

  for (const widget of dashboardMetricWidgets(config)) {
    if (remainingWidgets-- <= 0) break;
    const result = await queryMetricData({
      kind: "metric",
      baseId: dashboard.baseId,
      metric: widget.query?.metric ?? widget.metric,
      aggregation: widget.query?.aggregation ?? widget.aggregation,
      bucket: widget.query?.bucket ?? widget.bucket,
      since: widget.query?.since ?? widget.since,
      sourceId: widget.query?.sourceId ?? widget.sourceId ?? null,
      entityId: widget.query?.entityId ?? widget.entityId ?? null,
      entityType: widget.query?.entityType ?? widget.entityType ?? null,
      dimensions: widget.query?.dimensions ?? widget.dimensions,
    });
    points[widget.id] = result.ok ? result.data : [];
  }

  for (const widget of dashboardEventsWidgets(config)) {
    if (remainingWidgets-- <= 0) break;
    const result = await queryEventsData({ baseId: dashboard.baseId, ...widget.query });
    events[widget.id] = result.ok ? result.data.map(publicRecordedEvent) : [];
  }

  for (const widget of dashboardStatesWidgets(config)) {
    if (remainingWidgets-- <= 0) break;
    const result = await queryStatesData({ baseId: dashboard.baseId, ...widget.query });
    states[widget.id] = result.ok ? result.data.map(publicCurrentState) : [];
  }

  const publicDashboard: PulsePublicDashboard = {
    id: dashboard.id,
    name: dashboard.name,
    config: {
      refreshIntervalSeconds: publicRefreshInterval(config.refreshIntervalSeconds),
      layout: publicDashboardLayout(config.layout),
    },
  };

  return ok({ dashboard: publicDashboard, points, events, states });
};

const capabilities = async (): Promise<Result<PulseCapabilitySnapshot>> => {
  const [extension] = await sql<{ installed: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
    ) AS installed
  `;
  const enabled = extension?.installed === true;
  return ok({
    timescaleEnabled: enabled,
    timeBucketAvailable: enabled,
    continuousAggregatesAvailable: enabled,
  });
};

export const pulseService = {
  base: {
    list: listBases,
    create: createBase,
    get: getBase,
    update: updateBase,
    remove: deleteBase,
    clearData: clearBaseData,
    access: {
      require: requireBaseAccess,
      list: listBaseAccess,
      grant: grantBaseAccess,
      update: updateBaseAccess,
      revoke: revokeBaseAccess,
    },
  },
  source: {
    list: listSources,
    scrapes: listSourceScrapes,
    apiKeys: {
      list: listSourceApiKeys,
      create: createSourceApiKey,
      remove: removeSourceApiKey,
    },
    create: createSource,
    update: updateSource,
    remove: removeSource,
    scrape: scrapeSource,
  },
  dashboard: {
    list: listDashboards,
    create: createDashboard,
    update: updateDashboard,
    remove: deleteDashboard,
    compileDsl: compileDashboardDslText,
    enablePublic: enablePublicDashboard,
    disablePublic: disablePublicDashboard,
    publicSnapshot: getPublicDashboardSnapshot,
  },
  savedQuery: {
    list: listSavedQueries,
    create: createSavedQuery,
    remove: deleteSavedQuery,
  },
  ingest: {
    batch: ingestBatch,
    byApiKey: ingestByApiKey,
    metric: recordMetric,
    event: recordEvent,
    state: setState,
  },
  programmatic: programmaticPulse,
  query: {
    metric: queryMetric,
    metricText: queryMetricText,
    compileText: compileQueryText,
    metrics: listMetrics,
    series: listMetricSeries,
    recentEvents: listRecentEvents,
    currentStates: listCurrentStates,
    inventory: listInventory,
  },
  capabilities,
};

export type PulseService = typeof pulseService;
