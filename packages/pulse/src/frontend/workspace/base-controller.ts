import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { prompts, type ResourceApiKey, toast } from "@valentinkolb/cloud/ui";
import type { Accessor, Setter } from "solid-js";
import type {
  PulseBase,
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
import { jsonFetch } from "../http";
import { openPulseBaseSettingsDialog } from "./base-settings-dialog";

type BaseControllerDeps = {
  bases: Accessor<PulseBase[]>;
  selectedBase: Accessor<PulseBase | null>;
  loading: Accessor<boolean>;
  settingsDialogOpen: Accessor<boolean>;
  setLoading: Setter<boolean>;
  setSettingsDialogOpen: Setter<boolean>;
  setBases: Setter<PulseBase[]>;
  setSelectedBaseId: Setter<string>;
  setSelectedSourceId: Setter<string>;
  setSelectedMetric: Setter<string>;
  setSelectedDashboardId: Setter<string>;
  setSelectedResourceKey: Setter<string>;
  setRecentEvents: Setter<PulseRecordedEvent[]>;
  setCurrentStates: Setter<PulseCurrentState[]>;
  setActivityMetrics: Setter<PulseMetricSummary[]>;
  setMetrics: Setter<PulseMetricSummary[]>;
  setSeries: Setter<PulseMetricSeries[]>;
  setSourceScrapes: Setter<Record<string, PulseSourceScrape[]>>;
  setSourceApiKeys: Setter<Record<string, ResourceApiKey[]>>;
  setInventory: Setter<PulseInventory>;
  setSources: Setter<PulseSource[]>;
  setDashboards: Setter<PulseDashboard[]>;
  setSavedQueries: Setter<PulseSavedQuery[]>;
  loadBaseData: (baseId: string) => Promise<void>;
  navigateToBase: (baseId: string) => void;
};

export const createBaseController = (deps: BaseControllerDeps) => {
  const updateSettings = async (base: PulseBase, input: { name: string; description: string; retentionDays: number }) => {
    const name = input.name.trim();
    if (!name) {
      toast.error("Pulse name is required");
      return false;
    }
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3650) {
      toast.error("Retention must be between 1 and 3650 days");
      return false;
    }
    deps.setLoading(true);
    try {
      const updated = await jsonFetch<PulseBase>(`/api/pulse/bases/${base.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: input.description.trim() || null,
          retentionDays: input.retentionDays,
        }),
      });
      deps.setBases((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Pulse settings saved");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Pulse settings");
      return false;
    } finally {
      deps.setLoading(false);
    }
  };

  const clearData = async (base: PulseBase) => {
    const confirmed = await prompts.confirm(
      `Clear all metrics, events, states, observed resources, and scrape history from "${base.name}"? Sources, API keys, dashboards, saved queries, access, and settings will be kept.`,
      { title: "Clear Pulse data", variant: "danger", confirmText: "Clear data" },
    );
    if (!confirmed) return;

    deps.setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/bases/${base.id}/clear-data`, { method: "POST" });
      deps.setSelectedMetric("");
      deps.setSelectedResourceKey("");
      deps.setRecentEvents([]);
      deps.setCurrentStates([]);
      deps.setActivityMetrics([]);
      deps.setMetrics([]);
      deps.setSeries([]);
      deps.setSourceScrapes({});
      deps.setInventory({ resources: [], metrics: [], events: [], states: [] });
      deps.setSources((items) => items.map((item) => ({ ...item, lastSeenAt: null, lastError: null, lastErrorAt: null })));
      toast.success("Pulse data clear started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clear Pulse data");
    } finally {
      deps.setLoading(false);
    }
  };

  const deleteBase = async (base: PulseBase) => {
    const confirmed = await prompts.confirm(
      `Delete "${base.name}" and all Pulse data in this base? This cannot be undone. Large bases are removed in the background.`,
      { title: "Delete Pulse base", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return false;

    deps.setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/bases/${base.id}`, { method: "DELETE" });
      const nextBases = deps.bases().filter((item) => item.id !== base.id);
      const nextBase = nextBases[0] ?? null;
      deps.setBases(nextBases);
      deps.setSelectedBaseId(nextBase?.id ?? "");
      deps.setSelectedSourceId("");
      deps.setSelectedMetric("");
      deps.setSelectedDashboardId("");
      deps.setSelectedResourceKey("");
      deps.setRecentEvents([]);
      deps.setCurrentStates([]);
      deps.setActivityMetrics([]);
      deps.setSeries([]);
      deps.setSourceScrapes({});
      deps.setSourceApiKeys({});

      if (nextBase) {
        deps.navigateToBase(nextBase.id);
        await deps.loadBaseData(nextBase.id);
      } else {
        deps.setSources([]);
        deps.setMetrics([]);
        deps.setInventory({ resources: [], metrics: [], events: [], states: [] });
        deps.setDashboards([]);
        deps.setSavedQueries([]);
        deps.navigateToBase("");
      }

      toast.success("Pulse base deletion started");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete Pulse base");
      return false;
    } finally {
      deps.setLoading(false);
    }
  };

  const openSettings = async () => {
    if (deps.settingsDialogOpen()) return;
    const base = deps.selectedBase();
    if (!base) return;
    try {
      deps.setLoading(true);
      const accessEntries = await jsonFetch<AccessEntry[]>(`/api/pulse/bases/${base.id}/access`);
      deps.setLoading(false);
      deps.setSettingsDialogOpen(true);
      await openPulseBaseSettingsDialog({
        accessEntries,
        base,
        loading: deps.loading,
        updateBaseSettings: updateSettings,
        clearBaseData: () => clearData(base),
        deleteBase: () => deleteBase(base),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open Pulse settings");
    } finally {
      deps.setLoading(false);
      deps.setSettingsDialogOpen(false);
    }
  };

  return { openSettings };
};
