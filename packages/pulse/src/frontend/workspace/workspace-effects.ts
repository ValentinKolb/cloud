import { query } from "@k2b/stdlib/solid";
import type { Accessor, Setter } from "solid-js";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type {
  PulseDashboard,
  PulseDashboardConfig,
  PulseDashboardDslCompileResult,
  PulseMetricSummary,
  PulseQueryCompileResult,
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
  setQueryHistory: Setter<QueryHistoryEntry[]>;
  dashboardControlValues: Accessor<Record<string, Record<string, string>>>;
  setDashboardControlValues: Setter<Record<string, Record<string, string>>>;
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
};

export const installWorkspaceEffects = (deps: WorkspaceEffectsDeps) => {
  let lastAutoRunQuery = "";
  const [compileIntent, setCompileIntent] = createSignal<{ baseId: string; query: string } | null>(null);
  const compileQuery = query.create({
    source: compileIntent,
    enabled: () => compileIntent() !== null,
    load: (intent, { abortSignal }) => {
      if (!intent) throw new Error("No query compile requested");
      return jsonFetch<PulseQueryCompileResult>("/api/pulse/query/compile-text", {
        method: "POST",
        body: JSON.stringify(intent),
        signal: abortSignal,
      });
    },
  });

  onMount(() => {
    if (!deps.origin()) deps.setOrigin(window.location.origin);
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
    if (deps.activeView() !== "dashboard-edit" || !dashboard || deps.dashboardDslSeededFor() === dashboard.id) return;
    deps.setDashboardDslText(dashboardToDsl(dashboard));
    deps.setDashboardPreviewConfig(dashboard.config);
    deps.setDashboardDslDiagnostics(null);
    deps.setDashboardDslDiagnosticsText("");
    deps.setDashboardDslSeededFor(dashboard.id);
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
      setCompileIntent({ baseId, query });
      void compileQuery.refresh().then(() => {
        const error = compileQuery.error();
        if (error) {
          if (canceled) return;
          deps.setQueryDiagnostics({
            ok: false,
            diagnostics: [{ severity: "error", message: error.message }],
            compiled: null,
          });
          return;
        }
        const result = compileQuery.data();
        if (result) {
          if (canceled || query !== deps.currentExplorerQuery()) return;
          deps.setQueryDiagnostics(result);
          if (result.ok && result.compiled && query !== lastAutoRunQuery) {
            lastAutoRunQuery = query;
            void deps.runTextQuery({ query, manual: false, remember: false });
          }
        }
      });
    }, 250);
    onCleanup(() => {
      canceled = true;
      clearTimeout(timeout);
      compileQuery.abort();
    });
  });
};
