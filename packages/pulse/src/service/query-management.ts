import { fail, ok, type Result } from "@valentinkolb/cloud/server";
import { compilePulseQueryText } from "../query-dsl";
import type {
  EventQuery,
  MetricQuery,
  MetricQueryPoint,
  PulseCurrentState,
  PulseExplorerQuery,
  PulseQueryCompileResult,
  PulseRecordedEvent,
  StateQuery,
} from "../contracts";
import { requireBaseAccess, type AccessScope } from "./access-control";
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

export const queryMetric = async (query: MetricQuery, user: AccessScope): Promise<Result<MetricQueryPoint[]>> => {
  const access = await requireBaseAccess(query.baseId, user, "read");
  if (!access.ok) return fail(access.error);
  return queryMetricData(query);
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

const runMetricExplorerQuery = async (query: MetricExplorerQuery, user: AccessScope): Promise<Result<ExplorerQueryResult>> => {
  const points = await queryMetric(query, user);
  if (!points.ok) return fail(points.error);
  return ok({ compiled: query, points: points.data, events: [], states: [] });
};

const runEventsExplorerQuery = async (query: EventsExplorerQuery, user: AccessScope): Promise<Result<ExplorerQueryResult>> => {
  if ((query.aggregation ?? "rows") !== "rows") {
    const access = await requireBaseAccess(query.baseId, user, "read");
    if (!access.ok) return fail(access.error);
    const points = await queryEventAggregateData(query);
    if (!points.ok) return fail(points.error);
    return ok({ compiled: query, points: points.data, events: [], states: [] });
  }
  const events = await queryEvents(query, user);
  if (!events.ok) return fail(events.error);
  return ok({ compiled: query, points: [], events: events.data, states: [] });
};

const runStatesExplorerQuery = async (query: StatesExplorerQuery, user: AccessScope): Promise<Result<ExplorerQueryResult>> => {
  const states = await queryStates(query, user);
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

  switch (compiled.data.kind) {
    case "metric":
      return runMetricExplorerQuery(compiled.data, params.user);
    case "events":
      return runEventsExplorerQuery(compiled.data, params.user);
    case "states":
      return runStatesExplorerQuery(compiled.data, params.user);
  }
};

export const compileQueryText = async (params: { baseId: string; query: string; user: AccessScope }): Promise<Result<PulseQueryCompileResult>> => {
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
