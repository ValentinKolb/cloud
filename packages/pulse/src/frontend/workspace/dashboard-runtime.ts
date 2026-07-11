import type {
  MetricQueryPoint,
  PulseCurrentState,
  PulseDashboard,
  PulseDashboardConfig,
  PulseDashboardEventsWidget,
  PulseDashboardMetricWidget,
  PulseDashboardStatesWidget,
  PulseRecordedEvent,
} from "../../contracts";
import { jsonFetch } from "../http";
import { dashboardEventQueryText, dashboardMetricQueryText, dashboardStateQueryText, quoteQueryPart } from "./dashboard-query-text";

const dashboardRuntimeValues = (
  dashboard: PulseDashboard,
  config: PulseDashboardConfig,
  controlValues?: Record<string, string>,
): Record<string, string> => {
  const defaults = Object.fromEntries((config.layout?.controls ?? []).map((control) => [control.variable, control.defaultValue]));
  return { ...defaults, ...(controlValues ?? {}) };
};

const resolveDashboardQueryText = (
  text: string,
  dashboard: PulseDashboard,
  config: PulseDashboardConfig,
  controlValues?: Record<string, string>,
): string => {
  const values = dashboardRuntimeValues(dashboard, config, controlValues);
  return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, variable: string) =>
    typeof values[variable] === "string" ? quoteQueryPart(values[variable]) : match,
  );
};

const metricWidgetQueryText = (widget: PulseDashboardMetricWidget): string => {
  if (widget.queryText && widget.query) return widget.queryText;
  return dashboardMetricQueryText(
    widget.query ?? {
      kind: "metric",
      metric: widget.metric,
      aggregation: widget.aggregation,
      bucket: widget.bucket,
      since: widget.since,
      sourceId: widget.sourceId ?? null,
      entityId: widget.entityId ?? null,
      entityType: widget.entityType ?? null,
      dimensions: widget.dimensions,
    },
  );
};

const fetchDashboardQuery = <T,>(baseId: string, query: string, signal?: AbortSignal): Promise<T> =>
  jsonFetch<T>("/api/pulse/query/metric-text", {
    method: "POST",
    signal,
    body: JSON.stringify({ baseId, query }),
  });

export const fetchDashboardMetricWidgetPoints = async (input: {
  baseId: string;
  config: PulseDashboardConfig;
  controlValues?: Record<string, string>;
  dashboard: PulseDashboard;
  signal?: AbortSignal;
  widget: PulseDashboardMetricWidget;
}): Promise<MetricQueryPoint[]> => {
  const query = resolveDashboardQueryText(metricWidgetQueryText(input.widget), input.dashboard, input.config, input.controlValues);
  const data = await fetchDashboardQuery<{ points: MetricQueryPoint[] }>(input.baseId, query, input.signal);
  return data.points ?? [];
};

export const fetchDashboardEventsWidgetRows = async (input: {
  baseId: string;
  config: PulseDashboardConfig;
  controlValues?: Record<string, string>;
  dashboard: PulseDashboard;
  signal?: AbortSignal;
  widget: PulseDashboardEventsWidget;
}): Promise<PulseRecordedEvent[]> => {
  const query = resolveDashboardQueryText(
    input.widget.queryText || dashboardEventQueryText(input.widget.query),
    input.dashboard,
    input.config,
    input.controlValues,
  );
  const data = await fetchDashboardQuery<{ events: PulseRecordedEvent[] }>(input.baseId, query, input.signal);
  return data.events ?? [];
};

export const fetchDashboardStatesWidgetRows = async (input: {
  baseId: string;
  config: PulseDashboardConfig;
  controlValues?: Record<string, string>;
  dashboard: PulseDashboard;
  signal?: AbortSignal;
  widget: PulseDashboardStatesWidget;
}): Promise<PulseCurrentState[]> => {
  const query = resolveDashboardQueryText(
    input.widget.queryText || dashboardStateQueryText(input.widget.query),
    input.dashboard,
    input.config,
    input.controlValues,
  );
  const data = await fetchDashboardQuery<{ states: PulseCurrentState[] }>(input.baseId, query, input.signal);
  return data.states ?? [];
};
