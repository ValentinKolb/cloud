import { mutation } from "@k2b/stdlib/solid";
import { prompts, toast } from "@k2b/ui";
import { type Accessor, onCleanup, type Setter } from "solid-js";
import type { PulseBase } from "../../contracts";
import { jsonFetch } from "../http";
import { type BaseSettingsSaveResult, openPulseBaseSettingsDialog } from "./base-settings-dialog";

type BaseControllerDeps = {
  bases: Accessor<PulseBase[]>;
  selectedBase: Accessor<PulseBase | null>;
  loading: Accessor<boolean>;
  settingsDialogOpen: Accessor<boolean>;
  setLoading: Setter<boolean>;
  setSettingsDialogOpen: Setter<boolean>;
  refreshBases: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  writeBlocked: Accessor<boolean>;
  navigateToBase: (baseId: string) => void;
};

export const createBaseController = (deps: BaseControllerDeps) => {
  let disposed = false;
  type SettingsIntent = {
    baseId: string;
    name: string;
    description: string | null;
    rawRetentionDays: number;
    rollupRetentionDays: number;
    sensitiveRetentionHours: number;
  };
  const updateMutation = mutation.create<PulseBase, SettingsIntent>({
    mutation: ({ baseId, ...body }, { abortSignal }) =>
      jsonFetch<PulseBase>(`/api/pulse/bases/${baseId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        signal: abortSignal,
      }),
  });
  const clearMutation = mutation.create<void, string>({
    mutation: (baseId, { abortSignal }) =>
      jsonFetch<void>(`/api/pulse/bases/${baseId}/clear-data`, { method: "POST", signal: abortSignal }),
  });
  const deleteMutation = mutation.create<void, string>({
    mutation: (baseId, { abortSignal }) => jsonFetch<void>(`/api/pulse/bases/${baseId}`, { method: "DELETE", signal: abortSignal }),
  });
  onCleanup(() => {
    disposed = true;
    updateMutation.abort();
    clearMutation.abort();
    deleteMutation.abort();
  });
  const reconcile = async (refresh: () => Promise<void>, message: string): Promise<boolean> => {
    try {
      await refresh();
      return !disposed;
    } catch {
      if (!disposed) toast.error(message);
      return false;
    }
  };
  const requireWritable = (): boolean => {
    if (!deps.writeBlocked()) return true;
    toast.error("Refresh Pulse data before making more changes.");
    return false;
  };

  const updateSettings = async (
    base: PulseBase,
    input: {
      name: string;
      description: string;
      rawRetentionDays: number;
      rollupRetentionDays: number;
      sensitiveRetentionHours: number;
    },
  ): Promise<BaseSettingsSaveResult> => {
    if (!requireWritable()) return "failed";
    const name = input.name.trim();
    if (!name) {
      toast.error("Pulse name is required");
      return "failed";
    }
    if (!Number.isInteger(input.rawRetentionDays) || input.rawRetentionDays < 1 || input.rawRetentionDays > 3650) {
      toast.error("Raw retention must be between 1 and 3650 days");
      return "failed";
    }
    if (!Number.isInteger(input.rollupRetentionDays) || input.rollupRetentionDays < 1 || input.rollupRetentionDays > 3650) {
      toast.error("Rollup retention must be between 1 and 3650 days");
      return "failed";
    }
    if (!Number.isInteger(input.sensitiveRetentionHours) || input.sensitiveRetentionHours < 1 || input.sensitiveRetentionHours > 8760) {
      toast.error("Sensitive retention must be between 1 and 8760 hours");
      return "failed";
    }
    deps.setLoading(true);
    try {
      await updateMutation.mutate({
        baseId: base.id,
        name,
        description: input.description.trim() || null,
        rawRetentionDays: input.rawRetentionDays,
        rollupRetentionDays: input.rollupRetentionDays,
        sensitiveRetentionHours: input.sensitiveRetentionHours,
      });
      if (disposed) return "failed";
      if (updateMutation.error()) throw updateMutation.error();
      if (
        !(await reconcile(
          () => Promise.all([deps.refreshBases(), deps.refreshWorkspace()]).then(() => undefined),
          "Pulse settings were saved, but the workspace could not be refreshed.",
        ))
      )
        return "persisted";
      toast.success("Pulse settings saved");
      return "persisted";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Pulse settings");
      return "failed";
    } finally {
      deps.setLoading(false);
    }
  };

  const clearData = async (base: PulseBase) => {
    if (!requireWritable()) return;
    const confirmed = await prompts.confirm(
      `Clear all metrics, events, states, observed resources, and scrape history from "${base.name}"? Sources, API keys, dashboards, saved queries, access, and settings will be kept.`,
      { title: "Clear Pulse data", variant: "danger", confirmText: "Clear data" },
    );
    if (disposed || !confirmed || !requireWritable()) return;

    deps.setLoading(true);
    try {
      await clearMutation.mutate(base.id);
      if (disposed) return;
      if (clearMutation.error()) throw clearMutation.error();
      if (!(await reconcile(deps.refreshWorkspace, "Pulse data clearing started, but the workspace could not be refreshed."))) return;
      toast.success("Pulse data clear started");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clear Pulse data");
    } finally {
      deps.setLoading(false);
    }
  };

  const deleteBase = async (base: PulseBase) => {
    if (!requireWritable()) return false;
    const confirmed = await prompts.confirm(
      `Delete "${base.name}" and all Pulse data in this base? This cannot be undone. Large bases are removed in the background.`,
      { title: "Delete Pulse base", variant: "danger", confirmText: "Delete" },
    );
    if (disposed || !confirmed || !requireWritable()) return false;

    deps.setLoading(true);
    try {
      await deleteMutation.mutate(base.id);
      if (disposed) return false;
      if (deleteMutation.error()) throw deleteMutation.error();
      if (!(await reconcile(deps.refreshBases, "Pulse base deletion started, but the base list could not be refreshed."))) return false;
      const nextBase = deps.bases().find((item) => item.id !== base.id) ?? null;
      deps.navigateToBase(nextBase?.id ?? "");

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
      deps.setSettingsDialogOpen(true);
      await openPulseBaseSettingsDialog({
        base,
        loading: deps.loading,
        writeBlocked: deps.writeBlocked,
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
