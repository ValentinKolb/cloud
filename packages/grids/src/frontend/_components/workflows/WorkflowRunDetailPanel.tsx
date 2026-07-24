import { dialogCore, Placeholder, panelDialogWorkspaceOptions, prompts, Tooltip, toast } from "@valentinkolb/cloud/ui";
import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DocumentRunSummary, DocumentRunSummaryList } from "../../../contracts";
import type { Table, Workflow } from "../../../service";
import type { GridsWorkflowRun, GridsWorkflowStepRun } from "../../../workflows/contracts";
import { downloadPdfResponse } from "../documents/document-download";
import { requestDocumentRunDownload, requestWorkflowDocumentsDownload } from "../documents/document-transfer-client";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceWorkflowRunDetail } from "../workspace/workspace-state-model";
import { WorkflowRevisionHistory } from "./WorkflowRevisionHistory";
import {
  WorkflowRunDocumentsSection,
  WorkflowRunExecutionSection,
  WorkflowRunInputsSection,
  WorkflowRunStepsSection,
} from "./WorkflowRunDetailSections";
import { requestWorkflowRunInput } from "./WorkflowRunInputDialog";
import {
  formatWorkflowRunDate as formatDate,
  isTerminalWorkflowRunStatus,
  workflowRunStatusClass as statusClass,
  workflowStepOutcomeSummary,
} from "./workflow-display";
import { mergeRefreshedWorkflowRunDocuments, type WorkflowRunDocumentsState } from "./workflow-run-documents";
import { createWorkflowRunEventsProvider, isTerminalWorkflowRunLiveErrorCode } from "./workflow-run-events-provider";

const workflowRunDetailApi = apiClient.workspace["workflow-run-detail"] as unknown as {
  $get: (input: { query: { runId: string } }, options?: { init?: RequestInit }) => Promise<Response>;
};

const workflowRunDocumentsApi = apiClient.workflows.runs as unknown as {
  [":runId"]: {
    documents: {
      $get: (
        input: { param: { runId: string }; query: { limit: string; offset: string } },
        options?: { init?: RequestInit },
      ) => Promise<Response>;
    };
  };
};

const workflowRunLifecycleApi = apiClient.workflows as unknown as {
  runs: {
    [":runId"]: {
      cancel: { $post: (input: { param: { runId: string } }, options?: { init?: RequestInit }) => Promise<Response> };
    };
  };
  [":workflowId"]: {
    invoke: {
      manual: {
        $post: (
          input: {
            param: { workflowId: string };
            json: {
              mode: "execute" | "dryRun";
              inputs: Record<string, WorkflowJsonValue>;
              idempotencyKey: string;
              expectedRevision: number;
            };
          },
          options?: { init?: RequestInit },
        ) => Promise<Response>;
      };
    };
  };
};

const RUN_DOCUMENT_PAGE_SIZE = 100;

export function WorkflowRunDetailPanel(props: {
  runId: string;
  initialDetail: WorkspaceWorkflowRunDetail | null;
  workflows: Workflow[];
  workflowLevels: Record<string, "none" | "read" | "write" | "admin">;
  tables: Table[];
  onRunUpdated: (run: GridsWorkflowRun) => void;
  onSelectRun: (runId: string) => void;
  onClose: () => void;
}) {
  const [run, setRun] = createSignal<GridsWorkflowRun | null>(props.initialDetail?.run ?? null);
  const [inputLabels, setInputLabels] = createSignal(props.initialDetail?.inputLabels ?? {});
  const [steps, setSteps] = createSignal<GridsWorkflowStepRun[]>(props.initialDetail?.steps ?? []);
  const [documents, setDocuments] = createSignal<WorkflowRunDocumentsState>({
    items: props.initialDetail?.documents.items ?? [],
    total: props.initialDetail?.documents.total ?? 0,
    hasMore: props.initialDetail?.documents.hasMore ?? false,
    nextOffset: props.initialDetail?.documents.nextOffset ?? null,
  });
  const [downloadingDocumentId, setDownloadingDocumentId] = createSignal<string | null>(null);
  const [downloadingAll, setDownloadingAll] = createSignal(false);
  const [pendingLiveRefreshRunId, setPendingLiveRefreshRunId] = createSignal<string | null>(null);
  const [provenance, setProvenance] = createSignal(props.initialDetail?.provenance ?? null);
  const activeWorkflow = createMemo(() => props.workflows.find((workflow) => workflow.id === run()?.workflowId) ?? null);
  const revisionWorkflow = createMemo(() => {
    const active = activeWorkflow();
    if (active) return active;
    const current = run();
    if (!current?.workflowId) return null;
    return {
      id: current.workflowId,
      name: provenance()?.workflowName ?? "Deleted workflow",
      revision: current.workflowRevision,
    };
  });
  const latestProgressAt = createMemo(() => {
    const values = [
      run()?.createdAt,
      run()?.startedAt,
      run()?.finishedAt,
      ...steps().flatMap((step) => [step.startedAt, step.finishedAt]),
    ].filter((value): value is string => Boolean(value));
    return values.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
  });
  const waitingFor = createMemo(() => {
    if (run()?.status !== "waiting") return null;
    return (
      steps()
        .map((step) => workflowStepOutcomeSummary(step.outcome))
        .find((summary) => summary?.startsWith("Waiting")) ?? "Waiting"
    );
  });
  const inputRows = createMemo(() => {
    const workflow = activeWorkflow();
    return Object.entries(run()?.inputs ?? {}).map(([name, value]) => {
      const definition = workflow?.plan.inputs.find((input) => input.name === name);
      const label = typeof definition?.config.label === "string" ? definition.config.label : name;
      const tableId = workflow?.plan.bindings[`inputs.${name}.table`];
      const table = typeof tableId === "string" ? props.tables.find((candidate) => candidate.id === tableId) : null;
      const formatValue = (value: unknown) => JSON.stringify(value) ?? String(value);
      const formatRecordId = (recordId: unknown) =>
        typeof recordId === "string" ? `${table?.name ?? "Record"} ${recordId.slice(0, 8)}` : formatValue(recordId);
      const display =
        definition?.type === "record"
          ? typeof value === "string"
            ? (inputLabels()[value] ?? formatRecordId(value))
            : formatRecordId(value)
          : definition?.type === "recordList" && Array.isArray(value)
            ? value
                .map((recordId) =>
                  typeof recordId === "string" ? (inputLabels()[recordId] ?? formatRecordId(recordId)) : formatRecordId(recordId),
                )
                .join(", ")
            : typeof value === "string"
              ? value
              : formatValue(value);
      return { name, label, display };
    });
  });
  const canWrite = createMemo(() => {
    const workflowId = run()?.workflowId;
    return workflowId ? ["write", "admin"].includes(props.workflowLevels[workflowId] ?? "none") : false;
  });

  const loadMoreDocumentsMut = mutations.create<
    DocumentRunSummaryList,
    { runId: string; offset: number },
    { runId: string; offset: number }
  >({
    onBefore: (request) => request,
    mutation: async ({ runId, offset }, { abortSignal }) => {
      const response = await workflowRunDocumentsApi[":runId"].documents.$get(
        {
          param: { runId },
          query: { limit: String(RUN_DOCUMENT_PAGE_SIZE), offset: String(offset) },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load more generated documents."));
      return response.json();
    },
    onSuccess: (page, request) => {
      if (!request || request.runId !== props.runId) return;
      setDocuments((current) => {
        if (current.nextOffset !== request.offset) return current;
        const seen = new Set(current.items.map((document) => document.id));
        return {
          items: [...current.items, ...page.items.filter((document) => !seen.has(document.id))],
          total: page.total ?? current.total,
          hasMore: page.hasMore ?? false,
          nextOffset: page.nextOffset ?? null,
        };
      });
    },
  });

  const loadMut = mutations.create<WorkspaceWorkflowRunDetail, string, { runId: string }>({
    onBefore: (runId) => ({ runId }),
    mutation: async (runId, { abortSignal }) => {
      const response = await workflowRunDetailApi.$get({ query: { runId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load workflow run."));
      return response.json() as Promise<WorkspaceWorkflowRunDetail>;
    },
    onSuccess: (detail, context) => {
      if (context?.runId !== props.runId || detail.run.id !== context.runId) return;
      setRun(detail.run);
      setInputLabels(detail.inputLabels);
      setProvenance(detail.provenance);
      setSteps(detail.steps);
      setDocuments((current) => mergeRefreshedWorkflowRunDocuments(current, detail.documents));
    },
  });

  onCleanup(() => {
    loadMut.abort();
    loadMoreDocumentsMut.abort();
  });

  const refresh = (runId = props.runId) => {
    if (!loadMut.loading()) loadMut.mutate(runId);
  };

  createEffect(() => {
    const runId = pendingLiveRefreshRunId();
    if (!runId || loadMut.loading()) return;
    setPendingLiveRefreshRunId(null);
    if (runId === props.runId) refresh(runId);
  });

  createEffect(() => {
    const current = run();
    if (current) props.onRunUpdated(current);
  });

  let loadedRunId = props.initialDetail?.run.id ?? null;
  createEffect(() => {
    const runId = props.runId;
    if (loadedRunId === runId) return;
    loadedRunId = runId;
    setPendingLiveRefreshRunId(null);
    setRun(null);
    setInputLabels({});
    setProvenance(null);
    setSteps([]);
    setDocuments({ items: [], total: 0, hasMore: false, nextOffset: null });
    loadMut.mutate(runId);
  });

  const liveRunId = createMemo(() => {
    const current = run();
    return current && !isTerminalWorkflowRunStatus(current.status) ? current.id : null;
  });
  const liveWorkflowId = createMemo(() => {
    const current = run();
    return current && !isTerminalWorkflowRunStatus(current.status) ? current.workflowId : null;
  });

  createEffect(() => {
    const runId = liveRunId();
    if (!runId) return;
    const workflowId = liveWorkflowId();
    let streamReady = false;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    const refreshSelectedRun = () => {
      if (loadMut.loading()) {
        setPendingLiveRefreshRunId(runId);
        return;
      }
      refresh(runId);
    };
    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    const startFallback = () => {
      if (fallbackTimer || document.visibilityState !== "visible") return;
      fallbackTimer = setInterval(refreshSelectedRun, 2500);
    };
    const syncVisibility = () => {
      if (document.visibilityState !== "visible") {
        streamReady = false;
        stopFallback();
      } else if (!streamReady) {
        startFallback();
      }
    };
    document.addEventListener("visibilitychange", syncVisibility);
    startFallback();
    const events = workflowId
      ? createWorkflowRunEventsProvider({
          workflowId,
          onReady: () => {
            streamReady = true;
            stopFallback();
            refreshSelectedRun();
          },
          onEvent: (event) => {
            if (event.run.id !== runId) return;
            setRun((current) => (current?.id === runId ? { ...current, ...event.run } : current));
            setSteps(event.steps);
            if (isTerminalWorkflowRunStatus(event.run.status)) refreshSelectedRun();
          },
          onError: () => {
            streamReady = false;
            startFallback();
          },
          onRevoked: () => {
            streamReady = false;
            stopFallback();
          },
          onFatal: (error) => {
            streamReady = false;
            if (isTerminalWorkflowRunLiveErrorCode(error.code)) stopFallback();
            else startFallback();
          },
        })
      : null;
    events?.connect();
    onCleanup(() => {
      document.removeEventListener("visibilitychange", syncVisibility);
      stopFallback();
      events?.dispose();
    });
  });

  const downloadDocument = async (document: DocumentRunSummary) => {
    setDownloadingDocumentId(document.id);
    try {
      const res = await requestDocumentRunDownload(document.id);
      await downloadPdfResponse(res, document.filename);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not download document.");
    } finally {
      setDownloadingDocumentId(null);
    }
  };

  const cancelMut = mutations.create<GridsWorkflowRun, void>({
    mutation: async (_, { abortSignal }) => {
      const response = await workflowRunLifecycleApi.runs[":runId"].cancel.$post(
        { param: { runId: props.runId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not cancel workflow run."));
      return response.json();
    },
    onSuccess: (canceled) => {
      setRun(canceled);
      toast.success("Workflow run canceled");
      refresh(canceled.id);
    },
    onError: (error) => prompts.error(error.message),
  });

  const rerunMut = mutations.create<{ runId: string }, { inputs: Record<string, WorkflowJsonValue>; mode: "execute" | "dryRun" }>({
    mutation: async ({ inputs, mode }, { abortSignal }) => {
      const workflow = activeWorkflow();
      if (!workflow) throw new Error("The workflow definition is no longer available.");
      const response = await workflowRunLifecycleApi[":workflowId"].invoke.manual.$post(
        {
          param: { workflowId: workflow.id },
          json: {
            mode,
            inputs,
            idempotencyKey: crypto.randomUUID(),
            expectedRevision: workflow.revision,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not start another workflow run."));
      return response.json();
    },
    onSuccess: (receipt) => {
      toast.success("New workflow run started");
      props.onSelectRun(receipt.runId);
    },
    onError: (error) => prompts.error(error.message),
  });

  const cancelRun = async () => {
    const confirmed = await prompts.confirm("Cancel this workflow run? Completed external effects cannot be undone.", {
      title: "Cancel workflow run",
      icon: "ti ti-player-stop",
      confirmText: "Cancel run",
      variant: "danger",
    });
    if (confirmed) cancelMut.mutate();
  };

  const runAgain = async () => {
    const workflow = activeWorkflow();
    const current = run();
    if (!workflow || !current) return;
    const inputs = await requestWorkflowRunInput({
      workflow,
      tables: props.tables,
      mode: current.mode,
      initialValues: current.inputs,
    });
    if (inputs !== undefined) rerunMut.mutate({ inputs, mode: current.mode });
  };

  const inspectRevision = async () => {
    const workflow = revisionWorkflow();
    const current = run();
    if (!workflow || !current) return;
    await dialogCore.open<void>(
      (close) => (
        <WorkflowRevisionHistory
          workflow={workflow}
          initialRevision={current.workflowRevision}
          canRestore={false}
          onChanged={() => undefined}
          onClose={close}
        />
      ),
      panelDialogWorkspaceOptions,
    );
  };

  const downloadAllDocuments = async () => {
    setDownloadingAll(true);
    try {
      const res = await requestWorkflowDocumentsDownload(props.runId);
      await downloadPdfResponse(res, `workflow-run-${props.runId.slice(0, 8)}.pdf`);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not download generated documents.");
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <div class="flex h-full min-h-0 flex-col">
      <header class="detail-header">
        <div class="flex items-start gap-3">
          <span class="app-accent-text inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--ui-surface-subtle)]">
            <i class="ti ti-activity" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <h2 class="truncate text-sm font-semibold text-primary">Workflow run</h2>
              <span aria-live="polite" aria-atomic="true">
                <Show when={run()}>{(current) => <span class={`badge ${statusClass(current().status)}`}>{current().status}</span>}</Show>
              </span>
            </div>
            <p class="mt-0.5 text-xs text-dimmed">{run() ? formatDate(run()!.createdAt) : "Loading..."}</p>
          </div>
          <Tooltip content="Refresh run details">
            <button type="button" class="icon-btn" onClick={() => refresh()} disabled={loadMut.loading()} aria-label="Refresh run details">
              <i class={loadMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} />
            </button>
          </Tooltip>
          <Show when={run() && canWrite()}>
            <Tooltip content="Run again with these inputs">
              <button type="button" class="icon-btn" onClick={() => void runAgain()} disabled={rerunMut.loading()} aria-label="Run again">
                <i class={rerunMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-repeat"} />
              </button>
            </Tooltip>
          </Show>
          <Show when={run() && !isTerminalWorkflowRunStatus(run()!.status) && canWrite()}>
            <Tooltip content="Cancel workflow run">
              <button
                type="button"
                class="icon-btn text-red-600 dark:text-red-400"
                onClick={() => void cancelRun()}
                disabled={cancelMut.loading()}
                aria-label="Cancel workflow run"
              >
                <i class={cancelMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-player-stop"} />
              </button>
            </Tooltip>
          </Show>
          <Tooltip content="Close run details">
            <button type="button" class="icon-btn" onClick={props.onClose} aria-label="Close run details">
              <i class="ti ti-x" />
            </button>
          </Tooltip>
        </div>
      </header>

      <div class="detail-stack" data-scroll-preserve={`grids-workflow-run-detail-${props.runId}`}>
        <Show when={!run()}>
          <Show when={loadMut.error()} fallback={<Placeholder state="loading" surface="paper" title="Loading workflow run" />}>
            {(error) => (
              <Placeholder
                state="error"
                surface="paper"
                title="Could not load workflow run"
                description={error().message}
                action={
                  <button type="button" class="btn-input btn-input-sm" onClick={() => refresh()}>
                    <i class="ti ti-refresh" aria-hidden="true" /> Retry
                  </button>
                }
              />
            )}
          </Show>
        </Show>
        <Show when={run() && loadMut.error()}>
          {(error) => (
            <Placeholder
              state="error"
              surface="paper"
              align="left"
              title="Could not refresh workflow run"
              description={error().message}
              class="shrink-0 py-2"
              action={
                <button type="button" class="btn-input btn-input-sm" onClick={() => refresh()}>
                  <i class="ti ti-refresh" aria-hidden="true" /> Retry
                </button>
              }
            />
          )}
        </Show>

        <Show when={run()}>
          {(current) => (
            <>
              <WorkflowRunExecutionSection
                run={current()}
                provenance={provenance()}
                latestProgressAt={latestProgressAt()}
                waitingFor={waitingFor()}
                canInspectRevision={revisionWorkflow() !== null}
                onInspectRevision={() => void inspectRevision()}
              />
              <WorkflowRunInputsSection inputs={inputRows()} />
              <WorkflowRunStepsSection steps={steps()} loading={loadMut.loading()} />
              <WorkflowRunDocumentsSection
                documents={documents()}
                downloadingDocumentId={downloadingDocumentId()}
                downloadingAll={downloadingAll()}
                loadingMore={loadMoreDocumentsMut.loading()}
                loadMoreError={loadMoreDocumentsMut.error()?.message}
                onDownload={(document) => void downloadDocument(document)}
                onDownloadAll={() => void downloadAllDocuments()}
                onLoadMore={(offset) => loadMoreDocumentsMut.mutate({ runId: props.runId, offset })}
              />
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
