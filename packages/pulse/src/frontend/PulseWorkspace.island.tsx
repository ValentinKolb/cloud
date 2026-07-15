import { AppWorkspace, Panes, type PanesValue, toast } from "@valentinkolb/cloud/ui";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { createSignal } from "solid-js";
import type { MetricType, PulseDashboard, PulseDashboardConfig, PulseResourceSummary, PulseSource } from "../contracts";
import PulseLayoutHelp from "./PulseLayoutHelp";
import { createBaseController } from "./workspace/base-controller";
import DashboardEditorView from "./workspace/DashboardEditorView";
import DashboardView, { type DashboardRenderContext } from "./workspace/DashboardView";
import { createDashboardController } from "./workspace/dashboard-controller";
import {
  fetchDashboardEventsWidgetRows,
  fetchDashboardMetricWidgetPoints,
  fetchDashboardStatesWidgetRows,
} from "./workspace/dashboard-runtime";
import FocusedSignalView, { FocusedSignalDetail } from "./workspace/FocusedSignalView";
import {
  dashboardEventsWidgets,
  dashboardMetricWidgets,
  dashboardStatesWidgets,
  eventKindQueryText,
  metricSummaryQueryText,
  openQueryReferenceWindow,
  stateKeyQueryText,
} from "./workspace/helpers";
import { navigatePulseWorkspace, replacePulseWorkspaceUrl } from "./workspace/navigation";
import { installNearRealtimeController } from "./workspace/near-realtime-controller";
import PulseSidebar from "./workspace/PulseSidebar";
import {
  createQueryExplorerPanesValue,
  initialPulsePanesValue,
  persistPulsePanesValue,
  QUERY_EXPLORER_ELEMENT_IDS,
  QUERY_EXPLORER_PANES_KEY,
} from "./workspace/panes-state";
import { QueryHistoryPane, SavedQueriesPane } from "./workspace/QueryExplorerAuxPanes";
import QueryExplorerBrowsePane from "./workspace/QueryExplorerBrowsePane";
import QueryExplorerEditorPane from "./workspace/QueryExplorerEditorPane";
import QueryExplorerResultPane from "./workspace/QueryExplorerResultPane";
import { createQueryController } from "./workspace/query-controller";
import ResourceBrowserView from "./workspace/ResourceBrowserView";
import ResourceDetailView, { createResourceDetailSelection, ResourceSignalDetail } from "./workspace/ResourceDetailView";
import { signalCatalogKindForView } from "./workspace/SignalCatalogChrome";
import SignalCatalogView from "./workspace/SignalCatalogView";
import SourcesView, { SourcesDetailPanel } from "./workspace/SourcesView";
import { createSignalTableCellRenderers } from "./workspace/signal-table-cells";
import { createSourceController } from "./workspace/source-controller";
import {
  eventColumns,
  eventGroupColumns,
  metricColumns,
  metricSeriesColumns,
  stateColumns,
  stateGroupColumns,
} from "./workspace/table-columns";
import type { PulseWorkspaceProps, WorkspaceView } from "./workspace/types";
import { createWorkspaceDataController } from "./workspace/workspace-data-controller";
import { createWorkspaceDerivedModel } from "./workspace/workspace-derived-model";
import { installWorkspaceEffects } from "./workspace/workspace-effects";
import { createPulseWorkspaceState } from "./workspace/workspace-state";

export default function PulseWorkspace(props: PulseWorkspaceProps) {
  const state = createPulseWorkspaceState(props);
  const [explorerPanesValue, setExplorerPanesValue] = createSignal(
    initialPulsePanesValue(props.initialExplorerPanesValue, createQueryExplorerPanesValue(), QUERY_EXPLORER_ELEMENT_IDS),
  );
  const updateExplorerPanesValue = (value: PanesValue) => {
    setExplorerPanesValue(value);
    persistPulsePanesValue(QUERY_EXPLORER_PANES_KEY, value);
  };
  const {
    activeView,
    activityMetrics,
    activitySearch,
    bases,
    browseEntityId,
    browseSearch,
    browseSourceId,
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
    resourceSearch,
    resourceSourceFilter,
    resourceTypeFilter,
    savedQueries,
    selectedBaseId,
    selectedDashboardId,
    selectedMetric,
    selectedQuerySourceId,
    selectedResourceKey,
    selectedSourceId,
    selectedVisual,
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
    sourceSearch,
    sources,
    setSourceSearch,
  } = state;
  const {
    browseEvents,
    browseLabels,
    browseMetrics,
    browseSources,
    browseStates,
    browseVisibleEntities,
    compiledMetricQuery,
    compiledQuery,
    dashboardEditPreviewConfig,
    defaultQueryText,
    eventGroups,
    filteredResources,
    filteredSources,
    focusedMetric,
    matchingMetricSeries,
    matchingMetricSources,
    metricByName,
    metricScopeByName,
    previewSeries,
    previewUnit,
    pulseDateContext,
    queryCompletions,
    queryFilterSuggestions,
    querySuggestionMatches,
    querySuggestionOverflow,
    selectedBase,
    selectedBrowseEntity,
    selectedBrowseSource,
    selectedDashboard,
    selectedFocusedEvent,
    selectedFocusedSeries,
    selectedFocusedState,
    selectedResource,
    selectedResourceEvents,
    selectedResourceMetrics,
    selectedResourceStates,
    selectedSource,
    selectedSourceApiKeys,
    selectedSourceScrapes,
    sourceNameById,
    stateGroups,
    visibleQueryLabelSuggestions,
    visibleQuerySourceSuggestions,
    visibleSelectedResource,
  } = createWorkspaceDerivedModel(props, state);
  const resourceDetailSelection = createResourceDetailSelection({
    metrics: selectedResourceMetrics,
    states: selectedResourceStates,
    events: selectedResourceEvents,
  });
  const {
    loadActivity: loadActivityData,
    loadBase: loadBaseData,
    loadFocusedRows,
    loadSeries,
    loadSourceApiKeys,
    loadSourceScrapes,
    refreshResources: refreshResourceView,
  } = createWorkspaceDataController({
    selectedBaseId,
    activeView,
    activitySearch,
    metricTypeFilter,
    resourceSearch,
    resourceSourceFilter,
    resourceTypeFilter,
    selectedResourceKey,
    selectedMetric,
    selectedQuerySourceId,
    focusedSignalId,
    focusedSearch,
    focusedEvents,
    focusedMetricSeries,
    focusedStates,
    setSources,
    setMetrics,
    setInventory,
    setDashboards,
    setSavedQueries,
    setSelectedResourceKey,
    setSelectedMetric,
    setSelectedSourceId,
    setSelectedDashboardId,
    setRecentEvents,
    setCurrentStates,
    setActivityMetrics,
    setSeries,
    setSelectedSeriesId,
    setFocusedEvents,
    setFocusedMetricSeries,
    setFocusedStates,
    setFocusedHasMore,
    setFocusedLoadingMore,
    setSourceScrapes,
    setSourceApiKeys,
  });

  const refreshDashboardConfig = async (
    config: PulseDashboardConfig,
    dashboard = selectedDashboard(),
    baseId = selectedBaseId(),
    signal?: AbortSignal,
  ) => {
    if (!dashboard || !baseId) return;
    const controlValues = dashboardControlValues()[dashboard.id];
    await Promise.all([
      ...dashboardMetricWidgets(config).map((widget) =>
        fetchDashboardMetricWidgetPoints({ baseId, config, controlValues, dashboard, signal, widget })
          .then((points) => setMetricWidgetPoints((current) => ({ ...current, [widget.id]: points })))
          .catch(() => undefined),
      ),
      ...dashboardEventsWidgets(config).map((widget) =>
        fetchDashboardEventsWidgetRows({ baseId, config, controlValues, dashboard, signal, widget })
          .then((events) => setDashboardEvents((current) => ({ ...current, [widget.id]: events })))
          .catch(() => undefined),
      ),
      ...dashboardStatesWidgets(config).map((widget) =>
        fetchDashboardStatesWidgetRows({ baseId, config, controlValues, dashboard, signal, widget })
          .then((states) => setDashboardStates((current) => ({ ...current, [widget.id]: states })))
          .catch(() => undefined),
      ),
    ]);
  };

  const refreshDashboard = async (dashboard = selectedDashboard(), baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!dashboard) return;
    await refreshDashboardConfig(dashboard.config, dashboard, baseId, signal);
  };

  const navigateWorkspace = (
    nextState: { view: WorkspaceView; dashboardId?: string; sourceId?: string; signalId?: string },
    mode: "push" | "replace" = "push",
  ) => {
    const options = {
      baseId: selectedBaseId(),
      state: {
        ...nextState,
        signalId: nextState.signalId ?? focusedSignalId(),
      },
      activity: {
        q: activitySearch(),
        type: metricTypeFilter(),
      },
      resources: {
        q: resourceSearch(),
        sourceId: resourceSourceFilter(),
        type: resourceTypeFilter(),
      },
      focusedSearch: focusedSearch(),
    };
    if (mode === "replace") replacePulseWorkspaceUrl(options);
    else navigatePulseWorkspace(options);
  };

  const { openSettings: openSettingsDialog } = createBaseController({
    bases,
    selectedBase,
    loading,
    settingsDialogOpen,
    setLoading,
    setSettingsDialogOpen,
    setBases,
    setSelectedBaseId,
    setSelectedSourceId,
    setSelectedMetric,
    setSelectedDashboardId,
    setSelectedResourceKey,
    setRecentEvents,
    setCurrentStates,
    setActivityMetrics,
    setMetrics,
    setSeries,
    setSourceScrapes,
    setSourceApiKeys,
    setInventory,
    setSources,
    setDashboards,
    setSavedQueries,
    loadBaseData: (baseId) => loadBaseData(baseId),
    navigateToBase: (baseId) => navigatePulseWorkspace({ baseId, state: { view: "resources" } }),
  });

  const sourceController = createSourceController({
    selectedBaseId,
    loading,
    setLoading,
    setSources,
    setSelectedSourceId,
    setSourceApiKeys,
    navigate: (state) => navigateWorkspace(state),
    loadBaseData: (baseId) => loadBaseData(baseId),
    loadSourceScrapes: (baseId, sourceId) => loadSourceScrapes(baseId, sourceId),
    refreshDashboard: () => refreshDashboard(),
  });
  const { addSource, editSource, removeSource, scrape, toggleSource } = sourceController;

  const queryController = createQueryController({
    selectedBaseId,
    metrics,
    queryText,
    setQueryText,
    defaultQueryText,
    queryHistory,
    setQueryHistory,
    compiledQuery,
    explorerResultView,
    setExplorerResultView,
    setSelectedMetric,
    setSelectedAggregation,
    setSelectedBucket,
    setSelectedSince,
    setSelectedQuerySourceId,
    setPoints,
    setExplorerEvents,
    setExplorerStates,
    setQueryDiagnostics,
    setLastRunQuery,
    setQueryRunning,
    loading,
    setLoading,
    setSavedQueries,
    selectedVisual,
    browseSourceId,
    browseEntityId,
    openExplorer: () => openQueryExplorer(),
  });
  const {
    applyDimensionFilter: applyQueryDimensionFilter,
    applySourceFilter: applyQuerySourceFilter,
    copyDashboardWidget: copyDashboardWidgetSnippet,
    current: currentExplorerQuery,
    openEventQuery,
    openMetricQuery,
    openStateQuery,
    removeSaved: removeSavedQuery,
    run: runTextQuery,
    save: saveCurrentQuery,
    setEventBrowseQuery,
    setMetricBrowseQuery,
    setStateBrowseQuery,
  } = queryController;
  const dashboardController = createDashboardController({
    selectedBaseId,
    selectedDashboard,
    selectedDashboardId,
    dashboards,
    setDashboards,
    setSelectedDashboardId,
    loading,
    setLoading,
    origin,
    activeView,
    dashboardDslText,
    setDashboardDslText,
    dashboardDslDiagnostics,
    setDashboardDslDiagnostics,
    dashboardDslDiagnosticsText,
    setDashboardDslDiagnosticsText,
    dashboardPreviewConfig,
    setDashboardPreviewConfig,
    setDashboardDslSeededFor,
    setDashboardDslSaving,
    dashboardControlValues,
    setDashboardControlValues,
    navigate: (state) => navigateWorkspace(state),
    refreshDashboard: (dashboard) => refreshDashboard(dashboard),
    refreshDashboardConfig: (config, dashboard, baseId) => refreshDashboardConfig(config, dashboard, baseId),
  });
  const {
    compilePreview: compileDashboardDslPreview,
    createDashboard,
    openPublicDisplay: openPublicDashboardDisplayDialog,
    openSettings: openDashboardSettingsDialog,
    saveDsl: saveDashboardDsl,
    updateControl: updateDashboardControl,
  } = dashboardController;
  const dashboardRenderContext: DashboardRenderContext = {
    metricWidgetPoints,
    dashboardEvents,
    dashboardStates,
    metricByName,
    sourceNameById,
    sources,
    dashboardControlValues,
    dateContext: pulseDateContext,
    onControlChange: updateDashboardControl,
    onOpenPublicDisplay: (dashboard) => void openPublicDashboardDisplayDialog(dashboard),
  };

  const refreshSourcesView = async (baseId: string, signal: AbortSignal) => {
    await loadBaseData(baseId, signal);
    const source = selectedSource();
    if (!source) return;
    await loadSourceScrapes(baseId, source.id, signal);
    if (source.kind === "http_ingest") await loadSourceApiKeys(baseId, source.id, signal);
  };

  const refreshActivityView = async (baseId: string, signal: AbortSignal) => {
    await loadActivityData(baseId, signal);
  };

  const refreshDashboardView = async (baseId: string, signal: AbortSignal) => {
    await loadBaseData(baseId, signal);
    await refreshDashboard(selectedDashboard(), baseId, signal);
  };

  installNearRealtimeController({
    selectedBaseId,
    activeView,
    selectedDashboard,
    refreshSources: refreshSourcesView,
    refreshActivity: refreshActivityView,
    refreshDashboard: refreshDashboardView,
    refreshResources: refreshResourceView,
  });

  installWorkspaceEffects({
    selectedBaseId,
    activeView,
    selectedDashboard,
    origin,
    setOrigin,
    loadBaseData: () => loadBaseData(),
    setQueryHistory,
    dashboardControlValues,
    setDashboardControlValues,
    refreshDashboard: (dashboard) => refreshDashboard(dashboard),
    dashboardDslSeededFor,
    setDashboardDslText,
    setDashboardPreviewConfig,
    setDashboardDslDiagnostics,
    setDashboardDslDiagnosticsText,
    setDashboardDslSeededFor,
    dashboardDslText,
    compileDashboardDslPreview,
    querySeeded,
    queryText,
    metrics,
    setQueryText,
    setQuerySeeded,
    setQueryDiagnostics,
    currentExplorerQuery,
    runTextQuery,
    loadSeries,
    selectedMetric,
    selectedQuerySourceId,
    compiledMetricQuery,
    setSeries,
    setSelectedSeriesId,
    resourceSearch,
    resourceSourceFilter,
    resourceTypeFilter,
    selectedResourceKey,
    refreshResourceView,
    setInventory,
    activitySearch,
    metricTypeFilter,
    loadActivityData,
    setRecentEvents,
    setCurrentStates,
    setActivityMetrics,
    focusedSignalId,
    focusedSearch,
    loadFocusedRows,
    setFocusedHasMore,
    setFocusedMetricSeries,
    setFocusedStates,
    setFocusedEvents,
    selectedSource,
    loadSourceScrapes,
    loadSourceApiKeys,
    setSourceScrapes,
    setSourceApiKeys,
  });

  const openDashboard = (dashboardId: string) => {
    navigateWorkspace({ view: "dashboard", dashboardId });
  };

  const openDashboardEditor = (dashboardId = selectedDashboardId()) => {
    if (!dashboardId) return;
    navigateWorkspace({ view: "dashboard-edit", dashboardId });
  };

  const renderDashboardSidebarItem = (dashboard: PulseDashboard) => {
    return (
      <AppWorkspace.SidebarItem
        active={(activeView() === "dashboard" || activeView() === "dashboard-edit") && selectedDashboard()?.id === dashboard.id}
        title={dashboard.name}
        onClick={() => openDashboard(dashboard.id)}
      >
        <AppWorkspace.SidebarItemIcon icon="ti ti-chart-area-line" />
        <AppWorkspace.SidebarItemLabel>{dashboard.name}</AppWorkspace.SidebarItemLabel>
        <AppWorkspace.SidebarItemAction
          icon="ti ti-code"
          label={`Edit ${dashboard.name} dashboard DSL`}
          onSelect={() => openDashboardEditor(dashboard.id)}
        />
      </AppWorkspace.SidebarItem>
    );
  };

  const openSources = () => {
    const sourceId = sources().some((source) => source.id === selectedSourceId()) ? selectedSourceId() : "";
    setSelectedSourceId(sourceId);
    navigateWorkspace({ view: "sources", sourceId });
  };

  const selectSource = (source: PulseSource) => {
    setSelectedSourceId(source.id);
    navigateWorkspace({ view: "sources", sourceId: source.id });
  };

  const openQueryExplorer = () => navigateWorkspace({ view: "explorer" });
  const openResources = () => navigateWorkspace({ view: "resources" });
  const openResourceDetailView = (key: string) => {
    setSelectedResourceKey(key);
    navigateWorkspace({ view: "resource-detail", signalId: key });
  };
  const openActivityEvents = () => navigateWorkspace({ view: "activity-events" });
  const openActivityStates = () => navigateWorkspace({ view: "activity-states" });
  const openActivityMetrics = () => navigateWorkspace({ view: "activity-metrics" });
  const openMetricDetailView = (metric: string) => navigateWorkspace({ view: "metric-detail", signalId: metric });
  const openStateDetailView = (key: string) => navigateWorkspace({ view: "state-detail", signalId: key });
  const openEventDetailView = (kind: string) => navigateWorkspace({ view: "event-detail", signalId: kind });

  const replaceActivityUrl = () => {
    const view = activeView();
    if (view !== "activity-events" && view !== "activity-states" && view !== "activity-metrics") return;
    navigateWorkspace({ view }, "replace");
  };

  const replaceResourceUrl = () => {
    if (activeView() !== "resources") return;
    navigateWorkspace({ view: "resources" }, "replace");
  };

  const updateActivitySearch = (value: string) => {
    setActivitySearch(value);
    replaceActivityUrl();
  };

  const updateMetricTypeFilter = (value: string[]) => {
    setMetricTypeFilter((value[0] ?? "") as "" | MetricType);
    replaceActivityUrl();
  };

  const updateResourceSearch = (value: string) => {
    setResourceSearch(value);
    replaceResourceUrl();
  };

  const updateResourceSourceFilter = (value: string[]) => {
    setResourceSourceFilter(value[0] ?? "");
    replaceResourceUrl();
  };

  const updateResourceTypeFilter = (value: string[]) => {
    setResourceTypeFilter(value[0] ?? "");
    replaceResourceUrl();
  };

  const clearResourceFilters = () => {
    setResourceSourceFilter("");
    setResourceTypeFilter("");
    replaceResourceUrl();
  };

  const renderDashboardView = () => <DashboardView dashboard={selectedDashboard} context={dashboardRenderContext} />;

  const renderDashboardEditView = () => {
    return (
      <DashboardEditorView
        selectedBaseId={selectedBaseId}
        selectedDashboard={selectedDashboard}
        dashboardDslText={dashboardDslText}
        setDashboardDslText={setDashboardDslText}
        dashboardPreviewConfig={dashboardEditPreviewConfig}
        dashboardDslDiagnostics={dashboardDslDiagnostics}
        dashboardDslSaving={dashboardDslSaving}
        initialPanesValue={props.initialDashboardEditorPanesValue}
        sources={sources}
        inventory={inventory}
        metrics={metrics}
        savedQueries={savedQueries}
        renderContext={dashboardRenderContext}
        onSave={saveDashboardDsl}
        onOpenSettings={openDashboardSettingsDialog}
      />
    );
  };

  const signalCatalogTabs = () => [
    { kind: "events" as const, label: "Events", icon: "ti ti-bolt", count: eventGroups().length, open: openActivityEvents },
    { kind: "states" as const, label: "States", icon: "ti ti-toggle-right", count: stateGroups().length, open: openActivityStates },
    { kind: "metrics" as const, label: "Metrics", icon: "ti ti-chart-dots", count: activityMetrics().length, open: openActivityMetrics },
  ];

  const openSourceFromDetail = (sourceId: string | null | undefined) => {
    if (!sourceId) return;
    setSelectedSourceId(sourceId);
    navigateWorkspace({ view: "sources", sourceId });
  };

  const { renderEventCell, renderStateCell, renderMetricSeriesCell } = createSignalTableCellRenderers({
    sourceNameById,
    dateContext: pulseDateContext,
    metricUnit: () => focusedMetric()?.unit ?? null,
    openSource: openSourceFromDetail,
  });

  const resourceSourceLabel = (resource: PulseResourceSummary): string =>
    resource.sourceIds.map((sourceId) => sourceNameById().get(sourceId) ?? "Unknown source").join(", ") || "No source";

  const openSourceResources = (source: PulseSource) => {
    setResourceSearch("");
    setResourceSourceFilter(source.id);
    navigateWorkspace({ view: "resources" });
  };

  const sourcePublishedCounts = (sourceId: string) => ({
    resources: inventory().resources.filter((resource) => resource.sourceIds.includes(sourceId)).length,
    metricVariants: inventory().metrics.filter((metric) => metric.sourceId === sourceId).length,
    states: inventory().states.filter((state) => state.sourceId === sourceId).length,
    events: inventory().events.filter((event) => event.sourceId === sourceId).length,
  });

  const createSourceApiKey = sourceController.createApiKey;
  const revokeSourceApiKey = sourceController.revokeApiKey;

  const renderResourceBrowserView = () => (
    <ResourceBrowserView
      search={resourceSearch}
      setSearch={updateResourceSearch}
      sourceFilter={resourceSourceFilter}
      setSourceFilter={updateResourceSourceFilter}
      typeFilter={resourceTypeFilter}
      setTypeFilter={updateResourceTypeFilter}
      clearFilters={clearResourceFilters}
      inventory={inventory}
      filteredResources={filteredResources}
      selectedResource={visibleSelectedResource}
      dateContext={pulseDateContext()}
      openResource={openResourceDetailView}
      resourceSourceLabel={resourceSourceLabel}
      sourceNameById={sourceNameById}
    />
  );

  const renderResourceDetailView = () => {
    const resource = selectedResource();
    if (!resource) {
      return (
        <section class="paper flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-dimmed">
          Resource not found.
        </section>
      );
    }
    return (
      <ResourceDetailView
        resource={resource}
        metrics={selectedResourceMetrics()}
        states={selectedResourceStates()}
        events={selectedResourceEvents()}
        selection={resourceDetailSelection}
        dateContext={pulseDateContext()}
        sourceNameById={sourceNameById}
        openSource={openSourceFromDetail}
        openMetricQuery={openMetricQuery}
        openMetricVariants={openMetricDetailView}
        openStateQuery={openStateQuery}
        openStateVariants={openStateDetailView}
        openEventQuery={openEventQuery}
        openEventVariants={openEventDetailView}
      />
    );
  };

  const renderResourceSignalDetail = () => {
    const resource = selectedResource();
    if (!resource) return null;
    return (
      <ResourceSignalDetail
        resource={resource}
        metrics={selectedResourceMetrics()}
        states={selectedResourceStates()}
        events={selectedResourceEvents()}
        selection={resourceDetailSelection}
        dateContext={pulseDateContext()}
        sourceNameById={sourceNameById}
        openSource={openSourceFromDetail}
        openMetricQuery={openMetricQuery}
        openMetricVariants={openMetricDetailView}
        openStateQuery={openStateQuery}
        openStateVariants={openStateDetailView}
        openEventQuery={openEventQuery}
        openEventVariants={openEventDetailView}
      />
    );
  };

  const renderSourcesView = () => (
    <SourcesView
      search={sourceSearch}
      setSearch={setSourceSearch}
      selectedBaseId={selectedBaseId}
      loading={loading}
      sources={filteredSources}
      selectedSourceId={selectedSourceId}
      selectedSource={selectedSource}
      selectedSourceScrapes={selectedSourceScrapes}
      selectedSourceApiKeys={selectedSourceApiKeys}
      origin={origin}
      dateContext={pulseDateContext}
      publishedCounts={sourcePublishedCounts}
      copySetupText={copySetupText}
      addSource={addSource}
      selectSource={selectSource}
      closeSource={() => {
        setSelectedSourceId("");
        navigateWorkspace({ view: "sources" });
      }}
      openSourceResources={openSourceResources}
      editSource={editSource}
      toggleSource={toggleSource}
      scrape={scrape}
      removeSource={removeSource}
      createApiKey={createSourceApiKey}
      revokeApiKey={revokeSourceApiKey}
    />
  );

  const renderSourcesDetail = () => (
    <SourcesDetailPanel
      search={sourceSearch}
      setSearch={setSourceSearch}
      selectedBaseId={selectedBaseId}
      loading={loading}
      sources={filteredSources}
      selectedSourceId={selectedSourceId}
      selectedSource={selectedSource}
      selectedSourceScrapes={selectedSourceScrapes}
      selectedSourceApiKeys={selectedSourceApiKeys}
      origin={origin}
      dateContext={pulseDateContext}
      publishedCounts={sourcePublishedCounts}
      copySetupText={copySetupText}
      addSource={addSource}
      selectSource={selectSource}
      closeSource={() => {
        setSelectedSourceId("");
        navigateWorkspace({ view: "sources" });
      }}
      openSourceResources={openSourceResources}
      editSource={editSource}
      toggleSource={toggleSource}
      scrape={scrape}
      removeSource={removeSource}
      createApiKey={createSourceApiKey}
      revokeApiKey={revokeSourceApiKey}
    />
  );

  const openFocusedSignalQuery = () => {
    const view = activeView();
    const signalId = focusedSignalId();
    if (view === "metric-detail") {
      const metric = focusedMetric();
      if (metric) {
        setQueryText(metricSummaryQueryText(metric));
        openQueryExplorer();
        return;
      }
    }
    if (view === "state-detail") setQueryText(stateKeyQueryText(signalId));
    else setQueryText(eventKindQueryText(signalId));
    openQueryExplorer();
  };

  const closeFocusedSignalDetail = () => {
    if (activeView() === "metric-detail") setSelectedFocusedSeriesId("");
    if (activeView() === "state-detail") setSelectedFocusedStateId("");
    if (activeView() === "event-detail") setSelectedFocusedEventId("");
  };

  const renderFocusedSignalView = () => (
    <FocusedSignalView
      view={activeView}
      signalId={focusedSignalId}
      focusedMetric={focusedMetric}
      metricSeries={focusedMetricSeries}
      states={focusedStates}
      events={focusedEvents}
      hasMore={focusedHasMore}
      loadingMore={focusedLoadingMore}
      search={focusedSearch}
      setSearch={setFocusedSearch}
      selectedSeries={selectedFocusedSeries}
      selectedState={selectedFocusedState}
      selectedEvent={selectedFocusedEvent}
      setSelectedSeriesId={setSelectedFocusedSeriesId}
      setSelectedStateId={setSelectedFocusedStateId}
      setSelectedEventId={setSelectedFocusedEventId}
      metricSeriesColumns={metricSeriesColumns}
      stateColumns={stateColumns}
      eventColumns={eventColumns}
      renderMetricSeriesCell={renderMetricSeriesCell}
      renderStateCell={renderStateCell}
      renderEventCell={renderEventCell}
      loadRows={loadFocusedRows}
      onOpenQuery={openFocusedSignalQuery}
      sourceNameById={sourceNameById}
      dateContext={pulseDateContext}
      openSource={openSourceFromDetail}
      closeDetail={closeFocusedSignalDetail}
    />
  );

  const renderFocusedSignalDetail = () => (
    <FocusedSignalDetail
      view={activeView}
      signalId={focusedSignalId}
      focusedMetric={focusedMetric}
      metricSeries={focusedMetricSeries}
      states={focusedStates}
      events={focusedEvents}
      hasMore={focusedHasMore}
      loadingMore={focusedLoadingMore}
      search={focusedSearch}
      setSearch={setFocusedSearch}
      selectedSeries={selectedFocusedSeries}
      selectedState={selectedFocusedState}
      selectedEvent={selectedFocusedEvent}
      setSelectedSeriesId={setSelectedFocusedSeriesId}
      setSelectedStateId={setSelectedFocusedStateId}
      setSelectedEventId={setSelectedFocusedEventId}
      metricSeriesColumns={metricSeriesColumns}
      stateColumns={stateColumns}
      eventColumns={eventColumns}
      renderMetricSeriesCell={renderMetricSeriesCell}
      renderStateCell={renderStateCell}
      renderEventCell={renderEventCell}
      loadRows={loadFocusedRows}
      onOpenQuery={openFocusedSignalQuery}
      sourceNameById={sourceNameById}
      dateContext={pulseDateContext}
      openSource={openSourceFromDetail}
      closeDetail={closeFocusedSignalDetail}
    />
  );

  const renderQueryEditorPane = () => (
    <QueryExplorerEditorPane
      queryText={queryText}
      onQueryInput={setQueryText}
      completions={queryCompletions}
      diagnostics={queryDiagnostics}
      running={queryRunning}
      compiledMetricQuery={compiledMetricQuery}
      matchingSeriesCount={() => matchingMetricSeries().length}
      matchingSourcesCount={() => matchingMetricSources().length}
      filterSuggestionCount={() => queryFilterSuggestions().length}
      suggestionsExpanded={querySuggestionsExpanded}
      setSuggestionsExpanded={setQuerySuggestionsExpanded}
      suggestionSearch={querySuggestionSearch}
      setSuggestionSearch={setQuerySuggestionSearch}
      visibleSourceSuggestions={visibleQuerySourceSuggestions}
      visibleLabelSuggestions={visibleQueryLabelSuggestions}
      suggestionMatches={querySuggestionMatches}
      suggestionOverflow={querySuggestionOverflow}
      canRun={() => Boolean(currentExplorerQuery())}
      canOpenReference={() => Boolean(selectedBaseId())}
      onRun={() => void runTextQuery({ manual: true, remember: true })}
      onOpenReference={() => openQueryReferenceWindow(selectedBaseId())}
      onApplySourceFilter={applyQuerySourceFilter}
      onApplyDimensionFilter={applyQueryDimensionFilter}
    />
  );

  const renderExplorerResultPane = () => (
    <QueryExplorerResultPane
      compiled={compiledQuery}
      resultView={explorerResultView}
      setResultView={setExplorerResultView}
      visual={selectedVisual}
      setVisual={setSelectedVisual}
      points={points}
      events={explorerEvents}
      states={explorerStates}
      eventColumns={eventColumns}
      stateColumns={stateColumns}
      renderEventCell={renderEventCell}
      renderStateCell={renderStateCell}
      queryWasRun={() => lastRunQuery() === currentExplorerQuery()}
      previewTitle={() => compiledMetricQuery()?.metric ?? (selectedMetric() || "Query")}
      previewUnit={previewUnit}
      previewSeries={previewSeries}
      dateContext={pulseDateContext}
      onCopyWidgetSnippet={copyDashboardWidgetSnippet}
    />
  );

  const renderBrowseExplorerPane = () => (
    <QueryExplorerBrowsePane
      search={browseSearch}
      onSearchInput={setBrowseSearch}
      selectedSource={selectedBrowseSource}
      selectedEntity={selectedBrowseEntity}
      sourceId={browseSourceId}
      sources={browseSources}
      entities={browseVisibleEntities}
      metrics={browseMetrics}
      events={browseEvents}
      states={browseStates}
      labels={browseLabels}
      onClearSourceScope={() => setBrowseSourceId("")}
      onClearEntityScope={() => setBrowseEntityId("")}
      onSelectSource={setBrowseSourceId}
      onSelectEntity={setBrowseEntityId}
      onMetricQuery={setMetricBrowseQuery}
      onEventQuery={setEventBrowseQuery}
      onStateQuery={setStateBrowseQuery}
      onApplySourceFilter={applyQuerySourceFilter}
      onApplyDimensionFilter={applyQueryDimensionFilter}
    />
  );

  const renderMetricExplorerView = () => (
    <section class="flex min-h-0 flex-1 overflow-hidden pb-2">
      <Panes.Root value={explorerPanesValue()} onChange={updateExplorerPanesValue} class="h-full min-h-0 w-full">
        <Panes.Element id="result" title="Result" icon="ti ti-chart-line">
          {renderExplorerResultPane()}
        </Panes.Element>
        <Panes.Element id="editor" title="Query" icon="ti ti-code">
          {renderQueryEditorPane()}
        </Panes.Element>
        <Panes.Element id="browse" title="Browse" icon="ti ti-list-search">
          {renderBrowseExplorerPane()}
        </Panes.Element>
        <Panes.Element id="saved" title="Saved" icon="ti ti-device-floppy">
          <SavedQueriesPane
            queries={savedQueries}
            currentQuery={currentExplorerQuery}
            loading={loading}
            onSelect={setQueryText}
            onSaveCurrent={saveCurrentQuery}
            onRemove={removeSavedQuery}
          />
        </Panes.Element>
        <Panes.Element id="history" title="History" icon="ti ti-history">
          <QueryHistoryPane history={queryHistory} dateContext={pulseDateContext} onSelect={setQueryText} />
        </Panes.Element>
      </Panes.Root>
    </section>
  );

  const renderSignalCatalogView = () => (
    <SignalCatalogView
      kind={signalCatalogKindForView(activeView())}
      tabs={signalCatalogTabs()}
      search={activitySearch}
      metricTypeFilter={metricTypeFilter}
      onSearch={updateActivitySearch}
      onMetricTypeFilter={updateMetricTypeFilter}
      eventGroups={eventGroups}
      stateGroups={stateGroups}
      metrics={activityMetrics}
      eventColumns={eventGroupColumns}
      stateColumns={stateGroupColumns}
      metricColumns={metricColumns}
      metricScopeByName={metricScopeByName}
      sourceNameById={sourceNameById}
      dateContext={pulseDateContext}
      openEventDetail={openEventDetailView}
      openStateDetail={openStateDetailView}
      openMetricDetail={openMetricDetailView}
      openSource={openSourceFromDetail}
    />
  );

  const copySetupText = async (text: string, label: string) => {
    await clipboard.copy(text);
    toast.success(label);
  };

  const workspaceDetailOpen = () => {
    if (activeView() === "sources") return selectedSource() !== null;
    if (activeView() === "resource-detail") return resourceDetailSelection.open();
    if (activeView() === "metric-detail") return selectedFocusedSeries() !== null;
    if (activeView() === "state-detail") return selectedFocusedState() !== null;
    if (activeView() === "event-detail") return selectedFocusedEvent() !== null;
    return false;
  };

  const renderWorkspaceDetail = () => {
    if (activeView() === "sources") return renderSourcesDetail();
    if (activeView() === "resource-detail") return renderResourceSignalDetail();
    if (activeView() === "metric-detail" || activeView() === "state-detail" || activeView() === "event-detail") {
      return renderFocusedSignalDetail();
    }
    return null;
  };

  return (
    <AppWorkspace class={`cloud-ui-soft ${activeView() === "explorer" ? "min-h-0" : "min-h-[760px]"}`}>
      <PulseLayoutHelp />
      <PulseSidebar
        title={selectedBase()?.name ?? "Pulse"}
        subtitle={`${sources().length} source${sources().length === 1 ? "" : "s"} · ${metrics().length} metric${metrics().length === 1 ? "" : "s"}`}
        activeView={activeView()}
        dashboards={dashboards()}
        resourceCount={inventory().resources.length}
        sourceCount={sources().length}
        eventCount={eventGroups().length}
        stateCount={stateGroups().length}
        metricCount={metrics().length}
        settingsDisabled={!selectedBase() || loading()}
        openSettings={openSettingsDialog}
        createDashboard={createDashboard}
        openDashboard={openDashboard}
        renderDashboardItem={renderDashboardSidebarItem}
        openResources={openResources}
        openSources={openSources}
        openQueryExplorer={openQueryExplorer}
        openActivityEvents={openActivityEvents}
        openActivityStates={openActivityStates}
        openActivityMetrics={openActivityMetrics}
      />

      <AppWorkspace.Content>
        <AppWorkspace.Main
          class={`p-[var(--ui-space-shell)] ${activeView() === "explorer" ? "gap-2 overflow-hidden" : "gap-2 overflow-y-auto"}`}
        >
          {activeView() === "dashboard"
            ? renderDashboardView()
            : activeView() === "dashboard-edit"
              ? renderDashboardEditView()
              : activeView() === "sources"
                ? renderSourcesView()
                : activeView() === "resources"
                  ? renderResourceBrowserView()
                  : activeView() === "resource-detail"
                    ? renderResourceDetailView()
                    : activeView() === "metric-detail" || activeView() === "state-detail" || activeView() === "event-detail"
                      ? renderFocusedSignalView()
                      : activeView() === "explorer"
                        ? renderMetricExplorerView()
                        : renderSignalCatalogView()}
        </AppWorkspace.Main>

        <AppWorkspace.Detail id="pulse-detail-panel" open={workspaceDetailOpen()} width="lg" viewTransitionName="pulse-detail-panel-shell">
          {renderWorkspaceDetail()}
        </AppWorkspace.Detail>
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
