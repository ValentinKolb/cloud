import { prompts, type ResourceApiKey, type ResourceApiKeysProps, toast } from "@valentinkolb/cloud/ui";
import type { Accessor, Setter } from "solid-js";
import type { PulseSource } from "../../contracts";
import { jsonFetch } from "../http";
import {
  createPulseSource,
  scrapePulseSourceOnce,
  sourceCreatedMessage,
  sourceCreateValidationError,
  sourceInitialScrapeFailureMessage,
  sourceInitialScrapeSuccessMessage,
} from "./source-actions";
import { openSourceCreateDialog } from "./source-create-dialog";
import { openSourceEditDialog } from "./source-edit-dialog";
import { formatIngestCounts } from "./source-helpers";
import type { CreateSourceInput, WorkspaceView } from "./types";

type SourceControllerDeps = {
  selectedBaseId: Accessor<string>;
  loading: Accessor<boolean>;
  setLoading: Setter<boolean>;
  setSources: Setter<PulseSource[]>;
  setSelectedSourceId: Setter<string>;
  setSourceApiKeys: Setter<Record<string, ResourceApiKey[]>>;
  navigate: (state: { view: WorkspaceView; sourceId?: string }) => void;
  loadBaseData: (baseId: string) => Promise<void>;
  loadSourceScrapes: (baseId: string, sourceId: string) => Promise<void>;
  refreshDashboard: () => Promise<void>;
};

export const createSourceController = (deps: SourceControllerDeps) => {
  const scrapeCreatedMetricsSource = async (baseId: string, sourceId: string) => {
    try {
      const counts = await scrapePulseSourceOnce(baseId, sourceId);
      await deps.loadBaseData(baseId);
      await deps.loadSourceScrapes(baseId, sourceId);
      toast.success(sourceInitialScrapeSuccessMessage(counts));
    } catch (error) {
      toast.error(sourceInitialScrapeFailureMessage(error));
    }
  };

  const createSource = async (input: CreateSourceInput) => {
    const baseId = deps.selectedBaseId();
    if (!baseId) return false;
    const validationError = sourceCreateValidationError(input);
    if (validationError) {
      toast.error(validationError);
      return false;
    }
    deps.setLoading(true);
    try {
      const source = await createPulseSource(baseId, input);
      deps.navigate({ view: "sources", sourceId: source.id });
      await deps.loadBaseData(baseId);
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
      deps.setLoading(false);
    }
  };

  const addSource = () => openSourceCreateDialog({ loading: deps.loading, createSource });

  const scrape = async (source: PulseSource) => {
    const baseId = deps.selectedBaseId();
    if (!baseId) return;
    deps.setLoading(true);
    try {
      const counts = await scrapePulseSourceOnce(baseId, source.id);
      await deps.loadBaseData(baseId);
      await deps.loadSourceScrapes(baseId, source.id);
      await deps.refreshDashboard();
      toast.success(`Metrics scraped: ${formatIngestCounts(counts)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scrape failed");
    } finally {
      deps.setLoading(false);
    }
  };

  const toggleSource = async (source: PulseSource) => {
    const baseId = deps.selectedBaseId();
    if (!baseId) return;
    deps.setLoading(true);
    try {
      const updated = await jsonFetch<PulseSource>(`/api/pulse/bases/${baseId}/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !source.enabled }),
      });
      deps.setSources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await deps.refreshDashboard();
      toast.success(updated.enabled ? "Source resumed" : "Source paused");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update source");
    } finally {
      deps.setLoading(false);
    }
  };

  const editSource = async (source: PulseSource) => {
    const baseId = deps.selectedBaseId();
    if (!baseId) return;
    const patch = await openSourceEditDialog(source);
    if (!patch) return;
    deps.setLoading(true);
    try {
      const updated = await jsonFetch<PulseSource>(`/api/pulse/bases/${baseId}/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      deps.setSources((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Source updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update source");
    } finally {
      deps.setLoading(false);
    }
  };

  const removeSource = async (source: PulseSource) => {
    const baseId = deps.selectedBaseId();
    if (!baseId) return;
    const confirmed = await prompts.confirm(`Remove source "${source.name}"? Existing samples stay available, but new data will stop.`, {
      title: "Remove source",
      variant: "danger",
    });
    if (!confirmed) return;
    deps.setLoading(true);
    try {
      await jsonFetch<void>(`/api/pulse/bases/${baseId}/sources/${source.id}`, { method: "DELETE" });
      deps.setSelectedSourceId((current) => (current === source.id ? "" : current));
      await deps.loadBaseData(baseId);
      await deps.refreshDashboard();
      toast.success("Source removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove source");
    } finally {
      deps.setLoading(false);
    }
  };

  const createApiKey = async (source: PulseSource, input: Parameters<ResourceApiKeysProps["createKey"]>[0]) => {
    const baseId = deps.selectedBaseId();
    if (!baseId) throw new Error("No Pulse base selected.");
    const created = await jsonFetch<{ credential: ResourceApiKey; token: string }>(
      `/api/pulse/bases/${baseId}/sources/${source.id}/api-keys`,
      { method: "POST", body: JSON.stringify(input) },
    );
    deps.setSourceApiKeys((current) => ({ ...current, [source.id]: [created.credential, ...(current[source.id] ?? [])] }));
    return created;
  };

  const revokeApiKey = async (source: PulseSource, credentialId: string) => {
    const baseId = deps.selectedBaseId();
    if (!baseId) throw new Error("No Pulse base selected.");
    await jsonFetch<void>(`/api/pulse/bases/${baseId}/sources/${source.id}/api-keys/${credentialId}`, { method: "DELETE" });
    deps.setSourceApiKeys((current) => ({
      ...current,
      [source.id]: (current[source.id] ?? []).filter((key) => key.id !== credentialId),
    }));
  };

  return { addSource, createApiKey, editSource, removeSource, revokeApiKey, scrape, toggleSource };
};
