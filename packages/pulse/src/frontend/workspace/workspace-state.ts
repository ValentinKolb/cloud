import type { ResourceApiKey } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";
import type {
  Aggregation,
  MetricQueryPoint,
  MetricType,
  PanelVisual,
  PulseCurrentState,
  PulseDashboardConfig,
  PulseDashboardDslCompileResult,
  PulseInventory,
  PulseMetricSeries,
  PulseMetricSummary,
  PulseQueryCompileResult,
  PulseRecordedEvent,
  PulseSource,
  PulseSourceScrape,
} from "../../contracts";
import { readQueryHistory } from "./query-history";
import { readActivityQueryState, readResourceQueryState } from "./routes";
import type { ExplorerResultView, PulseWorkspaceProps, WorkspaceView } from "./types";

export const createPulseWorkspaceState = (props: PulseWorkspaceProps) => {
  const initialBaseId = props.initialBaseId ?? props.initialBases[0]?.id ?? "";
  const initialRouteState = props.initialRouteState ?? {
    view: "resources" as const,
    dashboardId: "",
    sourceId: "",
    signalId: "",
  };
  const initialDashboardId =
    props.initialDashboards?.find((dashboard) => dashboard.id === initialRouteState.dashboardId)?.id ??
    props.initialDashboards?.[0]?.id ??
    initialRouteState.dashboardId;
  const initialActivityQuery = props.initialActivityQuery ?? readActivityQueryState(props.initialSearch ?? "");
  const initialResourceQuery = props.initialResourceQuery ?? readResourceQueryState(props.initialSearch ?? "");
  const initialFocusedSearch = new URLSearchParams(props.initialSearch ?? "").get("q")?.trim() ?? "";

  const [bases, setBases] = createSignal(props.initialBases);
  const [selectedBaseId, setSelectedBaseId] = createSignal(initialBaseId);
  const [sources, setSources] = createSignal<PulseSource[]>(props.initialSources ?? []);
  const [sourceScrapes, setSourceScrapes] = createSignal<Record<string, PulseSourceScrape[]>>(props.initialSourceScrapes ?? {});
  const [sourceApiKeys, setSourceApiKeys] = createSignal<Record<string, ResourceApiKey[]>>(props.initialSourceApiKeys ?? {});
  const [sourceSearch, setSourceSearch] = createSignal("");
  const [metrics, setMetrics] = createSignal<PulseMetricSummary[]>(props.initialMetrics ?? []);
  const [inventory, setInventory] = createSignal<PulseInventory>(
    props.initialInventory ?? { resources: [], metrics: [], events: [], states: [], fields: [] },
  );
  const [resourceSearch, setResourceSearch] = createSignal(initialResourceQuery.q);
  const [resourceSourceFilter, setResourceSourceFilter] = createSignal(initialResourceQuery.sourceId);
  const [resourceTypeFilter, setResourceTypeFilter] = createSignal(initialResourceQuery.type);
  const [selectedResourceKey, setSelectedResourceKey] = createSignal(
    initialRouteState.view === "resource-detail" ? initialRouteState.signalId : (props.initialInventory?.resources[0]?.key ?? ""),
  );
  const [activityMetrics, setActivityMetrics] = createSignal<PulseMetricSummary[]>(props.initialActivityMetrics ?? []);
  const [series, setSeries] = createSignal<PulseMetricSeries[]>(props.initialSeries ?? []);
  const [recentEvents, setRecentEvents] = createSignal<PulseRecordedEvent[]>(props.initialRecentEvents ?? []);
  const [currentStates, setCurrentStates] = createSignal<PulseCurrentState[]>(props.initialCurrentStates ?? []);
  const [dashboards, setDashboards] = createSignal(props.initialDashboards ?? []);
  const [savedQueries, setSavedQueries] = createSignal(props.initialSavedQueries ?? []);
  const [selectedDashboardId, setSelectedDashboardId] = createSignal(initialDashboardId);
  const [activeView] = createSignal<WorkspaceView>(initialRouteState.view);
  const [selectedMetric, setSelectedMetric] = createSignal(props.initialMetrics?.[0]?.name ?? "");
  const [selectedSourceId, setSelectedSourceId] = createSignal(initialRouteState.sourceId);
  const [selectedQuerySourceId, setSelectedQuerySourceId] = createSignal("");
  const [activitySearch, setActivitySearch] = createSignal(initialActivityQuery.q);
  const [metricTypeFilter, setMetricTypeFilter] = createSignal<"" | MetricType>(initialActivityQuery.type);
  const [focusedSignalId] = createSignal(initialRouteState.signalId);
  const [focusedSearch, setFocusedSearch] = createSignal(initialFocusedSearch);
  const [focusedMetricSeries, setFocusedMetricSeries] = createSignal<PulseMetricSeries[]>(props.initialFocusedMetricSeries ?? []);
  const [focusedEvents, setFocusedEvents] = createSignal<PulseRecordedEvent[]>(props.initialFocusedEvents ?? []);
  const [focusedStates, setFocusedStates] = createSignal<PulseCurrentState[]>(props.initialFocusedStates ?? []);
  const [focusedHasMore, setFocusedHasMore] = createSignal(props.initialFocusedHasMore ?? false);
  const [focusedLoadingMore, setFocusedLoadingMore] = createSignal(false);
  const [selectedFocusedSeriesId, setSelectedFocusedSeriesId] = createSignal("");
  const [selectedFocusedStateId, setSelectedFocusedStateId] = createSignal("");
  const [selectedFocusedEventId, setSelectedFocusedEventId] = createSignal("");
  const [selectedSeriesId, setSelectedSeriesId] = createSignal("");
  const [selectedVisual, setSelectedVisual] = createSignal<PanelVisual>("line");
  const [selectedAggregation, setSelectedAggregation] = createSignal<Aggregation>("avg");
  const [selectedBucket, setSelectedBucket] = createSignal("5m");
  const [selectedSince, setSelectedSince] = createSignal("24h");
  const [queryText, setQueryText] = createSignal("");
  const [lastRunQuery, setLastRunQuery] = createSignal("");
  const [queryDiagnostics, setQueryDiagnostics] = createSignal<PulseQueryCompileResult | null>(null);
  const [queryHistory, setQueryHistory] = createSignal(readQueryHistory(initialBaseId));
  const [querySeeded, setQuerySeeded] = createSignal(false);
  const [querySuggestionsExpanded, setQuerySuggestionsExpanded] = createSignal(false);
  const [querySuggestionSearch, setQuerySuggestionSearch] = createSignal("");
  const [browseSearch, setBrowseSearch] = createSignal("");
  const [browseSourceId, setBrowseSourceId] = createSignal("");
  const [browseEntityId, setBrowseEntityId] = createSignal("");
  const [explorerResultView, setExplorerResultView] = createSignal<ExplorerResultView>("chart");
  const [points, setPoints] = createSignal<MetricQueryPoint[]>([]);
  const [explorerEvents, setExplorerEvents] = createSignal<PulseRecordedEvent[]>([]);
  const [explorerStates, setExplorerStates] = createSignal<PulseCurrentState[]>([]);
  const [queryRunning, setQueryRunning] = createSignal(false);
  const [metricWidgetPoints, setMetricWidgetPoints] = createSignal<Record<string, MetricQueryPoint[]>>(
    props.initialMetricWidgetPoints ?? {},
  );
  const [dashboardEvents, setDashboardEvents] = createSignal<Record<string, PulseRecordedEvent[]>>(props.initialDashboardEvents ?? {});
  const [dashboardStates, setDashboardStates] = createSignal<Record<string, PulseCurrentState[]>>(props.initialDashboardStates ?? {});
  const [dashboardControlValues, setDashboardControlValues] = createSignal<Record<string, Record<string, string>>>(
    initialDashboardId && Object.keys(props.initialDashboardControlValues ?? {}).length
      ? { [initialDashboardId]: props.initialDashboardControlValues ?? {} }
      : {},
  );
  const [dashboardDslText, setDashboardDslText] = createSignal("");
  const [dashboardDslDiagnostics, setDashboardDslDiagnostics] = createSignal<PulseDashboardDslCompileResult | null>(null);
  const [dashboardDslDiagnosticsText, setDashboardDslDiagnosticsText] = createSignal("");
  const [dashboardPreviewConfig, setDashboardPreviewConfig] = createSignal<PulseDashboardConfig | null>(null);
  const [dashboardDslSeededFor, setDashboardDslSeededFor] = createSignal("");
  const [dashboardDslSaving, setDashboardDslSaving] = createSignal(false);
  const [origin, setOrigin] = createSignal(props.initialOrigin ?? "");
  const [loading, setLoading] = createSignal(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = createSignal(false);

  return {
    activeView,
    activityMetrics,
    activitySearch,
    bases,
    browseEntityId,
    browseSearch,
    browseSourceId,
    currentStates,
    dashboardControlValues,
    dashboardDslDiagnostics,
    dashboardDslDiagnosticsText,
    dashboardDslSaving,
    dashboardDslSeededFor,
    dashboardDslText,
    dashboardEvents,
    dashboardPreviewConfig,
    dashboards,
    dashboardStates,
    explorerEvents,
    explorerResultView,
    explorerStates,
    focusedEvents,
    focusedHasMore,
    focusedLoadingMore,
    focusedMetricSeries,
    focusedSearch,
    focusedSignalId,
    focusedStates,
    inventory,
    lastRunQuery,
    loading,
    metricTypeFilter,
    metricWidgetPoints,
    metrics,
    origin,
    points,
    queryDiagnostics,
    queryHistory,
    queryRunning,
    querySeeded,
    querySuggestionSearch,
    querySuggestionsExpanded,
    queryText,
    recentEvents,
    resourceSearch,
    resourceSourceFilter,
    resourceTypeFilter,
    savedQueries,
    selectedAggregation,
    selectedBaseId,
    selectedBucket,
    selectedDashboardId,
    selectedFocusedEventId,
    selectedFocusedSeriesId,
    selectedFocusedStateId,
    selectedMetric,
    selectedQuerySourceId,
    selectedResourceKey,
    selectedSeriesId,
    selectedSince,
    selectedSourceId,
    selectedVisual,
    series,
    setActivityMetrics,
    setActivitySearch,
    setBases,
    setBrowseEntityId,
    setBrowseSearch,
    setBrowseSourceId,
    setCurrentStates,
    setDashboardControlValues,
    setDashboardDslDiagnostics,
    setDashboardDslDiagnosticsText,
    setDashboardDslSaving,
    setDashboardDslSeededFor,
    setDashboardDslText,
    setDashboardEvents,
    setDashboardPreviewConfig,
    setDashboards,
    setDashboardStates,
    setExplorerEvents,
    setExplorerResultView,
    setExplorerStates,
    setFocusedEvents,
    setFocusedHasMore,
    setFocusedLoadingMore,
    setFocusedMetricSeries,
    setFocusedSearch,
    setFocusedStates,
    setInventory,
    setLastRunQuery,
    setLoading,
    setMetricTypeFilter,
    setMetricWidgetPoints,
    setMetrics,
    setOrigin,
    setPoints,
    setQueryDiagnostics,
    setQueryHistory,
    setQueryRunning,
    setQuerySeeded,
    setQuerySuggestionSearch,
    setQuerySuggestionsExpanded,
    setQueryText,
    setRecentEvents,
    setResourceSearch,
    setResourceSourceFilter,
    setResourceTypeFilter,
    setSavedQueries,
    setSelectedAggregation,
    setSelectedBaseId,
    setSelectedBucket,
    setSelectedDashboardId,
    setSelectedFocusedEventId,
    setSelectedFocusedSeriesId,
    setSelectedFocusedStateId,
    setSelectedMetric,
    setSelectedQuerySourceId,
    setSelectedResourceKey,
    setSelectedSeriesId,
    setSelectedSince,
    setSelectedSourceId,
    setSelectedVisual,
    setSeries,
    setSourceApiKeys,
    setSourceScrapes,
    setSources,
    setSettingsDialogOpen,
    settingsDialogOpen,
    sourceApiKeys,
    sourceScrapes,
    sourceSearch,
    sources,
    setSourceSearch,
  };
};
