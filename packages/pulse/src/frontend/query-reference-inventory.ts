import { fuzzy } from "@valentinkolb/stdlib";
import type {
  Aggregation,
  MetricType,
  PulseCurrentState,
  PulseMetricSeries,
  PulseMetricSummary,
  PulseRecordedEvent,
  PulseSource,
} from "../contracts";
import { buildPulseQuery } from "./query-authoring";

export type ReferenceMetricRow = PulseMetricSummary & {
  search: string;
  visibleSeriesCount: number;
  sampleSeries: PulseMetricSeries | null;
};

export type ReferenceEventRow = { kind: string; count: number; lastSeenAt: string; search: string };
export type ReferenceStateRow = { key: string; count: number; lastSeenAt: string; search: string };
export type ReferenceScopeChip = { id: string; label: string; hint: string; count: number; icon: string };

type ScopeFilters = {
  sourceId: string;
  entityId: string;
};

export const quotePulseQueryValue = (value: string): string =>
  /[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;

const referenceSourceName = (sources: Map<string, PulseSource>, sourceId: string | null): string =>
  sourceId ? (sources.get(sourceId)?.name ?? sourceId.slice(0, 8)) : "No source";

const matchesScope = (value: { sourceId: string | null; entityId: string | null }, filters: ScopeFilters): boolean =>
  (!filters.sourceId || value.sourceId === filters.sourceId) && (!filters.entityId || value.entityId === filters.entityId);

const dimensionSearchText = (dimensions: Record<string, string>): string =>
  `${Object.keys(dimensions).join(" ")} ${Object.values(dimensions).join(" ")}`;

const referenceMetricAggregations: Record<MetricType, Aggregation> = {
  gauge: "avg",
  counter: "rate",
  histogram: "p95",
  summary: "p95",
};

type ReferenceAggregateRow = { id: string; count: number; lastSeenAt: string; search: string };

const isAfter = (left: string, right: string): boolean => new Date(left).getTime() > new Date(right).getTime();

const addSourceCount = (counts: Map<string, number>, sourceId: string | null): void => {
  if (sourceId) counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
};

const addAggregateRow = (rows: Map<string, ReferenceAggregateRow>, id: string, lastSeenAt: string, search: string): void => {
  const current = rows.get(id);
  if (!current) {
    rows.set(id, { id, count: 1, lastSeenAt, search });
    return;
  }

  current.count += 1;
  if (isAfter(lastSeenAt, current.lastSeenAt)) current.lastSeenAt = lastSeenAt;
  current.search += ` ${search}`;
};

const filterAggregateRows = (query: string, rows: ReferenceAggregateRow[]): ReferenceAggregateRow[] => {
  const q = query.trim();
  return q ? fuzzy.filter(q, rows, { key: (row) => row.search, limit: 120 }).map((hit) => hit.item) : rows;
};

export const buildReferenceSourceChips = (params: {
  sources: PulseSource[];
  series: PulseMetricSeries[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
}): ReferenceScopeChip[] => {
  const counts = new Map<string, number>();
  for (const item of params.series) addSourceCount(counts, item.sourceId);
  for (const item of params.events) addSourceCount(counts, item.sourceId);
  for (const item of params.states) addSourceCount(counts, item.sourceId);

  return params.sources
    .map((source) => ({
      id: source.id,
      label: source.name,
      hint: source.kind,
      count: counts.get(source.id) ?? 0,
      icon: "ti ti-database-share",
    }))
    .filter((chip) => chip.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
};

export const buildReferenceEntityChips = (params: {
  series: PulseMetricSeries[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
}): ReferenceScopeChip[] => {
  const entities = new Map<string, { type: string | null; count: number }>();
  const add = (entityId: string | null, entityType: string | null) => {
    if (!entityId) return;
    const current = entities.get(entityId);
    entities.set(entityId, { type: current?.type ?? entityType, count: (current?.count ?? 0) + 1 });
  };

  for (const item of params.series) add(item.entityId, item.entityType);
  for (const item of params.events) add(item.entityId, item.entityType);
  for (const item of params.states) add(item.entityId, item.entityType);

  return [...entities.entries()]
    .map(([id, value]) => ({
      id,
      label: id,
      hint: value.type ?? "entity",
      count: value.count,
      icon: "ti ti-cube",
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 40);
};

export const buildReferenceMetricRows = (params: {
  metrics: PulseMetricSummary[];
  series: PulseMetricSeries[];
  sourcesById: Map<string, PulseSource>;
  filters: ScopeFilters;
  query: string;
}): ReferenceMetricRow[] => {
  const seriesByMetric = new Map<string, PulseMetricSeries[]>();
  for (const item of params.series.filter((series) => matchesScope(series, params.filters))) {
    if (!seriesByMetric.has(item.metric)) seriesByMetric.set(item.metric, []);
    seriesByMetric.get(item.metric)!.push(item);
  }

  const scoped = params.filters.sourceId || params.filters.entityId;
  const rows = params.metrics
    .map((metric) => {
      const matchingSeries = seriesByMetric.get(metric.name) ?? [];
      const seriesText = matchingSeries.flatMap((item) => [
        referenceSourceName(params.sourcesById, item.sourceId),
        item.entityId ?? "",
        item.entityType ?? "",
        ...Object.keys(item.dimensions),
        ...Object.values(item.dimensions),
      ]);

      return {
        ...metric,
        visibleSeriesCount: matchingSeries.length,
        sampleSeries: matchingSeries[0] ?? null,
        search: [metric.name, metric.type, metric.unit ?? "", ...seriesText].join(" "),
      };
    })
    .filter((metric) => !scoped || metric.visibleSeriesCount > 0);

  const q = params.query.trim();
  return q ? fuzzy.filter(q, rows, { key: (row) => row.search, limit: 120 }).map((hit) => hit.item) : rows;
};

export const buildReferenceEventRows = (params: {
  events: PulseRecordedEvent[];
  sourcesById: Map<string, PulseSource>;
  filters: ScopeFilters;
  query: string;
}): ReferenceEventRow[] => {
  const byKind = new Map<string, ReferenceAggregateRow>();
  for (const event of params.events.filter((item) => matchesScope(item, params.filters))) {
    const search = `${event.kind} ${referenceSourceName(params.sourcesById, event.sourceId)} ${event.entityId ?? ""} ${
      event.entityType ?? ""
    } ${dimensionSearchText(event.dimensions)}`;
    addAggregateRow(byKind, event.kind, event.ts, search);
  }

  const rows = [...byKind.values()].sort((left, right) => left.id.localeCompare(right.id));
  return filterAggregateRows(params.query, rows).map((row) => ({
    kind: row.id,
    count: row.count,
    lastSeenAt: row.lastSeenAt,
    search: row.search,
  }));
};

export const buildReferenceStateRows = (params: {
  states: PulseCurrentState[];
  sourcesById: Map<string, PulseSource>;
  filters: ScopeFilters;
  query: string;
}): ReferenceStateRow[] => {
  const byKey = new Map<string, ReferenceAggregateRow>();
  for (const state of params.states.filter((item) => matchesScope(item, params.filters))) {
    const search = `${state.key} ${referenceSourceName(params.sourcesById, state.sourceId)} ${state.entityId ?? ""} ${
      state.entityType ?? ""
    } ${dimensionSearchText(state.dimensions)}`;
    addAggregateRow(byKey, state.key, state.updatedAt, search);
  }

  const rows = [...byKey.values()].sort((left, right) => left.id.localeCompare(right.id));
  return filterAggregateRows(params.query, rows).map((row) => ({
    key: row.id,
    count: row.count,
    lastSeenAt: row.lastSeenAt,
    search: row.search,
  }));
};

export const buildReferenceMetricQuery = (row: ReferenceMetricRow, filters: ScopeFilters): string => {
  const aggregation = referenceMetricAggregations[row.type];
  const dimensions = filters.entityId && row.sampleSeries ? row.sampleSeries.dimensions : {};
  return buildPulseQuery({
    metric: row.name,
    aggregation,
    bucket: "5m",
    since: "24h",
    sourceId: filters.sourceId || null,
    dimensions,
  });
};

export const buildReferenceEventQuery = (row: ReferenceEventRow, filters: ScopeFilters, entityType: string | null): string =>
  `events ${quotePulseQueryValue(row.kind)} since 7d${filters.sourceId ? ` source ${filters.sourceId}` : ""}${
    filters.entityId ? ` entity ${quotePulseQueryValue(filters.entityId)}` : ""
  }${entityType ? ` entity_type ${quotePulseQueryValue(entityType)}` : ""} limit 100`;

export const buildReferenceStateQuery = (row: ReferenceStateRow, filters: ScopeFilters, entityType: string | null): string =>
  `states ${quotePulseQueryValue(row.key)}${filters.sourceId ? ` source ${filters.sourceId}` : ""}${
    filters.entityId ? ` entity ${quotePulseQueryValue(filters.entityId)}` : ""
  }${entityType ? ` entity_type ${quotePulseQueryValue(entityType)}` : ""} limit 100`;
