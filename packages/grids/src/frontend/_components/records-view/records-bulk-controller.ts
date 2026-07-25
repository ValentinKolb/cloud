import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { type Accessor, createEffect, createSignal } from "solid-js";
import { apiClient } from "../../../api/client";
import type { RecordQuery } from "../../../contracts";
import type { GridRecord } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceBulkLauncher } from "../workspace/workspace-state-model";
import { bulkSelectionRunPayload, bulkWorkflowTargetLabel, pruneBulkSelection, sameBulkSelection } from "./bulk-selection";

type BulkWorkflowRunInput = {
  launcher: WorkspaceBulkLauncher;
  selectedRecordIds: string[];
  query: RecordQuery;
};

type RecordsBulkControllerOptions = {
  baseShortId: string;
  enabled: Accessor<boolean>;
  items: Accessor<GridRecord[]>;
  query: Accessor<RecordQuery>;
  scopeKey: Accessor<string>;
};

export const createRecordsBulkController = (options: RecordsBulkControllerOptions) => {
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const selectedCount = () => selectedIds().size;
  const clear = () => setSelectedIds(new Set<string>());

  const toggleRecord = (recordId: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  };

  const toggleVisible = (selected: boolean) => {
    const ids = options.items().map((record) => record.id);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const runWorkflow = mutation.create<
    { runId: string; status: string; launcherName: string; workflowShortId: string; targetLabel: string },
    BulkWorkflowRunInput
  >({
    mutation: async ({ launcher, selectedRecordIds, query }, { abortSignal }) => {
      const response = await apiClient.workflows.launchers[":launcherId"].invoke.bulk.$post(
        {
          param: { launcherId: launcher.id },
          json: {
            operationId: crypto.randomUUID(),
            mode: "execute",
            expectedRevision: launcher.workflowRevision,
            inputs: {},
            ...bulkSelectionRunPayload(selectedRecordIds, query),
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not start workflow."));
      const run = await response.json();
      return {
        ...run,
        launcherName: launcher.name,
        workflowShortId: launcher.workflowShortId,
        targetLabel: bulkWorkflowTargetLabel(selectedRecordIds.length),
      };
    },
    onSuccess: (run) => {
      clear();
      toast.success(`${run.launcherName} queued for ${run.targetLabel}.`, {
        title: "Workflow queued",
        duration: 10_000,
        action: {
          label: "Open run",
          href: `/app/grids/${encodeURIComponent(options.baseShortId)}/workflows/${encodeURIComponent(
            run.workflowShortId,
          )}?run=${encodeURIComponent(run.runId)}`,
        },
      });
    },
    onError: (error) => prompts.error(error.message),
  });

  const queueWorkflow = async (launcher: WorkspaceBulkLauncher) => {
    const selectedRecordIds = [...selectedIds()];
    if (selectedRecordIds.length === 0) {
      const confirmed = await prompts.confirm(
        `Run "${launcher.name}" for every record matching the current query? The server resolves the complete result set and stops without running if more than 10,000 records match.`,
        {
          title: "Run for current query",
          icon: "ti ti-list-check",
          confirmText: "Run workflow",
        },
      );
      if (!confirmed) return;
    }
    runWorkflow.mutate({ launcher, selectedRecordIds, query: options.query() });
  };

  let previousScopeKey = "";
  createEffect(() => {
    const nextScopeKey = options.scopeKey();
    if (previousScopeKey && nextScopeKey !== previousScopeKey) clear();
    previousScopeKey = nextScopeKey;
  });

  createEffect(() => {
    if (!options.enabled()) {
      if (selectedCount() > 0) clear();
      return;
    }
    const visibleIds = new Set(options.items().map((record) => record.id));
    setSelectedIds((current) => {
      const next = pruneBulkSelection(current, visibleIds);
      return sameBulkSelection(current, next) ? current : next;
    });
  });

  return { selectedIds, selectedCount, clear, toggleRecord, toggleVisible, queueWorkflow };
};
