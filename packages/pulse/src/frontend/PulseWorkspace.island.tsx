import {
  AppWorkspace,
  DockWorkspace,
  prompts,
  toast,
  type ResourceApiKey,
  type ResourceApiKeysProps,
} from "@valentinkolb/cloud/ui";
import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js";
import type {
  Aggregation,
  MetricType,
  PanelVisual,
  PulseBase,
  PulseCurrentState,
  PulseDashboard,
  PulseDashboardConfig,
  PulseDashboardControl,
  PulseDashboardDslCompileResult,
  PulseInventory,
  PulseMetricSummary,
  PulseMetricSeries,
  PulseQueryCompileResult,
  PulseRecordedEvent,
  PulseResourceMetric,
  PulseResourceSummary,
  PulseSavedQuery,
  PulseSource,
  PulseSourceScrape,
  MetricQuery,
  MetricQueryPoint,
} from "../contracts";
import PulseLayoutHelp from "./PulseLayoutHelp";
import { buildPulseQuery, buildPulseQueryCompletions, defaultPulseQuery } from "./query-authoring";
import DashboardEditorView from "./workspace/DashboardEditorView";
import DashboardView, { type DashboardRenderContext } from "./workspace/DashboardView";
import { fetchFocusedRowsPage, focusedRowsOffset, mergeFocusedRows } from "./workspace/focused-rows";
import FocusedSignalView from "./workspace/FocusedSignalView";
import PulseSidebar from "./workspace/PulseSidebar";
import { QueryHistoryPane, SavedQueriesPane } from "./workspace/QueryExplorerAuxPanes";
import QueryExplorerBrowsePane from "./workspace/QueryExplorerBrowsePane";
import QueryExplorerEditorPane from "./workspace/QueryExplorerEditorPane";
import QueryExplorerResultPane from "./workspace/QueryExplorerResultPane";
import {
  buildBrowseEntities,
  buildBrowseEvents,
  buildBrowseLabels,
  buildBrowseMetrics,
  buildBrowseSources,
  buildBrowseStates,
  filterBrowseSeries,
} from "./workspace/query-browser-model";
import {
  failedQueryDiagnostics,
  queryRunApplication,
  runPulseTextQuery,
  shouldRememberQueryRun,
  shouldToastQueryError,
} from "./workspace/query-runner";
import ResourceBrowserView from "./workspace/ResourceBrowserView";
import ResourceDetailView from "./workspace/ResourceDetailView";
import { openSaveQueryDialog } from "./workspace/saved-query-dialog";
import { signalCatalogKindForView } from "./workspace/SignalCatalogChrome";
import SignalCatalogView from "./workspace/SignalCatalogView";
import SourcesView from "./workspace/SourcesView";
import { openPulseBaseSettingsDialog } from "./workspace/base-settings-dialog";
import { openPulseDashboardSettingsDialog } from "./workspace/dashboard-settings-dialog";
import { buildActivityEventGroups, buildActivityStateGroups } from "./workspace/activity-groups";
import { createListDetailPanesValue } from "./workspace/list-detail-panes";
import { navigatePulseWorkspace, replacePulseWorkspaceUrl } from "./workspace/navigation";
import {
  openPublicDashboardDisplayDialog as openPublicDashboardDisplayOptionsDialog,
  type PublicDashboardDisplayHeight,
  type PublicDashboardDisplayTheme,
} from "./workspace/public-display-dialog";
import { openSourceEditDialog } from "./workspace/source-edit-dialog";
import { openSourceCreateDialog } from "./workspace/source-create-dialog";
import { buildPulseWorkspaceHref, readActivityQueryState, readResourceQueryState } from "./workspace/routes";
import {
  FOCUSED_PAGE_SIZE,
  dashboardEventsWidgets,
  dashboardDslCompileError,
  dashboardMetricWidgets,
  dashboardDslPreviewIsCurrent,
  dashboardPreviewConfigFromResult,
  dashboardStatesWidgets,
  dashboardToDsl,
  dashboardWidgetSnippetFromQuery,
  defaultPulseDateContext,
  compileDashboardDslText,
  createPublicDashboardToken,
  deletePublicDashboardToken,
  emptyDashboardDsl,
  currentStateQueryText,
  createPulseSource,
  defaultMetricAggregation,
  eventKindQueryText,
  formatIngestCounts,
  jsonFetch,
  metricSummaryQueryText,
  openQueryReferenceWindow,
  readQueryHistory,
  refreshIntervalFromOption,
  queryWithDimensionFilter,
  queryWithSourceFilter,
  recordedEventQueryText,
  resourceMetricQueryText,
  savePulseDashboardConfig,
  scrapePulseSourceOnce,
  createPulseSavedQuery,
  deletePulseSavedQuery,
  sourceCreatedMessage,
  sourceCreateValidationError,
  sourceInitialScrapeFailureMessage,
  sourceInitialScrapeSuccessMessage,
  signalResourceKey,
  shouldSkipDashboardDslPreview,
  stateKeyQueryText,
  stateRowId,
  writeQueryHistory,
} from "./workspace/helpers";
import { createSignalTableCellRenderers } from "./workspace/signal-table-cells";
import { eventColumns, eventGroupColumns, metricColumns, metricSeriesColumns, stateColumns, stateGroupColumns } from "./workspace/table-columns";
import type {
  ActivityEventGroup,
  ActivityStateGroup,
  CreateSourceInput,
  ExplorerResultView,
  PulseWorkspaceProps,
  QueryHistoryEntry,
  RefreshIntervalOption,
  WorkspaceView,
} from "./workspace/types";
import {
  fetchDashboardEventsWidgetRows,
  fetchDashboardMetricWidgetPoints,
  fetchDashboardStatesWidgetRows,
} from "./workspace/dashboard-runtime";
import {
  fetchPulseActivityData,
  fetchPulseBaseData,
  fetchPulseMetricSeries,
  fetchPulseResourceSignals,
  fetchPulseResources,
  fetchPulseSourceApiKeys,
  fetchPulseSourceScrapes,
} from "./workspace/workspace-loaders";

export default function PulseWorkspace(props: PulseWorkspaceProps) {
  const initialBaseId = props.initialBaseId ?? props.initialBases[0]?.id ?? "";
  const initialRouteState = props.initialRouteState ?? { view: "resources" as const, dashboardId: "", sourceId: "", signalId: "" };
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
  const [inventory, setInventory] = createSignal<PulseInventory>(props.initialInventory ?? { resources: [], metrics: [], events: [], states: [] });
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
  const [dashboards, setDashboards] = createSignal<PulseDashboard[]>(props.initialDashboards ?? []);
  const [savedQueries, setSavedQueries] = createSignal<PulseSavedQuery[]>(props.initialSavedQueries ?? []);
  const [selectedDashboardId, setSelectedDashboardId] = createSignal(initialDashboardId);
  const [activeView, setActiveView] = createSignal<WorkspaceView>(initialRouteState.view);
  const [selectedMetric, setSelectedMetric] = createSignal(props.initialMetrics?.[0]?.name ?? "");
  const [selectedSourceId, setSelectedSourceId] = createSignal(initialRouteState.sourceId);
  const [sourcePanesValue, setSourcePanesValue] = createSignal(createListDetailPanesValue());
  const [selectedQuerySourceId, setSelectedQuerySourceId] = createSignal("");
  const [activitySearch, setActivitySearch] = createSignal(initialActivityQuery.q);
  const [metricTypeFilter, setMetricTypeFilter] = createSignal<"" | MetricType>(initialActivityQuery.type);
  const [focusedSignalId, setFocusedSignalId] = createSignal(initialRouteState.signalId);
  const [focusedSearch, setFocusedSearch] = createSignal(initialFocusedSearch);
  const [focusedMetricSeries, setFocusedMetricSeries] = createSignal<PulseMetricSeries[]>(props.initialFocusedMetricSeries ?? []);
  const [focusedEvents, setFocusedEvents] = createSignal<PulseRecordedEvent[]>(props.initialFocusedEvents ?? []);
  const [focusedStates, setFocusedStates] = createSignal<PulseCurrentState[]>(props.initialFocusedStates ?? []);
  const [focusedHasMore, setFocusedHasMore] = createSignal(props.initialFocusedHasMore ?? false);
  const [focusedLoadingMore, setFocusedLoadingMore] = createSignal(false);
  const [selectedFocusedSeriesId, setSelectedFocusedSeriesId] = createSignal("");
  const [selectedFocusedStateId, setSelectedFocusedStateId] = createSignal("");
  const [selectedFocusedEventId, setSelectedFocusedEventId] = createSignal("");
  const [focusedPanesValue, setFocusedPanesValue] = createSignal(createListDetailPanesValue());
  const [selectedSeriesId, setSelectedSeriesId] = createSignal("");
  const [selectedVisual, setSelectedVisual] = createSignal<PanelVisual>("line");
  const [selectedAggregation, setSelectedAggregation] = createSignal<Aggregation>("avg");
  const [selectedBucket, setSelectedBucket] = createSignal("5m");
  const [selectedSince, setSelectedSince] = createSignal("24h");
  const [queryText, setQueryText] = createSignal("");
  const [lastRunQuery, setLastRunQuery] = createSignal("");
  const [queryDiagnostics, setQueryDiagnostics] = createSignal<PulseQueryCompileResult | null>(null);
  const [queryHistory, setQueryHistory] = createSignal<QueryHistoryEntry[]>(readQueryHistory(initialBaseId));
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
  const [metricWidgetPoints, setMetricWidgetPoints] = createSignal<Record<string, MetricQueryPoint[]>>(props.initialMetricWidgetPoints ?? {});
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
  let queryRunId = 0;
  let activityDataRequestId = 0;
  let resourceListRequestId = 0;
  let resourceSignalsRequestId = 0;
  let focusedRowsRequestId = 0;
  let dashboardDslCompileRequestId = 0;
  let lastAutoRunQuery = "";

  const selectedBase = createMemo(() => bases().find((base) => base.id === selectedBaseId()) ?? null);
  const selectedDashboard = createMemo(
    () => dashboards().find((dashboard) => dashboard.id === selectedDashboardId()) ?? dashboards()[0] ?? null,
  );
  const dashboardEditPreviewConfig = createMemo(() => dashboardPreviewConfig() ?? selectedDashboard()?.config ?? null);
  const selectedSource = createMemo(() => sources().find((source) => source.id === selectedSourceId()) ?? null);
  const selectedSourceScrapes = createMemo(() => (selectedSourceId() ? (sourceScrapes()[selectedSourceId()] ?? []) : []));
  const selectedSourceApiKeys = createMemo(() => (selectedSourceId() ? (sourceApiKeys()[selectedSourceId()] ?? []) : []));
  const focusedMetric = createMemo(() => metrics().find((metric) => metric.name === focusedSignalId()) ?? null);
  const selectedFocusedSeries = createMemo(
    () => focusedMetricSeries().find((item) => item.id === selectedFocusedSeriesId()) ?? focusedMetricSeries()[0] ?? null,
  );
  const selectedFocusedState = createMemo(
    () => focusedStates().find((state) => stateRowId(state) === selectedFocusedStateId()) ?? focusedStates()[0] ?? null,
  );
  const selectedFocusedEvent = createMemo(
    () => focusedEvents().find((event) => event.id === selectedFocusedEventId()) ?? focusedEvents()[0] ?? null,
  );
  const selectedSeries = createMemo(() => series().find((item) => item.id === selectedSeriesId()) ?? null);
  const sourceNameById = createMemo(() => new Map(sources().map((source) => [source.id, source.name])));
  const metricByName = createMemo(() => new Map(metrics().map((metric) => [metric.name, metric])));
  const sourceById = createMemo(() => new Map(sources().map((source) => [source.id, source])));
  const pulseDateContext = createMemo(() => ({
    ...defaultPulseDateContext,
    ...(props.initialDateConfig ?? {}),
    now: props.initialNow ?? new Date().toISOString(),
  }));
  const eventGroups = createMemo<ActivityEventGroup[]>(() => buildActivityEventGroups(recentEvents()));
  const stateGroups = createMemo<ActivityStateGroup[]>(() => buildActivityStateGroups(currentStates()));
  const resourceByKey = createMemo(() => new Map(inventory().resources.map((resource) => [resource.key, resource])));
  const selectedResource = createMemo(() => resourceByKey().get(selectedResourceKey()) ?? inventory().resources[0] ?? null);
  const resourceNeedle = createMemo(() => resourceSearch().trim().toLowerCase());
  const resourceMatches = (values: Array<string | null | undefined>) => {
    const needle = resourceNeedle();
    if (!needle) return true;
    return values.some((value) => value?.toLowerCase().includes(needle));
  };
  const filteredResources = createMemo(() =>
    inventory().resources.filter((resource) => {
      if (resourceSourceFilter() && !resource.sourceIds.includes(resourceSourceFilter())) return false;
      if (resourceTypeFilter() && (resource.type ?? "resource") !== resourceTypeFilter()) return false;
      return resourceMatches([
        resource.id,
        resource.label,
        resource.type,
        ...resource.sourceIds.map((sourceId) => sourceNameById().get(sourceId) ?? sourceId),
        ...Object.keys(resource.dimensions),
        ...Object.values(resource.dimensions),
      ]);
    }),
  );
  const visibleSelectedResource = createMemo(() => {
    const selected = selectedResource();
    return filteredResources().find((resource) => resource.key === selected?.key) ?? filteredResources()[0] ?? selected ?? null;
  });
  const selectedResourceMetrics = createMemo(() =>
    visibleSelectedResource() ? inventory().metrics.filter((metric) => metric.resourceKey === visibleSelectedResource()!.key) : [],
  );
  const selectedResourceStates = createMemo(() =>
    visibleSelectedResource() ? inventory().states.filter((state) => signalResourceKey(state) === visibleSelectedResource()!.key) : [],
  );
  const selectedResourceEvents = createMemo(() =>
    visibleSelectedResource() ? inventory().events.filter((event) => signalResourceKey(event) === visibleSelectedResource()!.key) : [],
  );
  const selectedBrowseSource = createMemo(() => sourceById().get(browseSourceId()) ?? null);
  const browseSearchNeedle = createMemo(() => browseSearch().trim().toLowerCase());
  const filteredSources = createMemo(() => {
    const q = sourceSearch().trim().toLowerCase();
    if (!q) return sources();
    return sources().filter((source) =>
      [source.name, source.kind, source.endpointUrl ?? "", source.lastError ?? ""].some((value) => value.toLowerCase().includes(q)),
    );
  });
  const previewSeries = createMemo(() => [
    {
      label: selectedMetric() || "metric",
      data: points().map((point) => ({ x: Date.parse(point.bucket), y: point.value ?? 0 })),
    },
  ]);
  const queryCompletions = createMemo(() =>
    buildPulseQueryCompletions({
      metrics: metrics(),
      events: recentEvents(),
      states: currentStates(),
      sources: sources(),
      series: series(),
    }),
  );
  const metricScopeByName = createMemo(() => {
    const scopes = new Map<string, { sources: Set<string>; resources: Set<string> }>();
    for (const metric of inventory().metrics) {
      const scope = scopes.get(metric.metric) ?? { sources: new Set<string>(), resources: new Set<string>() };
      if (metric.sourceId) scope.sources.add(metric.sourceId);
      scope.resources.add(metric.resourceKey);
      scopes.set(metric.metric, scope);
    }
    return scopes;
  });
  const browseScope = createMemo(() => ({ sourceId: browseSourceId(), entityId: browseEntityId() }));
  const browseEntities = createMemo(() =>
    buildBrowseEntities({
      inventory: inventory(),
      series: series(),
      events: recentEvents(),
      states: currentStates(),
    }),
  );
  const selectedBrowseEntity = createMemo(() => browseEntities().find((entity) => entity.id === browseEntityId()) ?? null);
  const browseMatches = (values: Array<string | null | undefined>) => {
    const needle = browseSearchNeedle();
    if (!needle) return true;
    return values.some((value) => value?.toLowerCase().includes(needle));
  };
  const browseScopedSeries = createMemo(() => filterBrowseSeries(series(), browseScope()));
  const browseSources = createMemo(() =>
    buildBrowseSources({
      sources: sources(),
      series: series(),
      events: recentEvents(),
      states: currentStates(),
      matches: browseMatches,
    }),
  );
  const browseVisibleEntities = createMemo(() =>
    browseEntities()
      .filter((entity) => {
        if (browseSourceId() && !entity.sourceIds.includes(browseSourceId())) return false;
        return browseMatches([entity.id, entity.type, ...Object.keys(entity.dimensions), ...Object.values(entity.dimensions)]);
      })
      .slice(0, 24),
  );
  const browseMetrics = createMemo(() =>
    buildBrowseMetrics({
      metrics: metrics(),
      scopedSeries: browseScopedSeries(),
      allSeries: series(),
      selectedEntityDimensions: selectedBrowseEntity()?.dimensions ?? {},
      entityId: browseEntityId(),
      matches: browseMatches,
    }),
  );
  const browseEvents = createMemo(() => buildBrowseEvents(recentEvents(), browseScope(), browseMatches));
  const browseStates = createMemo(() => buildBrowseStates(currentStates(), browseScope(), browseMatches));
  const browseLabels = createMemo(() =>
    buildBrowseLabels({
      scopedSeries: browseScopedSeries(),
      events: recentEvents(),
      states: currentStates(),
      scope: browseScope(),
      matches: browseMatches,
    }),
  );
  const compiledQuery = createMemo(() => queryDiagnostics()?.compiled ?? null);
  const compiledMetricQuery = createMemo(() => (compiledQuery()?.kind === "metric" ? (compiledQuery() as MetricQuery) : null));
  const matchingMetricSeries = createMemo(() => {
    const compiled = compiledMetricQuery();
    if (!compiled) return [];
    const filters = Object.entries(compiled.dimensions ?? {}).map(([key, value]) => [key, String(value)] as const);
    return series().filter((item) => {
      if (item.metric !== compiled.metric) return false;
      if (compiled.sourceId && item.sourceId !== compiled.sourceId) return false;
      return filters.every(([key, value]) => item.dimensions[key] === value);
    });
  });
  const queryFilterSuggestions = createMemo(() => {
    const compiled = compiledMetricQuery();
    if (!compiled) return [];
    const existing = new Set(Object.keys(compiled.dimensions ?? {}));
    const dimensions = new Map<string, Map<string, number>>();
    for (const item of matchingMetricSeries()) {
      for (const [key, value] of Object.entries(item.dimensions)) {
        if (existing.has(key)) continue;
        if (!dimensions.has(key)) dimensions.set(key, new Map());
        const values = dimensions.get(key)!;
        values.set(value, (values.get(value) ?? 0) + 1);
      }
    }
    return [...dimensions.entries()]
      .map(([key, values]) => ({
        key,
        count: [...values.values()].reduce((sum, value) => sum + value, 0),
        values: [...values.entries()]
          .map(([value, count]) => ({ key, value, count }))
          .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value)),
      }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  });
  const matchingMetricSources = createMemo(() => {
    const unique = new Map<string, { source: PulseSource; count: number }>();
    for (const item of matchingMetricSeries()) {
      const source = sourceById().get(item.sourceId ?? "");
      if (source) unique.set(source.id, { source, count: (unique.get(source.id)?.count ?? 0) + 1 });
    }
    return [...unique.values()].sort((left, right) => right.count - left.count || left.source.name.localeCompare(right.source.name));
  });
  const querySuggestionMatches = createMemo(() => {
    const search = querySuggestionSearch().trim().toLowerCase();
    const sourceMatches = matchingMetricSources().filter(({ source }) =>
      !search ? true : [source.name, source.kind, source.endpointUrl ?? ""].some((value) => value.toLowerCase().includes(search)),
    );
    const labelMatches = queryFilterSuggestions()
      .map((group) => ({
        ...group,
        values: group.values.filter((filter) =>
          !search ? true : `${filter.key}=${filter.value}`.toLowerCase().includes(search) || filter.value.toLowerCase().includes(search),
        ),
      }))
      .filter((group) => group.values.length > 0);
    return {
      sources: sourceMatches,
      labels: labelMatches,
    };
  });
  const visibleQuerySourceSuggestions = createMemo(() => {
    const limit = querySuggestionsExpanded() ? 25 : 4;
    return querySuggestionMatches().sources.slice(0, limit);
  });
  const visibleQueryLabelSuggestions = createMemo(() => {
    const groupLimit = querySuggestionsExpanded() ? 12 : 3;
    const valueLimit = querySuggestionsExpanded() ? 8 : 4;
    return querySuggestionMatches()
      .labels.slice(0, groupLimit)
      .map((group) => ({
        ...group,
        values: group.values.slice(0, valueLimit),
        hiddenValues: Math.max(0, group.values.length - valueLimit),
      }));
  });
  const querySuggestionOverflow = createMemo(() => {
    const sourceOverflow = compiledMetricQuery()?.sourceId
      ? 0
      : querySuggestionMatches().sources.length - visibleQuerySourceSuggestions().length;
    const labelOverflow = querySuggestionMatches().labels.reduce(
      (count, group, index) =>
        count +
        (index >= visibleQueryLabelSuggestions().length
          ? group.values.length
          : Math.max(0, group.values.length - (querySuggestionsExpanded() ? 8 : 4))),
      0,
    );
    return Math.max(0, sourceOverflow) + Math.max(0, labelOverflow);
  });
  const previewUnit = createMemo(() => metricByName().get(compiledMetricQuery()?.metric ?? selectedMetric())?.unit ?? null);
  const defaultQueryText = createMemo(() => {
    const metric = selectedMetric();
    if (!metric) return "";
    const seriesFilter = selectedSeries();
    const sourceId = seriesFilter?.sourceId ?? selectedQuerySourceId();
    return buildPulseQuery({
      metric,
      aggregation: selectedAggregation(),
      bucket: selectedBucket(),
      since: selectedSince(),
      sourceId,
      dimensions: seriesFilter?.dimensions,
    });
  });

  const loadBaseData = async (baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const nextData = await fetchPulseBaseData(baseId, signal);
    setSources(nextData.sources);
    setMetrics(nextData.metrics);
    setInventory(nextData.inventory);
    setSelectedResourceKey((current) =>
      current && nextData.inventory.resources.some((resource) => resource.key === current) ? current : (nextData.inventory.resources[0]?.key ?? ""),
    );
    setDashboards(nextData.dashboards);
    setSavedQueries(nextData.savedQueries);
    setSelectedMetric((current) =>
      current && nextData.metrics.some((metric) => metric.name === current) ? current : (nextData.metrics[0]?.name ?? ""),
    );
    setSelectedSourceId((current) => (current && nextData.sources.some((source) => source.id === current) ? current : ""));
    setSelectedDashboardId((current) => nextData.dashboards.find((dashboard) => dashboard.id === current)?.id ?? nextData.dashboards[0]?.id ?? "");
  };

  const loadActivityData = async (baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const requestId = ++activityDataRequestId;
    const snapshot = { q: activitySearch().trim(), type: metricTypeFilter() };
    const nextData = await fetchPulseActivityData(baseId, snapshot, signal);
    if (
      signal?.aborted ||
      requestId !== activityDataRequestId ||
      selectedBaseId() !== baseId ||
      activitySearch().trim() !== snapshot.q ||
      metricTypeFilter() !== snapshot.type
    ) {
      return;
    }
    setRecentEvents(nextData.events);
    setCurrentStates(nextData.states);
    setActivityMetrics(nextData.metrics);
  };

  const loadResourceList = async (baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const requestId = ++resourceListRequestId;
    const view = activeView();
    const snapshot =
      view === "resource-detail"
        ? { ref: selectedResourceKey(), limit: 20 }
        : {
            q: resourceSearch().trim(),
            sourceId: resourceSourceFilter(),
            type: resourceTypeFilter(),
            limit: 500,
          };
    const resources = await fetchPulseResources(baseId, snapshot, signal);
    if (
      signal?.aborted ||
      requestId !== resourceListRequestId ||
      selectedBaseId() !== baseId ||
      activeView() !== view ||
      (view === "resources" &&
        (resourceSearch().trim() !== (snapshot.q ?? "") ||
          resourceSourceFilter() !== (snapshot.sourceId ?? "") ||
          resourceTypeFilter() !== (snapshot.type ?? ""))) ||
      (view === "resource-detail" && selectedResourceKey() !== (snapshot.ref ?? ""))
    ) {
      return;
    }
    setInventory((current) => ({ ...current, resources }));
    if (view === "resources") {
      setSelectedResourceKey((current) => (current && resources.some((resource) => resource.key === current) ? current : (resources[0]?.key ?? "")));
    }
  };

  const loadSelectedResourceSignals = async (baseId = selectedBaseId(), resourceKey = selectedResourceKey(), signal?: AbortSignal) => {
    if (!baseId || !resourceKey) return;
    const requestId = ++resourceSignalsRequestId;
    const signals = await fetchPulseResourceSignals(baseId, resourceKey, signal);
    if (
      signal?.aborted ||
      requestId !== resourceSignalsRequestId ||
      selectedBaseId() !== baseId ||
      activeView() !== "resource-detail" ||
      selectedResourceKey() !== resourceKey
    ) {
      return;
    }
    setInventory((current) => ({
      ...current,
      metrics: signals.metrics,
      states: signals.states,
      events: signals.events,
    }));
  };

  const refreshResourceView = async (baseId = selectedBaseId(), signal?: AbortSignal) => {
    await loadResourceList(baseId, signal);
    if (activeView() === "resource-detail") await loadSelectedResourceSignals(baseId, selectedResourceKey(), signal);
  };

  const loadSeries = async (baseId = selectedBaseId(), metric = selectedMetric(), sourceId = selectedQuerySourceId()) => {
    if (!baseId || !metric) {
      setSeries([]);
      setSelectedSeriesId("");
      return;
    }
    const nextSeries = await fetchPulseMetricSeries(baseId, metric, sourceId);
    setSeries(nextSeries);
    setSelectedSeriesId((current) => (current && nextSeries.some((item) => item.id === current) ? current : ""));
  };

  const loadFocusedRows = async (options: { append?: boolean; signal?: AbortSignal } = {}) => {
    const baseId = selectedBaseId();
    const view = activeView();
    const signalId = focusedSignalId();
    if (!baseId || !signalId || (view !== "metric-detail" && view !== "state-detail" && view !== "event-detail")) return;
    const requestId = ++focusedRowsRequestId;
    const offset = untrack(() =>
      focusedRowsOffset({
        append: options.append,
        eventCount: focusedEvents().length,
        metricSeriesCount: focusedMetricSeries().length,
        stateCount: focusedStates().length,
        view,
      }),
    );

    setFocusedLoadingMore(true);
    try {
      const page = await fetchFocusedRowsPage({
        baseId,
        offset,
        pageSize: FOCUSED_PAGE_SIZE,
        search: focusedSearch().trim(),
        signal: options.signal,
        signalId,
        view,
      });
      if (requestId !== focusedRowsRequestId) return;
      setFocusedHasMore(page.hasMore);
      if (page.view === "metric-detail") setFocusedMetricSeries((current) => mergeFocusedRows(current, page.rows, options.append));
      if (page.view === "state-detail") setFocusedStates((current) => mergeFocusedRows(current, page.rows, options.append));
      if (page.view === "event-detail") setFocusedEvents((current) => mergeFocusedRows(current, page.rows, options.append));
    } finally {
      if (requestId === focusedRowsRequestId) setFocusedLoadingMore(false);
    }
  };

  const loadSourceScrapes = async (baseId = selectedBaseId(), sourceId = selectedSourceId(), signal?: AbortSignal) => {
    if (!baseId || !sourceId) return;
    const nextScrapes = await fetchPulseSourceScrapes(baseId, sourceId, signal);
    setSourceScrapes((current) => ({ ...current, [sourceId]: nextScrapes }));
  };

  const loadSourceApiKeys = async (baseId = selectedBaseId(), sourceId = selectedSourceId(), signal?: AbortSignal) => {
    if (!baseId || !sourceId) return;
    const nextKeys = await fetchPulseSourceApiKeys(baseId, sourceId, signal);
    setSourceApiKeys((current) => ({ ...current, [sourceId]: nextKeys }));
  };

  const refreshDashboardConfig = async (config: PulseDashboardConfig, dashboard = selectedDashboard(), baseId = selectedBaseId(), signal?: AbortSignal) => {
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

  const workspaceHref = (nextState: { view: WorkspaceView; dashboardId?: string; sourceId?: string; signalId?: string }) => {
    return buildPulseWorkspaceHref({
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
    });
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

  const createDashboard = async () => {
    const baseId = selectedBaseId();
    if (!baseId) return null;
    const result = await prompts.form({
      title: "New dashboard",
      icon: "ti ti-layout-dashboard",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "Operations" },
        description: { type: "text", label: "Description", multiline: true, placeholder: "What should this dashboard answer?" },
      },
      confirmText: "Create",
    });
    const name = result ? String(result.name ?? "").trim() : "";
    if (!name) return null;
    const description = String(result?.description ?? "").trim();
    const dsl = emptyDashboardDsl(name, description);
    setLoading(true);
    try {
      const dashboard = await jsonFetch<PulseDashboard>(`/api/pulse/bases/${baseId}/dashboards`, {
        method: "POST",
        body: JSON.stringify({ name, config: { dsl } }),
      });
      const dashboardDsl = dashboardToDsl(dashboard);
      setDashboards((current) => [dashboard, ...current]);
      setDashboardDslText(dashboardDsl);
      setDashboardPreviewConfig(dashboard.config);
      setDashboardDslDiagnostics({ ok: true, diagnostics: [], config: dashboard.config });
      setDashboardDslDiagnosticsText(dashboardDsl);
      setDashboardDslSeededFor(dashboard.id);
      setSelectedDashboardId(dashboard.id);
      navigateWorkspace({ view: "dashboard-edit", dashboardId: dashboard.id });
      toast.success("Dashboard created. Edit the DSL to add content.");
      return dashboard;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create dashboard");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const updateBaseSettings = async (base: PulseBase, input: { name: string; description: string; retentionDays: number }) => {
    const name = input.name.trim();
    if (!name) {
      toast.error("Pulse name is required");
      return false;
    }
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3650) {
      toast.error("Retention must be between 1 and 3650 days");
      return false;
    }
    setLoading(true);
    try {
      const updated = await jsonFetch<PulseBase>(`/api/pulse/bases/${base.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: input.description.trim() || null,
          retentionDays: input.retentionDays,
        }),
      });
      setBases((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Pulse settings saved");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Pulse settings");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const clearBaseData = async (base: PulseBase) => {
    const confirmed = await prompts.confirm(
      `Clear all metrics, events, states, observed resources, and scrape history from "${base.name}"? Sources, API keys, dashboards, saved queries, access, and settings will be kept.`,
      {
        title: "Clear Pulse data",
        variant: "danger",
        confirmText: "Clear data",
      },
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/bases/${base.id}/clear-data`, { method: "POST" });
      setSelectedMetric("");
      setSelectedResourceKey("");
      setRecentEvents([]);
      setCurrentStates([]);
      setActivityMetrics([]);
      setMetrics([]);
      setSeries([]);
      setSourceScrapes({});
      setInventory({ resources: [], metrics: [], events: [], states: [] });
      setSources((items) => items.map((item) => ({ ...item, lastSeenAt: null, lastError: null, lastErrorAt: null })));
      toast.success("Pulse data clear started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clear Pulse data");
    } finally {
      setLoading(false);
    }
  };

  const deleteBase = async (base: PulseBase) => {
    const confirmed = await prompts.confirm(`Delete "${base.name}" and all Pulse data in this base? This cannot be undone. Large bases are removed in the background.`, {
      title: "Delete Pulse base",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return false;

    setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/bases/${base.id}`, { method: "DELETE" });
      const nextBases = bases().filter((item) => item.id !== base.id);
      const nextBase = nextBases[0] ?? null;
      setBases(nextBases);
      setSelectedBaseId(nextBase?.id ?? "");
      setSelectedSourceId("");
      setSelectedMetric("");
      setSelectedDashboardId("");
      setSelectedResourceKey("");
      setRecentEvents([]);
      setCurrentStates([]);
      setActivityMetrics([]);
      setSeries([]);
      setSourceScrapes({});
      setSourceApiKeys({});

      if (nextBase) {
        navigatePulseWorkspace({ baseId: nextBase.id, state: { view: "resources" } });
        await loadBaseData(nextBase.id);
      } else {
        setSources([]);
        setMetrics([]);
        setInventory({ resources: [], metrics: [], events: [], states: [] });
        setDashboards([]);
        setSavedQueries([]);
        navigatePulseWorkspace({ baseId: "", state: { view: "resources" } });
      }

      toast.success("Pulse base deletion started");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete Pulse base");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const openSettingsDialog = async () => {
    if (settingsDialogOpen()) return;
    const base = selectedBase();
    if (!base) return;
    try {
      setLoading(true);
      const accessEntries = await jsonFetch<AccessEntry[]>(`/api/pulse/bases/${base.id}/access`);
      setLoading(false);
      setSettingsDialogOpen(true);

      await openPulseBaseSettingsDialog({
        accessEntries,
        base,
        loading,
        updateBaseSettings,
        clearBaseData: () => clearBaseData(base),
        deleteBase: () => deleteBase(base),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open Pulse settings");
    } finally {
      setLoading(false);
      setSettingsDialogOpen(false);
    }
  };

  const scrapeCreatedMetricsSource = async (baseId: string, sourceId: string) => {
    try {
      const counts = await scrapePulseSourceOnce(baseId, sourceId);
      await loadBaseData(baseId);
      await loadSourceScrapes(baseId, sourceId);
      toast.success(sourceInitialScrapeSuccessMessage(counts));
    } catch (error) {
      toast.error(sourceInitialScrapeFailureMessage(error));
    }
  };

  const createSource = async (input: CreateSourceInput) => {
    const baseId = selectedBaseId();
    if (!baseId) return false;
    const validationError = sourceCreateValidationError(input);
    if (validationError) {
      toast.error(validationError);
      return false;
    }
    setLoading(true);
    try {
      const source = await createPulseSource(baseId, input);
      navigateWorkspace({ view: "sources", sourceId: source.id });
      await loadBaseData(baseId);
      if (input.kind === "metrics") {
        await scrapeCreatedMetricsSource(baseId, source.id);
        return true;
      }
      toast.success(sourceCreatedMessage(input.kind));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add source");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const addSource = () =>
    openSourceCreateDialog({
      loading,
      createSource,
    });

  const scrape = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    setLoading(true);
    try {
      const counts = await scrapePulseSourceOnce(baseId, source.id);
      await loadBaseData(baseId);
      await loadSourceScrapes(baseId, source.id);
      await refreshDashboard();
      toast.success(`Metrics scraped: ${formatIngestCounts(counts)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scrape failed");
    } finally {
      setLoading(false);
    }
  };

  const toggleSource = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    setLoading(true);
    try {
      const updated = await jsonFetch<PulseSource>(`/api/pulse/bases/${baseId}/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      setSources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await refreshDashboard();
      toast.success(updated.enabled ? "Source resumed" : "Source paused");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update source");
    } finally {
      setLoading(false);
    }
  };

  const editSource = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    const patch = await openSourceEditDialog(source);
    if (!patch) return;

    setLoading(true);
    try {
      const updated = await jsonFetch<PulseSource>(`/api/pulse/bases/${baseId}/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Source updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update source");
    } finally {
      setLoading(false);
    }
  };

  const removeSource = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    if (
      !(await prompts.confirm(`Remove source "${source.name}"? Existing samples stay available, but new data will stop.`, {
        title: "Remove source",
        variant: "danger",
      }))
    )
      return;
    setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/bases/${baseId}/sources/${source.id}`, { method: "DELETE" });
      setSelectedSourceId((current) => (current === source.id ? "" : current));
      await loadBaseData(baseId);
      await refreshDashboard();
      toast.success("Source removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove source");
    } finally {
      setLoading(false);
    }
  };

  const currentExplorerQuery = () => queryText().trim() || defaultQueryText() || defaultPulseQuery(metrics());

  const applyQueryDimensionFilter = (key: string, value: string) => {
    const query = currentExplorerQuery();
    if (!query) return;
    setQueryText(queryWithDimensionFilter(query, key, value));
  };

  const applyQuerySourceFilter = (sourceId: string) => {
    const query = currentExplorerQuery();
    if (!query) return;
    setQueryText(queryWithSourceFilter(query, sourceId));
  };

  const setMetricBrowseQuery = (metric: PulseMetricSummary, dimensions: Record<string, string> = {}) => {
    setQueryText(metricSummaryQueryText(metric, { sourceId: browseSourceId() || null, dimensions }));
  };

  const setEventBrowseQuery = (kind: string, sample?: PulseRecordedEvent) => {
    setQueryText(eventKindQueryText(kind, { sourceId: browseSourceId() || sample?.sourceId, entityId: browseEntityId() || sample?.entityId }));
  };

  const setStateBrowseQuery = (key: string, sample?: PulseCurrentState) => {
    setQueryText(stateKeyQueryText(key, { sourceId: browseSourceId() || sample?.sourceId, entityId: browseEntityId() || sample?.entityId }));
  };

  const openMetricQuery = (metric: PulseResourceMetric) => {
    setQueryText(resourceMetricQueryText(metric));
    openQueryExplorer();
  };

  const openEventQuery = (event: PulseRecordedEvent) => {
    setQueryText(recordedEventQueryText(event));
    openQueryExplorer();
  };

  const openStateQuery = (state: PulseCurrentState) => {
    setQueryText(currentStateQueryText(state));
    openQueryExplorer();
  };

  const rememberQuery = (baseId: string, query: string) => {
    const next = [{ query, ranAt: new Date().toISOString() }, ...queryHistory().filter((item) => item.query !== query)].slice(0, 20);
    setQueryHistory(next);
    writeQueryHistory(baseId, next);
  };

  const runTextQuery = async (options: { query?: string; manual?: boolean; remember?: boolean } = {}) => {
    const baseId = selectedBaseId();
    const query = options.query?.trim() || currentExplorerQuery();
    if (!baseId || !query) return;
    const runId = ++queryRunId;
    setQueryRunning(true);
    try {
      const result = await runPulseTextQuery(baseId, query);
      if (runId !== queryRunId) return;
      const application = queryRunApplication(explorerResultView(), result);
      setQueryText(query);
      if (application.metricControls) {
        setSelectedMetric(application.metricControls.metric);
        setSelectedAggregation(application.metricControls.aggregation);
        setSelectedBucket(application.metricControls.bucket);
        setSelectedSince(application.metricControls.since);
        setSelectedQuerySourceId(application.metricControls.sourceId);
      } else {
        setExplorerResultView(application.nextResultView);
      }
      setPoints(application.points);
      setExplorerEvents(application.events);
      setExplorerStates(application.states);
      setQueryDiagnostics(application.diagnostics);
      setLastRunQuery(query);
      if (shouldRememberQueryRun(options)) rememberQuery(baseId, query);
    } catch (error) {
      if (runId !== queryRunId) return;
      const message = error instanceof Error ? error.message : "Query failed";
      if (shouldToastQueryError(options)) {
        toast.error(message);
      } else {
        setQueryDiagnostics(failedQueryDiagnostics(message));
      }
    } finally {
      if (runId === queryRunId) setQueryRunning(false);
    }
  };

  const saveCurrentQuery = async () => {
    const baseId = selectedBaseId();
    const query = currentExplorerQuery();
    if (!baseId || !query) return;
    const result = await openSaveQueryDialog(compiledQuery());
    if (!result) return;

    setLoading(true);
    try {
      const saved = await createPulseSavedQuery(baseId, { name: result.name, description: result.description, query });
      setSavedQueries((current) => [saved, ...current]);
      toast.success("Query saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save query");
    } finally {
      setLoading(false);
    }
  };

  const copyDashboardWidgetSnippet = async () => {
    const query = currentExplorerQuery();
    const compiled = compiledQuery();
    if (!query || !compiled) return;
    try {
      await clipboard.copy(dashboardWidgetSnippetFromQuery(query, compiled, selectedVisual()));
      toast.success("Dashboard widget DSL copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy widget DSL");
    }
  };

  const removeSavedQuery = async (query: PulseSavedQuery) => {
    if (!(await prompts.confirm(`Remove saved query "${query.name}"?`, { title: "Remove query", variant: "danger" }))) return;
    setLoading(true);
    try {
      await deletePulseSavedQuery(query);
      setSavedQueries((current) => current.filter((item) => item.id !== query.id));
      toast.success("Query removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove query");
    } finally {
      setLoading(false);
    }
  };

  const compileDashboardDslPreview = async (dashboard: PulseDashboard, text: string) => {
    const baseId = selectedBaseId();
    if (shouldSkipDashboardDslPreview(baseId, text)) {
      setDashboardDslDiagnostics(null);
      setDashboardDslDiagnosticsText("");
      return;
    }
    const requestId = ++dashboardDslCompileRequestId;
    const previewIsCurrent = () =>
      dashboardDslPreviewIsCurrent({
        currentDashboardId: selectedDashboard()?.id,
        currentRequestId: dashboardDslCompileRequestId,
        currentText: dashboardDslText(),
        dashboardId: dashboard.id,
        requestId,
        text,
      });
    try {
      const result = await compileDashboardDslText(baseId, text);
      if (!previewIsCurrent()) return;
      setDashboardDslDiagnostics(result);
      setDashboardDslDiagnosticsText(text);
      const previewConfig = dashboardPreviewConfigFromResult(result);
      if (previewConfig) {
        setDashboardPreviewConfig(previewConfig);
        await refreshDashboardConfig(previewConfig, dashboard, baseId);
      }
    } catch (error) {
      if (!previewIsCurrent()) return;
      setDashboardDslDiagnostics(dashboardDslCompileError(error));
      setDashboardDslDiagnosticsText(text);
    }
  };

  const saveDashboardDsl = async () => {
    const dashboard = selectedDashboard();
    const compiled = dashboardDslDiagnostics();
    if (!dashboard || dashboardDslDiagnosticsText() !== dashboardDslText() || !compiled?.ok || !compiled.config) {
      toast.error("Fix dashboard DSL errors before saving");
      return;
    }
    setDashboardDslSaving(true);
    try {
      const config: PulseDashboardConfig = {
        ...compiled.config,
        refreshIntervalSeconds: dashboard.config.refreshIntervalSeconds,
      };
      const updated = await savePulseDashboardConfig(dashboard, config);
      setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setDashboardDslSeededFor("");
      toast.success("Dashboard saved");
      await refreshDashboard(updated);
      navigateWorkspace({ view: "dashboard", dashboardId: updated.id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save dashboard");
    } finally {
      setDashboardDslSaving(false);
    }
  };

  const publicDashboardUrl = (
    token: string,
    options: { theme?: PublicDashboardDisplayTheme; height?: PublicDashboardDisplayHeight } = {},
  ) => {
    const base = origin() || (typeof window !== "undefined" ? window.location.origin : "");
    const url = new URL(`/app/pulse/display/${token}`, base || "http://localhost");
    if (options.theme) url.searchParams.set("theme", options.theme);
    if (options.height === "full") url.searchParams.set("height", "full");
    return base ? url.toString() : `${url.pathname}${url.search}`;
  };

  const ensurePublicDashboardLink = async (
    dashboard: PulseDashboard,
    options: { theme?: PublicDashboardDisplayTheme; height?: PublicDashboardDisplayHeight } = {},
  ) => {
    const result = await createPublicDashboardToken(dashboard.id);
    setDashboards((current) => current.map((item) => (item.id === result.dashboard.id ? result.dashboard : item)));
    return publicDashboardUrl(result.token, options);
  };

  const enablePublicLink = async (dashboard = selectedDashboard(), options: { copy?: boolean } = {}) => {
    if (!dashboard) return;
    setLoading(true);
    try {
      const link = await ensurePublicDashboardLink(dashboard);
      if (options.copy) await clipboard.copy(link);
      toast.success(options.copy ? "Public dashboard link copied" : "Public dashboard link enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create public link");
    } finally {
      setLoading(false);
    }
  };

  const disablePublicLink = async (dashboard = selectedDashboard()) => {
    if (!dashboard) return;
    setLoading(true);
    try {
      const updated = await deletePublicDashboardToken(dashboard.id);
      setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Public dashboard link disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disable public link");
    } finally {
      setLoading(false);
    }
  };

  const openPublicDashboardDisplayDialog = (dashboard: PulseDashboard) =>
    openPublicDashboardDisplayOptionsDialog({
      resolveLink: (options) => ensurePublicDashboardLink(dashboard, options),
    });

  const updateDashboardSettings = async (dashboard: PulseDashboard, input: { name: string; refreshInterval: RefreshIntervalOption }) => {
    const refreshIntervalSeconds = refreshIntervalFromOption(input.refreshInterval);
    const trimmed = input.name.trim();
    if (!trimmed) {
      toast.error("Dashboard name is required");
      return false;
    }
    setLoading(true);
    try {
      const config: PulseDashboardConfig = { ...dashboard.config, refreshIntervalSeconds };
      const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed, config }),
      });
      setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Dashboard updated");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update dashboard");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deleteDashboard = async (dashboard: PulseDashboard) => {
    if (
      !(await prompts.confirm(`Delete dashboard "${dashboard.name}"?`, {
        title: "Delete dashboard",
        variant: "danger",
      }))
    )
      return false;
    setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/dashboards/${dashboard.id}`, { method: "DELETE" });
      const nextDashboards = dashboards().filter((item) => item.id !== dashboard.id);
      setDashboards(nextDashboards);
      const fallback = nextDashboards[0] ?? null;
      if (selectedDashboardId() === dashboard.id)
        navigateWorkspace(fallback ? { view: "dashboard", dashboardId: fallback.id } : { view: "dashboard" });
      toast.success("Dashboard deleted");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete dashboard");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const openDashboardSettingsDialog = async (dashboard: PulseDashboard) => {
    try {
      await openPulseDashboardSettingsDialog({
        currentDashboard: () => dashboards().find((item) => item.id === dashboard.id) ?? dashboard,
        dashboard,
        loading,
        updateDashboardSettings,
        enablePublicLink,
        disablePublicLink,
        deleteDashboard,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open dashboard settings");
    }
  };

  const replaceDashboardControlUrl = (dashboard: PulseDashboard, values: Record<string, string>, config = dashboard.config) => {
    if (typeof window === "undefined" || (activeView() !== "dashboard" && activeView() !== "dashboard-edit")) return;
    const url = new URL(window.location.href);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("c_")) url.searchParams.delete(key);
    }
    for (const control of config.layout?.controls ?? []) {
      const value = values[control.variable] ?? control.defaultValue;
      if (value !== control.defaultValue) url.searchParams.set(`c_${control.variable}`, value);
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };

  const updateDashboardControl = (dashboard: PulseDashboard, control: PulseDashboardControl, value: string, config = dashboard.config) => {
    const nextValues = {
      ...(dashboardControlValues()[dashboard.id] ?? {}),
      [control.variable]: value,
    };
    replaceDashboardControlUrl(dashboard, nextValues, config);
    setDashboardControlValues((current) => ({
      ...current,
      [dashboard.id]: nextValues,
    }));
    queueMicrotask(() => {
      const preview = activeView() === "dashboard-edit" && dashboard.id === selectedDashboard()?.id ? dashboardPreviewConfig() : null;
      void (preview ? refreshDashboardConfig(preview, dashboard) : refreshDashboard(dashboard));
    });
  };

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

  const refreshIntervalForView = (view: WorkspaceView): number | null => {
    if (view === "dashboard") {
      const interval = selectedDashboard()?.config.refreshIntervalSeconds;
      return interval === null ? null : (interval ?? 5);
    }
    if (
      view === "sources" ||
      view === "resources" ||
      view === "resource-detail" ||
      view === "activity-events" ||
      view === "activity-states" ||
      view === "activity-metrics"
    )
      return 5;
    return null;
  };

  onMount(() => {
    if (!origin()) setOrigin(window.location.origin);
    if (activeView() !== "resources" && activeView() !== "resource-detail") void loadBaseData();
  });

  createEffect(() => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    setQueryHistory(readQueryHistory(baseId));
  });

  createEffect(() => {
    const baseId = selectedBaseId();
    const view = activeView();
    selectedDashboardId();
    selectedDashboard()?.config.refreshIntervalSeconds;
    if (!baseId) return;
    const intervalSeconds = refreshIntervalForView(view);
    if (intervalSeconds === null) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentRefresh: AbortController | undefined;
    let failures = 0;

    const run = () => {
      if (disposed) return;
      if (document.hidden) {
        schedule(intervalSeconds * 1000);
        return;
      }

      currentRefresh?.abort();
      const refresh = new AbortController();
      currentRefresh = refresh;
      const task =
        view === "dashboard"
          ? refreshDashboardView(baseId, refresh.signal)
          : view === "sources"
            ? refreshSourcesView(baseId, refresh.signal)
            : view === "resources" || view === "resource-detail"
              ? refreshResourceView(baseId, refresh.signal)
              : refreshActivityView(baseId, refresh.signal);

      task
        .then(() => {
          failures = 0;
        })
        .catch((error) => {
          if (refresh.signal.aborted) return;
          failures += 1;
          console.warn("Pulse workspace refresh failed", error);
        })
        .finally(() => {
          if (currentRefresh === refresh) currentRefresh = undefined;
          schedule(Math.min(60_000, intervalSeconds * 1000 * Math.max(1, 2 ** failures)));
        });
    };

    const schedule = (delayMs: number) => {
      if (disposed) return;
      timer = setTimeout(run, delayMs + Math.floor(Math.random() * 350));
    };

    schedule(intervalSeconds * 1000);
    onCleanup(() => {
      disposed = true;
      if (timer) clearTimeout(timer);
      currentRefresh?.abort();
    });
  });

  createEffect(() => {
    const dashboard = selectedDashboard();
    const controls = dashboard?.config.layout?.controls ?? [];
    if (!dashboard || !controls.length) return;
    setDashboardControlValues((current) => {
      if (current[dashboard.id]) return current;
      return {
        ...current,
        [dashboard.id]: Object.fromEntries(controls.map((control) => [control.variable, control.defaultValue])),
      };
    });
  });

  createEffect(() => {
    const dashboard = selectedDashboard();
    const view = activeView();
    if (dashboard && (view === "dashboard" || view === "dashboard-edit")) void refreshDashboard(dashboard);
  });

  createEffect(() => {
    const dashboard = selectedDashboard();
    if (activeView() !== "dashboard-edit" || !dashboard) return;
    if (dashboardDslSeededFor() === dashboard.id) return;
    const text = dashboardToDsl(dashboard);
    setDashboardDslText(text);
    setDashboardPreviewConfig(dashboard.config);
    setDashboardDslDiagnostics(null);
    setDashboardDslDiagnosticsText("");
    setDashboardDslSeededFor(dashboard.id);
    void refreshDashboard(dashboard);
  });

  createEffect(() => {
    const dashboard = selectedDashboard();
    const text = dashboardDslText();
    if (activeView() !== "dashboard-edit" || !dashboard || dashboardDslSeededFor() !== dashboard.id) return;
    const timeout = setTimeout(() => void compileDashboardDslPreview(dashboard, text), 350);
    onCleanup(() => clearTimeout(timeout));
  });

  createEffect(() => {
    if (activeView() !== "explorer" || querySeeded() || queryText().trim() || metrics().length === 0) return;
    setQueryText(defaultPulseQuery(metrics()));
    setQuerySeeded(true);
  });

  createEffect(() => {
    if (activeView() !== "explorer") {
      setQueryDiagnostics(null);
      return;
    }
    const baseId = selectedBaseId();
    const query = currentExplorerQuery();
    if (!baseId || !query) {
      setQueryDiagnostics(null);
      return;
    }
    setQueryDiagnostics(null);
    let canceled = false;
    const timeout = setTimeout(() => {
      void jsonFetch<PulseQueryCompileResult>("/api/pulse/query/compile-text", {
        method: "POST",
        body: JSON.stringify({ baseId, query }),
      })
        .then((result) => {
          if (canceled || query !== currentExplorerQuery()) return;
          setQueryDiagnostics(result);
          if (result.ok && result.compiled && query !== lastAutoRunQuery) {
            lastAutoRunQuery = query;
            void runTextQuery({ query, manual: false, remember: false });
          }
        })
        .catch((error) => {
          if (canceled) return;
          setQueryDiagnostics({
            ok: false,
            diagnostics: [{ severity: "error", message: error instanceof Error ? error.message : "Could not compile query" }],
            compiled: null,
          });
        });
    }, 250);
    onCleanup(() => {
      canceled = true;
      clearTimeout(timeout);
    });
  });

  createEffect(() => {
    if (activeView() !== "explorer") return;
    void loadSeries(selectedBaseId(), selectedMetric(), selectedQuerySourceId()).catch(() => {
      setSeries([]);
      setSelectedSeriesId("");
    });
  });

  createEffect(() => {
    if (activeView() !== "explorer") return;
    const compiled = compiledMetricQuery();
    const baseId = selectedBaseId();
    if (!compiled || !baseId) return;
    void loadSeries(baseId, compiled.metric, compiled.sourceId ?? "").catch(() => {
      setSeries([]);
      setSelectedSeriesId("");
    });
  });

  createEffect(() => {
    const view = activeView();
    if (view !== "resources" && view !== "resource-detail") return;
    const baseId = selectedBaseId();
    if (!baseId) return;
    if (view === "resources") {
      resourceSearch();
      resourceSourceFilter();
      resourceTypeFilter();
    } else {
      selectedResourceKey();
    }

    const refresh = new AbortController();
    void refreshResourceView(baseId, refresh.signal).catch(() => {
      if (refresh.signal.aborted) return;
      setInventory((current) =>
        view === "resources"
          ? { ...current, resources: [] }
          : {
              ...current,
              metrics: [],
              states: [],
              events: [],
            },
      );
    });
    onCleanup(() => refresh.abort());
  });

  createEffect(() => {
    const view = activeView();
    if (view !== "explorer" && view !== "activity-events" && view !== "activity-states" && view !== "activity-metrics") return;
    const baseId = selectedBaseId();
    activitySearch();
    metricTypeFilter();
    const refresh = new AbortController();
    void loadActivityData(baseId, refresh.signal).catch(() => {
      if (refresh.signal.aborted) return;
      setRecentEvents([]);
      setCurrentStates([]);
      setActivityMetrics([]);
    });
    onCleanup(() => refresh.abort());
  });

  createEffect(() => {
    const view = activeView();
    const signalId = focusedSignalId();
    focusedSearch();
    if (view !== "metric-detail" && view !== "state-detail" && view !== "event-detail") return;
    if (!signalId) return;
    const refresh = new AbortController();
    void loadFocusedRows({ signal: refresh.signal }).catch(() => {
      if (refresh.signal.aborted) return;
      setFocusedHasMore(false);
      if (view === "metric-detail") setFocusedMetricSeries([]);
      if (view === "state-detail") setFocusedStates([]);
      if (view === "event-detail") setFocusedEvents([]);
    });
    onCleanup(() => refresh.abort());
  });

  createEffect(() => {
    const source = selectedSource();
    if (!source || activeView() !== "sources") return;
    void loadSourceScrapes(selectedBaseId(), source.id).catch(() => {
      setSourceScrapes((current) => ({ ...current, [source.id]: [] }));
    });
    if (source.kind === "http_ingest") {
      void loadSourceApiKeys(selectedBaseId(), source.id).catch(() => {
        setSourceApiKeys((current) => ({ ...current, [source.id]: [] }));
      });
    }
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
      <div
        class="sidebar-item group text-xs"
        classList={{
          "sidebar-item-active":
            (activeView() === "dashboard" || activeView() === "dashboard-edit") && selectedDashboard()?.id === dashboard.id,
        }}
        title={dashboard.name}
      >
        <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openDashboard(dashboard.id)}>
          <i class="ti ti-chart-area-line text-sm" />
          <span class="truncate">{dashboard.name}</span>
        </button>
        <button
          type="button"
          class="sidebar-item-action opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={`Edit ${dashboard.name} dashboard DSL`}
          title="Edit dashboard DSL"
          onClick={(event) => {
            event.stopPropagation();
            openDashboardEditor(dashboard.id);
          }}
        >
          <i class="ti ti-code text-xs" />
        </button>
      </div>
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

  const renderDashboardView = () => (
    <DashboardView dashboard={selectedDashboard} context={dashboardRenderContext} />
  );

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
        initialDockState={props.initialDashboardEditorDockState}
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

  const createSourceApiKey = async (source: PulseSource, input: Parameters<ResourceApiKeysProps["createKey"]>[0]) => {
    const baseId = selectedBaseId();
    if (!baseId) throw new Error("No Pulse base selected.");
    const created = await jsonFetch<{ credential: ResourceApiKey; token: string }>(`/api/pulse/bases/${baseId}/sources/${source.id}/api-keys`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    setSourceApiKeys((current) => ({ ...current, [source.id]: [created.credential, ...(current[source.id] ?? [])] }));
    return created;
  };

  const revokeSourceApiKey = async (source: PulseSource, credentialId: string) => {
    const baseId = selectedBaseId();
    if (!baseId) throw new Error("No Pulse base selected.");
    await jsonFetch<void>(`/api/pulse/bases/${baseId}/sources/${source.id}/api-keys/${credentialId}`, { method: "DELETE" });
    setSourceApiKeys((current) => ({
      ...current,
      [source.id]: (current[source.id] ?? []).filter((key) => key.id !== credentialId),
    }));
  };

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
      panesValue={sourcePanesValue}
      setPanesValue={setSourcePanesValue}
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
      panesValue={focusedPanesValue}
      setPanesValue={setFocusedPanesValue}
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
      <DockWorkspace storageKey="pulse.query-explorer" initialState={props.initialExplorerDockState} defaultResultSize={42} class="h-full min-h-0">
        <DockWorkspace.Result hideHeader>
          {renderExplorerResultPane()}
        </DockWorkspace.Result>
        <DockWorkspace.Pane id="editor" title="Query" icon="ti ti-code" section="editor">
          {renderQueryEditorPane()}
        </DockWorkspace.Pane>
        <DockWorkspace.Pane id="browse" title="Browse" icon="ti ti-list-search" section="context">
          {renderBrowseExplorerPane()}
        </DockWorkspace.Pane>
        <DockWorkspace.Pane id="saved" title="Saved" icon="ti ti-device-floppy" section="context">
          <SavedQueriesPane
            queries={savedQueries}
            currentQuery={currentExplorerQuery}
            loading={loading}
            onSelect={setQueryText}
            onSaveCurrent={saveCurrentQuery}
            onRemove={removeSavedQuery}
          />
        </DockWorkspace.Pane>
        <DockWorkspace.Pane id="history" title="History" icon="ti ti-history" section="context">
          <QueryHistoryPane history={queryHistory} dateContext={pulseDateContext} onSelect={setQueryText} />
        </DockWorkspace.Pane>
      </DockWorkspace>
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

  return (
    <AppWorkspace class={activeView() === "explorer" ? "min-h-0" : "min-h-[760px]"}>
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
        retentionDays={selectedBase()?.retentionDays ?? 30}
        timescaleEnabled={Boolean(props.initialCapabilities?.timescaleEnabled)}
        settingsDisabled={!selectedBase() || loading()}
        openSettings={openSettingsDialog}
        createDashboard={createDashboard}
        renderDashboardItem={renderDashboardSidebarItem}
        openResources={openResources}
        openSources={openSources}
        openQueryExplorer={openQueryExplorer}
        openActivityEvents={openActivityEvents}
        openActivityStates={openActivityStates}
        openActivityMetrics={openActivityMetrics}
      />

      <AppWorkspace.Main class={activeView() === "explorer" ? "gap-3 overflow-hidden" : "gap-3 overflow-y-auto"}>
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

    </AppWorkspace>
  );
}
