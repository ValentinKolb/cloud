import { Layout } from "@valentinkolb/cloud/ssr";
import { getDateConfig, type AuthContext } from "@valentinkolb/cloud/server";
import { get as getSetting } from "@valentinkolb/cloud/services";
import { readDockWorkspaceStateCookie } from "@valentinkolb/cloud/ui";
import type { ResourceApiKey } from "@valentinkolb/cloud/ui";
import type {
  MetricQuery,
  MetricQueryPoint,
  PulseDashboard,
  PulseDashboardConfig,
  PulseDashboardControl,
  PulseDashboardEventsWidget,
  PulseDashboardMetricWidget,
  PulseDashboardSection,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
  PulseInventory,
  PulseMetricSeries,
  PulseRecordedEvent,
  PulseCurrentState,
} from "../../contracts";
import { ssr } from "../../config";
import { compilePulseQueryText } from "../../query-dsl";
import { pulseService } from "../../service";
import PulseWorkspace from "../PulseWorkspace.island";
import { quoteQueryPart } from "../workspace/helpers";
import { readActivityQueryState, readDashboardControlQueryState, readWorkspacePathState } from "../workspace/routes";

const dashboardWidgetDescendants = (widget: PulseDashboardWidget): PulseDashboardWidget[] =>
  widget.kind === "card" ? [widget, ...widget.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants))] : [widget];

const dashboardSectionWidgets = (section: PulseDashboardSection): PulseDashboardWidget[] => [
  ...section.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants)),
  ...(section.sections ?? []).flatMap(dashboardSectionWidgets),
];

const dashboardMetricWidgets = (dashboard: PulseDashboard): PulseDashboardMetricWidget[] =>
  dashboard.config.layout?.sections.flatMap(dashboardSectionWidgets).filter((widget): widget is PulseDashboardMetricWidget => widget.kind === "metric") ?? [];

const dashboardEventsWidgets = (dashboard: PulseDashboard): PulseDashboardEventsWidget[] =>
  dashboard.config.layout?.sections.flatMap(dashboardSectionWidgets).filter((widget): widget is PulseDashboardEventsWidget => widget.kind === "events") ?? [];

const dashboardStatesWidgets = (dashboard: PulseDashboard): PulseDashboardStatesWidget[] =>
  dashboard.config.layout?.sections.flatMap(dashboardSectionWidgets).filter((widget): widget is PulseDashboardStatesWidget => widget.kind === "states") ?? [];

const dashboardControlValues = (config: PulseDashboardConfig, values: Record<string, string>): Record<string, string> =>
  Object.fromEntries((config.layout?.controls ?? []).map((control: PulseDashboardControl) => [control.variable, values[control.variable] ?? control.defaultValue]));

const resolveDashboardQueryText = (text: string, config: PulseDashboardConfig, values: Record<string, string>): string => {
  const controls = dashboardControlValues(config, values);
  return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, variable: string) =>
    typeof controls[variable] === "string" ? quoteQueryPart(controls[variable]) : match,
  );
};

const metricWidgetQuery = (baseId: string, dashboard: PulseDashboard, widget: PulseDashboardMetricWidget, controlValues: Record<string, string>): MetricQuery => {
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

const widgetQueryText = (widget: PulseDashboardEventsWidget | PulseDashboardStatesWidget, dashboard: PulseDashboard, controlValues: Record<string, string>): string =>
  resolveDashboardQueryText(widget.queryText, dashboard.config, controlValues);

const FOCUSED_PAGE_SIZE = 100;

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

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);
  const dateConfig = getDateConfig(c);
  const appUrl = await getSetting<string>("app.url").catch(() => "");
  const initialOrigin = publicOrigin(appUrl, url.origin);
  const baseId = c.req.param("baseId") ?? "";
  const [basesResult, baseResult, capabilitiesResult] = await Promise.all([
    pulseService.base.list(user),
    pulseService.base.get(baseId, user),
    pulseService.capabilities(),
  ]);
  const bases = basesResult.ok ? basesResult.data : [];
  const capabilities = capabilitiesResult.ok ? capabilitiesResult.data : null;

  if (!baseResult.ok) {
    return () => (
      <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Pulse", href: "/app/pulse" }, { title: "Base not found" }]}>
        <div class="mx-auto flex max-w-4xl flex-col items-center gap-4 py-12">
          <p class="flex items-center gap-1.5 text-xs text-dimmed">
            <i class="ti ti-alert-circle text-sm" />
            {baseResult.error.message}
          </p>
          <a href="/app/pulse" class="btn-primary btn-sm">
            Back to Pulse
          </a>
        </div>
      </Layout>
    );
  }

  const routeState = readWorkspacePathState(url.pathname, baseResult.data.id);
  const initialActivityQuery = readActivityQueryState(url.search);
  const initialDashboardControlValues = readDashboardControlQueryState(url.search);
  const explorerDockState = readDockWorkspaceStateCookie(c.req.header("Cookie"), "pulse.query-explorer");
  const dashboardEditorDockState = readDockWorkspaceStateCookie(c.req.header("Cookie"), "pulse.dashboard-editor");
  const activityQuery = {
    q: initialActivityQuery.q || undefined,
    type: initialActivityQuery.type || undefined,
  };
  const [sourcesResult, metricsResult, inventoryResult, activityMetricsResult, dashboardsResult, savedQueriesResult, eventsResult, statesResult] =
    await Promise.all([
      pulseService.source.list(baseResult.data.id, user),
      pulseService.query.metrics(baseResult.data.id, user, {}),
      pulseService.query.inventory(baseResult.data.id, user),
      pulseService.query.metrics(baseResult.data.id, user, activityQuery),
      pulseService.dashboard.list(baseResult.data.id, user),
      pulseService.savedQuery.list(baseResult.data.id, user),
      pulseService.query.recentEvents(baseResult.data.id, user, { q: activityQuery.q }),
      pulseService.query.currentStates(baseResult.data.id, user, { q: activityQuery.q }),
    ]);
  const sources = sourcesResult.ok ? sourcesResult.data : [];
  const metrics = metricsResult.ok ? metricsResult.data : [];
  const inventory: PulseInventory = inventoryResult.ok ? inventoryResult.data : { resources: [], metrics: [], events: [], states: [] };
  const activityMetrics = activityMetricsResult.ok ? activityMetricsResult.data : [];
  const dashboards = dashboardsResult.ok ? dashboardsResult.data : [];
  const selectedDashboard = dashboards.find((dashboard) => dashboard.id === routeState.dashboardId) ?? dashboards[0] ?? null;
  const selectedSource = sources.find((source) => source.id === routeState.sourceId) ?? null;
  const [
    selectedSourceScrapesResult,
    selectedSourceApiKeysResult,
    focusedMetricSeriesResult,
    focusedEventsResult,
    focusedStatesResult,
  ] = await Promise.all([
      selectedSource
        ? pulseService.source.scrapes({ baseId: baseResult.data.id, sourceId: selectedSource.id, user })
        : Promise.resolve(null),
      selectedSource?.kind === "http_ingest"
        ? pulseService.source.apiKeys.list({ baseId: baseResult.data.id, sourceId: selectedSource.id, user })
        : Promise.resolve(null),
      routeState.view === "metric-detail" && routeState.signalId
        ? pulseService.query.series(baseResult.data.id, user, {
            metric: routeState.signalId,
            q: url.searchParams.get("q")?.trim() || undefined,
            limit: FOCUSED_PAGE_SIZE + 1,
          })
        : Promise.resolve(null),
      routeState.view === "event-detail" && routeState.signalId
        ? pulseService.query.recentEvents(baseResult.data.id, user, {
            kind: routeState.signalId,
            q: url.searchParams.get("q")?.trim() || undefined,
            limit: FOCUSED_PAGE_SIZE + 1,
          })
        : Promise.resolve(null),
      routeState.view === "state-detail" && routeState.signalId
        ? pulseService.query.currentStates(baseResult.data.id, user, {
            key: routeState.signalId,
            q: url.searchParams.get("q")?.trim() || undefined,
            limit: FOCUSED_PAGE_SIZE + 1,
          })
        : Promise.resolve(null),
    ]);
  const focusedMetricSeries: PulseMetricSeries[] = focusedMetricSeriesResult?.ok
    ? focusedMetricSeriesResult.data.slice(0, FOCUSED_PAGE_SIZE)
    : [];
  const focusedEvents: PulseRecordedEvent[] = focusedEventsResult?.ok ? focusedEventsResult.data.slice(0, FOCUSED_PAGE_SIZE) : [];
  const focusedStates: PulseCurrentState[] = focusedStatesResult?.ok ? focusedStatesResult.data.slice(0, FOCUSED_PAGE_SIZE) : [];
  const focusedHasMore =
    (focusedMetricSeriesResult?.ok && focusedMetricSeriesResult.data.length > FOCUSED_PAGE_SIZE) ||
    (focusedEventsResult?.ok && focusedEventsResult.data.length > FOCUSED_PAGE_SIZE) ||
    (focusedStatesResult?.ok && focusedStatesResult.data.length > FOCUSED_PAGE_SIZE);
  const initialSourceScrapes =
    selectedSourceScrapesResult?.ok && selectedSource ? { [selectedSource.id]: selectedSourceScrapesResult.data } : {};
  const initialSourceApiKeys: Record<string, ResourceApiKey[]> =
    selectedSourceApiKeysResult?.ok && selectedSource ? { [selectedSource.id]: selectedSourceApiKeysResult.data } : {};
  const metricWidgetPointEntries =
    selectedDashboard && (routeState.view === "dashboard" || routeState.view === "dashboard-edit")
      ? await Promise.all(
          dashboardMetricWidgets(selectedDashboard).map(async (widget): Promise<[string, MetricQueryPoint[]]> => {
            const result = await pulseService.query.metric(metricWidgetQuery(baseResult.data.id, selectedDashboard, widget, initialDashboardControlValues), user);
            return [widget.id, result.ok ? result.data : []];
          }),
        )
      : [];
  const dashboardEventEntries =
    selectedDashboard && (routeState.view === "dashboard" || routeState.view === "dashboard-edit")
      ? await Promise.all(
          dashboardEventsWidgets(selectedDashboard).map(async (widget): Promise<[string, PulseRecordedEvent[]]> => {
            const result = await pulseService.query.metricText({
              baseId: baseResult.data.id,
              query: widgetQueryText(widget, selectedDashboard, initialDashboardControlValues),
              user,
            });
            return [widget.id, result.ok ? result.data.events : []];
          }),
        )
      : [];
  const dashboardStateEntries =
    selectedDashboard && (routeState.view === "dashboard" || routeState.view === "dashboard-edit")
      ? await Promise.all(
          dashboardStatesWidgets(selectedDashboard).map(async (widget): Promise<[string, PulseCurrentState[]]> => {
            const result = await pulseService.query.metricText({
              baseId: baseResult.data.id,
              query: widgetQueryText(widget, selectedDashboard, initialDashboardControlValues),
              user,
            });
            return [widget.id, result.ok ? result.data.states : []];
          }),
        )
      : [];

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[{ title: "Start", href: "/" }, { title: "Pulse", href: "/app/pulse" }, { title: baseResult.data.name }]}
    >
      <PulseWorkspace
        initialBases={bases}
        initialCapabilities={capabilities}
        initialBaseId={baseResult.data.id}
        initialPath={url.pathname}
        initialSearch={url.search}
        initialRouteState={routeState}
        initialActivityQuery={initialActivityQuery}
        initialSources={sources}
        initialSourceScrapes={initialSourceScrapes}
        initialSourceApiKeys={initialSourceApiKeys}
        initialMetrics={metrics}
        initialInventory={inventory}
        initialActivityMetrics={activityMetrics}
        initialRecentEvents={eventsResult.ok ? eventsResult.data : []}
        initialCurrentStates={statesResult.ok ? statesResult.data : []}
        initialFocusedMetricSeries={focusedMetricSeries}
        initialFocusedEvents={focusedEvents}
        initialFocusedStates={focusedStates}
        initialFocusedHasMore={focusedHasMore}
        initialDashboards={dashboards}
        initialDashboardControlValues={initialDashboardControlValues}
        initialSavedQueries={savedQueriesResult.ok ? savedQueriesResult.data : []}
        initialMetricWidgetPoints={Object.fromEntries(metricWidgetPointEntries)}
        initialDashboardEvents={Object.fromEntries(dashboardEventEntries)}
        initialDashboardStates={Object.fromEntries(dashboardStateEntries)}
        initialExplorerDockState={explorerDockState}
        initialDashboardEditorDockState={dashboardEditorDockState}
        initialDateConfig={dateConfig}
        initialNow={new Date().toISOString()}
        initialOrigin={initialOrigin}
      />
    </Layout>
  );
});
