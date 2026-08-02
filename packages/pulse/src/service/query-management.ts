import { err, fail, ok, type Result } from "@valentinkolb/cloud/server";
import type {
  EventQuery,
  MetricQuery,
  MetricQueryPoint,
  PulseCurrentState,
  PulseExplorerQuery,
  PulseMapFieldSelector,
  PulseMapSeries,
  PulseQueryCompileResult,
  PulseRecordedEvent,
  StateQuery,
} from "../contracts";
import { compilePulseQueryText } from "../query-dsl";
import { type AccessScope, requireBaseAccess } from "./access-control";
import { queryEventMapData } from "./event-map-query";
import { queryEventAggregateData, queryEventsData, queryMetricData, queryStatesData } from "./query-execution";

type MetricExplorerQuery = Extract<PulseExplorerQuery, { kind: "metric" }>;
type EventsExplorerQuery = Extract<PulseExplorerQuery, { kind: "events" }>;
type StatesExplorerQuery = Extract<PulseExplorerQuery, { kind: "states" }>;
type ExplorerQueryResult = {
  compiled: PulseExplorerQuery;
  points: MetricQueryPoint[];
  events: PulseRecordedEvent[];
  states: PulseCurrentState[];
};

type PulseQueryExecutionLimits = {
  maxMetricPoints?: number;
  maxAggregatePoints?: number;
  maxRows?: number;
};

export const queryMetric = async (
  query: MetricQuery,
  user: AccessScope,
  limits: { maxOutputPoints?: number } = {},
): Promise<Result<MetricQueryPoint[]>> => {
  const access = await requireBaseAccess(query.baseId, user, "read");
  if (!access.ok) return fail(access.error);
  return queryMetricData(query, limits);
};

const queryEvents = async (query: EventQuery, user: AccessScope): Promise<Result<PulseRecordedEvent[]>> => {
  const access = await requireBaseAccess(query.baseId, user, "read");
  if (!access.ok) return fail(access.error);
  return queryEventsData(query);
};

const queryStates = async (query: StateQuery, user: AccessScope): Promise<Result<PulseCurrentState[]>> => {
  const access = await requireBaseAccess(query.baseId, user, "read");
  if (!access.ok) return fail(access.error);
  return queryStatesData(query);
};

const runMetricExplorerQuery = async (
  query: MetricExplorerQuery,
  user: AccessScope,
  limits: PulseQueryExecutionLimits,
): Promise<Result<ExplorerQueryResult>> => {
  const points = await queryMetric(query, user, { maxOutputPoints: limits.maxMetricPoints });
  if (!points.ok) return fail(points.error);
  return ok({ compiled: query, points: points.data, events: [], states: [] });
};

const runEventsExplorerQuery = async (
  query: EventsExplorerQuery,
  user: AccessScope,
  limits: PulseQueryExecutionLimits,
): Promise<Result<ExplorerQueryResult>> => {
  const boundedQuery = { ...query, limit: Math.min(query.limit, limits.maxRows ?? query.limit) };
  if ((query.aggregation ?? "rows") !== "rows") {
    const access = await requireBaseAccess(query.baseId, user, "read");
    if (!access.ok) return fail(access.error);
    const points = await queryEventAggregateData(boundedQuery, { maxOutputPoints: limits.maxAggregatePoints });
    if (!points.ok) return fail(points.error);
    return ok({ compiled: query, points: points.data, events: [], states: [] });
  }
  const events = await queryEvents(boundedQuery, user);
  if (!events.ok) return fail(events.error);
  return ok({ compiled: query, points: [], events: events.data, states: [] });
};

const runStatesExplorerQuery = async (
  query: StatesExplorerQuery,
  user: AccessScope,
  limits: PulseQueryExecutionLimits,
): Promise<Result<ExplorerQueryResult>> => {
  const boundedQuery = { ...query, limit: Math.min(query.limit, limits.maxRows ?? query.limit) };
  const states = await queryStates(boundedQuery, user);
  if (!states.ok) return fail(states.error);
  return ok({ compiled: query, points: [], events: [], states: states.data });
};

export const queryMetricText = async (params: {
  baseId: string;
  query: string;
  user: AccessScope;
}): Promise<Result<ExplorerQueryResult>> => {
  const compiled = compilePulseQueryText(params.baseId, params.query);
  if (!compiled.ok) return fail(compiled.error);

  return executeCompiledQuery(compiled.data, params.user);
};

export const executeCompiledQuery = async (
  query: PulseExplorerQuery,
  user: AccessScope,
  limits: PulseQueryExecutionLimits = {},
): Promise<Result<ExplorerQueryResult>> => {
  switch (query.kind) {
    case "metric":
      return runMetricExplorerQuery(query, user, limits);
    case "events":
      return runEventsExplorerQuery(query, user, limits);
    case "states":
      return runStatesExplorerQuery(query, user, limits);
  }
};

export const queryEventMapText = async (params: {
  baseId: string;
  query: string;
  latitude: PulseMapFieldSelector;
  longitude: PulseMapFieldSelector;
  label?: PulseMapFieldSelector;
  series?: PulseMapFieldSelector;
  size: "count" | "sum";
  user: AccessScope;
}): Promise<Result<PulseMapSeries[]>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "read");
  if (!access.ok) return fail(access.error);
  const compiled = compilePulseQueryText(params.baseId, params.query);
  if (!compiled.ok) return fail(compiled.error);
  if (compiled.data.kind !== "events" || (compiled.data.aggregation ?? "rows") !== "rows") {
    return fail(err.badInput("Map widgets require an event rows query"));
  }
  return queryEventMapData({
    query: compiled.data,
    latitude: params.latitude,
    longitude: params.longitude,
    label: params.label,
    series: params.series,
    size: params.size,
  });
};

export const compileQueryText = async (params: {
  baseId: string;
  query: string;
  user: AccessScope;
}): Promise<Result<PulseQueryCompileResult>> => {
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
