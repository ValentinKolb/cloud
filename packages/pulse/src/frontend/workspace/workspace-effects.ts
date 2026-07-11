import type { ResourceApiKey } from "@valentinkolb/cloud/ui";
import type { Accessor, Setter } from "solid-js";
import { createEffect, onCleanup, onMount } from "solid-js";
import type {
  MetricQuery,
  MetricType,
  PulseCurrentState,
  PulseDashboard,
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
import { defaultPulseQuery } from "../query-authoring";
import { dashboardToDsl, jsonFetch } from "./helpers";
import { readQueryHistory } from "./query-history";
import type { QueryHistoryEntry, WorkspaceView } from "./types";

type WorkspaceEffectsDeps = {
  selectedBaseId: Accessor<string>;
  activeView: Accessor<WorkspaceView>;
  selectedDashboard: Accessor<PulseDashboard | null>;
  origin: Accessor<string>;
  setOrigin: Setter<string>;
  loadBaseData: () => Promise<void>;
  setQueryHistory: Setter<QueryHistoryEntry[]>;
  dashboardControlValues: Accessor<Record<string, Record<string, string>>>;
  setDashboardControlValues: Setter<Record<string, Record<string, string>>>;
  refreshDashboard: (dashboard: PulseDashboard) => Promise<void>;
  dashboardDslSeededFor: Accessor<string>;
  setDashboardDslText: Setter<string>;
  setDashboardPreviewConfig: Setter<PulseDashboardConfig | null>;
  setDashboardDslDiagnostics: Setter<PulseDashboardDslCompileResult | null>;
  setDashboardDslDiagnosticsText: Setter<string>;
  setDashboardDslSeededFor: Setter<string>;
  dashboardDslText: Accessor<string>;
  compileDashboardDslPreview: (dashboard: PulseDashboard, text: string) => Promise<void>;
  querySeeded: Accessor<boolean>;
  queryText: Accessor<string>;
  metrics: Accessor<PulseMetricSummary[]>;
  setQueryText: Setter<string>;
  setQuerySeeded: Setter<boolean>;
  setQueryDiagnostics: Setter<PulseQueryCompileResult | null>;
  currentExplorerQuery: Accessor<string>;
  runTextQuery: (options: { query: string; manual: false; remember: false }) => Promise<void>;
  loadSeries: (baseId?: string, metric?: string, sourceId?: string) => Promise<void>;
  selectedMetric: Accessor<string>;
  selectedQuerySourceId: Accessor<string>;
  compiledMetricQuery: Accessor<MetricQuery | null>;
  setSeries: Setter<PulseMetricSeries[]>;
  setSelectedSeriesId: Setter<string>;
  resourceSearch: Accessor<string>;
  resourceSourceFilter: Accessor<string>;
  resourceTypeFilter: Accessor<string>;
  selectedResourceKey: Accessor<string>;
  refreshResourceView: (baseId: string, signal: AbortSignal) => Promise<void>;
  setInventory: Setter<PulseInventory>;
  activitySearch: Accessor<string>;
  metricTypeFilter: Accessor<"" | MetricType>;
  loadActivityData: (baseId: string, signal: AbortSignal) => Promise<void>;
  setRecentEvents: Setter<PulseRecordedEvent[]>;
  setCurrentStates: Setter<PulseCurrentState[]>;
  setActivityMetrics: Setter<PulseMetricSummary[]>;
  focusedSignalId: Accessor<string>;
  focusedSearch: Accessor<string>;
  loadFocusedRows: (options: { signal: AbortSignal }) => Promise<void>;
  setFocusedHasMore: Setter<boolean>;
  setFocusedMetricSeries: Setter<PulseMetricSeries[]>;
  setFocusedStates: Setter<PulseCurrentState[]>;
  setFocusedEvents: Setter<PulseRecordedEvent[]>;
  selectedSource: Accessor<PulseSource | null>;
  loadSourceScrapes: (baseId: string, sourceId: string) => Promise<void>;
  loadSourceApiKeys: (baseId: string, sourceId: string) => Promise<void>;
  setSourceScrapes: Setter<Record<string, PulseSourceScrape[]>>;
  setSourceApiKeys: Setter<Record<string, ResourceApiKey[]>>;
};

export const installWorkspaceEffects = (deps: WorkspaceEffectsDeps) => {
  let lastAutoRunQuery = "";

  onMount(() => {
    if (!deps.origin()) deps.setOrigin(window.location.origin);
    if (deps.activeView() !== "resources" && deps.activeView() !== "resource-detail") void deps.loadBaseData();
  });

  createEffect(() => {
    const baseId = deps.selectedBaseId();
    if (baseId) deps.setQueryHistory(readQueryHistory(baseId));
  });

  createEffect(() => {
    const dashboard = deps.selectedDashboard();
    const controls = dashboard?.config.layout?.controls ?? [];
    if (!dashboard || !controls.length) return;
    deps.setDashboardControlValues((current) => {
      if (current[dashboard.id]) return current;
      return { ...current, [dashboard.id]: Object.fromEntries(controls.map((control) => [control.variable, control.defaultValue])) };
    });
  });

  createEffect(() => {
    const dashboard = deps.selectedDashboard();
    const view = deps.activeView();
    if (dashboard && (view === "dashboard" || view === "dashboard-edit")) void deps.refreshDashboard(dashboard);
  });

  createEffect(() => {
    const dashboard = deps.selectedDashboard();
    if (deps.activeView() !== "dashboard-edit" || !dashboard || deps.dashboardDslSeededFor() === dashboard.id) return;
    deps.setDashboardDslText(dashboardToDsl(dashboard));
    deps.setDashboardPreviewConfig(dashboard.config);
    deps.setDashboardDslDiagnostics(null);
    deps.setDashboardDslDiagnosticsText("");
    deps.setDashboardDslSeededFor(dashboard.id);
    void deps.refreshDashboard(dashboard);
  });

  createEffect(() => {
    const dashboard = deps.selectedDashboard();
    const text = deps.dashboardDslText();
    if (deps.activeView() !== "dashboard-edit" || !dashboard || deps.dashboardDslSeededFor() !== dashboard.id) return;
    const timeout = setTimeout(() => void deps.compileDashboardDslPreview(dashboard, text), 350);
    onCleanup(() => clearTimeout(timeout));
  });

  createEffect(() => {
    if (deps.activeView() !== "explorer" || deps.querySeeded() || deps.queryText().trim() || deps.metrics().length === 0) return;
    deps.setQueryText(defaultPulseQuery(deps.metrics()));
    deps.setQuerySeeded(true);
  });

  createEffect(() => {
    if (deps.activeView() !== "explorer") {
      deps.setQueryDiagnostics(null);
      return;
    }
    const baseId = deps.selectedBaseId();
    const query = deps.currentExplorerQuery();
    if (!baseId || !query) {
      deps.setQueryDiagnostics(null);
      return;
    }
    deps.setQueryDiagnostics(null);
    let canceled = false;
    const timeout = setTimeout(() => {
      void jsonFetch<PulseQueryCompileResult>("/api/pulse/query/compile-text", {
        method: "POST",
        body: JSON.stringify({ baseId, query }),
      })
        .then((result) => {
          if (canceled || query !== deps.currentExplorerQuery()) return;
          deps.setQueryDiagnostics(result);
          if (result.ok && result.compiled && query !== lastAutoRunQuery) {
            lastAutoRunQuery = query;
            void deps.runTextQuery({ query, manual: false, remember: false });
          }
        })
        .catch((error) => {
          if (canceled) return;
          deps.setQueryDiagnostics({
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
    if (deps.activeView() !== "explorer") return;
    void deps.loadSeries(deps.selectedBaseId(), deps.selectedMetric(), deps.selectedQuerySourceId()).catch(() => {
      deps.setSeries([]);
      deps.setSelectedSeriesId("");
    });
  });

  createEffect(() => {
    if (deps.activeView() !== "explorer") return;
    const compiled = deps.compiledMetricQuery();
    const baseId = deps.selectedBaseId();
    if (!compiled || !baseId) return;
    void deps.loadSeries(baseId, compiled.metric, compiled.sourceId ?? "").catch(() => {
      deps.setSeries([]);
      deps.setSelectedSeriesId("");
    });
  });

  createEffect(() => {
    const view = deps.activeView();
    if (view !== "resources" && view !== "resource-detail") return;
    const baseId = deps.selectedBaseId();
    if (!baseId) return;
    if (view === "resources") {
      deps.resourceSearch();
      deps.resourceSourceFilter();
      deps.resourceTypeFilter();
    } else deps.selectedResourceKey();
    const refresh = new AbortController();
    void deps.refreshResourceView(baseId, refresh.signal).catch(() => {
      if (refresh.signal.aborted) return;
      deps.setInventory((current) =>
        view === "resources" ? { ...current, resources: [] } : { ...current, metrics: [], states: [], events: [] },
      );
    });
    onCleanup(() => refresh.abort());
  });

  createEffect(() => {
    const view = deps.activeView();
    if (view !== "explorer" && view !== "activity-events" && view !== "activity-states" && view !== "activity-metrics") return;
    const baseId = deps.selectedBaseId();
    deps.activitySearch();
    deps.metricTypeFilter();
    const refresh = new AbortController();
    void deps.loadActivityData(baseId, refresh.signal).catch(() => {
      if (refresh.signal.aborted) return;
      deps.setRecentEvents([]);
      deps.setCurrentStates([]);
      deps.setActivityMetrics([]);
    });
    onCleanup(() => refresh.abort());
  });

  createEffect(() => {
    const view = deps.activeView();
    const signalId = deps.focusedSignalId();
    deps.focusedSearch();
    if (view !== "metric-detail" && view !== "state-detail" && view !== "event-detail") return;
    if (!signalId) return;
    const refresh = new AbortController();
    void deps.loadFocusedRows({ signal: refresh.signal }).catch(() => {
      if (refresh.signal.aborted) return;
      deps.setFocusedHasMore(false);
      if (view === "metric-detail") deps.setFocusedMetricSeries([]);
      if (view === "state-detail") deps.setFocusedStates([]);
      if (view === "event-detail") deps.setFocusedEvents([]);
    });
    onCleanup(() => refresh.abort());
  });

  createEffect(() => {
    const source = deps.selectedSource();
    if (!source || deps.activeView() !== "sources") return;
    void deps.loadSourceScrapes(deps.selectedBaseId(), source.id).catch(() => {
      deps.setSourceScrapes((current) => ({ ...current, [source.id]: [] }));
    });
    if (source.kind === "http_ingest") {
      void deps.loadSourceApiKeys(deps.selectedBaseId(), source.id).catch(() => {
        deps.setSourceApiKeys((current) => ({ ...current, [source.id]: [] }));
      });
    }
  });
};
