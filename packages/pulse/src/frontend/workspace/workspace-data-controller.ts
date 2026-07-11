import type { ResourceApiKey } from "@valentinkolb/cloud/ui";
import type { Accessor, Setter } from "solid-js";
import { untrack } from "solid-js";
import type {
  MetricType,
  PulseCurrentState,
  PulseDashboard,
  PulseInventory,
  PulseMetricSeries,
  PulseMetricSummary,
  PulseRecordedEvent,
  PulseSavedQuery,
  PulseSource,
  PulseSourceScrape,
} from "../../contracts";
import { fetchFocusedRowsPage, focusedRowsOffset, mergeFocusedRows } from "./focused-rows";
import { FOCUSED_PAGE_SIZE } from "./helpers";
import type { WorkspaceView } from "./types";
import {
  fetchPulseActivityData,
  fetchPulseBaseData,
  fetchPulseMetricSeries,
  fetchPulseResourceSignals,
  fetchPulseResources,
  fetchPulseSourceApiKeys,
  fetchPulseSourceScrapes,
} from "./workspace-loaders";

type DataControllerDeps = {
  selectedBaseId: Accessor<string>;
  activeView: Accessor<WorkspaceView>;
  activitySearch: Accessor<string>;
  metricTypeFilter: Accessor<"" | MetricType>;
  resourceSearch: Accessor<string>;
  resourceSourceFilter: Accessor<string>;
  resourceTypeFilter: Accessor<string>;
  selectedResourceKey: Accessor<string>;
  selectedMetric: Accessor<string>;
  selectedQuerySourceId: Accessor<string>;
  focusedSignalId: Accessor<string>;
  focusedSearch: Accessor<string>;
  focusedEvents: Accessor<PulseRecordedEvent[]>;
  focusedMetricSeries: Accessor<PulseMetricSeries[]>;
  focusedStates: Accessor<PulseCurrentState[]>;
  setSources: Setter<PulseSource[]>;
  setMetrics: Setter<PulseMetricSummary[]>;
  setInventory: Setter<PulseInventory>;
  setDashboards: Setter<PulseDashboard[]>;
  setSavedQueries: Setter<PulseSavedQuery[]>;
  setSelectedResourceKey: Setter<string>;
  setSelectedMetric: Setter<string>;
  setSelectedSourceId: Setter<string>;
  setSelectedDashboardId: Setter<string>;
  setRecentEvents: Setter<PulseRecordedEvent[]>;
  setCurrentStates: Setter<PulseCurrentState[]>;
  setActivityMetrics: Setter<PulseMetricSummary[]>;
  setSeries: Setter<PulseMetricSeries[]>;
  setSelectedSeriesId: Setter<string>;
  setFocusedEvents: Setter<PulseRecordedEvent[]>;
  setFocusedMetricSeries: Setter<PulseMetricSeries[]>;
  setFocusedStates: Setter<PulseCurrentState[]>;
  setFocusedHasMore: Setter<boolean>;
  setFocusedLoadingMore: Setter<boolean>;
  setSourceScrapes: Setter<Record<string, PulseSourceScrape[]>>;
  setSourceApiKeys: Setter<Record<string, ResourceApiKey[]>>;
};

export const createWorkspaceDataController = (deps: DataControllerDeps) => {
  let activityRequestId = 0;
  let resourceListRequestId = 0;
  let resourceSignalsRequestId = 0;
  let focusedRowsRequestId = 0;

  const loadBase = async (baseId = deps.selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const nextData = await fetchPulseBaseData(baseId, signal);
    deps.setSources(nextData.sources);
    deps.setMetrics(nextData.metrics);
    deps.setInventory(nextData.inventory);
    deps.setSelectedResourceKey((current) =>
      current && nextData.inventory.resources.some((resource) => resource.key === current)
        ? current
        : (nextData.inventory.resources[0]?.key ?? ""),
    );
    deps.setDashboards(nextData.dashboards);
    deps.setSavedQueries(nextData.savedQueries);
    deps.setSelectedMetric((current) =>
      current && nextData.metrics.some((metric) => metric.name === current) ? current : (nextData.metrics[0]?.name ?? ""),
    );
    deps.setSelectedSourceId((current) => (current && nextData.sources.some((source) => source.id === current) ? current : ""));
    deps.setSelectedDashboardId(
      (current) => nextData.dashboards.find((dashboard) => dashboard.id === current)?.id ?? nextData.dashboards[0]?.id ?? "",
    );
  };

  const loadActivity = async (baseId = deps.selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const requestId = ++activityRequestId;
    const snapshot = { q: deps.activitySearch().trim(), type: deps.metricTypeFilter() };
    const nextData = await fetchPulseActivityData(baseId, snapshot, signal);
    if (
      signal?.aborted ||
      requestId !== activityRequestId ||
      deps.selectedBaseId() !== baseId ||
      deps.activitySearch().trim() !== snapshot.q ||
      deps.metricTypeFilter() !== snapshot.type
    ) {
      return;
    }
    deps.setRecentEvents(nextData.events);
    deps.setCurrentStates(nextData.states);
    deps.setActivityMetrics(nextData.metrics);
  };

  const loadResources = async (baseId = deps.selectedBaseId(), signal?: AbortSignal) => {
    if (!baseId) return;
    const requestId = ++resourceListRequestId;
    const view = deps.activeView();
    const snapshot =
      view === "resource-detail"
        ? { ref: deps.selectedResourceKey(), limit: 20 }
        : {
            q: deps.resourceSearch().trim(),
            sourceId: deps.resourceSourceFilter(),
            type: deps.resourceTypeFilter(),
            limit: 500,
          };
    const resources = await fetchPulseResources(baseId, snapshot, signal);
    if (
      signal?.aborted ||
      requestId !== resourceListRequestId ||
      deps.selectedBaseId() !== baseId ||
      deps.activeView() !== view ||
      (view === "resources" &&
        (deps.resourceSearch().trim() !== (snapshot.q ?? "") ||
          deps.resourceSourceFilter() !== (snapshot.sourceId ?? "") ||
          deps.resourceTypeFilter() !== (snapshot.type ?? ""))) ||
      (view === "resource-detail" && deps.selectedResourceKey() !== (snapshot.ref ?? ""))
    ) {
      return;
    }
    deps.setInventory((current) => ({ ...current, resources }));
    if (view === "resources") {
      deps.setSelectedResourceKey((current) =>
        current && resources.some((resource) => resource.key === current) ? current : (resources[0]?.key ?? ""),
      );
    }
  };

  const loadResourceSignals = async (baseId = deps.selectedBaseId(), resourceKey = deps.selectedResourceKey(), signal?: AbortSignal) => {
    if (!baseId || !resourceKey) return;
    const requestId = ++resourceSignalsRequestId;
    const signals = await fetchPulseResourceSignals(baseId, resourceKey, signal);
    if (
      signal?.aborted ||
      requestId !== resourceSignalsRequestId ||
      deps.selectedBaseId() !== baseId ||
      deps.activeView() !== "resource-detail" ||
      deps.selectedResourceKey() !== resourceKey
    ) {
      return;
    }
    deps.setInventory((current) => ({ ...current, metrics: signals.metrics, states: signals.states, events: signals.events }));
  };

  const refreshResources = async (baseId = deps.selectedBaseId(), signal?: AbortSignal) => {
    await loadResources(baseId, signal);
    if (deps.activeView() === "resource-detail") await loadResourceSignals(baseId, deps.selectedResourceKey(), signal);
  };

  const loadSeries = async (baseId = deps.selectedBaseId(), metric = deps.selectedMetric(), sourceId = deps.selectedQuerySourceId()) => {
    if (!baseId || !metric) {
      deps.setSeries([]);
      deps.setSelectedSeriesId("");
      return;
    }
    const nextSeries = await fetchPulseMetricSeries(baseId, metric, sourceId);
    deps.setSeries(nextSeries);
    deps.setSelectedSeriesId((current) => (current && nextSeries.some((item) => item.id === current) ? current : ""));
  };

  const loadFocusedRows = async (options: { append?: boolean; signal?: AbortSignal } = {}) => {
    const baseId = deps.selectedBaseId();
    const view = deps.activeView();
    const signalId = deps.focusedSignalId();
    if (!baseId || !signalId || (view !== "metric-detail" && view !== "state-detail" && view !== "event-detail")) return;
    const requestId = ++focusedRowsRequestId;
    const offset = untrack(() =>
      focusedRowsOffset({
        append: options.append,
        eventCount: deps.focusedEvents().length,
        metricSeriesCount: deps.focusedMetricSeries().length,
        stateCount: deps.focusedStates().length,
        view,
      }),
    );

    deps.setFocusedLoadingMore(true);
    try {
      const page = await fetchFocusedRowsPage({
        baseId,
        offset,
        pageSize: FOCUSED_PAGE_SIZE,
        search: deps.focusedSearch().trim(),
        signal: options.signal,
        signalId,
        view,
      });
      if (requestId !== focusedRowsRequestId) return;
      deps.setFocusedHasMore(page.hasMore);
      if (page.view === "metric-detail") deps.setFocusedMetricSeries((current) => mergeFocusedRows(current, page.rows, options.append));
      if (page.view === "state-detail") deps.setFocusedStates((current) => mergeFocusedRows(current, page.rows, options.append));
      if (page.view === "event-detail") deps.setFocusedEvents((current) => mergeFocusedRows(current, page.rows, options.append));
    } finally {
      if (requestId === focusedRowsRequestId) deps.setFocusedLoadingMore(false);
    }
  };

  const loadSourceScrapes = async (baseId: string, sourceId: string, signal?: AbortSignal) => {
    if (!baseId || !sourceId) return;
    const nextScrapes = await fetchPulseSourceScrapes(baseId, sourceId, signal);
    deps.setSourceScrapes((current) => ({ ...current, [sourceId]: nextScrapes }));
  };

  const loadSourceApiKeys = async (baseId: string, sourceId: string, signal?: AbortSignal) => {
    if (!baseId || !sourceId) return;
    const nextKeys = await fetchPulseSourceApiKeys(baseId, sourceId, signal);
    deps.setSourceApiKeys((current) => ({ ...current, [sourceId]: nextKeys }));
  };

  return {
    loadActivity,
    loadBase,
    loadFocusedRows,
    loadResourceSignals,
    loadResources,
    loadSeries,
    loadSourceApiKeys,
    loadSourceScrapes,
    refreshResources,
  };
};
