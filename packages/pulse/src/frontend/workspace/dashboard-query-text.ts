import type {
  PulseDashboardEventQuery,
  PulseDashboardMetricQuery,
  PulseDashboardStateQuery,
} from "../../contracts";

export const quoteQueryPart = (value: string): string =>
  /[\s,=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;

const queryFiltersToText = (query: PulseDashboardMetricQuery | PulseDashboardEventQuery | PulseDashboardStateQuery): string => {
  const source = query.sourceId ? ` source ${query.sourceId}` : "";
  const entity = query.entityId ? ` entity ${quoteQueryPart(query.entityId)}` : "";
  const entityType = query.entityType ? ` entity_type ${quoteQueryPart(query.entityType)}` : "";
  const dimensions = Object.entries(query.dimensions ?? {});
  const where = dimensions.length ? ` where ${dimensions.map(([key, value]) => `${key}=${quoteQueryPart(String(value))}`).join(", ")}` : "";
  const limit = query.kind === "events" || query.kind === "states" ? ` limit ${query.limit}` : "";
  return `${source}${entity}${entityType}${where}${limit}`;
};

export const dashboardMetricQueryText = (query: PulseDashboardMetricQuery): string =>
  `metric ${query.metric} ${query.aggregation} every ${query.bucket} since ${query.since}${queryFiltersToText(query)}`;

export const dashboardEventQueryText = (query: PulseDashboardEventQuery): string =>
  `events ${query.event ?? "*"} since ${query.since}${queryFiltersToText(query)}`;

export const dashboardStateQueryText = (query: PulseDashboardStateQuery): string =>
  `states ${query.state ?? "*"}${query.since ? ` since ${query.since}` : ""}${queryFiltersToText(query)}`;
