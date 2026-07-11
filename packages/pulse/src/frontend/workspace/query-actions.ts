import type {
  Aggregation,
  MetricType,
  PulseCurrentState,
  PulseMetricSummary,
  PulseRecordedEvent,
  PulseResourceMetric,
} from "../../contracts";
import { buildPulseQuery } from "../query-authoring";
import { quoteQueryPart } from "./dashboard-query-text";

export const defaultMetricAggregation = (type: MetricType): Aggregation => {
  if (type === "counter") return "rate";
  if (type === "histogram" || type === "summary") return "p95";
  return "latest";
};

export const queryWithDimensionFilter = (query: string, key: string, value: string): string => {
  const filter = `${key}=${quoteQueryPart(value)}`;
  return /\bwhere\b/i.test(query) ? `${query}, ${filter}` : `${query} where ${filter}`;
};

export const queryWithSourceFilter = (query: string, sourceId: string): string => {
  if (!query || /\bsource\b/i.test(query)) return query;
  return `${query} source ${sourceId}`;
};

const sourceClause = (sourceId: string | null | undefined) => (sourceId ? ` source ${sourceId}` : "");
const entityClause = (entityId: string | null | undefined) => (entityId ? ` entity ${quoteQueryPart(entityId)}` : "");

const whereClause = (dimensions: Record<string, string>) => {
  const entries = Object.entries(dimensions).slice(0, 8);
  return entries.length ? ` where ${entries.map(([key, value]) => `${key}=${quoteQueryPart(value)}`).join(", ")}` : "";
};

export const metricSummaryQueryText = (
  metric: PulseMetricSummary,
  options: {
    dimensions?: Record<string, string>;
    sourceId?: string | null;
  } = {},
): string =>
  buildPulseQuery({
    metric: metric.name,
    aggregation: defaultMetricAggregation(metric.type),
    bucket: metric.type === "gauge" ? "1m" : "5m",
    since: "24h",
    sourceId: options.sourceId,
    dimensions: options.dimensions,
  });

export const resourceMetricQueryText = (metric: PulseResourceMetric): string =>
  buildPulseQuery({
    metric: metric.metric,
    aggregation: defaultMetricAggregation(metric.type),
    bucket: metric.type === "gauge" ? "1m" : "5m",
    since: "24h",
    sourceId: metric.sourceId,
    dimensions: metric.dimensions,
  });

export const eventKindQueryText = (
  kind: string,
  options: {
    entityId?: string | null;
    sourceId?: string | null;
  } = {},
): string => `events ${quoteQueryPart(kind)} since 24h${sourceClause(options.sourceId)}${entityClause(options.entityId)} limit 100`;

export const stateKeyQueryText = (
  key: string,
  options: {
    entityId?: string | null;
    sourceId?: string | null;
  } = {},
): string => `states ${quoteQueryPart(key)} since 10m${sourceClause(options.sourceId)}${entityClause(options.entityId)} limit 100`;

export const recordedEventQueryText = (event: PulseRecordedEvent): string =>
  `events ${quoteQueryPart(event.kind)} since 24h${sourceClause(event.sourceId)}${entityClause(event.entityId)}${whereClause(
    event.dimensions,
  )} limit 100`;

export const currentStateQueryText = (state: PulseCurrentState): string =>
  `states ${quoteQueryPart(state.key)} since 10m${sourceClause(state.sourceId)}${entityClause(state.entityId)}${whereClause(
    state.dimensions,
  )} limit 100`;
