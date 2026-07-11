import { prompts, toast } from "@valentinkolb/cloud/ui";
import { clipboard } from "@valentinkolb/stdlib/browser";
import type { Accessor, Setter } from "solid-js";
import type { PulseDashboard, PulseDashboardConfig, PulseDashboardControl, PulseDashboardDslCompileResult } from "../../contracts";
import { jsonFetch } from "../http";
import {
  compileDashboardDslText,
  createPublicDashboardToken,
  dashboardDslCompileError,
  deletePublicDashboardToken,
  savePulseDashboardConfig,
} from "./dashboard-actions";
import {
  dashboardDslPreviewIsCurrent,
  dashboardPreviewConfigFromResult,
  dashboardToDsl,
  emptyDashboardDsl,
  shouldSkipDashboardDslPreview,
} from "./dashboard-dsl-helpers";
import { openPulseDashboardSettingsDialog } from "./dashboard-settings-dialog";
import {
  openPublicDashboardDisplayDialog as openPublicDashboardDisplayOptionsDialog,
  type PublicDashboardDisplayHeight,
  type PublicDashboardDisplayTheme,
} from "./public-display-dialog";
import type { RefreshIntervalOption, WorkspaceView } from "./types";
import { refreshIntervalFromOption } from "./workspace-options";

type DashboardControllerDeps = {
  selectedBaseId: Accessor<string>;
  selectedDashboard: Accessor<PulseDashboard | null>;
  selectedDashboardId: Accessor<string>;
  dashboards: Accessor<PulseDashboard[]>;
  setDashboards: Setter<PulseDashboard[]>;
  setSelectedDashboardId: Setter<string>;
  loading: Accessor<boolean>;
  setLoading: Setter<boolean>;
  origin: Accessor<string>;
  activeView: Accessor<WorkspaceView>;
  dashboardDslText: Accessor<string>;
  setDashboardDslText: Setter<string>;
  dashboardDslDiagnostics: Accessor<PulseDashboardDslCompileResult | null>;
  setDashboardDslDiagnostics: Setter<PulseDashboardDslCompileResult | null>;
  dashboardDslDiagnosticsText: Accessor<string>;
  setDashboardDslDiagnosticsText: Setter<string>;
  dashboardPreviewConfig: Accessor<PulseDashboardConfig | null>;
  setDashboardPreviewConfig: Setter<PulseDashboardConfig | null>;
  setDashboardDslSeededFor: Setter<string>;
  setDashboardDslSaving: Setter<boolean>;
  dashboardControlValues: Accessor<Record<string, Record<string, string>>>;
  setDashboardControlValues: Setter<Record<string, Record<string, string>>>;
  navigate: (state: { view: WorkspaceView; dashboardId?: string }) => void;
  refreshDashboard: (dashboard?: PulseDashboard | null) => Promise<void>;
  refreshDashboardConfig: (config: PulseDashboardConfig, dashboard?: PulseDashboard | null, baseId?: string) => Promise<void>;
};

export const createDashboardController = (deps: DashboardControllerDeps) => {
  let compileRequestId = 0;

  const createDashboard = async () => {
    const baseId = deps.selectedBaseId();
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
    const dsl = emptyDashboardDsl(name, String(result?.description ?? "").trim());
    deps.setLoading(true);
    try {
      const dashboard = await jsonFetch<PulseDashboard>(`/api/pulse/bases/${baseId}/dashboards`, {
        method: "POST",
        body: JSON.stringify({ name, config: { dsl } }),
      });
      const dashboardDsl = dashboardToDsl(dashboard);
      deps.setDashboards((current) => [dashboard, ...current]);
      deps.setDashboardDslText(dashboardDsl);
      deps.setDashboardPreviewConfig(dashboard.config);
      deps.setDashboardDslDiagnostics({ ok: true, diagnostics: [], config: dashboard.config });
      deps.setDashboardDslDiagnosticsText(dashboardDsl);
      deps.setDashboardDslSeededFor(dashboard.id);
      deps.setSelectedDashboardId(dashboard.id);
      deps.navigate({ view: "dashboard-edit", dashboardId: dashboard.id });
      toast.success("Dashboard created. Edit the DSL to add content.");
      return dashboard;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create dashboard");
      return null;
    } finally {
      deps.setLoading(false);
    }
  };

  const compilePreview = async (dashboard: PulseDashboard, text: string) => {
    const baseId = deps.selectedBaseId();
    if (shouldSkipDashboardDslPreview(baseId, text)) {
      deps.setDashboardDslDiagnostics(null);
      deps.setDashboardDslDiagnosticsText("");
      return;
    }
    const requestId = ++compileRequestId;
    const previewIsCurrent = () =>
      dashboardDslPreviewIsCurrent({
        currentDashboardId: deps.selectedDashboard()?.id,
        currentRequestId: compileRequestId,
        currentText: deps.dashboardDslText(),
        dashboardId: dashboard.id,
        requestId,
        text,
      });
    try {
      const result = await compileDashboardDslText(baseId, text);
      if (!previewIsCurrent()) return;
      deps.setDashboardDslDiagnostics(result);
      deps.setDashboardDslDiagnosticsText(text);
      const previewConfig = dashboardPreviewConfigFromResult(result);
      if (previewConfig) {
        deps.setDashboardPreviewConfig(previewConfig);
        await deps.refreshDashboardConfig(previewConfig, dashboard, baseId);
      }
    } catch (error) {
      if (!previewIsCurrent()) return;
      deps.setDashboardDslDiagnostics(dashboardDslCompileError(error));
      deps.setDashboardDslDiagnosticsText(text);
    }
  };

  const saveDsl = async () => {
    const dashboard = deps.selectedDashboard();
    const compiled = deps.dashboardDslDiagnostics();
    if (!dashboard || deps.dashboardDslDiagnosticsText() !== deps.dashboardDslText() || !compiled?.ok || !compiled.config) {
      toast.error("Fix dashboard DSL errors before saving");
      return;
    }
    deps.setDashboardDslSaving(true);
    try {
      const config: PulseDashboardConfig = {
        ...compiled.config,
        refreshIntervalSeconds: dashboard.config.refreshIntervalSeconds,
      };
      const updated = await savePulseDashboardConfig(dashboard, config);
      deps.setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      deps.setDashboardDslSeededFor("");
      toast.success("Dashboard saved");
      await deps.refreshDashboard(updated);
      deps.navigate({ view: "dashboard", dashboardId: updated.id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save dashboard");
    } finally {
      deps.setDashboardDslSaving(false);
    }
  };

  const publicUrl = (token: string, options: { theme?: PublicDashboardDisplayTheme; height?: PublicDashboardDisplayHeight } = {}) => {
    const base = deps.origin() || (typeof window !== "undefined" ? window.location.origin : "");
    const url = new URL(`/app/pulse/display/${token}`, base || "http://localhost");
    if (options.theme) url.searchParams.set("theme", options.theme);
    if (options.height === "full") url.searchParams.set("height", "full");
    return base ? url.toString() : `${url.pathname}${url.search}`;
  };

  const ensurePublicLink = async (
    dashboard: PulseDashboard,
    options: { theme?: PublicDashboardDisplayTheme; height?: PublicDashboardDisplayHeight } = {},
  ) => {
    const result = await createPublicDashboardToken(dashboard.id);
    deps.setDashboards((current) => current.map((item) => (item.id === result.dashboard.id ? result.dashboard : item)));
    return publicUrl(result.token, options);
  };

  const enablePublicLink = async (dashboard = deps.selectedDashboard(), options: { copy?: boolean } = {}) => {
    if (!dashboard) return;
    deps.setLoading(true);
    try {
      const link = await ensurePublicLink(dashboard);
      if (options.copy) await clipboard.copy(link);
      toast.success(options.copy ? "Public dashboard link copied" : "Public dashboard link enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create public link");
    } finally {
      deps.setLoading(false);
    }
  };

  const disablePublicLink = async (dashboard = deps.selectedDashboard()) => {
    if (!dashboard) return;
    deps.setLoading(true);
    try {
      const updated = await deletePublicDashboardToken(dashboard.id);
      deps.setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Public dashboard link disabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disable public link");
    } finally {
      deps.setLoading(false);
    }
  };

  const openPublicDisplay = (dashboard: PulseDashboard) =>
    openPublicDashboardDisplayOptionsDialog({ resolveLink: (options) => ensurePublicLink(dashboard, options) });

  const updateSettings = async (dashboard: PulseDashboard, input: { name: string; refreshInterval: RefreshIntervalOption }) => {
    const name = input.name.trim();
    if (!name) {
      toast.error("Dashboard name is required");
      return false;
    }
    deps.setLoading(true);
    try {
      const config: PulseDashboardConfig = {
        ...dashboard.config,
        refreshIntervalSeconds: refreshIntervalFromOption(input.refreshInterval),
      };
      const updated = await jsonFetch<PulseDashboard>(`/api/pulse/dashboards/${dashboard.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, config }),
      });
      deps.setDashboards((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Dashboard updated");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update dashboard");
      return false;
    } finally {
      deps.setLoading(false);
    }
  };

  const deleteDashboard = async (dashboard: PulseDashboard) => {
    const confirmed = await prompts.confirm(`Delete dashboard "${dashboard.name}"?`, { title: "Delete dashboard", variant: "danger" });
    if (!confirmed) return false;
    deps.setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/dashboards/${dashboard.id}`, { method: "DELETE" });
      const nextDashboards = deps.dashboards().filter((item) => item.id !== dashboard.id);
      deps.setDashboards(nextDashboards);
      const fallback = nextDashboards[0] ?? null;
      if (deps.selectedDashboardId() === dashboard.id)
        deps.navigate(fallback ? { view: "dashboard", dashboardId: fallback.id } : { view: "dashboard" });
      toast.success("Dashboard deleted");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete dashboard");
      return false;
    } finally {
      deps.setLoading(false);
    }
  };

  const openSettings = async (dashboard: PulseDashboard) => {
    try {
      await openPulseDashboardSettingsDialog({
        currentDashboard: () => deps.dashboards().find((item) => item.id === dashboard.id) ?? dashboard,
        dashboard,
        loading: deps.loading,
        updateDashboardSettings: updateSettings,
        enablePublicLink,
        disablePublicLink,
        deleteDashboard,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open dashboard settings");
    }
  };

  const updateControl = (dashboard: PulseDashboard, control: PulseDashboardControl, value: string, config = dashboard.config) => {
    const nextValues = { ...(deps.dashboardControlValues()[dashboard.id] ?? {}), [control.variable]: value };
    if (typeof window !== "undefined" && (deps.activeView() === "dashboard" || deps.activeView() === "dashboard-edit")) {
      const url = new URL(window.location.href);
      for (const key of [...url.searchParams.keys()]) if (key.startsWith("c_")) url.searchParams.delete(key);
      for (const item of config.layout?.controls ?? []) {
        const current = nextValues[item.variable] ?? item.defaultValue;
        if (current !== item.defaultValue) url.searchParams.set(`c_${item.variable}`, current);
      }
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    }
    deps.setDashboardControlValues((current) => ({ ...current, [dashboard.id]: nextValues }));
    queueMicrotask(() => {
      const preview =
        deps.activeView() === "dashboard-edit" && dashboard.id === deps.selectedDashboard()?.id ? deps.dashboardPreviewConfig() : null;
      void (preview ? deps.refreshDashboardConfig(preview, dashboard) : deps.refreshDashboard(dashboard));
    });
  };

  return {
    compilePreview,
    createDashboard,
    deleteDashboard,
    disablePublicLink,
    enablePublicLink,
    openPublicDisplay,
    openSettings,
    saveDsl,
    updateControl,
    updateSettings,
  };
};
