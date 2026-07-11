import { randomUUID } from "node:crypto";
import { err, fail, ok, type Result } from "@valentinkolb/cloud/server";
import { compileDashboardDsl } from "../dashboard-dsl";
import { compilePulseQueryText } from "../query-dsl";
import type {
  Aggregation,
  PulseDashboard,
  PulseDashboardCardWidget,
  PulseDashboardConfig,
  PulseDashboardControl,
  PulseDashboardEventsWidget,
  PulseDashboardLayout,
  PulseDashboardMarkdownWidget,
  PulseDashboardMetricQuery,
  PulseDashboardMetricWidget,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardStateQuery,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
} from "../contracts";
import {
  isRecord,
  normalizeAggregation,
  normalizeConditions,
  normalizeDescription,
  normalizeDurationToken,
  normalizeRefreshInterval,
  normalizeSpan,
  normalizeTrimmedString,
  normalizeVisual,
  parseDashboardJson,
} from "./dashboard-config-primitives";
export { dashboardEventsWidgets, dashboardMetricWidgets, dashboardStatesWidgets } from "./dashboard-widget-selectors";

const normalizeDashboardDimensions = (dimensions: Record<string, unknown> | undefined): Record<string, string> => {
  const entries = Object.entries(dimensions ?? {})
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key, value]) => key.length > 0 && value !== null && value !== undefined)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
};

const normalizeMetricWidgetBase = (value: Record<string, unknown>) => {
  const metric = normalizeTrimmedString(value.metric, 240) ?? "";
  if (!metric) return null;
  const id = normalizeId(value.id);
  const title = normalizeTitle(value.title, metric);
  const visual = normalizeVisual(value.visual);
  const aggregation = normalizeAggregation(value.aggregation, "avg");
  const bucket = normalizeDurationToken(value.bucket, "5m");
  const since = normalizeDurationToken(value.since, "24h");
  const sourceId = normalizeTrimmedString(value.sourceId, 80);
  const entityId = normalizeTrimmedString(value.entityId, 240);
  const entityType = normalizeTrimmedString(value.entityType, 80);
  const dimensions = normalizeQueryDimensions(value.dimensions);
  return { id, title, metric, visual, aggregation, bucket, since, sourceId, entityId, entityType, dimensions };
};

const normalizeId = (value: unknown): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : randomUUID();

const normalizeTitle = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : fallback;

const normalizeQueryDimensions = (value: unknown): Record<string, string> | undefined =>
  isRecord(value) ? normalizeDashboardDimensions(value as Record<string, string | number | boolean | null>) : undefined;

const normalizeControlKind = (value: unknown): PulseDashboardControl["kind"] | null =>
  value === "range" || value === "source" || value === "entity" || value === "entity_type" || value === "label" || value === "text"
    ? value
    : null;

const normalizeControlOptions = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const options = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 240))
    .slice(0, 100);
  return options.length ? options : undefined;
};

const normalizeControl = (control: unknown): PulseDashboardControl | null => {
  if (typeof control !== "object" || control === null) return null;
  const value = control as Record<string, unknown>;
  const kind = normalizeControlKind(value.kind);
  const variable = normalizeTrimmedString(value.variable, 80) ?? "";
  const label = normalizeTrimmedString(value.label, 160) ?? variable;
  if (!kind || !variable || !label) return null;
  const options = normalizeControlOptions(value.options);
  return {
    id: normalizeId(value.id),
    kind,
    variable,
    label,
    defaultValue: typeof value.defaultValue === "string" ? value.defaultValue.trim().slice(0, 240) : "",
    options,
    entityType: normalizeTrimmedString(value.entityType, 80),
  };
};

const normalizeMarkdownWidget = (value: Record<string, unknown>): PulseDashboardMarkdownWidget | null => {
  const markdown = typeof value.markdown === "string" ? value.markdown.trim().slice(0, 8_000) : "";
  if (!markdown) return null;
  const result: PulseDashboardMarkdownWidget = {
    id: normalizeId(value.id),
    kind: "markdown",
    markdown,
    span: normalizeSpan(value.span),
  };
  const title = normalizeDescription(value.title, 160);
  const description = normalizeDescription(value.description);
  if (title !== undefined) result.title = title;
  if (description !== undefined) result.description = description;
  return result;
};

const normalizeQueryStringOrNull = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

const normalizeMetricQuery = (
  query: unknown,
  base: NonNullable<ReturnType<typeof normalizeMetricWidgetBase>>,
): PulseDashboardMetricQuery | undefined => {
  if (!isRecord(query) || query.kind !== "metric" || typeof query.metric !== "string") return undefined;
  return {
    kind: "metric",
    metric: query.metric,
    aggregation: normalizeAggregation(query.aggregation, base.aggregation),
    bucket: normalizeDurationToken(query.bucket, base.bucket),
    since: normalizeDurationToken(query.since, base.since),
    sourceId: normalizeQueryStringOrNull(query.sourceId, 80),
    entityId: normalizeQueryStringOrNull(query.entityId, 240),
    entityType: normalizeQueryStringOrNull(query.entityType, 80),
    dimensions: normalizeQueryDimensions(query.dimensions),
  };
};

const normalizeMetricWidget = (value: Record<string, unknown>): PulseDashboardMetricWidget | null => {
  const base = normalizeMetricWidgetBase(value);
  if (!base) return null;
  const result: PulseDashboardMetricWidget = {
    ...base,
    kind: "metric",
    span: normalizeSpan(value.span),
    queryText: typeof value.queryText === "string" ? value.queryText.trim().slice(0, 8_000) : undefined,
    query: normalizeMetricQuery(value.query, base),
    conditions: normalizeConditions(value.conditions),
  };
  const description = normalizeDescription(value.description);
  if (description !== undefined) result.description = description;
  return result;
};

const normalizeWidgetQueryText = (value: Record<string, unknown>): string =>
  typeof value.queryText === "string" ? value.queryText.trim().slice(0, 8_000) : "";

const applyDescription = <T extends { description?: string | null }>(result: T, value: Record<string, unknown>): T => {
  const description = normalizeDescription(value.description);
  if (description !== undefined) result.description = description;
  return result;
};

const normalizeTableQueryBase = (rawQuery: Record<string, unknown>) => ({
  sourceId: typeof rawQuery.sourceId === "string" && rawQuery.sourceId.trim() ? rawQuery.sourceId : null,
  entityId: typeof rawQuery.entityId === "string" && rawQuery.entityId.trim() ? rawQuery.entityId : null,
  entityType: typeof rawQuery.entityType === "string" && rawQuery.entityType.trim() ? rawQuery.entityType : null,
  dimensions: normalizeQueryDimensions(rawQuery.dimensions),
  limit: typeof rawQuery.limit === "number" && Number.isInteger(rawQuery.limit) ? Math.min(1_000, Math.max(1, rawQuery.limit)) : 500,
});

const normalizeTableQueryName = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const normalizeEventsWidget = (value: Record<string, unknown>): PulseDashboardEventsWidget | null => {
  const rawQuery = isRecord(value.query) ? value.query : null;
  if (rawQuery?.kind !== "events") return null;
  return applyDescription<PulseDashboardEventsWidget>({
    id: normalizeId(value.id),
    kind: "events",
    title: normalizeTitle(value.title, "Events"),
    visual: "table",
    queryText: normalizeWidgetQueryText(value),
    query: {
      kind: "events",
      event: normalizeTableQueryName(rawQuery.event),
      since: normalizeDurationToken(rawQuery.since, "24h"),
      ...normalizeTableQueryBase(rawQuery),
    },
    conditions: normalizeConditions(value.conditions),
    span: normalizeSpan(value.span),
  }, value);
};

const normalizeStatesWidget = (value: Record<string, unknown>): PulseDashboardStatesWidget | null => {
  const rawQuery = isRecord(value.query) ? value.query : null;
  if (rawQuery?.kind !== "states") return null;
  return applyDescription<PulseDashboardStatesWidget>({
    id: normalizeId(value.id),
    kind: "states",
    title: normalizeTitle(value.title, "States"),
    visual: value.visual === "stat" ? "stat" : "table",
    queryText: normalizeWidgetQueryText(value),
    query: {
      kind: "states",
      state: normalizeTableQueryName(rawQuery.state),
      since: normalizeDurationToken(rawQuery.since, "") || null,
      ...normalizeTableQueryBase(rawQuery),
    },
    conditions: normalizeConditions(value.conditions),
    span: normalizeSpan(value.span),
  }, value);
};

const normalizeCardWidget = (value: Record<string, unknown>): PulseDashboardCardWidget | null => {
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim().slice(0, 160) : "";
  if (!title) return null;
  const rows = Array.isArray(value.rows)
    ? value.rows
        .map(normalizeRow)
        .filter((row): row is PulseDashboardRow => row !== null)
        .slice(0, 24)
    : [];
  if (rows.length === 0) return null;
  const result: PulseDashboardCardWidget = {
    id: normalizeId(value.id),
    kind: "card",
    title,
    rows,
    span: normalizeSpan(value.span),
  };
  const description = normalizeDescription(value.description);
  if (description !== undefined) result.description = description;
  return result;
};

const normalizeWidget = (widget: unknown): PulseDashboardWidget | null => {
  if (!isRecord(widget)) return null;
  if (widget.kind === "markdown") return normalizeMarkdownWidget(widget);
  if (widget.kind === "metric") return normalizeMetricWidget(widget);
  if (widget.kind === "events") return normalizeEventsWidget(widget);
  if (widget.kind === "states") return normalizeStatesWidget(widget);
  if (widget.kind === "card") return normalizeCardWidget(widget);
  return null;
};

const normalizeRowCells = (cells: unknown): PulseDashboardWidget[] =>
  Array.isArray(cells) ? cells.map(normalizeWidget).filter((cell): cell is PulseDashboardWidget => cell !== null).slice(0, 12) : [];

const normalizeRow = (row: unknown): PulseDashboardRow | null => {
  if (!isRecord(row)) return null;
  const value = row;
  if (value.kind !== "row") return null;
  const cells = normalizeRowCells(value.cells);
  if (cells.length === 0) return null;
  return {
    id: normalizeId(value.id),
    kind: "row",
    height: value.height === "sm" || value.height === "lg" ? value.height : "md",
    cells,
  };
};

const normalizeRows = (rows: unknown): PulseDashboardRow[] =>
  Array.isArray(rows) ? rows.map(normalizeRow).filter((row): row is PulseDashboardRow => row !== null).slice(0, 24) : [];

const normalizeChildSections = (sections: unknown, depth: number): PulseDashboardSection[] =>
  Array.isArray(sections)
    ? sections
        .map((item) => normalizeSection(item, depth + 1))
        .filter((item): item is PulseDashboardSection => item !== null)
        .slice(0, 12)
    : [];

const normalizeSection = (section: unknown, depth = 0): PulseDashboardSection | null => {
  if (depth > 3 || !isRecord(section)) return null;
  const value = section;
  if (value.kind !== "section") return null;
  const title = normalizeTitle(value.title, "");
  if (!title) return null;
  const rows = normalizeRows(value.rows);
  const sections = normalizeChildSections(value.sections, depth);
  if (rows.length === 0 && sections.length === 0) return null;
  const result = applyDescription<PulseDashboardSection>({
    id: normalizeId(value.id),
    kind: "section",
    title,
    rows,
  }, value);
  if (sections.length) result.sections = sections;
  return result;
};

const normalizeLayout = (layout: unknown): PulseDashboardLayout | null => {
  if (typeof layout !== "object" || layout === null) return null;
  const value = layout as Record<string, unknown>;
  if (value.version !== 1) return null;
  const sections = Array.isArray(value.sections)
    ? value.sections.map((section) => normalizeSection(section)).filter((section): section is PulseDashboardSection => section !== null)
    : [];
  if (sections.length === 0) return null;
  const result: PulseDashboardLayout = { version: 1, sections: sections.slice(0, 24) };
  const description = normalizeDescription(value.description, 1_000);
  if (description !== undefined) result.description = description;
  const controls = Array.isArray(value.controls) ? value.controls.map(normalizeControl).filter((control): control is PulseDashboardControl => control !== null).slice(0, 24) : [];
  if (controls.length) result.controls = controls;
  return result;
};

export const normalizeDashboardConfig = (config: unknown): PulseDashboardConfig => {
  const parsed = parseDashboardJson(config);
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
    const layout = normalizeLayout(raw.layout);
    if (layout) result.layout = layout;
  }
  return result;
};

export const compileDashboardConfigForSave = (baseId: string, config: unknown): Result<PulseDashboardConfig> => {
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

export const dashboardRenderConfig = (dashboard: PulseDashboard): PulseDashboardConfig => {
  if (dashboard.config.layout) return dashboard.config;
  const compiled = compileDashboardConfigForSave(dashboard.baseId, dashboard.config);
  return compiled.ok ? compiled.data : dashboard.config;
};
