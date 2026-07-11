import { prompts, toast } from "@valentinkolb/cloud/ui";
import { clipboard } from "@valentinkolb/stdlib/browser";
import type { Accessor, Setter } from "solid-js";
import type {
  Aggregation,
  MetricQueryPoint,
  PanelVisual,
  PulseCurrentState,
  PulseExplorerQuery,
  PulseMetricSummary,
  PulseQueryCompileResult,
  PulseRecordedEvent,
  PulseResourceMetric,
  PulseSavedQuery,
} from "../../contracts";
import { defaultPulseQuery } from "../query-authoring";
import {
  currentStateQueryText,
  dashboardWidgetSnippetFromQuery,
  eventKindQueryText,
  metricSummaryQueryText,
  queryWithDimensionFilter,
  queryWithSourceFilter,
  recordedEventQueryText,
  resourceMetricQueryText,
  stateKeyQueryText,
} from "./helpers";
import { writeQueryHistory } from "./query-history";
import {
  failedQueryDiagnostics,
  queryRunApplication,
  runPulseTextQuery,
  shouldRememberQueryRun,
  shouldToastQueryError,
} from "./query-runner";
import { createPulseSavedQuery, deletePulseSavedQuery } from "./saved-query-actions";
import { openSaveQueryDialog } from "./saved-query-dialog";
import type { ExplorerResultView, QueryHistoryEntry } from "./types";

type QueryControllerDeps = {
  selectedBaseId: Accessor<string>;
  metrics: Accessor<PulseMetricSummary[]>;
  queryText: Accessor<string>;
  setQueryText: Setter<string>;
  defaultQueryText: Accessor<string>;
  queryHistory: Accessor<QueryHistoryEntry[]>;
  setQueryHistory: Setter<QueryHistoryEntry[]>;
  compiledQuery: Accessor<PulseExplorerQuery | null>;
  explorerResultView: Accessor<ExplorerResultView>;
  setExplorerResultView: Setter<ExplorerResultView>;
  setSelectedMetric: Setter<string>;
  setSelectedAggregation: Setter<Aggregation>;
  setSelectedBucket: Setter<string>;
  setSelectedSince: Setter<string>;
  setSelectedQuerySourceId: Setter<string>;
  setPoints: Setter<MetricQueryPoint[]>;
  setExplorerEvents: Setter<PulseRecordedEvent[]>;
  setExplorerStates: Setter<PulseCurrentState[]>;
  setQueryDiagnostics: Setter<PulseQueryCompileResult | null>;
  setLastRunQuery: Setter<string>;
  setQueryRunning: Setter<boolean>;
  loading: Accessor<boolean>;
  setLoading: Setter<boolean>;
  setSavedQueries: Setter<PulseSavedQuery[]>;
  selectedVisual: Accessor<PanelVisual>;
  browseSourceId: Accessor<string>;
  browseEntityId: Accessor<string>;
  openExplorer: () => void;
};

export const createQueryController = (deps: QueryControllerDeps) => {
  let runId = 0;
  const current = () => deps.queryText().trim() || deps.defaultQueryText() || defaultPulseQuery(deps.metrics());

  const applyDimensionFilter = (key: string, value: string) => {
    const query = current();
    if (query) deps.setQueryText(queryWithDimensionFilter(query, key, value));
  };

  const applySourceFilter = (sourceId: string) => {
    const query = current();
    if (query) deps.setQueryText(queryWithSourceFilter(query, sourceId));
  };

  const setMetricBrowseQuery = (metric: PulseMetricSummary, dimensions: Record<string, string> = {}) =>
    deps.setQueryText(metricSummaryQueryText(metric, { sourceId: deps.browseSourceId() || null, dimensions }));

  const setEventBrowseQuery = (kind: string, sample?: PulseRecordedEvent) =>
    deps.setQueryText(
      eventKindQueryText(kind, {
        sourceId: deps.browseSourceId() || sample?.sourceId,
        entityId: deps.browseEntityId() || sample?.entityId,
      }),
    );

  const setStateBrowseQuery = (key: string, sample?: PulseCurrentState) =>
    deps.setQueryText(
      stateKeyQueryText(key, { sourceId: deps.browseSourceId() || sample?.sourceId, entityId: deps.browseEntityId() || sample?.entityId }),
    );

  const openMetricQuery = (metric: PulseResourceMetric) => {
    deps.setQueryText(resourceMetricQueryText(metric));
    deps.openExplorer();
  };
  const openEventQuery = (event: PulseRecordedEvent) => {
    deps.setQueryText(recordedEventQueryText(event));
    deps.openExplorer();
  };
  const openStateQuery = (state: PulseCurrentState) => {
    deps.setQueryText(currentStateQueryText(state));
    deps.openExplorer();
  };

  const remember = (baseId: string, query: string) => {
    const next = [{ query, ranAt: new Date().toISOString() }, ...deps.queryHistory().filter((item) => item.query !== query)].slice(0, 20);
    deps.setQueryHistory(next);
    writeQueryHistory(baseId, next);
  };

  const run = async (options: { query?: string; manual?: boolean; remember?: boolean } = {}) => {
    const baseId = deps.selectedBaseId();
    const query = options.query?.trim() || current();
    if (!baseId || !query) return;
    const requestId = ++runId;
    deps.setQueryRunning(true);
    try {
      const result = await runPulseTextQuery(baseId, query);
      if (requestId !== runId) return;
      const application = queryRunApplication(deps.explorerResultView(), result);
      deps.setQueryText(query);
      if (application.metricControls) {
        deps.setSelectedMetric(application.metricControls.metric);
        deps.setSelectedAggregation(application.metricControls.aggregation);
        deps.setSelectedBucket(application.metricControls.bucket);
        deps.setSelectedSince(application.metricControls.since);
        deps.setSelectedQuerySourceId(application.metricControls.sourceId);
      } else deps.setExplorerResultView(application.nextResultView);
      deps.setPoints(application.points);
      deps.setExplorerEvents(application.events);
      deps.setExplorerStates(application.states);
      deps.setQueryDiagnostics(application.diagnostics);
      deps.setLastRunQuery(query);
      if (shouldRememberQueryRun(options)) remember(baseId, query);
    } catch (error) {
      if (requestId !== runId) return;
      const message = error instanceof Error ? error.message : "Query failed";
      if (shouldToastQueryError(options)) toast.error(message);
      else deps.setQueryDiagnostics(failedQueryDiagnostics(message));
    } finally {
      if (requestId === runId) deps.setQueryRunning(false);
    }
  };

  const save = async () => {
    const baseId = deps.selectedBaseId();
    const query = current();
    if (!baseId || !query) return;
    const result = await openSaveQueryDialog(deps.compiledQuery());
    if (!result) return;
    deps.setLoading(true);
    try {
      const saved = await createPulseSavedQuery(baseId, { name: result.name, description: result.description, query });
      deps.setSavedQueries((currentItems) => [saved, ...currentItems]);
      toast.success("Query saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save query");
    } finally {
      deps.setLoading(false);
    }
  };

  const copyDashboardWidget = async () => {
    const query = current();
    const compiled = deps.compiledQuery();
    if (!query || !compiled) return;
    try {
      await clipboard.copy(dashboardWidgetSnippetFromQuery(query, compiled, deps.selectedVisual()));
      toast.success("Dashboard widget DSL copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy widget DSL");
    }
  };

  const removeSaved = async (query: PulseSavedQuery) => {
    if (!(await prompts.confirm(`Remove saved query "${query.name}"?`, { title: "Remove query", variant: "danger" }))) return;
    deps.setLoading(true);
    try {
      await deletePulseSavedQuery(query);
      deps.setSavedQueries((currentItems) => currentItems.filter((item) => item.id !== query.id));
      toast.success("Query removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove query");
    } finally {
      deps.setLoading(false);
    }
  };

  return {
    applyDimensionFilter,
    applySourceFilter,
    copyDashboardWidget,
    current,
    openEventQuery,
    openMetricQuery,
    openStateQuery,
    removeSaved,
    run,
    save,
    setEventBrowseQuery,
    setMetricBrowseQuery,
    setStateBrowseQuery,
  };
};
