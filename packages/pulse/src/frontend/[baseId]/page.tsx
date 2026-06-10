import { Layout } from "@valentinkolb/cloud/ssr";
import type { AuthContext } from "@valentinkolb/cloud/server";
import type {
  MetricQuery,
  MetricQueryPoint,
  MetricType,
  PulseDashboard,
  PulseDashboardMetricWidget,
  PulseDashboardPanel,
  PulseDashboardSection,
  PulseDashboardWidget,
} from "../../contracts";
import { ssr } from "../../config";
import { pulseService } from "../../service";
import PulseWorkspace from "../PulseWorkspace.island";

type WorkspaceView = "dashboard" | "dashboard-edit" | "sources" | "explorer" | "activity-events" | "activity-states" | "activity-metrics";

type WorkspaceRouteState = {
  view: WorkspaceView;
  dashboardId: string;
  sourceId: string;
};

const readWorkspacePathState = (path: string, baseId: string): WorkspaceRouteState => {
  const fallback: WorkspaceRouteState = { view: "dashboard", dashboardId: "", sourceId: "" };
  if (!baseId) return fallback;
  const marker = `/app/pulse/${baseId}`;
  const start = path.indexOf(marker);
  if (start < 0) return fallback;
  const rest = path
    .slice(start + marker.length)
    .split("/")
    .filter(Boolean);
  if (rest[0] === "dashboards") return { view: rest[2] === "edit" ? "dashboard-edit" : "dashboard", dashboardId: rest[1] ?? "", sourceId: "" };
  if (rest[0] === "sources") return { view: "sources", dashboardId: "", sourceId: rest[1] ?? "" };
  if (rest[0] === "explorer" || rest[0] === "metric-explorer") return { view: "explorer", dashboardId: "", sourceId: "" };
  if (rest[0] === "activity" && rest[1] === "states") return { view: "activity-states", dashboardId: "", sourceId: "" };
  if (rest[0] === "activity" && rest[1] === "metrics") return { view: "activity-metrics", dashboardId: "", sourceId: "" };
  if (rest[0] === "activity") return { view: "activity-events", dashboardId: "", sourceId: "" };
  return fallback;
};

const dashboardWidgetDescendants = (widget: PulseDashboardWidget): PulseDashboardWidget[] =>
  widget.kind === "card" ? [widget, ...widget.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants))] : [widget];

const dashboardSectionWidgets = (section: PulseDashboardSection): PulseDashboardWidget[] => [
  ...section.rows.flatMap((row) => row.cells.flatMap(dashboardWidgetDescendants)),
  ...(section.sections ?? []).flatMap(dashboardSectionWidgets),
];

const dashboardMetricPanels = (dashboard: PulseDashboard): PulseDashboardPanel[] => [
  ...dashboard.config.panels,
  ...(dashboard.config.layout?.sections
    .flatMap(dashboardSectionWidgets)
    .filter((widget): widget is PulseDashboardMetricWidget => widget.kind === "metric") ?? []),
];

const panelQuery = (baseId: string, panel: PulseDashboardPanel): MetricQuery => ({
  kind: "metric",
  baseId,
  metric: panel.metric,
  aggregation: panel.aggregation,
  bucket: panel.bucket,
  since: panel.since,
  sourceId: panel.sourceId ?? null,
  dimensions: panel.dimensions ?? undefined,
});

const defaultMetricAggregation = (type: MetricType): MetricQuery["aggregation"] => {
  if (type === "counter") return "rate";
  if (type === "histogram" || type === "summary") return "p95";
  return "latest";
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);
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
  const activityType = url.searchParams.get("type");
  const activityQuery: { q?: string; type?: MetricType } = {
    q: url.searchParams.get("q")?.trim() || undefined,
    type:
      activityType === "gauge" || activityType === "counter" || activityType === "histogram" || activityType === "summary"
        ? activityType
        : undefined,
  };
  const [sourcesResult, metricsResult, activityMetricsResult, dashboardsResult, savedQueriesResult, eventsResult, statesResult] =
    await Promise.all([
      pulseService.source.list(baseResult.data.id, user),
      pulseService.query.metrics(baseResult.data.id, user, {}),
      pulseService.query.metrics(baseResult.data.id, user, activityQuery),
      pulseService.dashboard.list(baseResult.data.id, user),
      pulseService.savedQuery.list(baseResult.data.id, user),
      pulseService.query.recentEvents(baseResult.data.id, user, { q: activityQuery.q }),
      pulseService.query.currentStates(baseResult.data.id, user, { q: activityQuery.q }),
    ]);
  const sources = sourcesResult.ok ? sourcesResult.data : [];
  const metrics = metricsResult.ok ? metricsResult.data : [];
  const activityMetrics = activityMetricsResult.ok ? activityMetricsResult.data : [];
  const dashboards = dashboardsResult.ok ? dashboardsResult.data : [];
  const selectedDashboard = dashboards.find((dashboard) => dashboard.id === routeState.dashboardId) ?? dashboards[0] ?? null;
  const selectedSource = sources.find((source) => source.id === routeState.sourceId) ?? null;
  const selectedActivityMetricName = url.searchParams.get("metric") ?? "";
  const selectedActivityMetric = activityMetrics.find((metric) => metric.name === selectedActivityMetricName) ?? null;
  const [selectedSourceScrapesResult, selectedSourceTokensResult, selectedActivityMetricSeriesResult, selectedActivityMetricPointsResult] =
    await Promise.all([
      selectedSource ? pulseService.source.scrapes({ baseId: baseResult.data.id, sourceId: selectedSource.id, user }) : Promise.resolve(null),
      selectedSource?.kind === "http_ingest"
        ? pulseService.source.tokens.list({ baseId: baseResult.data.id, sourceId: selectedSource.id, user })
        : Promise.resolve(null),
      selectedActivityMetric ? pulseService.query.series(baseResult.data.id, user, { metric: selectedActivityMetric.name }) : Promise.resolve(null),
      selectedActivityMetric
        ? pulseService.query.metric(
            {
              kind: "metric",
              baseId: baseResult.data.id,
              metric: selectedActivityMetric.name,
              aggregation: defaultMetricAggregation(selectedActivityMetric.type),
              bucket: selectedActivityMetric.type === "gauge" ? "1m" : "5m",
              since: "24h",
            },
            user,
          )
        : Promise.resolve(null),
    ]);
  const initialSourceScrapes = selectedSourceScrapesResult?.ok && selectedSource ? { [selectedSource.id]: selectedSourceScrapesResult.data } : {};
  const initialSourceTokens = selectedSourceTokensResult?.ok && selectedSource ? { [selectedSource.id]: selectedSourceTokensResult.data } : {};
  const panelPointsEntries =
    selectedDashboard && (routeState.view === "dashboard" || routeState.view === "dashboard-edit")
      ? await Promise.all(
          dashboardMetricPanels(selectedDashboard).map(async (panel): Promise<[string, MetricQueryPoint[]]> => {
            const result = await pulseService.query.metric(panelQuery(baseResult.data.id, panel), user);
            return [panel.id, result.ok ? result.data : []];
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
        initialSources={sources}
        initialSourceScrapes={initialSourceScrapes}
        initialSourceTokens={initialSourceTokens}
        initialMetrics={metrics}
        initialActivityMetrics={activityMetrics}
        initialRecentEvents={eventsResult.ok ? eventsResult.data : []}
        initialCurrentStates={statesResult.ok ? statesResult.data : []}
        initialActivityMetricSeries={selectedActivityMetricSeriesResult?.ok ? selectedActivityMetricSeriesResult.data : []}
        initialActivityMetricPoints={selectedActivityMetricPointsResult?.ok ? selectedActivityMetricPointsResult.data : []}
        initialDashboards={dashboards}
        initialSavedQueries={savedQueriesResult.ok ? savedQueriesResult.data : []}
        initialPanelPoints={Object.fromEntries(panelPointsEntries)}
      />
    </Layout>
  );
});
