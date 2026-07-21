import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { type Accessor, createEffect, createSignal } from "solid-js";
import { apiClient } from "../../../api/client";
import type { RecordQuery } from "../../../contracts";
import type { GridRecord } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceBulkLauncher } from "../workspace/workspace-state-model";
import { bulkSelectionRunPayload, pruneBulkSelection, sameBulkSelection } from "./bulk-selection";

type BulkWorkflowRunInput = {
  launcher: WorkspaceBulkLauncher;
  selectedRecordIds: string[];
  query: RecordQuery;
};

type RecordsBulkControllerOptions = {
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

  const runWorkflow = mutation.create<{ runId: string; status: string }, BulkWorkflowRunInput>({
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
      return response.json();
    },
    onSuccess: (run) => {
      clear();
      toast.success(`Workflow queued: ${run.status}`);
    },
    onError: (error) => prompts.error(error.message),
  });

  const queueWorkflow = (launcher: WorkspaceBulkLauncher) =>
    runWorkflow.mutate({ launcher, selectedRecordIds: [...selectedIds()], query: options.query() });

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
