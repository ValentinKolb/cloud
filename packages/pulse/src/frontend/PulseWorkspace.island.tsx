import {
  AppWorkspace,
  AutocompleteEditor,
  Chart,
  DataTable,
  dialogCore,
  DockWorkspace,
  FilterChip,
  MarkdownView,
  NumberInput,
  Panes,
  PanelDialog,
  panelDialogOptions,
  PermissionEditor,
  prompts,
  SegmentedControl,
  SelectInput,
  SettingsModal,
  StructuredDataPreview,
  TextInput,
  toast,
  type DataTableColumn,
  type PanesValue,
  type ResourceApiKey,
} from "@valentinkolb/cloud/ui";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import { markdown } from "@valentinkolb/cloud/shared";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type {
  Aggregation,
  MetricType,
  PanelVisual,
  PulseBase,
  PulseCapabilitySnapshot,
  PulseCurrentState,
  PulseDashboard,
  PulseDashboardCardWidget,
  PulseDashboardCondition,
  PulseDashboardConfig,
  PulseDashboardControl,
  PulseDashboardDslCompileResult,
  PulseDashboardEventsWidget,
  PulseDashboardMarkdownWidget,
  PulseDashboardMetricWidget,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
  PulseExplorerQuery,
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
import { buildPulseQuery, buildPulseQueryCompletions, defaultPulseQuery, pulseDashboardDslHighlight, pulseQueryHighlight } from "./query-authoring";
import { FocusedEventDetail, FocusedMetricSeriesDetail, FocusedStateDetail } from "./workspace/FocusedSignalDetails";
import PulseSidebar from "./workspace/PulseSidebar";
import ResourceBrowserView from "./workspace/ResourceBrowserView";
import ResourceDetailView from "./workspace/ResourceDetailView";
import SourceDetailView from "./workspace/SourceDetailView";
import { navigatePulseWorkspace, replacePulseWorkspaceUrl } from "./workspace/navigation";
import { buildPulseWorkspaceHref, readResourceQueryState } from "./workspace/routes";
import {
  DASHBOARD_REFRESH_OPTIONS,
  FOCUSED_PAGE_SIZE,
  METRIC_TYPE_FILTER_OPTIONS,
  RESULT_VIEW_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  VISUAL_OPTIONS,
  compactDate,
  compactDateWithDelta,
  compactMetricUnit,
  dashboardCellSpan,
  dashboardEventQueryText,
  dashboardLayoutWidgets,
  dashboardEventsWidgets,
  dashboardMetricQueryText,
  dashboardMetricWidgets,
  dashboardStateQueryText,
  dashboardStatesWidgets,
  dashboardToDsl,
  dashboardWidgetSnippetFromQuery,
  defaultPulseDateContext,
  dimensionsSummary,
  eventGroupId,
  formatIngestCounts,
  formatSignalValue,
  formatValue,
  gaugeMax,
  jsonFetch,
  normalizeEndpointInput,
  openQueryReferenceWindow,
  parseScrapeInterval,
  plural,
  pointsToBars,
  pointsToHeatmap,
  pointsToHistogram,
  queryPointColumns,
  quoteDashboardDslString,
  quoteQueryPart,
  readActivityQueryState,
  readQueryHistory,
  refreshIntervalFromOption,
  refreshOptionFromConfig,
  seriesLabel,
  signalResourceKey,
  signalSubject,
  sourceKindIcon,
  sourceStatus,
  starterDashboardDsl,
  stateGroupId,
  stateRowId,
  suggestionTagClass,
  writeQueryHistory,
} from "./workspace/helpers";
import type {
  ActivityEventGroup,
  ActivityStateGroup,
  BrowseEntity,
  CreateSourceInput,
  ExplorerResultView,
  GrantableLevel,
  MetricTextQueryResult,
  PulseWorkspaceProps,
  QueryHistoryEntry,
  RefreshIntervalOption,
  SourceCreateKind,
  WorkspaceView,
} from "./workspace/types";

const createPulseListDetailPanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "pulse-list-detail-root",
    direction: "horizontal",
    sizes: [68, 32],
    children: [
      {
        type: "leaf",
        id: "list",
        elementIds: ["list"],
        activeElementId: "list",
        presentation: "single",
      },
      {
        type: "leaf",
        id: "detail",
        elementIds: ["detail"],
        activeElementId: "detail",
        presentation: "single",
      },
    ],
  },
});

type SignalCatalogKind = "events" | "states" | "metrics";
type PublicDashboardDisplayTheme = "light" | "dark";
type PublicDashboardDisplayHeight = "scroll" | "full";

const signalCatalogKindForView = (view: WorkspaceView): SignalCatalogKind =>
  view === "activity-states" ? "states" : view === "activity-metrics" ? "metrics" : "events";

const dashboardSpanClasses: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  9: "lg:col-span-9",
  10: "lg:col-span-10",
  11: "lg:col-span-11",
  12: "lg:col-span-12",
};

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
  const [sourcePanesValue, setSourcePanesValue] = createSignal<PanesValue>(createPulseListDetailPanesValue());
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
  const [focusedPanesValue, setFocusedPanesValue] = createSignal<PanesValue>(createPulseListDetailPanesValue());
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
  const eventGroups = createMemo<ActivityEventGroup[]>(() => {
    const groups = new Map<string, ActivityEventGroup>();
    for (const event of recentEvents()) {
      const id = eventGroupId(event);
      const current =
        groups.get(id) ??
        ({
          id,
          kind: event.kind,
          subject: signalSubject(event),
          sourceId: event.sourceId,
          latest: event,
          rows: [],
        } satisfies ActivityEventGroup);
      current.rows.push(event);
      if (Date.parse(event.ts) > Date.parse(current.latest.ts)) current.latest = event;
      groups.set(id, current);
    }
    for (const group of groups.values()) group.rows.sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts));
    return [...groups.values()].sort((left, right) => Date.parse(right.latest.ts) - Date.parse(left.latest.ts));
  });
  const stateGroups = createMemo<ActivityStateGroup[]>(() => {
    const groups = new Map<string, ActivityStateGroup>();
    for (const state of currentStates()) {
      const id = stateGroupId(state);
      const current =
        groups.get(id) ??
        ({
          id,
          key: state.key,
          sourceId: state.sourceId,
          latest: state,
          rows: [],
        } satisfies ActivityStateGroup);
      current.rows.push(state);
      if (Date.parse(state.updatedAt) > Date.parse(current.latest.updatedAt)) current.latest = state;
      groups.set(id, current);
    }
    for (const group of groups.values()) group.rows.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return [...groups.values()].sort((left, right) => Date.parse(right.latest.updatedAt) - Date.parse(left.latest.updatedAt));
  });
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
  const sourceColumns: DataTableColumn<PulseSource>[] = [
    { id: "source", header: "Source", value: "name", cellClass: "min-w-56" },
    { id: "status", header: "Status", cellClass: "w-28 whitespace-nowrap" },
    { id: "resources", header: "Resources", cellClass: "w-24 whitespace-nowrap" },
    { id: "signals", header: "Signals", cellClass: "w-32 whitespace-nowrap" },
    { id: "target", header: "Target", cellClass: "min-w-48" },
    { id: "seen", header: "Last seen", cellClass: "w-48 whitespace-nowrap" },
  ];
  const sourceScrapeColumns: DataTableColumn<PulseSourceScrape>[] = [
    { id: "status", header: "Status", cellClass: "w-28 whitespace-nowrap" },
    { id: "finished", header: "Finished", cellClass: "w-44 whitespace-nowrap" },
    { id: "samples", header: "Data", cellClass: "w-28 whitespace-nowrap" },
    { id: "duration", header: "Time", cellClass: "w-20 whitespace-nowrap" },
    { id: "error", header: "Error", cellClass: "min-w-40" },
  ];
  const eventColumns: DataTableColumn<PulseRecordedEvent>[] = [
    { id: "kind", header: "Event", value: "kind", cellClass: "min-w-52" },
    { id: "subject", header: "Subject", cellClass: "min-w-56" },
    { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
    { id: "dimensions", header: "Dimensions", cellClass: "min-w-56" },
    { id: "value", header: "Value", cellClass: "w-24 whitespace-nowrap" },
    { id: "time", header: "Time", cellClass: "w-44 whitespace-nowrap" },
  ];
  const eventGroupColumns: DataTableColumn<ActivityEventGroup>[] = [
    { id: "kind", header: "Event", value: "kind", cellClass: "min-w-52" },
    { id: "subject", header: "Subject", value: "subject", cellClass: "min-w-56" },
    { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
    { id: "value", header: "Latest value", cellClass: "min-w-32 whitespace-nowrap" },
    { id: "count", header: "Rows", cellClass: "w-20 whitespace-nowrap" },
    { id: "time", header: "Latest", cellClass: "w-44 whitespace-nowrap" },
  ];
  const stateColumns: DataTableColumn<PulseCurrentState>[] = [
    { id: "key", header: "State", value: "key", cellClass: "min-w-52" },
    { id: "value", header: "Value", cellClass: "min-w-40" },
    { id: "subject", header: "Subject", cellClass: "min-w-56" },
    { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
    { id: "dimensions", header: "Dimensions", cellClass: "min-w-56" },
    { id: "updated", header: "Updated", cellClass: "w-44 whitespace-nowrap" },
  ];
  const stateGroupColumns: DataTableColumn<ActivityStateGroup>[] = [
    { id: "key", header: "State", value: "key", cellClass: "min-w-52" },
    { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
    { id: "value", header: "Latest value", cellClass: "min-w-40" },
    { id: "updated", header: "Latest", cellClass: "w-44 whitespace-nowrap" },
  ];
  const metricColumns: DataTableColumn<PulseMetricSummary>[] = [
    { id: "name", header: "Metric", value: "name", cellClass: "min-w-72" },
    { id: "type", header: "Type", value: "type", cellClass: "w-24 whitespace-nowrap" },
    { id: "unit", header: "Unit", cellClass: "w-24 whitespace-nowrap" },
    { id: "sources", header: "Sources", cellClass: "w-24 whitespace-nowrap" },
    { id: "resources", header: "Resources", cellClass: "w-28 whitespace-nowrap" },
    { id: "series", header: "Variants", cellClass: "w-24 whitespace-nowrap" },
    { id: "lastSeen", header: "Last seen", cellClass: "w-44 whitespace-nowrap" },
  ];
  const metricSeriesColumns: DataTableColumn<PulseMetricSeries>[] = [
    { id: "subject", header: "Subject", cellClass: "min-w-56" },
    { id: "current", header: "Current", cellClass: "w-32 whitespace-nowrap" },
    { id: "source", header: "Source", cellClass: "w-40 whitespace-nowrap" },
    { id: "dimensions", header: "Dimensions", cellClass: "min-w-56" },
    { id: "lastSeen", header: "Last seen", cellClass: "w-44 whitespace-nowrap" },
  ];
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
  const browseEntities = createMemo(() => {
    const entities = new Map<string, BrowseEntity>();
    const resourceIds = new Set(inventory().resources.map((resource) => resource.id));
    for (const resource of inventory().resources) {
      entities.set(resource.id, {
        id: resource.id,
        type: resource.type,
        sourceIds: resource.sourceIds,
        metricCount: resource.metricCount,
        eventCount: resource.eventCount,
        stateCount: resource.stateCount,
        dimensions: resource.dimensions,
      });
    }
    const ensure = (entityId: string | null, entityType: string | null, sourceId: string | null, dimensions: Record<string, string>) => {
      if (!entityId) return null;
      const current =
        entities.get(entityId) ??
        ({
          id: entityId,
          type: entityType,
          sourceIds: [],
          metricCount: 0,
          eventCount: 0,
          stateCount: 0,
          dimensions: {},
        } satisfies BrowseEntity);
      if (!current.type && entityType) current.type = entityType;
      if (sourceId && !current.sourceIds.includes(sourceId)) current.sourceIds.push(sourceId);
      current.dimensions = { ...dimensions, ...current.dimensions };
      entities.set(entityId, current);
      return current;
    };
    for (const item of series()) {
      const entity = ensure(item.entityId, item.entityType, item.sourceId, item.dimensions);
      if (entity && !resourceIds.has(entity.id)) entity.metricCount += 1;
    }
    for (const item of recentEvents()) {
      const entity = ensure(item.entityId, item.entityType, item.sourceId, item.dimensions);
      if (entity && !resourceIds.has(entity.id)) entity.eventCount += 1;
    }
    for (const item of currentStates()) {
      const entity = ensure(item.entityId, item.entityType, item.sourceId, item.dimensions);
      if (entity && !resourceIds.has(entity.id)) entity.stateCount += 1;
    }
    return [...entities.values()].sort((left, right) => {
      const rightCount = right.metricCount + right.eventCount + right.stateCount;
      const leftCount = left.metricCount + left.eventCount + left.stateCount;
      return rightCount - leftCount || left.id.localeCompare(right.id);
    });
  });
  const selectedBrowseEntity = createMemo(() => browseEntities().find((entity) => entity.id === browseEntityId()) ?? null);
  const browseMatches = (values: Array<string | null | undefined>) => {
    const needle = browseSearchNeedle();
    if (!needle) return true;
    return values.some((value) => value?.toLowerCase().includes(needle));
  };
  const browseScopedSeries = createMemo(() =>
    series().filter((item) => {
      if (browseSourceId() && item.sourceId !== browseSourceId()) return false;
      if (browseEntityId() && item.entityId !== browseEntityId()) return false;
      return true;
    }),
  );
  const browseSources = createMemo(() =>
    sources()
      .map((source) => ({
        source,
        metricCount: series().filter((item) => item.sourceId === source.id).length,
        eventCount: recentEvents().filter((item) => item.sourceId === source.id).length,
        stateCount: currentStates().filter((item) => item.sourceId === source.id).length,
      }))
      .filter(({ source }) => browseMatches([source.name, source.kind, source.endpointUrl ?? "", source.lastError ?? ""]))
      .slice(0, 24),
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
    metrics()
      .map((metric) => {
        const scopedSeries = browseScopedSeries().filter((item) => item.metric === metric.name);
        const sampleSeries = scopedSeries[0] ?? series().find((item) => item.metric === metric.name);
        return {
          metric,
          seriesCount: scopedSeries.length > 0 ? scopedSeries.length : metric.seriesCount,
          sampleDimensions: browseEntityId() ? (sampleSeries?.dimensions ?? selectedBrowseEntity()?.dimensions ?? {}) : {},
        };
      })
      .filter((item) => {
        if (
          browseEntityId() &&
          browseScopedSeries().length > 0 &&
          !browseScopedSeries().some((series) => series.metric === item.metric.name)
        ) {
          return false;
        }
        return browseMatches([
          item.metric.name,
          item.metric.type,
          item.metric.unit ?? "",
          ...Object.keys(item.sampleDimensions),
          ...Object.values(item.sampleDimensions),
        ]);
      })
      .slice(0, 60),
  );
  const browseEvents = createMemo(() => {
    const groups = new Map<string, { kind: string; count: number; sample: PulseRecordedEvent }>();
    for (const event of recentEvents()) {
      if (browseSourceId() && event.sourceId !== browseSourceId()) continue;
      if (browseEntityId() && event.entityId !== browseEntityId()) continue;
      if (
        !browseMatches([event.kind, event.entityId, event.entityType, ...Object.keys(event.dimensions), ...Object.values(event.dimensions)])
      )
        continue;
      const current = groups.get(event.kind);
      groups.set(event.kind, { kind: event.kind, count: (current?.count ?? 0) + 1, sample: current?.sample ?? event });
    }
    return [...groups.values()].sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind)).slice(0, 40);
  });
  const browseStates = createMemo(() => {
    const groups = new Map<string, { key: string; count: number; sample: PulseCurrentState }>();
    for (const state of currentStates()) {
      if (browseSourceId() && state.sourceId !== browseSourceId()) continue;
      if (browseEntityId() && state.entityId !== browseEntityId()) continue;
      if (
        !browseMatches([state.key, state.entityId, state.entityType, ...Object.keys(state.dimensions), ...Object.values(state.dimensions)])
      )
        continue;
      const current = groups.get(state.key);
      groups.set(state.key, { key: state.key, count: (current?.count ?? 0) + 1, sample: current?.sample ?? state });
    }
    return [...groups.values()].sort((left, right) => right.count - left.count || left.key.localeCompare(right.key)).slice(0, 40);
  });
  const browseLabels = createMemo(() => {
    const labels = new Map<string, Map<string, number>>();
    const add = (dimensions: Record<string, string>) => {
      for (const [key, value] of Object.entries(dimensions)) {
        if (!labels.has(key)) labels.set(key, new Map());
        const values = labels.get(key)!;
        values.set(value, (values.get(value) ?? 0) + 1);
      }
    };
    for (const item of browseScopedSeries()) add(item.dimensions);
    for (const item of recentEvents()) {
      if (browseSourceId() && item.sourceId !== browseSourceId()) continue;
      if (browseEntityId() && item.entityId !== browseEntityId()) continue;
      add(item.dimensions);
    }
    for (const item of currentStates()) {
      if (browseSourceId() && item.sourceId !== browseSourceId()) continue;
      if (browseEntityId() && item.entityId !== browseEntityId()) continue;
      add(item.dimensions);
    }
    return [...labels.entries()]
      .map(([key, values]) => ({
        key,
        count: [...values.values()].reduce((sum, value) => sum + value, 0),
        values: [...values.entries()]
          .map(([value, count]) => ({ key, value, count }))
          .filter((item) => browseMatches([item.key, item.value]))
          .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
          .slice(0, 8),
      }))
      .filter((group) => group.values.length > 0)
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
      .slice(0, 12);
  });
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
    const [nextSources, nextMetrics, nextInventory, nextDashboards, nextSavedQueries] = await Promise.all([
      jsonFetch<PulseSource[]>(`/api/pulse/bases/${baseId}/sources`, { signal }),
      jsonFetch<PulseMetricSummary[]>(`/api/pulse/bases/${baseId}/metrics`, { signal }),
      jsonFetch<PulseInventory>(`/api/pulse/bases/${baseId}/inventory`, { signal }),
      jsonFetch<PulseDashboard[]>(`/api/pulse/bases/${baseId}/dashboards`, { signal }),
      jsonFetch<PulseSavedQuery[]>(`/api/pulse/bases/${baseId}/saved-queries`, { signal }),
    ]);
    setSources(nextSources);
    setMetrics(nextMetrics);
    setInventory(nextInventory);
    setSelectedResourceKey((current) => (current && nextInventory.resources.some((resource) => resource.key === current) ? current : (nextInventory.resources[0]?.key ?? "")));
    setDashboards(nextDashboards);
    setSavedQueries(nextSavedQueries);
    setSelectedMetric((current) =>
      current && nextMetrics.some((metric) => metric.name === current) ? current : (nextMetrics[0]?.name ?? ""),
    );
    setSelectedSourceId((current) => (current && nextSources.some((source) => source.id === current) ? current : ""));
    setSelectedDashboardId((current) => nextDashboards.find((dashboard) => dashboard.id === current)?.id ?? nextDashboards[0]?.id ?? "");
  };

  const activityQueryParams = (
    includeType = false,
    snapshot: { q: string; type: "" | MetricType } = { q: activitySearch().trim(), type: metricTypeFilter() },
  ) => {
    const params = new URLSearchParams();
    if (snapshot.q) params.set("q", snapshot.q);
    if (includeType && snapshot.type) params.set("type", snapshot.type);
    return params;
  };

  const loadActivityData = async (baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const requestId = ++activityDataRequestId;
    const snapshot = { q: activitySearch().trim(), type: metricTypeFilter() };
    const eventParams = activityQueryParams(false, snapshot);
    const stateParams = activityQueryParams(false, snapshot);
    const metricParams = activityQueryParams(true, snapshot);
    const [nextEvents, nextStates, nextMetrics] = await Promise.all([
      jsonFetch<PulseRecordedEvent[]>(`/api/pulse/bases/${baseId}/recent-events?${eventParams}`, { signal }),
      jsonFetch<PulseCurrentState[]>(`/api/pulse/bases/${baseId}/states?${stateParams}`, { signal }),
      jsonFetch<PulseMetricSummary[]>(`/api/pulse/bases/${baseId}/metrics?${metricParams}`, { signal }),
    ]);
    if (
      signal?.aborted ||
      requestId !== activityDataRequestId ||
      selectedBaseId() !== baseId ||
      activitySearch().trim() !== snapshot.q ||
      metricTypeFilter() !== snapshot.type
    ) {
      return;
    }
    setRecentEvents(nextEvents);
    setCurrentStates(nextStates);
    setActivityMetrics(nextMetrics);
  };

  const loadSeries = async (baseId = selectedBaseId(), metric = selectedMetric(), sourceId = selectedQuerySourceId()) => {
    if (!baseId || !metric) {
      setSeries([]);
      setSelectedSeriesId("");
      return;
    }
    const params = new URLSearchParams({ metric });
    if (sourceId) params.set("sourceId", sourceId);
    const nextSeries = await jsonFetch<PulseMetricSeries[]>(`/api/pulse/bases/${baseId}/series?${params}`);
    setSeries(nextSeries);
    setSelectedSeriesId((current) => (current && nextSeries.some((item) => item.id === current) ? current : ""));
  };

  const fetchMetricSeries = async (baseId: string, metric: string, sourceId?: string | null) => {
    const params = new URLSearchParams({ metric });
    if (sourceId) params.set("sourceId", sourceId);
    return jsonFetch<PulseMetricSeries[]>(`/api/pulse/bases/${baseId}/series?${params}`);
  };

  const loadFocusedRows = async (options: { append?: boolean } = {}) => {
    const baseId = selectedBaseId();
    const view = activeView();
    const signalId = focusedSignalId();
    if (!baseId || !signalId || (view !== "metric-detail" && view !== "state-detail" && view !== "event-detail")) return;
    const requestId = ++focusedRowsRequestId;

    const offset =
      options.append && view === "metric-detail"
        ? focusedMetricSeries().length
        : options.append && view === "state-detail"
          ? focusedStates().length
          : options.append && view === "event-detail"
            ? focusedEvents().length
            : 0;
    const params = new URLSearchParams({
      limit: String(FOCUSED_PAGE_SIZE + 1),
      offset: String(offset),
    });
    const search = focusedSearch().trim();
    if (search) params.set("q", search);

    setFocusedLoadingMore(true);
    try {
      if (view === "metric-detail") {
        params.set("metric", signalId);
        const rows = await jsonFetch<PulseMetricSeries[]>(`/api/pulse/bases/${baseId}/series?${params}`);
        if (requestId !== focusedRowsRequestId) return;
        setFocusedHasMore(rows.length > FOCUSED_PAGE_SIZE);
        const page = rows.slice(0, FOCUSED_PAGE_SIZE);
        setFocusedMetricSeries((current) => (options.append ? [...current, ...page] : page));
        return;
      }
      if (view === "state-detail") {
        params.set("key", signalId);
        const rows = await jsonFetch<PulseCurrentState[]>(`/api/pulse/bases/${baseId}/states?${params}`);
        if (requestId !== focusedRowsRequestId) return;
        setFocusedHasMore(rows.length > FOCUSED_PAGE_SIZE);
        const page = rows.slice(0, FOCUSED_PAGE_SIZE);
        setFocusedStates((current) => (options.append ? [...current, ...page] : page));
        return;
      }
      params.set("kind", signalId);
      const rows = await jsonFetch<PulseRecordedEvent[]>(`/api/pulse/bases/${baseId}/recent-events?${params}`);
      if (requestId !== focusedRowsRequestId) return;
      setFocusedHasMore(rows.length > FOCUSED_PAGE_SIZE);
      const page = rows.slice(0, FOCUSED_PAGE_SIZE);
      setFocusedEvents((current) => (options.append ? [...current, ...page] : page));
    } finally {
      if (requestId === focusedRowsRequestId) setFocusedLoadingMore(false);
    }
  };

  const loadSourceScrapes = async (baseId = selectedBaseId(), sourceId = selectedSourceId(), signal?: AbortSignal) => {
    if (!baseId || !sourceId) return;
    const nextScrapes = await jsonFetch<PulseSourceScrape[]>(`/api/pulse/bases/${baseId}/sources/${sourceId}/scrapes`, { signal });
    setSourceScrapes((current) => ({ ...current, [sourceId]: nextScrapes }));
  };

  const loadSourceApiKeys = async (baseId = selectedBaseId(), sourceId = selectedSourceId(), signal?: AbortSignal) => {
    if (!baseId || !sourceId) return;
    const nextKeys = await jsonFetch<ResourceApiKey[]>(`/api/pulse/bases/${baseId}/sources/${sourceId}/api-keys`, { signal });
    setSourceApiKeys((current) => ({ ...current, [sourceId]: nextKeys }));
  };

  const dashboardValues = (dashboard = selectedDashboard(), config = dashboard?.config) => {
    if (!dashboard) return {};
    const defaults = Object.fromEntries((config?.layout?.controls ?? []).map((control) => [control.variable, control.defaultValue]));
    return { ...defaults, ...(dashboardControlValues()[dashboard.id] ?? {}) };
  };

  const quoteDashboardQueryValue = (value: string): string => quoteQueryPart(value);

  const resolveDashboardQueryText = (text: string, dashboard = selectedDashboard(), config = dashboard?.config): string => {
    const values = dashboardValues(dashboard, config);
    return text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, variable: string) =>
      typeof values[variable] === "string" ? quoteDashboardQueryValue(values[variable]) : match,
    );
  };

  const loadMetricWidget = async (
    widget: PulseDashboardMetricWidget,
    baseId = selectedBaseId(),
    signal?: AbortSignal,
    dashboard = selectedDashboard(),
    config = dashboard?.config,
  ) => {
    if (!baseId) return;
    const query =
      widget.queryText && widget.query
        ? resolveDashboardQueryText(widget.queryText, dashboard, config)
        : dashboardMetricQueryText(
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
    const data = await jsonFetch<{ points: MetricQueryPoint[] }>("/api/pulse/query/metric-text", {
      method: "POST",
      signal,
      body: JSON.stringify({ baseId, query }),
    });
    setMetricWidgetPoints((current) => ({ ...current, [widget.id]: data.points ?? [] }));
  };

  const loadDashboardEventsWidget = async (
    widget: PulseDashboardEventsWidget,
    baseId = selectedBaseId(),
    signal?: AbortSignal,
    dashboard = selectedDashboard(),
    config = dashboard?.config,
  ) => {
    if (!baseId) return;
    const data = await jsonFetch<{ events: PulseRecordedEvent[] }>("/api/pulse/query/metric-text", {
      method: "POST",
      signal,
      body: JSON.stringify({ query: resolveDashboardQueryText(widget.queryText || dashboardEventQueryText(widget.query), dashboard, config), baseId }),
    });
    setDashboardEvents((current) => ({ ...current, [widget.id]: data.events ?? [] }));
  };

  const loadDashboardStatesWidget = async (
    widget: PulseDashboardStatesWidget,
    baseId = selectedBaseId(),
    signal?: AbortSignal,
    dashboard = selectedDashboard(),
    config = dashboard?.config,
  ) => {
    if (!baseId) return;
    const data = await jsonFetch<{ states: PulseCurrentState[] }>("/api/pulse/query/metric-text", {
      method: "POST",
      signal,
      body: JSON.stringify({ query: resolveDashboardQueryText(widget.queryText || dashboardStateQueryText(widget.query), dashboard, config), baseId }),
    });
    setDashboardStates((current) => ({ ...current, [widget.id]: data.states ?? [] }));
  };

  const refreshDashboardConfig = async (config: PulseDashboardConfig, dashboard = selectedDashboard(), baseId = selectedBaseId(), signal?: AbortSignal) => {
    if (!dashboard || !baseId) return;
    await Promise.all([
      ...dashboardMetricWidgets(config).map((widget) => loadMetricWidget(widget, baseId, signal, dashboard, config).catch(() => undefined)),
      ...dashboardEventsWidgets(config).map((widget) => loadDashboardEventsWidget(widget, baseId, signal, dashboard, config).catch(() => undefined)),
      ...dashboardStatesWidgets(config).map((widget) => loadDashboardStatesWidget(widget, baseId, signal, dashboard, config).catch(() => undefined)),
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
    const dsl = starterDashboardDsl(name, description);
    setLoading(true);
    try {
      const dashboard = await jsonFetch<PulseDashboard>(`/api/pulse/bases/${baseId}/dashboards`, {
        method: "POST",
        body: JSON.stringify({ name, config: { dsl, layout: null } }),
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

  const openSettingsDialog = async () => {
    if (settingsDialogOpen()) return;
    const base = selectedBase();
    if (!base) return;
    try {
      setLoading(true);
      const accessEntries = await jsonFetch<AccessEntry[]>(`/api/pulse/bases/${base.id}/access`);
      setLoading(false);
      setSettingsDialogOpen(true);

      await prompts.dialog<void>(
        (close) => {
          const [name, setName] = createSignal(base.name);
          const [description, setDescription] = createSignal(base.description ?? "");
          const [retentionDays, setRetentionDays] = createSignal<number | null>(base.retentionDays);
          const saveProfile = async () =>
            updateBaseSettings(base, {
              name: name(),
              description: description(),
              retentionDays: retentionDays() ?? base.retentionDays,
            });

          const saveRetention = async () =>
            updateBaseSettings(base, {
              name: name(),
              description: description(),
              retentionDays: retentionDays() ?? base.retentionDays,
            });

          const grantAccess = (principal: Principal, permission: GrantableLevel) =>
            jsonFetch<AccessEntry>(`/api/pulse/bases/${base.id}/access`, {
              method: "POST",
              body: JSON.stringify({ principal, permission }),
            });

          const updateAccess = (accessId: string, permission: GrantableLevel) =>
            jsonFetch<void>(`/api/pulse/access/${accessId}`, {
              method: "PATCH",
              body: JSON.stringify({ permission }),
            });

          const revokeAccess = (accessId: string) => jsonFetch<void>(`/api/pulse/access/${accessId}`, { method: "DELETE" });

          const clearBaseData = async () => {
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

          const deleteBase = async () => {
            const confirmed = await prompts.confirm(
              `Delete "${base.name}" and all Pulse data in this base? This cannot be undone. Large bases are removed in the background.`,
              {
                title: "Delete Pulse base",
                variant: "danger",
                confirmText: "Delete",
              },
            );
            if (!confirmed) return;

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

              close();
              toast.success("Pulse base deletion started");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not delete Pulse base");
            } finally {
              setLoading(false);
            }
          };

          return (
            <div class="flex h-[86vh] min-h-0 flex-col overflow-hidden">
              <SettingsModal title="Pulse settings" subtitle={base.name} icon="ti ti-activity-heartbeat" onClose={close} closeLabel="Close">
                <SettingsModal.Tab
                  id="general"
                  title="General"
                  icon="ti ti-settings"
                  description="Name and description shown across Pulse."
                >
                  <form
                    class="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveProfile();
                    }}
                  >
                    <TextInput
                      label="Name"
                      description="Shown in the Pulse sidebar, overview, and dashboard headers."
                      icon="ti ti-tag"
                      value={name}
                      onInput={setName}
                      required
                    />
                    <TextInput
                      label="Description"
                      description="Optional context for teammates who can access this Pulse base."
                      icon="ti ti-align-left"
                      value={description}
                      onInput={setDescription}
                      multiline
                      lines={3}
                      placeholder="Optional"
                    />
                    <button type="submit" class="btn-primary btn-sm self-start" disabled={loading() || !name().trim()}>
                      <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
                      Save
                    </button>
                  </form>
                </SettingsModal.Tab>

                <SettingsModal.Tab
                  id="access"
                  title="Access"
                  icon="ti ti-users"
                  description="Grant people and groups access to this Pulse base."
                >
                  <PermissionEditor
                    initialEntries={accessEntries}
                    canEdit
                    grantAccess={grantAccess}
                    updateAccess={updateAccess}
                    revokeAccess={revokeAccess}
                    allowedLevels={[
                      { level: "read", label: "View", icon: "ti-eye" },
                      { level: "write", label: "Edit", icon: "ti-pencil" },
                      { level: "admin", label: "Manage", icon: "ti-shield" },
                    ]}
                  />
                </SettingsModal.Tab>

                <SettingsModal.Tab
                  id="retention"
                  title="Retention"
                  icon="ti ti-clock-cog"
                  description="Control how long raw telemetry stays queryable."
                >
                  <form
                    class="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRetention();
                    }}
                  >
                    <NumberInput
                      label="Raw data retention"
                      description="Pulse keeps raw metrics, events, and states for this many days before cleanup."
                      icon="ti ti-clock"
                      suffix="days"
                      min={1}
                      max={3650}
                      value={retentionDays}
                      onInput={setRetentionDays}
                      required
                    />
                    <button type="submit" class="btn-primary btn-sm self-start" disabled={loading()}>
                      <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
                      Save retention
                    </button>
                  </form>
                </SettingsModal.Tab>

                <SettingsModal.Tab
                  id="danger"
                  title="Danger zone"
                  icon="ti ti-alert-triangle"
                  tone="danger"
                  description="Destructive actions for this Pulse base."
                >
                  <div class="info-block-warning mb-3">
                    Clearing data removes observed metrics, events, states, resources, and scrape history. Sources, API keys, dashboards, saved
                    queries, access, and settings are kept.
                  </div>
                  <button type="button" class="btn-danger btn-sm mb-5" disabled={loading()} onClick={() => void clearBaseData()}>
                    <i class="ti ti-eraser text-sm" />
                    Clear all telemetry data
                  </button>
                  <div class="info-block-warning mb-3">
                    Deleting this Pulse base removes its sources, dashboards, saved queries, metrics, events, states, and ingest keys.
                  </div>
                  <button type="button" class="btn-danger btn-sm" disabled={loading()} onClick={() => void deleteBase()}>
                    <i class="ti ti-trash text-sm" />
                    Delete Pulse base
                  </button>
                </SettingsModal.Tab>
              </SettingsModal>
            </div>
          );
        },
        { surface: "bare", header: false, size: "large" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open Pulse settings");
    } finally {
      setLoading(false);
      setSettingsDialogOpen(false);
    }
  };

  const createSource = async (input: CreateSourceInput) => {
    const baseId = selectedBaseId();
    if (!baseId) return false;
    const endpointInput = String(input.endpointUrl ?? "").trim();
    if (input.kind === "metrics" && !endpointInput) {
      toast.error("Endpoint URL is required");
      return false;
    }
    const name = input.name.trim() || (input.kind === "http_ingest" ? "Telemetry push" : "Metrics endpoint");
    setLoading(true);
    try {
      const source = await jsonFetch<PulseSource>(`/api/pulse/bases/${baseId}/sources`, {
        method: "POST",
        body: JSON.stringify(
          input.kind === "metrics"
            ? {
                kind: "metrics",
                name,
                endpointUrl: normalizeEndpointInput(endpointInput),
                bearerToken: input.bearerToken?.trim() || null,
                scrapeIntervalSeconds: parseScrapeInterval(String(input.scrapeIntervalSeconds ?? 60)),
              }
            : { kind: input.kind, name },
        ),
      });
      navigateWorkspace({ view: "sources", sourceId: source.id });
      await loadBaseData(baseId);
      if (input.kind === "metrics") {
        try {
          const counts = await jsonFetch<{ metrics: number; events: number; states: number }>(
            `/api/pulse/bases/${baseId}/sources/${source.id}/scrape`,
            {
              method: "POST",
              body: "{}",
            },
          );
          await loadBaseData(baseId);
          await loadSourceScrapes(baseId, source.id);
          toast.success(`Metrics source added and scraped: ${formatIngestCounts(counts)}`);
          return true;
        } catch (scrapeError) {
          toast.error(
            scrapeError instanceof Error
              ? `Source added, initial scrape failed: ${scrapeError.message}`
              : "Source added, initial scrape failed",
          );
        }
      }
      toast.success(`${input.kind === "http_ingest" ? "HTTP ingest" : "Metrics"} source created`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add source");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const addSource = () =>
    dialogCore.open<void>((close) => {
      const [kind, setKind] = createSignal<SourceCreateKind>("http_ingest");
      const [name, setName] = createSignal("");
      const [endpointUrl, setEndpointUrl] = createSignal("");
      const [bearerToken, setBearerToken] = createSignal("");
      const [scrapeIntervalSeconds, setScrapeIntervalSeconds] = createSignal<number | null>(60);
      const title = () => (kind() === "http_ingest" ? "HTTP ingest" : "Metrics endpoint");
      const sourceInfo = () =>
        "After creating this source, add one or more labeled API keys from the source detail panel. Use them as Bearer tokens from ingestors, apps, automations, imports, or jobs.";
      const submit = async () => {
        const created = await createSource({
          kind: kind(),
          name: name(),
          endpointUrl: endpointUrl(),
          bearerToken: bearerToken(),
          scrapeIntervalSeconds: scrapeIntervalSeconds() ?? 60,
        });
        if (created) close();
      };

      return (
        <form
          class="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <PanelDialog>
            <PanelDialog.Header
              title="New source"
              subtitle="Add one telemetry input for this Pulse base."
              icon="ti ti-plug-connected"
              close={close}
            />
            <PanelDialog.Body>
              <TextInput
                label="Name"
                description="Shown in source lists, dashboard filters, and setup examples."
                icon="ti ti-tag"
                value={name}
                onInput={setName}
                placeholder={kind() === "http_ingest" ? "Sales pipeline" : "Service metrics"}
              />

              <PanelDialog.Section title={title()} subtitle="Choose how Pulse should receive data." icon="ti ti-route">
                <SelectInput
                  label="Type"
                  description="Pick a scrape target or an ingest source that pushes data into Pulse."
                  icon="ti ti-plug-connected"
                  value={kind}
                  onChange={(value) => setKind(value as SourceCreateKind)}
                  options={SOURCE_TYPE_OPTIONS}
                  required
                />
                <Show when={kind() === "metrics"}>
                  <div class="grid gap-3 md:grid-cols-2">
                    <TextInput
                      label="Endpoint URL"
                      description="Pulse will scrape this /metrics endpoint on the configured interval."
                      type="url"
                      icon="ti ti-link"
                      value={endpointUrl}
                      onInput={setEndpointUrl}
                      placeholder="https://example.local/metrics"
                      required
                    />
                    <NumberInput
                      label="Scrape interval"
                      description="How often Pulse scrapes the endpoint."
                      icon="ti ti-refresh"
                      suffix="sec"
                      min={10}
                      max={86_400}
                      value={scrapeIntervalSeconds}
                      onInput={setScrapeIntervalSeconds}
                    />
                  </div>
                  <TextInput
                    label="Bearer token"
                    description="Optional. Stored encrypted by Pulse."
                    icon="ti ti-key"
                    value={bearerToken}
                    onInput={setBearerToken}
                    placeholder="Optional"
                    password
                  />
                </Show>
                <Show when={kind() !== "metrics"}>
                  <div class="info-block-info">
                    <div class="flex items-start gap-2">
                      <i class="ti ti-info-circle mt-0.5 shrink-0 text-blue-500" />
                      <p>{sourceInfo()}</p>
                    </div>
                  </div>
                </Show>
              </PanelDialog.Section>
            </PanelDialog.Body>
            <PanelDialog.Footer>
              <button type="button" class="btn-input btn-input-sm" onClick={() => close()} disabled={loading()}>
                Cancel
              </button>
              <button type="submit" class="btn-input btn-input-sm" disabled={loading() || (kind() === "metrics" && !endpointUrl().trim())}>
                <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-plus"} text-sm`} />
                Add
              </button>
            </PanelDialog.Footer>
          </PanelDialog>
        </form>
      );
    }, panelDialogOptions);

  const scrape = async (source: PulseSource) => {
    const baseId = selectedBaseId();
    if (!baseId) return;
    setLoading(true);
    try {
      const counts = await jsonFetch<{ metrics: number; events: number; states: number }>(
        `/api/pulse/bases/${baseId}/sources/${source.id}/scrape`,
        {
          method: "POST",
          body: "{}",
        },
      );
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
    const result = await prompts.form({
      title: source.kind === "metrics" ? "Edit metrics source" : "Edit source",
      icon: source.kind === "metrics" ? "ti ti-plug" : "ti ti-pencil",
      fields:
        source.kind === "metrics"
          ? {
              name: {
                type: "text",
                label: "Source name",
                description: "Shown in source lists and dashboard filters.",
                required: true,
                default: source.name,
              },
              endpointUrl: {
                type: "text",
                label: "Metrics endpoint URL",
                description: "Pulse scrapes this endpoint on the configured interval.",
                required: true,
                default: source.endpointUrl ?? "",
              },
              scrapeIntervalSeconds: {
                type: "text",
                label: "Scrape interval in seconds",
                description: "How often Pulse should fetch this metrics endpoint.",
                default: String(source.scrapeIntervalSeconds ?? 60),
              },
              bearerToken: {
                type: "text",
                label: "New bearer token",
                description: "Leave empty to keep the currently stored encrypted token.",
                placeholder: "Leave empty to keep unchanged",
              },
            }
          : {
              name: {
                type: "text",
                label: "Source name",
                description: "Shown in source lists and dashboard filters.",
                required: true,
                default: source.name,
              },
            },
      confirmText: "Save",
    });
    const name = result ? String(result.name ?? "").trim() : "";
    if (!name) return;
    const patch: Record<string, unknown> = { name };
    if (source.kind === "metrics") {
      const endpoint = String(result?.endpointUrl ?? "").trim() || source.endpointUrl?.trim();
      if (!endpoint) return;
      patch.endpointUrl = normalizeEndpointInput(endpoint);
      const interval = parseScrapeInterval(String(result?.scrapeIntervalSeconds ?? source.scrapeIntervalSeconds ?? 60));
      patch.scrapeIntervalSeconds = interval;
      const bearer = String(result?.bearerToken ?? "").trim();
      if (bearer) patch.bearerToken = bearer;
    }

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

  const defaultMetricAggregation = (type: MetricType): Aggregation => {
    if (type === "counter") return "rate";
    if (type === "histogram" || type === "summary") return "p95";
    return "latest";
  };

  const currentExplorerQuery = () => queryText().trim() || defaultQueryText() || defaultPulseQuery(metrics());

  const applyQueryDimensionFilter = (key: string, value: string) => {
    const query = currentExplorerQuery();
    if (!query) return;
    const filter = `${key}=${quoteQueryPart(value)}`;
    setQueryText(/\bwhere\b/i.test(query) ? `${query}, ${filter}` : `${query} where ${filter}`);
  };

  const applyQuerySourceFilter = (sourceId: string) => {
    const query = currentExplorerQuery();
    if (!query || /\bsource\b/i.test(query)) return;
    setQueryText(`${query} source ${sourceId}`);
  };

  const sourceClause = (sourceId: string | null | undefined) => (sourceId ? ` source ${sourceId}` : "");
  const entityClause = (entityId: string | null | undefined) => (entityId ? ` entity ${quoteQueryPart(entityId)}` : "");
  const whereClause = (dimensions: Record<string, string>) => {
    const entries = Object.entries(dimensions).slice(0, 8);
    return entries.length ? ` where ${entries.map(([key, value]) => `${key}=${quoteQueryPart(value)}`).join(", ")}` : "";
  };

  const setMetricBrowseQuery = (metric: PulseMetricSummary, dimensions: Record<string, string> = {}) => {
    setQueryText(
      buildPulseQuery({
        metric: metric.name,
        aggregation: defaultMetricAggregation(metric.type),
        bucket: metric.type === "gauge" ? "1m" : "5m",
        since: "24h",
        sourceId: browseSourceId() || null,
        dimensions,
      }),
    );
  };

  const setEventBrowseQuery = (kind: string, sample?: PulseRecordedEvent) => {
    setQueryText(
      `events ${quoteQueryPart(kind)} since 24h${sourceClause(browseSourceId() || sample?.sourceId)}${entityClause(browseEntityId() || sample?.entityId)} limit 100`,
    );
  };

  const setStateBrowseQuery = (key: string, sample?: PulseCurrentState) => {
    setQueryText(
      `states ${quoteQueryPart(key)} since 10m${sourceClause(browseSourceId() || sample?.sourceId)}${entityClause(browseEntityId() || sample?.entityId)} limit 100`,
    );
  };

  const openMetricQuery = (metric: PulseResourceMetric) => {
    setQueryText(
      buildPulseQuery({
        metric: metric.metric,
        aggregation: defaultMetricAggregation(metric.type),
        bucket: metric.type === "gauge" ? "1m" : "5m",
        since: "24h",
        sourceId: metric.sourceId,
        dimensions: metric.dimensions,
      }),
    );
    openQueryExplorer();
  };

  const openEventQuery = (event: PulseRecordedEvent) => {
    setQueryText(
      `events ${quoteQueryPart(event.kind)} since 24h${sourceClause(event.sourceId)}${entityClause(event.entityId)}${whereClause(event.dimensions)} limit 100`,
    );
    openQueryExplorer();
  };

  const openStateQuery = (state: PulseCurrentState) => {
    setQueryText(
      `states ${quoteQueryPart(state.key)} since 10m${sourceClause(state.sourceId)}${entityClause(state.entityId)}${whereClause(state.dimensions)} limit 100`,
    );
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
      const result = await jsonFetch<MetricTextQueryResult>("/api/pulse/query/metric-text", {
        method: "POST",
        body: JSON.stringify({ baseId, query }),
      });
      if (runId !== queryRunId) return;
      setQueryText(query);
      if (result.compiled.kind === "metric") {
        setSelectedMetric(result.compiled.metric);
        setSelectedAggregation(result.compiled.aggregation);
        setSelectedBucket(result.compiled.bucket);
        setSelectedSince(result.compiled.since);
        setSelectedQuerySourceId(result.compiled.sourceId ?? "");
      } else if (explorerResultView() === "chart") {
        setExplorerResultView("table");
      }
      setPoints(result.points);
      setExplorerEvents(result.events);
      setExplorerStates(result.states);
      setQueryDiagnostics({ ok: true, diagnostics: [{ severity: "info", message: "Query is valid." }], compiled: result.compiled });
      setLastRunQuery(query);
      if (options.remember ?? options.manual ?? true) rememberQuery(baseId, query);
    } catch (error) {
      if (runId !== queryRunId) return;
      const message = error instanceof Error ? error.message : "Query failed";
      if (options.manual ?? true) {
        toast.error(message);
      } else {
        setQueryDiagnostics({ ok: false, diagnostics: [{ severity: "error", message }], compiled: null });
      }
    } finally {
      if (runId === queryRunId) setQueryRunning(false);
    }
  };

  const saveCurrentQuery = async () => {
    const baseId = selectedBaseId();
    const query = currentExplorerQuery();
    if (!baseId || !query) return;
    const compiled = compiledQuery();
    const queryName =
      compiled?.kind === "metric"
        ? compiled.metric
        : compiled?.kind === "events"
          ? compiled.event || "All events"
          : compiled?.kind === "states"
            ? compiled.state || "All states"
            : "Pulse query";
    const result = await prompts.form({
      title: "Save query",
      icon: "ti ti-device-floppy",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: queryName },
        description: {
          type: "text",
          label: "Description",
          multiline: true,
          lines: 3,
          placeholder: "Optional notes for this query",
        },
      },
      confirmText: "Save",
    });
    if (!result) return;
    const name = String(result.name ?? "").trim();
    if (!name) return;
    setLoading(true);
    try {
      const saved = await jsonFetch<PulseSavedQuery>(`/api/pulse/bases/${baseId}/saved-queries`, {
        method: "POST",
        body: JSON.stringify({
          name,
          description: String(result.description ?? "").trim() || null,
          query,
        }),
      });
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
      await jsonFetch<void>(`/api/pulse/bases/${query.baseId}/saved-queries/${query.id}`, { method: "DELETE" });
      setSavedQueries((current) => current.filter((item) => item.id !== query.id));
      toast.success("Query removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove query");
    } finally {
      setLoading(false);
    }
  };

  const insertDashboardSnippet = (dsl: string, snippet: string): string => {
    const trimmed = dsl.trimEnd();
    const indentedSnippet = snippet
      .trim()
      .split("\n")
      .map((line) => (line.trim() ? `    ${line}` : line))
      .join("\n");
    const index = trimmed.lastIndexOf("}");
    if (index >= 0) return `${trimmed.slice(0, index).trimEnd()}\n\n  section "Added" {\n${indentedSnippet}\n  }\n${trimmed.slice(index)}`;
    return `${trimmed}\n\n  section "Added" {\n${indentedSnippet}\n  }\n}`;
  };

  const compileDashboardDslPreview = async (dashboard: PulseDashboard, text: string) => {
    const baseId = selectedBaseId();
    if (!baseId || !text.trim()) {
      setDashboardDslDiagnostics(null);
      setDashboardDslDiagnosticsText("");
      return;
    }
    const requestId = ++dashboardDslCompileRequestId;
    try {
      const result = await jsonFetch<PulseDashboardDslCompileResult>("/api/pulse/dashboard-dsl/compile", {
        method: "POST",
        body: JSON.stringify({ baseId, text }),
      });
      if (requestId !== dashboardDslCompileRequestId || dashboard.id !== selectedDashboard()?.id || text !== dashboardDslText()) return;
      setDashboardDslDiagnostics(result);
      setDashboardDslDiagnosticsText(text);
      if (result.ok && result.config) {
        setDashboardPreviewConfig(result.config);
        await refreshDashboardConfig(result.config, dashboard, baseId);
      }
    } catch (error) {
      if (requestId !== dashboardDslCompileRequestId || dashboard.id !== selectedDashboard()?.id || text !== dashboardDslText()) return;
      setDashboardDslDiagnostics({
        ok: false,
        diagnostics: [
          { severity: "error", message: error instanceof Error ? error.message : "Could not compile dashboard", line: 1, column: 1 },
        ],
        config: null,
      });
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
      const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: dashboard.name, config }),
      });
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
    const result = await jsonFetch<{ dashboard: PulseDashboard; token: string }>(`/api/pulse/dashboards/${dashboard.id}/public-token`, {
      method: "POST",
      body: "{}",
    });
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
      const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}/public-token`, {
        method: "DELETE",
      });
      setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Public dashboard link disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disable public link");
    } finally {
      setLoading(false);
    }
  };

  const openPublicDashboardDisplayDialog = async (dashboard: PulseDashboard) => {
    try {
      await prompts.dialog<void>(
        (close) => {
          const [theme, setTheme] = createSignal<PublicDashboardDisplayTheme>("dark");
          const [height, setHeight] = createSignal<PublicDashboardDisplayHeight>("scroll");
          const [busy, setBusy] = createSignal<"copy" | "open" | null>(null);

          const resolveLink = () => ensurePublicDashboardLink(dashboard, { theme: theme(), height: height() });

          const copyLink = async () => {
            setBusy("copy");
            try {
              await clipboard.copy(await resolveLink());
              toast.success("Public display link copied");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not copy public display link");
            } finally {
              setBusy(null);
            }
          };

          const openLink = async () => {
            setBusy("open");
            try {
              window.open(await resolveLink(), "_blank", "noopener,noreferrer");
              close();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not open public display");
            } finally {
              setBusy(null);
            }
          };

          return (
            <div class="flex w-full min-w-0 max-w-xl flex-col gap-4 overflow-hidden">
              <p class="max-w-full text-sm leading-relaxed text-dimmed">Choose a display URL for monitors, shared links, or embedded screens.</p>

              <div class="flex min-w-0 flex-col gap-2">
                <p class="text-sm font-medium text-primary">Theme</p>
                <SegmentedControl<PublicDashboardDisplayTheme>
                  value={theme}
                  onChange={setTheme}
                  options={[
                    { value: "light", label: "Light", icon: "ti ti-sun" },
                    { value: "dark", label: "Dark", icon: "ti ti-moon" },
                  ]}
                />
              </div>

              <div class="flex min-w-0 flex-col gap-2">
                <p class="text-sm font-medium text-primary">Page height</p>
                <SegmentedControl<PublicDashboardDisplayHeight>
                  value={height}
                  onChange={setHeight}
                  options={[
                    { value: "scroll", label: "Scrollable", icon: "ti ti-arrows-vertical" },
                    { value: "full", label: "Full height", icon: "ti ti-device-tv" },
                  ]}
                />
                <p class="text-xs leading-relaxed text-dimmed">
                  Full height disables page scrolling for display monitors. Use it only when the dashboard fits the screen.
                </p>
              </div>

              <div class="flex flex-wrap justify-end gap-2 pt-2">
                <button type="button" class="btn-input btn-input-sm" disabled={busy() !== null} onClick={copyLink}>
                  <i class={`ti ${busy() === "copy" ? "ti-loader-2 animate-spin" : "ti-copy"}`} />
                  Copy link
                </button>
                <button type="button" class="btn-input btn-input-sm" disabled={busy() !== null} onClick={openLink}>
                  <i class={`ti ${busy() === "open" ? "ti-loader-2 animate-spin" : "ti-external-link"}`} />
                  Open display
                </button>
              </div>
            </div>
          );
        },
        { title: "Public display", icon: "ti ti-device-tv" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open public display options");
    }
  };

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
      await prompts.dialog<void>(
        (close) => {
          const [name, setName] = createSignal(dashboard.name);
          const [refreshInterval, setRefreshInterval] = createSignal<RefreshIntervalOption>(refreshOptionFromConfig(dashboard.config));
          const currentDashboard = createMemo(() => dashboards().find((item) => item.id === dashboard.id) ?? dashboard);
          return (
            <div class="flex h-[72vh] min-h-0 flex-col overflow-hidden">
              <SettingsModal
                title="Dashboard settings"
                subtitle={dashboard.name}
                icon="ti ti-layout-dashboard"
                onClose={close}
                closeLabel="Close"
              >
                <SettingsModal.Tab id="general" title="General" icon="ti ti-settings" description="Name shown in the Pulse sidebar and header.">
                  <form
                    class="flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void updateDashboardSettings(currentDashboard(), { name: name(), refreshInterval: refreshInterval() });
                    }}
                  >
                    <TextInput
                      label="Name"
                      description="Use a short dashboard name that describes the view or audience."
                      icon="ti ti-tag"
                      value={name}
                      onInput={setName}
                      required
                    />
                    <SelectInput
                      label="Auto refresh"
                      description="Controls how often Pulse refreshes this dashboard in the background. Use never for static views."
                      icon="ti ti-refresh"
                      value={refreshInterval}
                      onChange={(value) => setRefreshInterval(value as RefreshIntervalOption)}
                      options={DASHBOARD_REFRESH_OPTIONS}
                    />
                    <button type="submit" class="btn-primary btn-sm self-start" disabled={loading() || !name().trim()}>
                      <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-sm`} />
                      Save
                    </button>
                  </form>
                </SettingsModal.Tab>

                <SettingsModal.Tab
                  id="public-link"
                  title="Public link"
                  icon="ti ti-link"
                  description="Anyone with the UUID link can view this dashboard's included data."
                >
                  <div class="flex flex-col gap-3">
                    <div class={currentDashboard().publicEnabled ? "info-block-success" : "info-block-info"}>
                      {currentDashboard().publicEnabled
                        ? "Public display is enabled. Copy the link whenever you need it, or disable public access."
                        : "Public display is disabled. Create a link when you want to share this dashboard without auth."}
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        class="btn-input btn-input-sm"
                        disabled={loading()}
                        onClick={() => void enablePublicLink(currentDashboard(), { copy: true })}
                      >
                        <i class="ti ti-copy" />
                        {currentDashboard().publicEnabled ? "Copy public link" : "Create and copy link"}
                      </button>
                      <Show when={currentDashboard().publicEnabled}>
                        <button
                          type="button"
                          class="btn-input btn-input-sm"
                          disabled={loading()}
                          onClick={() => void disablePublicLink(currentDashboard())}
                        >
                          <i class="ti ti-link-off" />
                          Disable public link
                        </button>
                      </Show>
                    </div>
                  </div>
                </SettingsModal.Tab>

                <SettingsModal.Tab
                  id="danger"
                  title="Danger zone"
                  icon="ti ti-alert-triangle"
                  tone="danger"
                  description="Delete this dashboard."
                >
                  <button
                    type="button"
                    class="btn-danger btn-sm"
                    disabled={loading()}
                    onClick={() => void deleteDashboard(dashboard).then((deleted) => deleted && close())}
                  >
                    <i class="ti ti-trash text-sm" />
                    Delete dashboard
                  </button>
                </SettingsModal.Tab>
              </SettingsModal>
            </div>
          );
        },
        { surface: "bare", header: false, size: "large" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open dashboard settings");
    }
  };

  const renderMetricWidgetChart = (widget: PulseDashboardMetricWidget) => {
    const data = metricWidgetPoints()[widget.id] ?? [];
    const last = data.at(-1)?.value ?? null;
    const summary = metricByName().get(widget.metric);
    const unit = compactMetricUnit(summary?.unit);
    if (widget.visual === "stat") {
      return (
        <Chart
          kind="stat"
          class="h-36 text-primary"
          label={widget.title}
          value={formatValue(last)}
          unit={unit}
          sparkline={data.map((point) => point.value ?? 0)}
        />
      );
    }
    if (widget.visual === "gauge") {
      const value = last ?? 0;
      return (
        <Chart
          kind="gauge"
          class="h-44 text-primary"
          value={value}
          min={0}
          max={gaugeMax(unit ?? null, value)}
          label={widget.title}
          unit={unit}
        />
      );
    }
    if (widget.visual === "barGauge") {
      const value = last ?? 0;
      return (
        <Chart
          kind="barGauge"
          class="h-36 text-primary"
          data={[{ label: widget.title, value, min: 0, max: gaugeMax(unit ?? null, value), unit }]}
          min={0}
          max={gaugeMax(unit ?? null, value)}
          unit={unit}
        />
      );
    }
    if (widget.visual === "bar") {
      return <Chart kind="bar" class="h-48 text-dimmed" data={pointsToBars(data, pulseDateContext())} showValues={data.length <= 16} />;
    }
    if (widget.visual === "histogram") {
      return <Chart kind="histogram" class="h-48 text-dimmed" data={pointsToHistogram(data)} bins={12} yAxis={{ label: "Count" }} />;
    }
    if (widget.visual === "heatmap") {
      return (
        <Chart
          kind="heatmap"
          class="h-48 text-dimmed"
          data={pointsToHeatmap(data, pulseDateContext())}
          format={(value) => formatValue(value)}
          showValues={data.length <= 48}
        />
      );
    }
    if (widget.visual === "table") {
      return (
        <DataTable
          rows={data}
          columns={queryPointColumns}
          getRowId={(point) => point.bucket}
          density="compact"
          class="max-h-64 overflow-auto"
          empty="No points yet."
        />
      );
    }
    return (
      <Chart
        kind="line"
        class="h-48 text-dimmed"
        series={[{ label: widget.title, data: data.map((point) => ({ x: Date.parse(point.bucket), y: point.value ?? 0 })) }]}
        xAxis={{ format: (value) => compactDate(new Date(value).toISOString(), pulseDateContext()) }}
        yAxis={{ format: (value) => formatValue(value) }}
        smooth
        area
      />
    );
  };

  const dashboardMatchedCondition = (widget: PulseDashboardMetricWidget, value: number | null): PulseDashboardCondition | null => {
    const conditions = widget.conditions ?? [];
    if (value === null || !conditions.length) return null;
    let match: PulseDashboardCondition | null = null;
    for (const condition of conditions) {
      const target = typeof condition.value === "number" ? condition.value : Number(condition.value);
      if (!Number.isFinite(target)) continue;
      const matched =
        condition.operator === ">"
          ? value > target
          : condition.operator === ">="
            ? value >= target
            : condition.operator === "<"
              ? value < target
              : condition.operator === "<="
                ? value <= target
                : condition.operator === "="
                ? value === target
                : value !== target;
      if (matched) {
        match = condition;
        if (condition.level === "critical") break;
      }
    }
    return match;
  };

  const dashboardConditionText = (condition: PulseDashboardCondition): string =>
    condition.message?.trim() || `${condition.level === "critical" ? "Critical" : "Warning"} when value ${condition.operator} ${String(condition.value)}`;

  const renderMetricWidgetCard = (widget: PulseDashboardMetricWidget, options: { description?: string | null } = {}) => {
    const condition = dashboardMatchedCondition(widget, metricWidgetPoints()[widget.id]?.at(-1)?.value ?? null);
    const level = condition?.level ?? null;
    return (
    <article
      class="paper h-full p-4"
      classList={{
        "border-yellow-300 bg-yellow-50/70 dark:border-yellow-800 dark:bg-yellow-950/30": level === "warn",
        "border-red-300 bg-red-50/70 dark:border-red-800 dark:bg-red-950/30": level === "critical",
      }}
    >
      <div class="mb-3 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-primary">{widget.title}</p>
          <p class="mt-1 truncate text-xs text-dimmed">
            {widget.metric} · {widget.aggregation} / {widget.bucket}
            {widget.sourceId ? ` · ${sourceNameById().get(widget.sourceId) ?? "source"}` : ""}
          </p>
          <Show when={condition}>
            {(matched) => (
              <p
                class={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  matched().level === "critical"
                    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200"
                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200"
                }`}
              >
                <i class={`ti ${matched().level === "critical" ? "ti-alert-triangle" : "ti-alert-circle"}`} />
                <span>{dashboardConditionText(matched())}</span>
              </p>
            )}
          </Show>
          <Show when={options.description}>{(description) => <p class="mt-2 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
        </div>
      </div>
      {renderMetricWidgetChart(widget)}
    </article>
    );
  };

  const renderMarkdownWidget = (widget: PulseDashboardMarkdownWidget) => (
    <article class="paper h-full p-4">
      <Show when={widget.title || widget.description}>
        <div class="mb-3">
          <Show when={widget.title}>{(title) => <p class="text-sm font-semibold text-primary">{title()}</p>}</Show>
          <Show when={widget.description}>{(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
        </div>
      </Show>
      <MarkdownView html={markdown.render(widget.markdown)} smallHeadings class="text-sm" />
    </article>
  );

  const renderCardWidget = (widget: PulseDashboardCardWidget) => (
    <article class="paper h-full p-4">
      <div class="mb-3">
        <p class="text-sm font-semibold text-primary">{widget.title}</p>
        <Show when={widget.description}>{(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
      </div>
      <div class="space-y-3">
        <For each={widget.rows}>{(row) => renderDashboardRow(row)}</For>
      </div>
    </article>
  );

  const renderEventsWidget = (widget: PulseDashboardEventsWidget) => (
    <article class="paper h-full p-4">
      <div class="mb-3">
        <p class="text-sm font-semibold text-primary">{widget.title}</p>
        <Show when={widget.description}>{(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
      </div>
      <DataTable
        rows={dashboardEvents()[widget.id] ?? []}
        columns={[
          { id: "time", header: "Time", value: (event) => compactDateWithDelta(event.ts, pulseDateContext()) },
          { id: "event", header: "Event", value: (event) => event.kind },
          { id: "subject", header: "Subject", value: (event) => signalSubject(event) },
          { id: "value", header: "Value", value: (event) => formatSignalValue(event.value) },
        ]}
        getRowId={(event) => event.id}
        density="compact"
        class="max-h-80 overflow-auto"
        empty="No events matched this query."
      />
    </article>
  );

  const renderStatesWidget = (widget: PulseDashboardStatesWidget) => {
    const rows = dashboardStates()[widget.id] ?? [];
    return (
      <article class="paper h-full p-4">
        <div class="mb-3">
          <p class="text-sm font-semibold text-primary">{widget.title}</p>
          <Show when={widget.description}>{(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
        </div>
        <Show
          when={widget.visual === "stat"}
          fallback={
            <DataTable
              rows={rows}
              columns={[
                { id: "state", header: "State", value: (state) => state.key },
                { id: "value", header: "Value", value: (state) => formatSignalValue(state.value) },
                { id: "entity", header: "Entity", value: (state) => state.entityId },
                { id: "updated", header: "Updated", value: (state) => compactDateWithDelta(state.updatedAt, pulseDateContext()) },
              ]}
              getRowId={(state) => stateRowId(state)}
              density="compact"
              class="max-h-80 overflow-auto"
              empty="No states matched this query."
            />
          }
        >
          <Chart
            kind="stat"
            class="h-40 text-primary"
            label={rows[0]?.key ?? widget.title}
            value={rows[0] ? formatSignalValue(rows[0].value) : "n/a"}
            sparkline={[]}
          />
        </Show>
      </article>
    );
  };

  const renderDashboardWidget = (widget: PulseDashboardWidget, cellCount: number) => {
    const span = dashboardCellSpan(widget.span, cellCount);
    return (
      <div class={`col-span-1 h-full min-w-0 ${dashboardSpanClasses[span] ?? dashboardSpanClasses[12]}`}>
        {widget.kind === "metric"
          ? renderMetricWidgetCard(widget, { description: widget.description })
          : widget.kind === "markdown"
            ? renderMarkdownWidget(widget)
            : widget.kind === "events"
              ? renderEventsWidget(widget)
              : widget.kind === "states"
                ? renderStatesWidget(widget)
                : renderCardWidget(widget)}
      </div>
    );
  };

  const renderDashboardRow = (row: PulseDashboardRow) => (
    <div class="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-12">
      <For each={row.cells}>{(widget) => renderDashboardWidget(widget, row.cells.length)}</For>
    </div>
  );

  const renderDashboardSection = (section: PulseDashboardSection) => (
    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold text-primary">{section.title}</h2>
        <Show when={section.description}>
          {(description) => <p class="mt-1 max-w-3xl text-xs leading-relaxed text-dimmed">{description()}</p>}
        </Show>
      </div>
      <For each={section.rows}>{(row) => renderDashboardRow(row)}</For>
      <For each={section.sections}>{(child) => <div class="border-l border-border/70 pl-4">{renderDashboardSection(child)}</div>}</For>
    </section>
  );

  const dashboardControlOptions = (control: PulseDashboardControl) => {
    if (control.options?.length) return control.options.map((value) => ({ id: value, label: value }));
    if (control.kind === "source") return sources().map((source) => ({ id: source.id, label: source.name, icon: sourceKindIcon(source.kind) }));
    if (control.kind === "range") return ["1h", "6h", "24h", "7d", "30d"].map((value) => ({ id: value, label: value }));
    return [];
  };

  const dashboardControlValue = (dashboard: PulseDashboard, control: PulseDashboardControl) =>
    dashboardControlValues()[dashboard.id]?.[control.variable] ?? control.defaultValue;

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

  const renderDashboardControls = (dashboard: PulseDashboard, config: PulseDashboardConfig) => (
    <Show when={config.layout?.controls}>
      {(controls) => (
        <div class="flex flex-wrap items-end justify-end gap-2">
          <For each={controls()}>
            {(control) => {
              const options = dashboardControlOptions(control);
              return (
                <label class="min-w-40 text-xs font-semibold text-secondary">
                  <span class="mb-1 block">{control.label}</span>
                  <Show
                    when={options.length}
                    fallback={
                      <TextInput
                        icon={control.kind === "entity" ? "ti ti-cube" : control.kind === "text" ? "ti ti-search" : "ti ti-filter"}
                        value={() => dashboardControlValue(dashboard, control)}
                        onInput={(value) => updateDashboardControl(dashboard, control, value, config)}
                        placeholder={control.variable}
                      />
                    }
                  >
                    <SelectInput
                      icon={
                        control.kind === "range"
                          ? "ti ti-clock"
                          : control.kind === "source"
                            ? "ti ti-database-share"
                            : control.kind === "entity"
                              ? "ti ti-cube"
                              : "ti ti-filter"
                      }
                      value={() => dashboardControlValue(dashboard, control)}
                      onChange={(value) => updateDashboardControl(dashboard, control, value, config)}
                      options={options}
                    />
                  </Show>
                </label>
              );
            }}
          </For>
        </div>
      )}
    </Show>
  );

  const renderDashboardHeader = (dashboard: PulseDashboard, config: PulseDashboardConfig) => (
    <header class="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-xl font-semibold text-primary">{dashboard.name}</h1>
        <Show when={config.layout?.description}>
          {(description) => <p class="mt-1 max-w-3xl text-sm leading-relaxed text-dimmed">{description()}</p>}
        </Show>
      </div>
      <div class="flex flex-wrap items-end justify-end gap-2">
        <Show when={dashboard.publicEnabled}>
          <button type="button" class="btn-input btn-input-sm" onClick={() => void openPublicDashboardDisplayDialog(dashboard)}>
            <i class="ti ti-device-tv" />
            Public display
          </button>
        </Show>
        {renderDashboardControls(dashboard, config)}
      </div>
    </header>
  );

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
    if (view === "sources" || view === "resources" || view === "activity-events" || view === "activity-states" || view === "activity-metrics") return 5;
    return null;
  };

  onMount(() => {
    if (!origin()) setOrigin(window.location.origin);
    void loadBaseData();
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
            : view === "resources"
              ? loadBaseData(baseId, refresh.signal)
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
    if (querySeeded() || queryText().trim() || metrics().length === 0) return;
    setQueryText(defaultPulseQuery(metrics()));
    setQuerySeeded(true);
  });

  createEffect(() => {
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
    void loadSeries(selectedBaseId(), selectedMetric(), selectedQuerySourceId()).catch(() => {
      setSeries([]);
      setSelectedSeriesId("");
    });
  });

  createEffect(() => {
    const compiled = compiledMetricQuery();
    const baseId = selectedBaseId();
    if (!compiled || !baseId) return;
    void loadSeries(baseId, compiled.metric, compiled.sourceId ?? "").catch(() => {
      setSeries([]);
      setSelectedSeriesId("");
    });
  });

  createEffect(() => {
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
    void loadFocusedRows().catch(() => {
      setFocusedHasMore(false);
      if (view === "metric-detail") setFocusedMetricSeries([]);
      if (view === "state-detail") setFocusedStates([]);
      if (view === "event-detail") setFocusedEvents([]);
    });
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

  const renderDashboardConfigContent = (config: () => PulseDashboardConfig | null) => {
    const currentConfig = createMemo(() => {
      const value = config();
      return value && dashboardLayoutWidgets(value).length ? value : null;
    });
    return (
      <Show
        when={currentConfig()}
        fallback={
          <div class="paper flex flex-1 items-center justify-center p-8 text-center text-sm text-dimmed">
            Open the dashboard editor to add the first widget.
          </div>
        }
      >
        {(currentConfig) => (
          <div class="space-y-4">
            <Show when={currentConfig().layout}>
              {(layout) => (
                <>
                  <For each={layout().sections}>{(section) => renderDashboardSection(section)}</For>
                </>
              )}
            </Show>
          </div>
        )}
      </Show>
    );
  };

  const renderDashboardView = () => (
    <section class="flex min-h-0 flex-1 flex-col">
      <Show when={selectedDashboard()}>{(dashboard) => renderDashboardHeader(dashboard(), dashboard().config)}</Show>
      {renderDashboardConfigContent(() => selectedDashboard()?.config ?? null)}
    </section>
  );

  const appendDashboardDslSnippet = (snippet: string) => {
    setDashboardDslText((current) => {
      const dashboard = selectedDashboard();
      const base = current.trim() || (dashboard ? dashboardToDsl(dashboard) : "");
      return base ? insertDashboardSnippet(base, snippet) : snippet;
    });
  };

  const renderReferenceList = (props: {
    title: string;
    icon: string;
    items: { label: string; meta?: string; snippet?: string }[];
    empty: string;
  }) => (
    <section class="paper p-3">
      <div class="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
        <i class={`${props.icon} text-sm text-dimmed`} />
        <span>{props.title}</span>
      </div>
      <Show when={props.items.length} fallback={<p class="text-xs text-dimmed">{props.empty}</p>}>
        <div class="max-h-40 overflow-auto">
          <For each={props.items.slice(0, 24)}>
            {(item) => (
              <Show
                when={item.snippet}
                fallback={
                  <div class="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs">
                    <span class="truncate font-medium text-secondary">{item.label}</span>
                    <Show when={item.meta}>{(meta) => <span class="shrink-0 text-[11px] text-dimmed">{meta()}</span>}</Show>
                  </div>
                }
              >
                {(snippet) => (
                  <button
                    type="button"
                    class="flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    onClick={() => appendDashboardDslSnippet(snippet())}
                    title="Append DSL snippet"
                  >
                    <span class="truncate font-medium text-secondary">{item.label}</span>
                    <Show when={item.meta}>{(meta) => <span class="shrink-0 text-[11px] text-dimmed">{meta()}</span>}</Show>
                  </button>
                )}
              </Show>
            )}
          </For>
        </div>
      </Show>
    </section>
  );

  const dashboardReferenceSources = createMemo(() =>
    sources().map((source) => ({
      label: source.name,
      meta: source.kind,
      snippet: `section ${quoteDashboardDslString(source.name)} {\n  line "Metric" {\n    query metric metric.name avg every 5m since 24h source ${source.id}\n  }\n}`,
    })),
  );

  const dashboardReferenceResources = createMemo(() =>
    inventory().resources.map((resource) => {
      const metric = inventory().metrics.find((item) => item.resourceKey === resource.key);
      const sourceId = metric?.sourceId ?? resource.sourceIds[0] ?? null;
      const source = sourceId ? ` source ${sourceId}` : "";
      const dimensions = Object.entries(resource.dimensions ?? {});
      const scope = dimensions.length
        ? ` where ${dimensions.map(([key, value]) => `${key}=${quoteQueryPart(String(value))}`).join(", ")}`
        : ` entity ${quoteQueryPart(resource.id)}${resource.type ? ` entity_type ${quoteQueryPart(resource.type)}` : ""}`;
      return {
        label: resource.label,
        meta: `${resource.type ?? "resource"} · ${resource.metricCount} metrics`,
        snippet: metric
          ? `line ${quoteDashboardDslString(metric.metric)} {\n  query metric ${quoteQueryPart(metric.metric)} ${metric.type === "counter" ? "rate" : "avg"} every 5m since 24h${source}${scope}\n}`
          : undefined,
      };
    }),
  );

  const dashboardReferenceMetrics = createMemo(() =>
    metrics().map((metric) => ({
      label: metric.name,
      meta: metric.type,
      snippet: `line ${quoteDashboardDslString(metric.name)} {\n  query metric ${quoteQueryPart(metric.name)} ${metric.type === "counter" ? "rate" : "avg"} every 5m since 24h\n}`,
    })),
  );

  const dashboardReferenceEvents = createMemo(() => {
    const names = [...new Set(inventory().events.map((event) => event.kind))].sort();
    return names.map((name) => ({
      label: name,
      meta: "event",
      snippet: `table ${quoteDashboardDslString(name)} {\n  query events ${quoteQueryPart(name)} since 24h limit 100\n}`,
    }));
  });

  const dashboardReferenceStates = createMemo(() => {
    const names = [...new Set(inventory().states.map((state) => state.key))].sort();
    return names.map((name) => ({
      label: name,
      meta: "state",
      snippet: `table ${quoteDashboardDslString(name)} {\n  query states ${quoteQueryPart(name)} limit 100\n}`,
    }));
  });

  const dashboardReferenceLabels = createMemo(() => {
    const labels = new Map<string, Set<string>>();
    const addDimensions = (dimensions: Record<string, string>) => {
      for (const [key, value] of Object.entries(dimensions)) {
        if (!labels.has(key)) labels.set(key, new Set());
        labels.get(key)!.add(value);
      }
    };
    for (const item of inventory().metrics) addDimensions(item.dimensions);
    for (const item of inventory().events) addDimensions(item.dimensions);
    for (const item of inventory().states) addDimensions(item.dimensions);
    return [...labels.entries()]
      .map(([label, values]) => ({ label, meta: `${values.size} values` }))
      .sort((left, right) => left.label.localeCompare(right.label));
  });

  const dashboardReferenceEntities = createMemo(() => {
    const entities = new Map<string, { type: string | null; count: number }>();
    const addEntity = (entityId: string | null, entityType: string | null) => {
      if (!entityId) return;
      const current = entities.get(entityId);
      entities.set(entityId, { type: current?.type ?? entityType, count: (current?.count ?? 0) + 1 });
    };
    for (const item of inventory().metrics) addEntity(item.resourceId, item.resourceType);
    for (const item of inventory().events) addEntity(item.entityId, item.entityType);
    for (const item of inventory().states) addEntity(item.entityId, item.entityType);
    return [...entities.entries()]
      .map(([label, value]) => ({ label, meta: value.type ? `${value.type} · ${value.count}` : `${value.count}` }))
      .sort((left, right) => left.label.localeCompare(right.label));
  });

  const savedQueryDashboardSnippet = (query: PulseSavedQuery): string => {
    const text = query.query.trim().replace(/\s+/g, " ");
    const title = quoteDashboardDslString(query.name);
    const statement = text.startsWith("metric ") ? "line" : "table";
    return `${statement} ${title} {\n  query ${text}\n}`;
  };

  const dashboardReferenceSavedQueries = createMemo(() =>
    savedQueries().map((query) => ({
      label: query.name,
      meta: query.query.split(/\s+/)[0] ?? "query",
      snippet: savedQueryDashboardSnippet(query),
    })),
  );

  const renderDashboardEditorPane = () => (
    <div class="paper h-full overflow-hidden p-0">
      <AutocompleteEditor
        value={dashboardDslText}
        onInput={setDashboardDslText}
        highlight={pulseDashboardDslHighlight}
        fill
        lines={18}
        spellcheck={false}
        ariaLabel="Pulse dashboard DSL"
        ariaInvalid={dashboardDslDiagnostics()?.ok === false}
        placeholder={
          'dashboard "Solar overview" {\n  section "Today" {\n    gauge "Charge" {\n      query metric solar.battery.charge_percent latest since 10m\n    }\n  }\n}'
        }
      />
    </div>
  );

  const renderDashboardInventoryPane = () => (
    <div class="grid h-full content-start gap-2 overflow-auto p-1 md:grid-cols-2 2xl:grid-cols-3">
      {renderReferenceList({
        title: "Sources",
        icon: "ti ti-database-share",
        items: dashboardReferenceSources(),
        empty: "No sources yet.",
      })}
      {renderReferenceList({
        title: "Resources",
        icon: "ti ti-cube",
        items: dashboardReferenceResources(),
        empty: "No resources yet.",
      })}
      {renderReferenceList({
        title: "Metrics",
        icon: "ti ti-chart-dots",
        items: dashboardReferenceMetrics(),
        empty: "No metrics yet.",
      })}
      {renderReferenceList({ title: "Events", icon: "ti ti-bolt", items: dashboardReferenceEvents(), empty: "No events yet." })}
      {renderReferenceList({
        title: "States",
        icon: "ti ti-toggle-right",
        items: dashboardReferenceStates(),
        empty: "No states yet.",
      })}
      {renderReferenceList({ title: "Labels", icon: "ti ti-tags", items: dashboardReferenceLabels(), empty: "No labels yet." })}
      {renderReferenceList({
        title: "Entities",
        icon: "ti ti-cube",
        items: dashboardReferenceEntities(),
        empty: "No entities yet.",
      })}
      {renderReferenceList({
        title: "Saved queries",
        icon: "ti ti-device-floppy",
        items: dashboardReferenceSavedQueries(),
        empty: "No saved queries yet.",
      })}
    </div>
  );

  const renderDashboardDiagnosticsPane = () => (
    <div class="paper h-full overflow-auto p-3">
      <Show
        when={dashboardDslDiagnostics()}
        fallback={
          <p class="flex items-center gap-1.5 text-xs text-dimmed">
            <i class="ti ti-clock" /> Waiting for a DSL preview.
          </p>
        }
      >
        {(result) => (
          <Show
            when={result().diagnostics.length}
            fallback={
              <p class="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                <i class="ti ti-check" /> Dashboard DSL is valid.
              </p>
            }
          >
            <div class="space-y-2">
              <For each={result().diagnostics}>
                {(diagnostic) => (
                  <p class="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-300">
                    <i class="ti ti-alert-circle mt-0.5" />
                    <span>
                      {diagnostic.line}:{diagnostic.column} · {diagnostic.message}
                    </span>
                  </p>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );

  const renderDashboardEditView = () => {
    return (
      <section class="flex min-h-[42rem] flex-1 flex-col gap-3 overflow-hidden pb-2">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <h1 class="truncate text-base font-semibold text-primary">{selectedDashboard()?.name ?? "Dashboard"} DSL</h1>
            <p class="mt-0.5 text-xs text-dimmed">Author sections, cards, markdown, and query-backed widgets.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span
              class={`chip border-0 ${
                dashboardDslDiagnostics()?.ok
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                  : dashboardDslDiagnostics()
                    ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
                    : ""
              }`}
            >
              <i class={`ti ${dashboardDslDiagnostics()?.ok ? "ti-check" : dashboardDslDiagnostics() ? "ti-alert-circle" : "ti-clock"}`} />
              <span>{dashboardDslDiagnostics()?.ok ? "Valid" : dashboardDslDiagnostics() ? "Invalid" : "Waiting"}</span>
            </span>
            <button
              type="button"
              class="btn-input btn-input-sm"
              disabled={!selectedDashboard() || dashboardDslSaving() || !dashboardDslDiagnostics()?.ok}
              onClick={() => void saveDashboardDsl()}
            >
              <i class={`ti ${dashboardDslSaving() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} /> Save
            </button>
            <button
              type="button"
              class="btn-input btn-input-sm"
              disabled={!selectedDashboard()}
              onClick={() => {
                const dashboard = selectedDashboard();
                if (dashboard) void openDashboardSettingsDialog(dashboard);
              }}
            >
              <i class="ti ti-settings" /> Settings
            </button>
            <button
              type="button"
              class="btn-input btn-input-sm"
              onClick={() => openQueryReferenceWindow(selectedBaseId(), { dashboardDsl: true })}
            >
              <i class="ti ti-external-link" /> Query reference
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden">
          <DockWorkspace storageKey="pulse.dashboard-editor" initialState={props.initialDashboardEditorDockState} defaultResultSize={48} class="h-full">
            <DockWorkspace.Result title="Preview" icon="ti ti-eye">
              <div class="h-full overflow-auto bg-zinc-50 p-3 dark:bg-zinc-950">
                {renderDashboardConfigContent(() => dashboardEditPreviewConfig())}
              </div>
            </DockWorkspace.Result>
            <DockWorkspace.Pane id="editor" title="DSL" icon="ti ti-code" section="editor">
              {renderDashboardEditorPane()}
            </DockWorkspace.Pane>
            <DockWorkspace.Pane id="inventory" title="Inventory" icon="ti ti-database-search" section="context">
              {renderDashboardInventoryPane()}
            </DockWorkspace.Pane>
            <DockWorkspace.Pane id="diagnostics" title="Diagnostics" icon="ti ti-alert-circle" section="context">
              {renderDashboardDiagnosticsPane()}
            </DockWorkspace.Pane>
          </DockWorkspace>
        </div>
      </section>
    );
  };

  const renderSourceCell = (
    source: PulseSource,
    col: DataTableColumn<PulseSource>,
    render: (value: unknown) => JSX.Element,
  ): JSX.Element => {
    if (col.id === "source") {
      const status = sourceStatus(source);
      return (
        <div class="flex min-w-0 items-center gap-2">
          <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            <i class={`${sourceKindIcon(source.kind)} text-base`} />
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-primary">{source.name}</p>
            <p class={`mt-0.5 flex items-center gap-1 truncate text-xs ${status.text}`}>
              <span class={`inline-flex h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} />
              {status.label}
              <span class="text-dimmed">· {source.kind}</span>
            </p>
          </div>
        </div>
      );
    }
    if (col.id === "status") {
      const status = sourceStatus(source);
      return (
        <span class={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${status.text}`}>
          <i class={status.icon} />
          {status.label}
        </span>
      );
    }
    if (col.id === "resources") {
      const counts = sourcePublishedCounts(source.id);
      return <span class="text-xs text-secondary">{counts.resources.toLocaleString()}</span>;
    }
    if (col.id === "signals") {
      const counts = sourcePublishedCounts(source.id);
      const total = counts.metricVariants + counts.states + counts.events;
      return (
        <span class="text-xs text-secondary">
          {total.toLocaleString()} <span class="text-dimmed">({counts.metricVariants}m/{counts.states}s/{counts.events}e)</span>
        </span>
      );
    }
    if (col.id === "target") {
      if (source.kind === "metrics") {
        return (
          <div class="min-w-0">
            <p class="truncate text-xs text-secondary" title={source.endpointUrl ?? ""}>
              {source.endpointUrl ?? "No endpoint"}
            </p>
            <p class="mt-1 text-xs text-dimmed">Every {source.scrapeIntervalSeconds ?? 60}s</p>
          </div>
        );
      }
      if (source.kind === "http_ingest") return <span class="text-xs text-secondary">Token ingest endpoint</span>;
      return <span class="text-xs text-secondary">Internal app telemetry</span>;
    }
    if (col.id === "seen") return source.lastSeenAt ? compactDateWithDelta(source.lastSeenAt, pulseDateContext()) : "Waiting";
    return render(source[col.id as keyof PulseSource]);
  };

  const renderSourceScrapeCell = (scrape: PulseSourceScrape, col: DataTableColumn<PulseSourceScrape>): JSX.Element => {
    if (col.id === "status") {
      return (
        <span
          class={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
            scrape.success
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
          }`}
        >
          <i class={`ti ${scrape.success ? "ti-check" : "ti-alert-circle"}`} />
          {scrape.success ? "Success" : "Error"}
        </span>
      );
    }
    if (col.id === "finished") return <span class="text-xs text-secondary">{compactDateWithDelta(scrape.finishedAt, pulseDateContext())}</span>;
    if (col.id === "samples") return <span class="text-xs text-secondary">{formatIngestCounts(scrape)}</span>;
    if (col.id === "duration") return <span class="text-xs text-secondary">{scrape.durationMs}ms</span>;
    if (col.id === "error") {
      return (
        <span class={scrape.errorMessage ? "line-clamp-2 text-xs text-red-600 dark:text-red-300" : "text-xs text-dimmed"}>
          {scrape.errorMessage ?? "-"}
        </span>
      );
    }
    return null;
  };

  const renderEventCell = (
    event: PulseRecordedEvent,
    col: DataTableColumn<PulseRecordedEvent>,
    render: (value: unknown) => JSX.Element,
  ) => {
    if (col.id === "subject") {
      const summary = dimensionsSummary(event.dimensions);
      return (
        <div class="min-w-0">
          <p class="truncate text-xs font-medium text-secondary">{signalSubject(event)}</p>
          <Show when={summary}>
            {(text) => <p class="mt-0.5 truncate text-[11px] text-dimmed">{text()}</p>}
          </Show>
        </div>
      );
    }
    if (col.id === "source") return renderSourceLink(event.sourceId);
    if (col.id === "dimensions") {
      const summary = dimensionsSummary(event.dimensions, 6);
      return (
        <span class="line-clamp-2 text-xs text-secondary" title={Object.entries(event.dimensions).map(([key, value]) => `${key}=${value}`).join(", ")}>
          {summary || "-"}
        </span>
      );
    }
    if (col.id === "value") return <span class="text-xs text-secondary">{event.value === null ? "-" : formatValue(event.value)}</span>;
    if (col.id === "time") return <span class="text-xs text-secondary">{compactDateWithDelta(event.ts, pulseDateContext())}</span>;
    return render(event[col.id as keyof PulseRecordedEvent]);
  };

  const renderEventGroupCell = (
    group: ActivityEventGroup,
    col: DataTableColumn<ActivityEventGroup>,
    render: (value: unknown) => JSX.Element,
  ) => {
    if (col.id === "kind") {
      return (
        <span class="flex min-w-0 items-center gap-1.5">
          {renderSignalInfoButton("Open event", () => openEventDetailView(group.kind))}
          <span class="truncate">{group.kind}</span>
        </span>
      );
    }
    if (col.id === "source") return renderSourceLink(group.sourceId);
    if (col.id === "value") return <span class="text-xs text-secondary">{group.latest.value === null ? "-" : formatValue(group.latest.value)}</span>;
    if (col.id === "count") return <span class="text-xs text-secondary">{group.rows.length}</span>;
    if (col.id === "time") return <span class="text-xs text-secondary">{compactDateWithDelta(group.latest.ts, pulseDateContext())}</span>;
    return render(group[col.id as keyof ActivityEventGroup]);
  };

  const renderStateCell = (state: PulseCurrentState, col: DataTableColumn<PulseCurrentState>, render: (value: unknown) => JSX.Element) => {
    if (col.id === "value") {
      return (
        <span class="line-clamp-2 text-xs text-secondary" title={formatSignalValue(state.value)}>
          {formatSignalValue(state.value)}
        </span>
      );
    }
    if (col.id === "subject") {
      const summary = dimensionsSummary(state.dimensions);
      return (
        <div class="min-w-0">
          <p class="truncate text-xs font-medium text-secondary">{signalSubject(state)}</p>
          <Show when={summary}>
            {(text) => <p class="mt-0.5 truncate text-[11px] text-dimmed">{text()}</p>}
          </Show>
        </div>
      );
    }
    if (col.id === "source") return renderSourceLink(state.sourceId);
    if (col.id === "dimensions") {
      const summary = dimensionsSummary(state.dimensions, 6);
      return (
        <span class="line-clamp-2 text-xs text-secondary" title={Object.entries(state.dimensions).map(([key, value]) => `${key}=${value}`).join(", ")}>
          {summary || "-"}
        </span>
      );
    }
    if (col.id === "updated") return <span class="text-xs text-secondary">{compactDateWithDelta(state.updatedAt, pulseDateContext())}</span>;
    return render(state[col.id as keyof PulseCurrentState]);
  };

  const renderStateGroupCell = (
    group: ActivityStateGroup,
    col: DataTableColumn<ActivityStateGroup>,
    render: (value: unknown) => JSX.Element,
  ) => {
    if (col.id === "key") {
      return (
        <span class="flex min-w-0 items-center gap-1.5">
          {renderSignalInfoButton("Open state", () => openStateDetailView(group.key))}
          <span class="truncate">{group.key}</span>
        </span>
      );
    }
    if (col.id === "source") return renderSourceLink(group.sourceId);
    if (col.id === "value") {
      if (group.rows.length > 1) return <span class="text-xs text-dimmed">{plural(group.rows.length, "variant")}</span>;
      return (
        <span class="line-clamp-2 text-xs text-secondary" title={formatSignalValue(group.latest.value)}>
          {formatSignalValue(group.latest.value)}
        </span>
      );
    }
    if (col.id === "updated") return <span class="text-xs text-secondary">{compactDateWithDelta(group.latest.updatedAt, pulseDateContext())}</span>;
    return render(group[col.id as keyof ActivityStateGroup]);
  };

  const renderMetricCell = (
    metric: PulseMetricSummary,
    col: DataTableColumn<PulseMetricSummary>,
    render: (value: unknown) => JSX.Element,
  ) => {
    if (col.id === "name") {
      return (
        <span class="flex min-w-0 items-center gap-1.5">
          {renderSignalInfoButton("Open metric", () => openMetricDetailView(metric.name))}
          <span class="truncate">{metric.name}</span>
        </span>
      );
    }
    if (col.id === "unit") return <span class="text-xs text-secondary">{metric.unit ?? "-"}</span>;
    if (col.id === "sources") {
      const count = metricScopeByName().get(metric.name)?.sources.size ?? 0;
      return <span class="text-xs text-secondary">{count || "-"}</span>;
    }
    if (col.id === "resources") {
      const count = metricScopeByName().get(metric.name)?.resources.size ?? 0;
      return <span class="text-xs text-secondary">{count || "-"}</span>;
    }
    if (col.id === "series") return <span class="text-xs text-secondary">{metric.seriesCount}</span>;
    if (col.id === "lastSeen")
      return <span class="text-xs text-secondary">{metric.lastSeenAt ? compactDateWithDelta(metric.lastSeenAt, pulseDateContext()) : "-"}</span>;
    return render(metric[col.id as keyof PulseMetricSummary]);
  };

  const renderMetricSeriesCell = (
    item: PulseMetricSeries,
    col: DataTableColumn<PulseMetricSeries>,
    render: (value: unknown) => JSX.Element,
  ) => {
    if (col.id === "subject") {
      return <span class="truncate text-xs font-medium text-secondary">{signalSubject(item)}</span>;
    }
    if (col.id === "current") {
      const unit = focusedMetric()?.unit;
      return (
        <span class="text-xs font-medium text-primary">
          {item.latestValue === null ? "-" : `${formatValue(item.latestValue)}${unit ? ` ${unit}` : ""}`}
        </span>
      );
    }
    if (col.id === "source") return renderSourceLink(item.sourceId);
    if (col.id === "dimensions") {
      const summary = dimensionsSummary(item.dimensions, 6);
      return (
        <span class="line-clamp-2 text-xs text-secondary" title={Object.entries(item.dimensions).map(([key, value]) => `${key}=${value}`).join(", ")}>
          {summary || "-"}
        </span>
      );
    }
    if (col.id === "lastSeen") return <span class="text-xs text-secondary">{item.lastSeenAt ? compactDateWithDelta(item.lastSeenAt, pulseDateContext()) : "-"}</span>;
    return render(item[col.id as keyof PulseMetricSeries]);
  };

  const renderActivityToolbar = (kind: "events" | "states" | "metrics") => (
    <div class="flex min-w-0 flex-1 shrink-0 flex-wrap items-center gap-2">
      <div class="min-w-64 flex-1">
        <TextInput
          type="search"
          icon="ti ti-search"
          value={activitySearch}
          onInput={updateActivitySearch}
          placeholder={kind === "events" ? "Search events..." : kind === "states" ? "Search states..." : "Search metrics..."}
          clearable
        />
      </div>
      <Show when={kind === "metrics"}>
        <FilterChip
          label="Type"
          icon="ti ti-filter"
          value={metricTypeFilter() ? [metricTypeFilter()] : []}
          onChange={updateMetricTypeFilter}
          options={METRIC_TYPE_FILTER_OPTIONS}
        />
      </Show>
    </div>
  );

  const signalCatalogTabs = (activeKind: SignalCatalogKind) => [
    { kind: "events" as const, label: "Events", icon: "ti ti-bolt", count: eventGroups().length, open: openActivityEvents },
    { kind: "states" as const, label: "States", icon: "ti ti-toggle-right", count: stateGroups().length, open: openActivityStates },
    { kind: "metrics" as const, label: "Metrics", icon: "ti ti-chart-dots", count: activityMetrics().length, open: openActivityMetrics },
  ].map((tab) => ({ ...tab, active: tab.kind === activeKind }));

  const signalCatalogTabClass = (active: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${
      active
        ? "bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-200"
        : "bg-zinc-100/70 text-secondary hover:bg-zinc-100 hover:text-primary dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
    }`;

  const renderSignalCatalogTabs = (kind: SignalCatalogKind) => (
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <For each={signalCatalogTabs(kind)}>
        {(tab) => (
          <button type="button" class={signalCatalogTabClass(tab.active)} aria-current={tab.active ? "page" : undefined} onClick={tab.open}>
            <i class={tab.icon} />
            <span>{tab.label}</span>
            <span class="text-dimmed">{tab.count}</span>
          </button>
        )}
      </For>
    </div>
  );

  const openSourceFromDetail = (sourceId: string | null | undefined) => {
    if (!sourceId) return;
    setSelectedSourceId(sourceId);
    navigateWorkspace({ view: "sources", sourceId });
  };

  const renderSourceLink = (sourceId: string | null | undefined) => {
    if (!sourceId) return <span class="text-xs text-dimmed">-</span>;
    return (
      <button
        type="button"
        class="inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-secondary transition hover:text-blue-600 dark:hover:text-blue-300"
        onClick={(event) => {
          event.stopPropagation();
          openSourceFromDetail(sourceId);
        }}
        title="Open source"
      >
        <i class="ti ti-database-share shrink-0" />
        <span class="truncate">{sourceNameById().get(sourceId) ?? "Unknown source"}</span>
      </button>
    );
  };

  const renderSignalInfoButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-dimmed transition hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-950 dark:hover:text-blue-300"
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <i class="ti ti-info-circle text-sm" />
    </button>
  );

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

  const renderSelectedSourceDetail = () => (
    <Show when={selectedSource()} keyed fallback={<div class="paper h-full p-4 text-sm text-dimmed">Select a source.</div>}>
      {(source) => (
        <SourceDetailView
          source={source}
          published={sourcePublishedCounts(source.id)}
          origin={origin()}
          dateContext={pulseDateContext()}
          loading={loading()}
          scrapes={selectedSourceScrapes()}
          apiKeys={selectedSourceApiKeys()}
          scrapeColumns={sourceScrapeColumns}
          renderScrapeCell={renderSourceScrapeCell}
          copySetupText={copySetupText}
          openSourceResources={openSourceResources}
          editSource={editSource}
          toggleSource={toggleSource}
          close={() => {
            setSelectedSourceId("");
            navigateWorkspace({ view: "sources" });
          }}
          scrape={scrape}
          removeSource={removeSource}
          createApiKey={async (input) => {
            const baseId = selectedBaseId();
            if (!baseId) throw new Error("No Pulse base selected.");
            const created = await jsonFetch<{ credential: ResourceApiKey; token: string }>(`/api/pulse/bases/${baseId}/sources/${source.id}/api-keys`, {
              method: "POST",
              body: JSON.stringify(input),
            });
            setSourceApiKeys((current) => ({ ...current, [source.id]: [created.credential, ...(current[source.id] ?? [])] }));
            return created;
          }}
          revokeApiKey={async (credentialId) => {
            const baseId = selectedBaseId();
            if (!baseId) throw new Error("No Pulse base selected.");
            await jsonFetch<void>(`/api/pulse/bases/${baseId}/sources/${source.id}/api-keys/${credentialId}`, { method: "DELETE" });
            setSourceApiKeys((current) => ({
              ...current,
              [source.id]: (current[source.id] ?? []).filter((key) => key.id !== credentialId),
            }));
          }}
        />
      )}
    </Show>
  );

  const renderSourcesView = () => (
    <section class="flex min-h-0 flex-1 flex-col gap-3 pb-2">
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <div class="min-w-64 flex-1">
          <TextInput
            type="search"
            icon="ti ti-search"
            value={sourceSearch}
            onInput={setSourceSearch}
            placeholder="Search sources..."
            clearable
          />
        </div>
        <button type="button" class="btn-input btn-input-sm" disabled={!selectedBaseId() || loading()} onClick={() => void addSource()}>
          <i class="ti ti-plus" /> Source
        </button>
      </div>
      <section class="h-[min(72vh,54rem)] min-h-[32rem] shrink-0 overflow-hidden">
        <Panes.Root
          value={sourcePanesValue()}
          onChange={setSourcePanesValue}
          class="h-full min-h-0"
          allowMove={false}
          allowReorder={false}
          allowHorizontalSplit={false}
          allowVerticalSplit={false}
        >
          <Panes.Element id="list" title="Sources" icon="ti-database-share">
            <div class="paper flex h-full min-h-0 flex-col overflow-hidden">
              <DataTable
                rows={filteredSources()}
                columns={sourceColumns}
                getRowId={(source) => source.id}
                selectedRowId={selectedSourceId() || null}
                onRowClick={selectSource}
                density="compact"
                fillHeight
                class="min-h-0 flex-1 overflow-auto"
                empty="No sources yet."
                scrollPreserveKey="pulse-sources-table"
                renderCell={({ row: source, col, render }) => renderSourceCell(source, col, render)}
              />
            </div>
          </Panes.Element>
          <Panes.Element id="detail" title="Detail" icon="ti-info-circle">
            <div class="h-full min-h-0 overflow-auto">{renderSelectedSourceDetail()}</div>
          </Panes.Element>
        </Panes.Root>
      </section>
    </section>
  );

  const renderFocusedSignalView = () => {
    const view = activeView();
    const signalId = focusedSignalId();
    const isMetric = view === "metric-detail";
    const isState = view === "state-detail";
    const rowsLabel = isMetric
      ? plural(focusedMetricSeries().length, "variant")
      : isState
        ? plural(focusedStates().length, "variant")
        : plural(focusedEvents().length, "event");
    const subtitle = isMetric
      ? `${focusedMetric()?.type ?? "metric"}${focusedMetric()?.unit ? ` · ${focusedMetric()?.unit}` : ""} · ${rowsLabel}`
      : isState
        ? `state · ${rowsLabel}`
        : `event · ${rowsLabel}`;

    return (
      <section class="flex min-h-0 flex-1 flex-col gap-3 pb-2">
        <div class="paper shrink-0 p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-label text-xs">{isMetric ? "Metric" : isState ? "State" : "Event"}</p>
              <h2 class="mt-1 truncate text-xl font-semibold text-primary">{signalId}</h2>
              <p class="mt-1 text-sm text-dimmed">{subtitle}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <button type="button" class="btn-input btn-input-sm" onClick={() => void loadFocusedRows()}>
                <i class={`ti ${focusedLoadingMore() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} /> Reload
              </button>
              <button
                type="button"
                class="btn-input btn-input-sm"
                onClick={() => {
                  if (isMetric) {
                    const metric = focusedMetric();
                    if (metric) {
                      setQueryText(
                        buildPulseQuery({
                          metric: metric.name,
                          aggregation: defaultMetricAggregation(metric.type),
                          bucket: metric.type === "gauge" ? "1m" : "5m",
                          since: "24h",
                        }),
                      );
                      openQueryExplorer();
                      return;
                    }
                  }
                  if (isState) setQueryText(`states ${quoteQueryPart(signalId)} since 10m limit 100`);
                  else setQueryText(`events ${quoteQueryPart(signalId)} since 24h limit 100`);
                  openQueryExplorer();
                }}
              >
                <i class="ti ti-code" /> Open query
              </button>
            </div>
          </div>
        </div>

        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <div class="min-w-64 flex-1">
            <TextInput
              type="search"
              icon="ti ti-search"
              value={focusedSearch}
              onInput={setFocusedSearch}
              placeholder={isMetric ? "Search variants..." : isState ? "Search state variants..." : "Search events..."}
              clearable
            />
          </div>
          <span class="chip">
            <i class={isMetric ? "ti ti-stack-3" : isState ? "ti ti-toggle-right" : "ti ti-bolt"} />
            {rowsLabel}
          </span>
        </div>

        <section class="h-[min(68vh,54rem)] min-h-[32rem] shrink-0 overflow-hidden">
          <Panes.Root
            value={focusedPanesValue()}
            onChange={setFocusedPanesValue}
            class="h-full min-h-0"
            allowMove={false}
            allowReorder={false}
            allowHorizontalSplit={false}
            allowVerticalSplit={false}
          >
            <Panes.Element id="list" title={isMetric || isState ? "Variants" : "Events"} icon={isMetric ? "ti-stack-3" : isState ? "ti-toggle-right" : "ti-bolt"}>
              <div class="paper flex h-full min-h-0 flex-col overflow-hidden">
                <Show when={isMetric}>
                  <DataTable
                    rows={focusedMetricSeries()}
                    columns={metricSeriesColumns}
                    getRowId={(item) => item.id}
                    selectedRowId={selectedFocusedSeries()?.id ?? null}
                    onRowClick={(item) => setSelectedFocusedSeriesId(item.id)}
                    density="compact"
                    fillHeight
                    class="min-h-0 flex-1 overflow-auto"
                    empty="No variants found."
                    hasMore={focusedHasMore()}
                    loadingMore={focusedLoadingMore()}
                    onLoadMore={() => void loadFocusedRows({ append: true })}
                    scrollPreserveKey={`pulse-focused-metric-${signalId}`}
                    renderCell={({ row, col, render }) => renderMetricSeriesCell(row, col, render)}
                  />
                </Show>
                <Show when={isState}>
                  <DataTable
                    rows={focusedStates()}
                    columns={stateColumns}
                    getRowId={stateRowId}
                    selectedRowId={selectedFocusedState() ? stateRowId(selectedFocusedState()!) : null}
                    onRowClick={(state) => setSelectedFocusedStateId(stateRowId(state))}
                    density="compact"
                    fillHeight
                    class="min-h-0 flex-1 overflow-auto"
                    empty="No state variants found."
                    hasMore={focusedHasMore()}
                    loadingMore={focusedLoadingMore()}
                    onLoadMore={() => void loadFocusedRows({ append: true })}
                    scrollPreserveKey={`pulse-focused-state-${signalId}`}
                    renderCell={({ row, col, render }) => renderStateCell(row, col, render)}
                  />
                </Show>
                <Show when={view === "event-detail"}>
                  <DataTable
                    rows={focusedEvents()}
                    columns={eventColumns}
                    getRowId={(event) => event.id}
                    selectedRowId={selectedFocusedEvent()?.id ?? null}
                    onRowClick={(event) => setSelectedFocusedEventId(event.id)}
                    density="compact"
                    fillHeight
                    class="min-h-0 flex-1 overflow-auto"
                    empty="No events found."
                    hasMore={focusedHasMore()}
                    loadingMore={focusedLoadingMore()}
                    onLoadMore={() => void loadFocusedRows({ append: true })}
                    scrollPreserveKey={`pulse-focused-event-${signalId}`}
                    renderCell={({ row, col, render }) => renderEventCell(row, col, render)}
                  />
                </Show>
              </div>
            </Panes.Element>

            <Panes.Element id="detail" title="Detail" icon="ti-info-circle">
              <div class="h-full min-h-0 overflow-auto">
                {isMetric ? (
                  <Show when={selectedFocusedSeries()} keyed fallback={<div class="paper h-full p-4 text-sm text-dimmed">Select a metric variant.</div>}>
                    {(item) => (
                      <FocusedMetricSeriesDetail
                        item={item}
                        metricName={focusedSignalId()}
                        sourceId={item.sourceId}
                        sourceNameById={sourceNameById}
                        dateContext={pulseDateContext()}
                        metricUnit={focusedMetric()?.unit ?? null}
                        openSource={openSourceFromDetail}
                      />
                    )}
                  </Show>
                ) : isState ? (
                  <Show when={selectedFocusedState()} keyed fallback={<div class="paper h-full p-4 text-sm text-dimmed">Select a state variant.</div>}>
                    {(state) => (
                      <FocusedStateDetail
                        state={state}
                        sourceId={state.sourceId}
                        sourceNameById={sourceNameById}
                        dateContext={pulseDateContext()}
                        openSource={openSourceFromDetail}
                      />
                    )}
                  </Show>
                ) : (
                  <Show when={selectedFocusedEvent()} keyed fallback={<div class="paper h-full p-4 text-sm text-dimmed">Select an event.</div>}>
                    {(event) => (
                      <FocusedEventDetail
                        event={event}
                        sourceId={event.sourceId}
                        sourceNameById={sourceNameById}
                        dateContext={pulseDateContext()}
                        openSource={openSourceFromDetail}
                      />
                    )}
                  </Show>
                )}
              </div>
            </Panes.Element>
          </Panes.Root>
        </section>
      </section>
    );
  };

  const renderExplorerChart = () => {
    const data = points();
    const title = compiledMetricQuery()?.metric ?? (selectedMetric() || "Query");
    const last = data.at(-1)?.value ?? null;
    const unit = compactMetricUnit(previewUnit());
    if (selectedVisual() === "stat") {
      return (
        <Chart
          kind="stat"
          class="h-full min-h-0 text-primary"
          label={title}
          value={formatValue(last)}
          unit={unit}
          sparkline={data.map((point) => point.value ?? 0)}
        />
      );
    }
    if (selectedVisual() === "gauge") {
      const value = last ?? 0;
      return (
        <Chart
          kind="gauge"
          class="h-full min-h-0 text-primary"
          value={value}
          min={0}
          max={gaugeMax(unit ?? null, value)}
          label={title}
          unit={unit}
        />
      );
    }
    if (selectedVisual() === "barGauge") {
      const value = last ?? 0;
      return (
        <Chart
          kind="barGauge"
          class="h-full min-h-0 text-primary"
          data={[{ label: title, value, min: 0, max: gaugeMax(unit ?? null, value), unit }]}
          min={0}
          max={gaugeMax(unit ?? null, value)}
          unit={unit}
        />
      );
    }
    if (selectedVisual() === "bar")
      return <Chart kind="bar" class="h-full min-h-0 text-dimmed" data={pointsToBars(data, pulseDateContext())} showValues={data.length <= 16} />;
    if (selectedVisual() === "histogram")
      return (
        <Chart kind="histogram" class="h-full min-h-0 text-dimmed" data={pointsToHistogram(data)} bins={12} yAxis={{ label: "Count" }} />
      );
    if (selectedVisual() === "heatmap")
      return (
        <Chart
          kind="heatmap"
          class="h-full min-h-0 text-dimmed"
          data={pointsToHeatmap(data, pulseDateContext())}
          format={(value) => formatValue(value)}
          showValues={data.length <= 48}
        />
      );
    return (
      <Chart
        kind="line"
        class="h-full min-h-0 text-dimmed"
        series={previewSeries()}
        xAxis={{ format: (value) => compactDate(new Date(value).toISOString(), pulseDateContext()) }}
        yAxis={{ format: (value) => formatValue(value) }}
        smooth
        area
      />
    );
  };

  const renderExplorerResult = () => {
    const compiled = compiledQuery();
    const queryWasRun = lastRunQuery() === currentExplorerQuery();
    if (explorerResultView() === "compiled") {
      return <StructuredDataPreview data={compiledQuery() ?? {}} empty="Run a query to see the compiled shape." />;
    }
    if (compiled?.kind === "events") {
      return (
        <DataTable
          rows={explorerEvents()}
          columns={eventColumns}
          getRowId={(event) => event.id}
          selectedRowId={null}
          density="compact"
          class="h-full min-h-0 overflow-auto"
          empty="Run an events query to see events."
          renderCell={({ row: event, col, render }) => renderEventCell(event, col, render)}
        />
      );
    }
    if (compiled?.kind === "states") {
      return (
        <DataTable
          rows={explorerStates()}
          columns={stateColumns}
          getRowId={stateRowId}
          selectedRowId={null}
          density="compact"
          class="h-full min-h-0 overflow-auto"
          empty="Run a states query to see current states."
          renderCell={({ row: state, col, render }) => renderStateCell(state, col, render)}
        />
      );
    }
    if (explorerResultView() === "table") {
      return (
        <DataTable
          rows={points()}
          columns={queryPointColumns}
          getRowId={(point) => point.bucket}
          density="compact"
          class="h-full min-h-0 overflow-auto"
          empty={
            queryWasRun
              ? "No points matched this metric query. Try a wider since range or check whether the source is still ingesting."
              : "Run a metric query to see points."
          }
        />
      );
    }
    if (compiled && compiled.kind !== "metric") {
      return (
        <div class="flex h-full min-h-0 items-center justify-center text-sm text-dimmed">Use Table or Compiled for this query type.</div>
      );
    }
    if (points().length > 0) return renderExplorerChart();
    return (
      <div class="flex h-full min-h-0 items-center justify-center px-6 text-center text-sm text-dimmed">
        {queryWasRun
          ? "No points matched this metric query. Try a wider since range or check whether the source is still ingesting."
          : "Run a metric query to preview data."}
      </div>
    );
  };

  const renderQueryEditorPane = () => (
    <div class="paper flex h-full min-h-0 flex-col overflow-hidden">
      <div class="min-h-0 flex-1 overflow-auto p-3">
        <AutocompleteEditor
          value={queryText}
          onInput={setQueryText}
          onSubmit={() => void runTextQuery({ manual: true, remember: true })}
          completions={queryCompletions()}
          highlight={pulseQueryHighlight}
          restoreExpansionOnBackspace={false}
          lines={7}
          spellcheck={false}
          placeholder="metric orders.created increase every 1h since 7d where channel=web"
          ariaLabel="Pulse query"
          ariaInvalid={queryDiagnostics()?.ok === false}
        />
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <For each={queryDiagnostics()?.diagnostics ?? []}>
            {(diagnostic) => (
              <span class={diagnostic.severity === "error" ? "text-red-600 dark:text-red-300" : "text-dimmed"}>
                <i class={diagnostic.severity === "error" ? "ti ti-alert-circle" : "ti ti-check"} /> {diagnostic.message}
              </span>
            )}
          </For>
          <Show when={queryRunning()}>
            <span class="text-dimmed">
              <i class="ti ti-loader-2 animate-spin" /> Updating preview...
            </span>
          </Show>
        </div>

        <Show when={compiledMetricQuery() && matchingMetricSeries().length > 0}>
          <section class="mt-3 rounded bg-zinc-50 p-3 dark:bg-zinc-900/50">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-sm font-semibold text-primary">Suggested refinements</h3>
                  <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-dimmed dark:bg-zinc-900">
                    click to autocomplete
                  </span>
                </div>
                <p class="mt-1 text-xs text-dimmed">Based on the matched variants. Add a source or label to narrow the query.</p>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-dimmed">
                <span class="inline-flex items-center gap-1">
                  <i class="ti ti-stack-2" />
                  {plural(matchingMetricSeries().length, "variant")}
                </span>
                <span class="inline-flex items-center gap-1">
                  <i class="ti ti-database-share" />
                  {plural(matchingMetricSources().length, "source")}
                </span>
                <span class="inline-flex items-center gap-1">
                  <i class="ti ti-tags" />
                  {plural(queryFilterSuggestions().length, "label key")}
                </span>
                <Show when={querySuggestionOverflow() > 0 || querySuggestionsExpanded()}>
                  <button
                    type="button"
                    class="inline-flex h-7 items-center gap-1 rounded-full bg-zinc-100 px-2.5 text-xs font-medium text-secondary transition hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    onClick={() => setQuerySuggestionsExpanded((expanded) => !expanded)}
                  >
                    <i class={`ti ${querySuggestionsExpanded() ? "ti-chevron-up" : "ti-adjustments-horizontal"}`} />
                    {querySuggestionsExpanded()
                      ? "Show less"
                      : `Browse${querySuggestionOverflow() > 0 ? ` +${querySuggestionOverflow()}` : ""}`}
                  </button>
                </Show>
              </div>
            </div>
            <Show when={querySuggestionsExpanded()}>
              <div class="mt-3 max-w-xl">
                <TextInput
                  type="search"
                  icon="ti ti-search"
                  value={querySuggestionSearch}
                  onInput={setQuerySuggestionSearch}
                  placeholder="Search suggested sources and labels..."
                  clearable
                />
              </div>
            </Show>
            <div class="mt-3 space-y-2">
              <Show when={!compiledMetricQuery()?.sourceId && visibleQuerySourceSuggestions().length > 0}>
                <div class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-2">
                  <div class="pt-1 text-xs font-medium text-dimmed">Sources</div>
                  <div class="flex flex-wrap gap-2">
                    <For each={visibleQuerySourceSuggestions()}>
                      {({ source, count }) => (
                        <button type="button" class={suggestionTagClass} onClick={() => applyQuerySourceFilter(source.id)}>
                          <i class="ti ti-database-share" />
                          <span class="truncate">{source.name}</span>
                          <span class="text-dimmed">· {count}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <For each={visibleQueryLabelSuggestions()}>
                {(group) => (
                  <div class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-2">
                    <div
                      class="truncate pt-1 text-xs font-medium text-dimmed"
                      title={`${group.key} · ${plural(group.count, "variant")}`}
                    >
                      {group.key}
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <For each={group.values}>
                        {(filter) => (
                          <button
                            type="button"
                            class={suggestionTagClass}
                            onClick={() => applyQueryDimensionFilter(filter.key, filter.value)}
                            title={`Add where ${filter.key}=${filter.value}`}
                          >
                            <i class="ti ti-tag" />
                            <span class="truncate">{filter.value}</span>
                            <span class="text-dimmed">· {filter.count}</span>
                          </button>
                        )}
                      </For>
                      <Show when={group.hiddenValues > 0}>
                        <span class="inline-flex h-7 items-center px-2 text-xs text-dimmed">+{group.hiddenValues} more</span>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
              <Show
                when={
                  querySuggestionsExpanded() &&
                  querySuggestionMatches().sources.length === 0 &&
                  querySuggestionMatches().labels.length === 0
                }
              >
                <p class="text-xs text-dimmed">No suggested filters match this search.</p>
              </Show>
            </div>
          </section>
        </Show>

        <Show when={compiledMetricQuery() && matchingMetricSeries().length === 0}>
          <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-dimmed">
            <span class="inline-flex items-center gap-1">
              <i class="ti ti-stack-2" />0 variants matched
            </span>
          </div>
        </Show>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2 bg-surface px-3 py-3">
        <button
          type="button"
          class="btn-input btn-input-sm"
          disabled={!currentExplorerQuery() || queryRunning()}
          onClick={() => void runTextQuery({ manual: true, remember: true })}
        >
          <i class={`ti ${queryRunning() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} /> Reload
        </button>
        <button
          type="button"
          class="btn-input btn-input-sm"
          disabled={!selectedBaseId()}
          onClick={() => openQueryReferenceWindow(selectedBaseId())}
        >
          <i class="ti ti-external-link" /> Open reference
        </button>
      </div>
    </div>
  );

  const renderExplorerResultPane = () => (
    <div class="paper flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <div class="min-w-40">
          <SelectInput
            icon="ti ti-layout"
            value={explorerResultView}
            onChange={(value) =>
              setExplorerResultView(compiledQuery()?.kind !== "metric" && value === "chart" ? "table" : (value as ExplorerResultView))
            }
            options={RESULT_VIEW_OPTIONS}
          />
        </div>
        <Show when={explorerResultView() === "chart"}>
          <div class="min-w-44">
            <SelectInput
              icon="ti ti-chart-line"
              value={selectedVisual}
              onChange={(value) => setSelectedVisual(value as PanelVisual)}
              options={VISUAL_OPTIONS}
            />
          </div>
        </Show>
        <button
          type="button"
          class="btn-input btn-input-sm"
          disabled={!compiledQuery()}
          onClick={() => void copyDashboardWidgetSnippet()}
          title="Copy a Dashboard DSL widget snippet for this query"
        >
          <i class="ti ti-copy" /> Copy widget
        </button>
        <span class="ml-auto text-xs text-dimmed">
          {compiledQuery()?.kind === "events"
            ? `${explorerEvents().length} events`
            : compiledQuery()?.kind === "states"
              ? `${explorerStates().length} states`
              : `${points().length} points`}
        </span>
      </div>
      <div class={explorerResultView() === "table" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-hidden p-3"}>
        {renderExplorerResult()}
      </div>
    </div>
  );

  const renderBrowseExplorerPane = () => {
    const scopeTagClass = "chip border-0 bg-blue-50 text-blue-700 dark:bg-blue-950/70 dark:text-blue-200";
    const clearScopeButtonClass = "ml-1 inline-flex text-blue-500 transition hover:text-blue-700 dark:text-blue-300";
    const rowClass = "group block w-full rounded px-2 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-900";
    const actionClass =
      "inline-flex h-7 items-center gap-1 rounded-full bg-zinc-100 px-2.5 text-[11px] font-medium text-secondary transition hover:bg-blue-100 hover:text-blue-700 dark:bg-zinc-900 dark:hover:bg-blue-950 dark:hover:text-blue-200";

    return (
      <div class="paper flex h-full min-h-0 flex-col overflow-hidden">
        <div class="shrink-0 space-y-2 p-3">
          <TextInput
            type="search"
            icon="ti ti-search"
            value={browseSearch}
            onInput={setBrowseSearch}
            placeholder="Find sources, entities, metrics, events, states, labels..."
            clearable
          />
          <div class="flex flex-wrap gap-2">
            <Show when={selectedBrowseSource()}>
              {(source) => (
                <span class={scopeTagClass}>
                  <i class="ti ti-database-share" />
                  <span class="truncate">Source: {source().name}</span>
                  <button type="button" class={clearScopeButtonClass} onClick={() => setBrowseSourceId("")} aria-label="Clear source scope">
                    <i class="ti ti-x" />
                  </button>
                </span>
              )}
            </Show>
            <Show when={selectedBrowseEntity()}>
              {(entity) => (
                <span class={scopeTagClass}>
                  <i class="ti ti-cube" />
                  <span class="truncate">Resource: {entity().id}</span>
                  <button type="button" class={clearScopeButtonClass} onClick={() => setBrowseEntityId("")} aria-label="Clear resource scope">
                    <i class="ti ti-x" />
                  </button>
                </span>
              )}
            </Show>
            <Show when={!selectedBrowseSource() && !selectedBrowseEntity()}>
              <span class="text-xs text-dimmed">Select a source or resource to narrow the signals below.</span>
            </Show>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-3 pb-3">
          <div class="grid gap-3 xl:grid-cols-2">
            <section class="rounded bg-zinc-50/80 p-2 dark:bg-zinc-900/45">
              <div class="mb-1 flex items-center justify-between gap-2 px-1">
                <h3 class="text-label text-xs">Sources</h3>
                <span class="text-[11px] text-dimmed">{plural(browseSources().length, "shown")}</span>
              </div>
              <Show when={browseSources().length > 0} fallback={<p class="px-1 py-2 text-xs text-dimmed">No matching sources.</p>}>
                <For each={browseSources()}>
                  {({ source, metricCount, eventCount, stateCount }) => (
                    <div class="rounded transition hover:bg-white dark:hover:bg-zinc-950">
                      <button type="button" class={rowClass} onClick={() => setBrowseSourceId(source.id)}>
                        <span class="flex items-center gap-2">
                          <i class={`${sourceKindIcon(source.kind)} text-dimmed`} />
                          <span class="min-w-0 flex-1 truncate text-sm font-medium text-secondary">{source.name}</span>
                          <span class={sourceStatus(source).text}>{sourceStatus(source).label}</span>
                        </span>
                        <span class="mt-1 block truncate text-[11px] text-dimmed">
                          {source.kind} · {plural(metricCount, "metric")} · {plural(eventCount, "event")} · {plural(stateCount, "state")}
                        </span>
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </section>

            <section class="rounded bg-zinc-50/80 p-2 dark:bg-zinc-900/45">
              <div class="mb-1 flex items-center justify-between gap-2 px-1">
                <h3 class="text-label text-xs">Resources</h3>
                <span class="text-[11px] text-dimmed">{plural(browseVisibleEntities().length, "shown")}</span>
              </div>
              <Show
                when={browseVisibleEntities().length > 0}
                fallback={<p class="px-1 py-2 text-xs text-dimmed">No matching resources yet.</p>}
              >
                <For each={browseVisibleEntities()}>
                  {(entity) => (
                    <button type="button" class={rowClass} onClick={() => setBrowseEntityId(entity.id)}>
                      <span class="flex items-center gap-2">
                        <i class="ti ti-cube text-dimmed" />
                        <span class="min-w-0 flex-1 truncate text-sm font-medium text-secondary">{entity.id}</span>
                        <span class="text-[11px] text-dimmed">{entity.type ?? "entity"}</span>
                      </span>
                      <span class="mt-1 block truncate text-[11px] text-dimmed">
                        {plural(entity.metricCount, "metric")} · {plural(entity.eventCount, "event")} · {plural(entity.stateCount, "state")}
                      </span>
                    </button>
                  )}
                </For>
              </Show>
            </section>
          </div>

          <section class="mt-3 rounded bg-zinc-50/80 p-2 dark:bg-zinc-900/45">
            <div class="mb-1 flex items-center justify-between gap-2 px-1">
              <h3 class="text-label text-xs">Signals</h3>
              <span class="text-[11px] text-dimmed">
                {plural(browseMetrics().length, "metric")} · {plural(browseEvents().length, "event")} ·{" "}
                {plural(browseStates().length, "state")}
              </span>
            </div>
            <div class="grid gap-2 xl:grid-cols-3">
              <div>
                <h4 class="px-1 pb-1 text-xs font-semibold text-dimmed">Metrics</h4>
                <Show when={browseMetrics().length > 0} fallback={<p class="px-1 py-2 text-xs text-dimmed">No matching metrics.</p>}>
                  <For each={browseMetrics()}>
                    {({ metric, seriesCount, sampleDimensions }) => (
                      <div class="rounded px-2 py-2 transition hover:bg-white dark:hover:bg-zinc-950">
                        <button type="button" class="block w-full text-left" onClick={() => setMetricBrowseQuery(metric, sampleDimensions)}>
                          <span class="block truncate text-sm font-medium text-secondary">{metric.name}</span>
                          <span class="block truncate text-[11px] text-dimmed">
                            {metric.type}
                            {metric.unit ? ` · ${metric.unit}` : ""} · {plural(seriesCount, "variant")}
                          </span>
                        </button>
                        <div class="mt-2 flex flex-wrap gap-1">
                          <button type="button" class={actionClass} onClick={() => setMetricBrowseQuery(metric, sampleDimensions)}>
                            <i class="ti ti-code" /> query
                          </button>
                          <Show when={browseSourceId()}>
                            <button type="button" class={actionClass} onClick={() => applyQuerySourceFilter(browseSourceId())}>
                              <i class="ti ti-database-share" /> add source
                            </button>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>

              <div>
                <h4 class="px-1 pb-1 text-xs font-semibold text-dimmed">Events</h4>
                <Show when={browseEvents().length > 0} fallback={<p class="px-1 py-2 text-xs text-dimmed">No matching events.</p>}>
                  <For each={browseEvents()}>
                    {(event) => (
                      <div class="rounded px-2 py-2 transition hover:bg-white dark:hover:bg-zinc-950">
                        <button type="button" class="block w-full text-left" onClick={() => setEventBrowseQuery(event.kind, event.sample)}>
                          <span class="block truncate text-sm font-medium text-secondary">{event.kind}</span>
                          <span class="block truncate text-[11px] text-dimmed">{plural(event.count, "recent row")}</span>
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
              </div>

              <div>
                <h4 class="px-1 pb-1 text-xs font-semibold text-dimmed">States</h4>
                <Show when={browseStates().length > 0} fallback={<p class="px-1 py-2 text-xs text-dimmed">No matching states.</p>}>
                  <For each={browseStates()}>
                    {(state) => (
                      <div class="rounded px-2 py-2 transition hover:bg-white dark:hover:bg-zinc-950">
                        <button type="button" class="block w-full text-left" onClick={() => setStateBrowseQuery(state.key, state.sample)}>
                          <span class="block truncate text-sm font-medium text-secondary">{state.key}</span>
                          <span class="block truncate text-[11px] text-dimmed">
                            {plural(state.count, "current row")} · latest {formatSignalValue(state.sample.value)}
                          </span>
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </section>

          <section class="mt-3 rounded bg-zinc-50/80 p-2 dark:bg-zinc-900/45">
            <div class="mb-2 flex items-center justify-between gap-2 px-1">
              <h3 class="text-label text-xs">Labels</h3>
              <span class="text-[11px] text-dimmed">Click to add a where filter</span>
            </div>
            <Show when={browseLabels().length > 0} fallback={<p class="px-1 py-2 text-xs text-dimmed">No matching labels.</p>}>
              <div class="space-y-2">
                <For each={browseLabels()}>
                  {(group) => (
                    <div class="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2">
                      <div class="truncate px-1 pt-1 text-xs font-medium text-dimmed">{group.key}</div>
                      <div class="flex flex-wrap gap-1">
                        <For each={group.values}>
                          {(filter) => (
                            <button
                              type="button"
                              class={suggestionTagClass}
                              onClick={() => applyQueryDimensionFilter(filter.key, filter.value)}
                            >
                              <i class="ti ti-tag" />
                              <span class="truncate">{filter.value}</span>
                              <span class="text-dimmed">· {filter.count}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>
      </div>
    );
  };

  const renderSavedQueriesPane = () => (
    <div class="paper flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span class="text-label text-xs">Saved queries</span>
        <button
          type="button"
          class="text-xs font-medium text-secondary transition hover:text-blue-600"
          disabled={!currentExplorerQuery() || loading()}
          onClick={() => void saveCurrentQuery()}
        >
          <i class="ti ti-device-floppy" /> Save current
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-auto px-2 pb-2">
        <Show when={savedQueries().length > 0} fallback={<p class="px-1 py-2 text-xs text-dimmed">No saved queries.</p>}>
          <For each={savedQueries()}>
            {(item) => (
              <div class="group flex items-start gap-2 rounded px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                <button type="button" class="min-w-0 flex-1 text-left" onClick={() => setQueryText(item.query)}>
                  <span class="block truncate text-sm font-medium text-secondary">{item.name}</span>
                  <code class="block truncate font-mono text-[11px] text-dimmed">{item.query}</code>
                </button>
                <button
                  type="button"
                  class="icon-btn opacity-0 group-hover:opacity-100"
                  onClick={() => void removeSavedQuery(item)}
                  aria-label="Remove saved query"
                >
                  <i class="ti ti-trash" />
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );

  const renderQueryHistoryPane = () => (
    <div class="paper h-full min-h-0 overflow-auto p-2">
      <Show when={queryHistory().length > 0} fallback={<p class="px-1 py-2 text-xs text-dimmed">No runs yet.</p>}>
        <For each={queryHistory()}>
          {(item) => (
            <button
              type="button"
              class="block w-full rounded px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
              onClick={() => setQueryText(item.query)}
            >
              <code class="block truncate font-mono text-[11px] text-secondary">{item.query}</code>
              <span class="text-[11px] text-dimmed">{compactDateWithDelta(item.ranAt, pulseDateContext())}</span>
            </button>
          )}
        </For>
      </Show>
    </div>
  );

  const renderMetricExplorerView = () => (
    <section class="flex min-h-0 flex-1 overflow-hidden pb-2">
      <DockWorkspace storageKey="pulse.query-explorer" initialState={props.initialExplorerDockState} defaultResultSize={42} class="h-full min-h-0">
        <DockWorkspace.Result title="Result" icon="ti ti-chart-line">
          {renderExplorerResultPane()}
        </DockWorkspace.Result>
        <DockWorkspace.Pane id="editor" title="Query" icon="ti ti-code" section="editor">
          {renderQueryEditorPane()}
        </DockWorkspace.Pane>
        <DockWorkspace.Pane id="browse" title="Browse" icon="ti ti-list-search" section="context">
          {renderBrowseExplorerPane()}
        </DockWorkspace.Pane>
        <DockWorkspace.Pane id="saved" title="Saved" icon="ti ti-device-floppy" section="context">
          {renderSavedQueriesPane()}
        </DockWorkspace.Pane>
        <DockWorkspace.Pane id="history" title="History" icon="ti ti-history" section="context">
          {renderQueryHistoryPane()}
        </DockWorkspace.Pane>
      </DockWorkspace>
    </section>
  );

  const renderSignalCatalogTable = (kind: SignalCatalogKind) => {
    if (kind === "events") {
      return (
        <DataTable
          rows={eventGroups()}
          columns={eventGroupColumns}
          getRowId={(group) => group.id}
          selectedRowId={null}
          onRowClick={(group) => openEventDetailView(group.kind)}
          density="compact"
          fillHeight
          class="paper flex-1 min-h-0 overflow-auto"
          empty="No events ingested yet."
          scrollPreserveKey="pulse-signals-events"
          renderCell={({ row, col, render }) => renderEventGroupCell(row, col, render)}
        />
      );
    }
    if (kind === "states") {
      return (
        <DataTable
          rows={stateGroups()}
          columns={stateGroupColumns}
          getRowId={(group) => group.id}
          selectedRowId={null}
          onRowClick={(group) => openStateDetailView(group.key)}
          density="compact"
          fillHeight
          class="paper flex-1 min-h-0 overflow-auto"
          empty="No states ingested yet."
          scrollPreserveKey="pulse-signals-states"
          renderCell={({ row, col, render }) => renderStateGroupCell(row, col, render)}
        />
      );
    }
    return (
      <DataTable
        rows={activityMetrics()}
        columns={metricColumns}
        getRowId={(metric) => metric.name}
        selectedRowId={null}
        onRowClick={(metric) => openMetricDetailView(metric.name)}
        density="compact"
        fillHeight
        class="paper flex-1 min-h-0 overflow-auto"
        empty="No metrics ingested yet."
        scrollPreserveKey="pulse-signals-metrics"
        renderCell={({ row, col, render }) => renderMetricCell(row, col, render)}
      />
    );
  };

  const renderSignalCatalogView = (kind: SignalCatalogKind) => (
    <section class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        {renderSignalCatalogTabs(kind)}
        {renderActivityToolbar(kind)}
      </div>
      {renderSignalCatalogTable(kind)}
    </section>
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
                    : renderSignalCatalogView(signalCatalogKindForView(activeView()))}
      </AppWorkspace.Main>

    </AppWorkspace>
  );
}
