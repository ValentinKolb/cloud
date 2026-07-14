import { err, fail, ok, type Result } from "@valentinkolb/cloud/server";
import { toPgTextArray } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import type {
  DashboardRefreshInterval,
  EventQuery,
  MetricQuery,
  MetricQueryPoint,
  PulseCurrentState,
  PulseDashboard,
  PulseDashboardEventsWidget,
  PulseDashboardLayout,
  PulseDashboardMetricWidget,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardSnapshot,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
  PulsePublicCurrentState,
  PulsePublicDashboard,
  PulsePublicDashboardCardWidget,
  PulsePublicDashboardEventsWidget,
  PulsePublicDashboardLayout,
  PulsePublicDashboardMetricWidget,
  PulsePublicDashboardRow,
  PulsePublicDashboardSection,
  PulsePublicDashboardStatesWidget,
  PulsePublicDashboardWidget,
  PulsePublicRecordedEvent,
  PulseRecordedEvent,
  StateQuery,
} from "../contracts";
import { requireBaseAccess, type AccessScope } from "./access-control";
import {
  dashboardEventsWidgets,
  dashboardMetricWidgets,
  dashboardRenderConfig,
  dashboardStatesWidgets,
  normalizeDashboardConfig,
} from "./dashboard-config";
import { publicDashboardTokenHash } from "./public-dashboard-tokens";
import { iso } from "./telemetry-values";

const MAX_PUBLIC_EXECUTED_WIDGETS = 36;

type DashboardRow = {
  id: string;
  base_id: string;
  name: string;
  config: unknown;
  public_enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type PublicDashboardSnapshotDeps = {
  queryMetricData: (query: MetricQuery) => Promise<Result<MetricQueryPoint[]>>;
  queryEventsData: (query: EventQuery) => Promise<Result<PulseRecordedEvent[]>>;
  queryStatesData: (query: StateQuery) => Promise<Result<PulseCurrentState[]>>;
};

type PublicWidgetResults = {
  points: Record<string, MetricQueryPoint[]>;
  events: Record<string, PulsePublicRecordedEvent[]>;
  states: Record<string, PulsePublicCurrentState[]>;
  metricUnitByName: Map<string, string | null>;
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

const getPublicDashboardByToken = async (token: string): Promise<Result<PulseDashboard>> => {
  const [row] = await sql<DashboardRow[]>`
    SELECT d.id, d.base_id, d.name, d.config, d.public_enabled, d.created_at, d.updated_at
    FROM pulse.dashboards d
    JOIN pulse.bases b ON b.id = d.base_id
    WHERE d.public_enabled = TRUE
      AND b.deletion_started_at IS NULL
      AND d.public_token_hash = ${publicDashboardTokenHash(token)}
  `;
  return row ? ok(mapDashboard(row)) : fail(err.notFound("Pulse dashboard"));
};

const getDashboardById = async (dashboardId: string, user: AccessScope): Promise<Result<PulseDashboard>> => {
  const [row] = await sql<DashboardRow[]>`
    SELECT d.id, d.base_id, d.name, d.config, d.public_enabled, d.created_at, d.updated_at
    FROM pulse.dashboards d
    JOIN pulse.bases b ON b.id = d.base_id
    WHERE d.id = ${dashboardId}::uuid
      AND b.deletion_started_at IS NULL
  `;
  if (!row) return fail(err.notFound("Pulse dashboard"));
  const access = await requireBaseAccess(row.base_id, user, "read");
  if (!access.ok) return fail(access.error);
  return ok(mapDashboard(row));
};

const publicMetricWidget = (
  widget: PulseDashboardMetricWidget,
  metricUnitByName: Map<string, string | null>,
): PulsePublicDashboardMetricWidget => ({
  id: widget.id,
  kind: "metric",
  title: widget.title,
  metric: widget.metric,
  unit: metricUnitByName.get(widget.query?.metric ?? widget.metric) ?? null,
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

const publicDashboardWidget = (widget: PulseDashboardWidget, metricUnitByName: Map<string, string | null>): PulsePublicDashboardWidget => {
  if (widget.kind === "metric") return publicMetricWidget(widget, metricUnitByName);
  if (widget.kind === "events") return publicEventsWidget(widget);
  if (widget.kind === "states") return publicStatesWidget(widget);
  if (widget.kind === "markdown") return widget;
  const card: PulsePublicDashboardCardWidget = {
    id: widget.id,
    kind: "card",
    title: widget.title,
    description: widget.description,
    span: widget.span,
    rows: widget.rows.map((row) => publicDashboardRow(row, metricUnitByName)),
  };
  return card;
};

const publicDashboardRow = (row: PulseDashboardRow, metricUnitByName: Map<string, string | null>): PulsePublicDashboardRow => ({
  id: row.id,
  kind: "row",
  height: row.height,
  cells: row.cells.map((cell) => publicDashboardWidget(cell, metricUnitByName)),
});

const publicDashboardSection = (
  section: PulseDashboardSection,
  metricUnitByName: Map<string, string | null>,
): PulsePublicDashboardSection => ({
  id: section.id,
  kind: "section",
  title: section.title,
  description: section.description,
  rows: section.rows.map((row) => publicDashboardRow(row, metricUnitByName)),
  sections: section.sections?.map((child) => publicDashboardSection(child, metricUnitByName)),
});

const publicDashboardLayout = (
  layout: PulseDashboardLayout | null,
  metricUnitByName: Map<string, string | null>,
): PulsePublicDashboardLayout | null =>
  layout
    ? {
        version: 1,
        description: layout.description,
        sections: layout.sections.map((section) => publicDashboardSection(section, metricUnitByName)),
      }
    : null;

const publicDashboardMetricUnits = async (baseId: string, widgets: PulseDashboardMetricWidget[]): Promise<Map<string, string | null>> => {
  const names = [...new Set(widgets.map((widget) => widget.query?.metric ?? widget.metric).filter(Boolean))];
  if (!names.length) return new Map();
  const rows = await sql<{ name: string; unit: string | null }[]>`
    SELECT name, unit
    FROM pulse.metric_defs
    WHERE base_id = ${baseId}::uuid
      AND name = ANY(${toPgTextArray(names)}::text[])
  `;
  return new Map(rows.map((row) => [row.name, row.unit]));
};

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

const publicRefreshInterval = (value: DashboardRefreshInterval | null | undefined): DashboardRefreshInterval | null | undefined =>
  value === 1 ? 5 : value;

const nullable = <T>(value: T | null | undefined): T | null => value ?? null;

const fallbackMetricWidgetQuery = (baseId: string, widget: PulseDashboardMetricWidget): MetricQuery => ({
  kind: "metric",
  baseId,
  metric: widget.metric,
  aggregation: widget.aggregation,
  bucket: widget.bucket,
  since: widget.since,
  sourceId: nullable(widget.sourceId),
  entityId: nullable(widget.entityId),
  entityType: nullable(widget.entityType),
  dimensions: widget.dimensions,
});

const metricWidgetQuery = (baseId: string, widget: PulseDashboardMetricWidget): MetricQuery => ({
  ...fallbackMetricWidgetQuery(baseId, widget),
  ...(widget.query ?? {}),
  baseId,
  kind: "metric",
});

const takePublicWidgets = <T>(widgets: T[], remaining: number): { widgets: T[]; remaining: number } => {
  const allowed = Math.max(0, remaining);
  return { widgets: widgets.slice(0, allowed), remaining: Math.max(0, allowed - widgets.length) };
};

const runPublicMetricWidgets = async (
  baseId: string,
  widgets: PulseDashboardMetricWidget[],
  deps: PublicDashboardSnapshotDeps,
): Promise<Record<string, MetricQueryPoint[]>> => {
  const points: Record<string, MetricQueryPoint[]> = {};
  for (const widget of widgets) {
    const result = await deps.queryMetricData(metricWidgetQuery(baseId, widget));
    points[widget.id] = result.ok ? result.data : [];
  }
  return points;
};

const runPublicEventsWidgets = async (
  baseId: string,
  widgets: PulseDashboardEventsWidget[],
  deps: PublicDashboardSnapshotDeps,
): Promise<Record<string, PulsePublicRecordedEvent[]>> => {
  const events: Record<string, PulsePublicRecordedEvent[]> = {};
  for (const widget of widgets) {
    const result = await deps.queryEventsData({ baseId, ...widget.query });
    events[widget.id] = result.ok ? result.data.map(publicRecordedEvent) : [];
  }
  return events;
};

const runPublicStatesWidgets = async (
  baseId: string,
  widgets: PulseDashboardStatesWidget[],
  deps: PublicDashboardSnapshotDeps,
): Promise<Record<string, PulsePublicCurrentState[]>> => {
  const states: Record<string, PulsePublicCurrentState[]> = {};
  for (const widget of widgets) {
    const result = await deps.queryStatesData({ baseId, ...widget.query });
    states[widget.id] = result.ok ? result.data.map(publicCurrentState) : [];
  }
  return states;
};

const collectPublicWidgetResults = async (dashboard: PulseDashboard, deps: PublicDashboardSnapshotDeps): Promise<PublicWidgetResults> => {
  const config = dashboardRenderConfig(dashboard);
  const metricWidgets = dashboardMetricWidgets(config);
  const metricUnitByName = await publicDashboardMetricUnits(dashboard.baseId, metricWidgets);
  const metrics = takePublicWidgets(metricWidgets, MAX_PUBLIC_EXECUTED_WIDGETS);
  const eventWidgets = takePublicWidgets(dashboardEventsWidgets(config), metrics.remaining);
  const stateWidgets = takePublicWidgets(dashboardStatesWidgets(config), eventWidgets.remaining);

  const [points, events, states] = await Promise.all([
    runPublicMetricWidgets(dashboard.baseId, metrics.widgets, deps),
    runPublicEventsWidgets(dashboard.baseId, eventWidgets.widgets, deps),
    runPublicStatesWidgets(dashboard.baseId, stateWidgets.widgets, deps),
  ]);
  return { points, events, states, metricUnitByName };
};

const publicDashboardFromConfig = (dashboard: PulseDashboard, metricUnitByName: Map<string, string | null>): PulsePublicDashboard => {
  const config = dashboardRenderConfig(dashboard);
  return {
    id: dashboard.id,
    name: dashboard.name,
    config: {
      refreshIntervalSeconds: publicRefreshInterval(config.refreshIntervalSeconds),
      layout: publicDashboardLayout(config.layout, metricUnitByName),
    },
  };
};

export const getPublicDashboardSnapshot = async (
  token: string,
  deps: PublicDashboardSnapshotDeps,
): Promise<Result<PulseDashboardSnapshot>> => {
  const dashboardResult = await getPublicDashboardByToken(token);
  if (!dashboardResult.ok) return fail(dashboardResult.error);
  const dashboard = dashboardResult.data;
  const { points, events, states, metricUnitByName } = await collectPublicWidgetResults(dashboard, deps);
  const publicDashboard = publicDashboardFromConfig(dashboard, metricUnitByName);

  return ok({ dashboard: publicDashboard, points, events, states });
};

export const getDashboardSnapshot = async (
  dashboardId: string,
  user: AccessScope,
  deps: PublicDashboardSnapshotDeps,
): Promise<Result<PulseDashboardSnapshot>> => {
  const dashboardResult = await getDashboardById(dashboardId, user);
  if (!dashboardResult.ok) return fail(dashboardResult.error);
  const dashboard = dashboardResult.data;
  const { points, events, states, metricUnitByName } = await collectPublicWidgetResults(dashboard, deps);
  return ok({
    dashboard: publicDashboardFromConfig(dashboard, metricUnitByName),
    points,
    events,
    states,
  });
};
