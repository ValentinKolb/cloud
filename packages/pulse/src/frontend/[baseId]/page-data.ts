import type { ResourceApiKey } from "@valentinkolb/cloud/ui";
import { getDateConfig, type AuthContext } from "@valentinkolb/cloud/server";
import { get as getSetting } from "@valentinkolb/cloud/services";
import { readDockWorkspaceStateCookie } from "@valentinkolb/cloud/ui";
import type { Context } from "hono";
import type {
  MetricQuery,
  MetricQueryPoint,
  PulseCurrentState,
  PulseDashboard,
  PulseDashboardConfig,
  PulseDashboardControl,
  PulseDashboardEventsWidget,
  PulseDashboardMetricWidget,
  PulseDashboardStatesWidget,
  PulseInventory,
  PulseMetricSeries,
  MetricType,
  PulseRecordedEvent,
  PulseResourceMetric,
  PulseResourceSummary,
  PulseSource,
  PulseSourceScrape,
} from "../../contracts";
import { compilePulseQueryText } from "../../query-dsl";
import { pulseService } from "../../service";
import {
  dashboardEventsWidgets,
  dashboardMetricWidgets,
  dashboardStatesWidgets,
  FOCUSED_PAGE_SIZE,
  quoteQueryPart,
} from "../workspace/helpers";
import { readActivityQueryState, readDashboardControlQueryState, readWorkspacePathState, type WorkspaceRouteState } from "../workspace/routes";
import type { PulseWorkspaceProps } from "../workspace/types";

type PulseUser = Parameters<typeof pulseService.base.list>[0];
type DashboardControlValues = Record<string, string>;
type PulseWorkspacePageContext<T extends AuthContext = AuthContext> = Context<T>;

type PulseWorkspacePageData =
  | {
      kind: "not_found";
      errorMessage: string;
    }
  | {
      kind: "ok";
      baseName: string;
      workspaceProps: PulseWorkspaceProps;
    };

type SelectedSourceData = {
  initialSourceScrapes: Record<string, PulseSourceScrape[]>;
  initialSourceApiKeys: Record<string, ResourceApiKey[]>;
};

type FocusedSignalData = {
  initialFocusedMetricSeries: PulseMetricSeries[];
  initialFocusedEvents: PulseRecordedEvent[];
  initialFocusedStates: PulseCurrentState[];
  initialFocusedHasMore: boolean;
};

type DashboardWidgetData = {
  initialMetricWidgetPoints: Record<string, MetricQueryPoint[]>;
  initialDashboardEvents: Record<string, PulseRecordedEvent[]>;
  initialDashboardStates: Record<string, PulseCurrentState[]>;
};

type ResourceInitialData = {
  inventory: PulseInventory;
};

const dashboardControlValues = (config: PulseDashboardConfig, values: DashboardControlValues): DashboardControlValues =>
  Object.fromEntries((config.layout?.controls ?? []).map((control: PulseDashboardControl) => [control.variable, values[control.variable] ?? control.defaultValue]));

const resolveDashboardQueryText = (text: string, config: PulseDashboardConfig, values: DashboardControlValues): string => {
  const controls = dashboardControlValues(config, values);
  return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, variable: string) =>
    typeof controls[variable] === "string" ? quoteQueryPart(controls[variable]) : match,
  );
};

const metricWidgetQuery = (baseId: string, dashboard: PulseDashboard, widget: PulseDashboardMetricWidget, controlValues: DashboardControlValues): MetricQuery => {
  if (widget.queryText) {
    const compiled = compilePulseQueryText(baseId, resolveDashboardQueryText(widget.queryText, dashboard.config, controlValues));
    if (compiled.ok && compiled.data.kind === "metric") return compiled.data;
  }
  return {
    kind: "metric",
    baseId,
    metric: widget.metric,
    aggregation: widget.aggregation,
    bucket: widget.bucket,
    since: widget.since,
    sourceId: widget.sourceId ?? null,
    entityId: widget.entityId ?? null,
    entityType: widget.entityType ?? null,
    dimensions: widget.dimensions ?? undefined,
  };
};

const widgetQueryText = (widget: PulseDashboardEventsWidget | PulseDashboardStatesWidget, dashboard: PulseDashboard, controlValues: DashboardControlValues): string =>
  resolveDashboardQueryText(widget.queryText, dashboard.config, controlValues);

const emptyInventory = (): PulseInventory => ({ resources: [], metrics: [], events: [], states: [], fields: [] });

const dataOr = <T,>(result: { ok: boolean; data?: T }, fallback: T): T => (result.ok ? (result.data as T) : fallback);

const activityQueryInput = (query: { q: string; type: MetricType | "" }) => ({
  q: query.q || undefined,
  type: query.type || undefined,
});

const resourceListQueryInput = (searchParams: URLSearchParams) => ({
  q: searchParams.get("q")?.trim() || undefined,
  sourceId: searchParams.get("source")?.trim() || undefined,
  type: searchParams.get("type")?.trim() || undefined,
  limit: 500,
});

const selectedDashboard = (dashboards: PulseDashboard[], dashboardId: string | null): PulseDashboard | null =>
  dashboards.find((dashboard) => dashboard.id === dashboardId) ?? dashboards[0] ?? null;

const selectedSource = (sources: PulseSource[], sourceId: string | null): PulseSource | null =>
  sources.find((source) => source.id === sourceId) ?? null;

const publicOrigin = (rawAppUrl: string | null | undefined, requestOrigin: string): string => {
  const raw = String(rawAppUrl ?? "").trim();
  if (!raw) return requestOrigin;
  const withScheme = /^https?:\/\//i.test(raw)
    ? raw
    : raw.startsWith("localhost") || raw.startsWith("127.") || raw.startsWith("[::1]")
      ? `http://${raw}`
      : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return requestOrigin;
  }
};

const loadSelectedSourceData = async (baseId: string, user: PulseUser, selectedSource: PulseSource | null): Promise<SelectedSourceData> => {
  if (!selectedSource) return { initialSourceScrapes: {}, initialSourceApiKeys: {} };

  const [scrapesResult, apiKeysResult] = await Promise.all([
    pulseService.source.scrapes({ baseId, sourceId: selectedSource.id, user }),
    loadSelectedSourceApiKeys(baseId, user, selectedSource),
  ]);

  return {
    initialSourceScrapes: scrapesResult.ok ? { [selectedSource.id]: scrapesResult.data } : {},
    initialSourceApiKeys: apiKeysResult ? { [selectedSource.id]: apiKeysResult } : {},
  };
};

const loadSelectedSourceApiKeys = async (baseId: string, user: PulseUser, selectedSource: PulseSource): Promise<ResourceApiKey[] | null> => {
  if (selectedSource.kind !== "http_ingest") return null;
  const result = await pulseService.source.apiKeys.list({ baseId, sourceId: selectedSource.id, user });
  return result.ok ? result.data : null;
};

const emptyFocusedSignalData = (): FocusedSignalData => ({
  initialFocusedMetricSeries: [],
  initialFocusedEvents: [],
  initialFocusedStates: [],
  initialFocusedHasMore: false,
});

const hasMoreFocusedRows = (rows: unknown[]): boolean => rows.length > FOCUSED_PAGE_SIZE;

const visibleFocusedRows = <T,>(rows: T[]): T[] => rows.slice(0, FOCUSED_PAGE_SIZE);

const loadFocusedMetricSeries = async (baseId: string, user: PulseUser, metric: string, q: string | undefined): Promise<FocusedSignalData> => {
  const result = await pulseService.query.series(baseId, user, { metric, q, limit: FOCUSED_PAGE_SIZE + 1 });
  if (!result.ok) return emptyFocusedSignalData();
  return {
    initialFocusedMetricSeries: visibleFocusedRows(result.data),
    initialFocusedEvents: [],
    initialFocusedStates: [],
    initialFocusedHasMore: hasMoreFocusedRows(result.data),
  };
};

const loadFocusedEvents = async (baseId: string, user: PulseUser, kind: string, q: string | undefined): Promise<FocusedSignalData> => {
  const result = await pulseService.query.recentEvents(baseId, user, { kind, q, limit: FOCUSED_PAGE_SIZE + 1 });
  if (!result.ok) return emptyFocusedSignalData();
  return {
    initialFocusedMetricSeries: [],
    initialFocusedEvents: visibleFocusedRows(result.data),
    initialFocusedStates: [],
    initialFocusedHasMore: hasMoreFocusedRows(result.data),
  };
};

const loadFocusedStates = async (baseId: string, user: PulseUser, key: string, q: string | undefined): Promise<FocusedSignalData> => {
  const result = await pulseService.query.currentStates(baseId, user, { key, q, limit: FOCUSED_PAGE_SIZE + 1 });
  if (!result.ok) return emptyFocusedSignalData();
  return {
    initialFocusedMetricSeries: [],
    initialFocusedEvents: [],
    initialFocusedStates: visibleFocusedRows(result.data),
    initialFocusedHasMore: hasMoreFocusedRows(result.data),
  };
};

const loadFocusedSignalData = async (
  baseId: string,
  user: PulseUser,
  routeState: WorkspaceRouteState,
  searchParams: URLSearchParams,
): Promise<FocusedSignalData> => {
  if (!routeState.signalId) return emptyFocusedSignalData();
  const q = searchParams.get("q")?.trim() || undefined;
  if (routeState.view === "metric-detail") return loadFocusedMetricSeries(baseId, user, routeState.signalId, q);
  if (routeState.view === "event-detail") return loadFocusedEvents(baseId, user, routeState.signalId, q);
  if (routeState.view === "state-detail") return loadFocusedStates(baseId, user, routeState.signalId, q);
  return emptyFocusedSignalData();
};

const loadDashboardWidgetData = async (
  baseId: string,
  user: PulseUser,
  routeState: WorkspaceRouteState,
  selectedDashboard: PulseDashboard | null,
  controlValues: DashboardControlValues,
): Promise<DashboardWidgetData> => {
  if (!selectedDashboard || (routeState.view !== "dashboard" && routeState.view !== "dashboard-edit")) {
    return { initialMetricWidgetPoints: {}, initialDashboardEvents: {}, initialDashboardStates: {} };
  }

  const [metricWidgetPointEntries, eventEntries, stateEntries] = await Promise.all([
    Promise.all(
      dashboardMetricWidgets(selectedDashboard.config).map(async (widget): Promise<[string, MetricQueryPoint[]]> => {
        const result = await pulseService.query.metric(metricWidgetQuery(baseId, selectedDashboard, widget, controlValues), user);
        return [widget.id, result.ok ? result.data : []];
      }),
    ),
    Promise.all(
      dashboardEventsWidgets(selectedDashboard.config).map(async (widget): Promise<[string, PulseRecordedEvent[]]> => {
        const result = await pulseService.query.metricText({
          baseId,
          query: widgetQueryText(widget, selectedDashboard, controlValues),
          user,
        });
        return [widget.id, result.ok ? result.data.events : []];
      }),
    ),
    Promise.all(
      dashboardStatesWidgets(selectedDashboard.config).map(async (widget): Promise<[string, PulseCurrentState[]]> => {
        const result = await pulseService.query.metricText({
          baseId,
          query: widgetQueryText(widget, selectedDashboard, controlValues),
          user,
        });
        return [widget.id, result.ok ? result.data.states : []];
      }),
    ),
  ]);

  return {
    initialMetricWidgetPoints: Object.fromEntries(metricWidgetPointEntries),
    initialDashboardEvents: Object.fromEntries(eventEntries),
    initialDashboardStates: Object.fromEntries(stateEntries),
  };
};

const exactResourceMatch = (resources: PulseResourceSummary[], ref: string): PulseResourceSummary | null =>
  resources.find((resource) => resource.key === ref || resource.id === ref || resource.label === ref) ?? resources[0] ?? null;

const loadResourceInitialData = async (
  baseId: string,
  user: PulseUser,
  routeState: WorkspaceRouteState,
  searchParams: URLSearchParams,
): Promise<ResourceInitialData> => {
  if (routeState.view === "resource-detail") {
    const ref = routeState.signalId.trim();
    if (!ref) return { inventory: emptyInventory() };
    const resourcesResult = await pulseService.query.resources(baseId, user, { ref, limit: 20 });
    const resources = dataOr(resourcesResult, []);
    const resource = exactResourceMatch(resources, ref);
    if (!resource) return { inventory: { ...emptyInventory(), resources } };

    const [metricsResult, statesResult, eventsResult] = await Promise.all([
      pulseService.query.resourceMetrics(baseId, user, { resourceKey: resource.key, limit: 500 }),
      pulseService.query.resourceStates(baseId, user, { resourceKey: resource.key, limit: 500 }),
      pulseService.query.resourceEvents(baseId, user, { resourceKey: resource.key, limit: 500 }),
    ]);

    return {
      inventory: {
        ...emptyInventory(),
        resources,
        metrics: dataOr<PulseResourceMetric[]>(metricsResult, []),
        states: dataOr<PulseCurrentState[]>(statesResult, []),
        events: dataOr<PulseRecordedEvent[]>(eventsResult, []),
      },
    };
  }

  if (routeState.view === "resources") {
    const resourcesResult = await pulseService.query.resources(baseId, user, resourceListQueryInput(searchParams));
    return {
      inventory: {
        ...emptyInventory(),
        resources: dataOr(resourcesResult, []),
      },
    };
  }

  const inventoryResult = await pulseService.query.inventory(baseId, user);
  return { inventory: dataOr(inventoryResult, emptyInventory()) };
};

export async function loadPulseWorkspacePageData<T extends AuthContext>(c: PulseWorkspacePageContext<T>): Promise<PulseWorkspacePageData> {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);
  const baseId = c.req.param("baseId") ?? "";
  const [basesResult, baseResult, capabilitiesResult] = await Promise.all([
    pulseService.base.list(user),
    pulseService.base.get(baseId, user),
    pulseService.capabilities(),
  ]);

  if (!baseResult.ok) {
    return { kind: "not_found", errorMessage: baseResult.error.message };
  }

  const base = baseResult.data;
  const routeState = readWorkspacePathState(url.pathname, base.id);
  const activityQuery = readActivityQueryState(url.search);
  const dashboardControlValues = readDashboardControlQueryState(url.search);
  const [appUrl, workspaceData] = await Promise.all([
    getSetting<string>("app.url").catch(() => ""),
    loadPulseWorkspaceInitialData({
      user,
      baseId: base.id,
      routeState,
      activityQuery,
      dashboardControlValues,
      searchParams: url.searchParams,
    }),
  ]);

  return {
    kind: "ok",
    baseName: base.name,
    workspaceProps: {
      initialBases: dataOr(basesResult, []),
      initialCapabilities: dataOr(capabilitiesResult, null),
      initialBaseId: base.id,
      initialPath: url.pathname,
      initialSearch: url.search,
      initialRouteState: routeState,
      initialActivityQuery: activityQuery,
      initialDashboardControlValues: dashboardControlValues,
      initialExplorerDockState: readDockWorkspaceStateCookie(c.req.header("Cookie"), "pulse.query-explorer"),
      initialDashboardEditorDockState: readDockWorkspaceStateCookie(c.req.header("Cookie"), "pulse.dashboard-editor"),
      initialDateConfig: getDateConfig(c),
      initialNow: new Date().toISOString(),
      initialOrigin: publicOrigin(appUrl, url.origin),
      ...workspaceData,
    },
  };
}

async function loadPulseWorkspaceInitialData(params: {
  user: PulseUser;
  baseId: string;
  routeState: WorkspaceRouteState;
  activityQuery: { q: string; type: MetricType | "" };
  dashboardControlValues: DashboardControlValues;
  searchParams: URLSearchParams;
}): Promise<Partial<PulseWorkspaceProps>> {
  const activityQuery = activityQueryInput(params.activityQuery);
  const [sourcesResult, metricsResult, resourceData, activityMetricsResult, dashboardsResult, savedQueriesResult, eventsResult, statesResult] =
    await Promise.all([
      pulseService.source.list(params.baseId, params.user),
      pulseService.query.metrics(params.baseId, params.user, {}),
      loadResourceInitialData(params.baseId, params.user, params.routeState, params.searchParams),
      pulseService.query.metrics(params.baseId, params.user, activityQuery),
      pulseService.dashboard.list(params.baseId, params.user),
      pulseService.savedQuery.list(params.baseId, params.user),
      pulseService.query.recentEvents(params.baseId, params.user, { q: activityQuery.q }),
      pulseService.query.currentStates(params.baseId, params.user, { q: activityQuery.q }),
    ]);
  const sources = dataOr(sourcesResult, []);
  const dashboards = dataOr(dashboardsResult, []);
  const dashboard = selectedDashboard(dashboards, params.routeState.dashboardId);
  const source = selectedSource(sources, params.routeState.sourceId);
  const [sourceData, focusedData, widgetData] = await Promise.all([
    loadSelectedSourceData(params.baseId, params.user, source),
    loadFocusedSignalData(params.baseId, params.user, params.routeState, params.searchParams),
    loadDashboardWidgetData(params.baseId, params.user, params.routeState, dashboard, params.dashboardControlValues),
  ]);

  return {
    initialSources: sources,
    initialSourceScrapes: sourceData.initialSourceScrapes,
    initialSourceApiKeys: sourceData.initialSourceApiKeys,
    initialMetrics: dataOr(metricsResult, []),
    initialInventory: resourceData.inventory,
    initialActivityMetrics: dataOr(activityMetricsResult, []),
    initialRecentEvents: dataOr(eventsResult, []),
    initialCurrentStates: dataOr(statesResult, []),
    initialFocusedMetricSeries: focusedData.initialFocusedMetricSeries,
    initialFocusedEvents: focusedData.initialFocusedEvents,
    initialFocusedStates: focusedData.initialFocusedStates,
    initialFocusedHasMore: focusedData.initialFocusedHasMore,
    initialDashboards: dashboards,
    initialSavedQueries: dataOr(savedQueriesResult, []),
    initialMetricWidgetPoints: widgetData.initialMetricWidgetPoints,
    initialDashboardEvents: widgetData.initialDashboardEvents,
    initialDashboardStates: widgetData.initialDashboardStates,
  };
}
