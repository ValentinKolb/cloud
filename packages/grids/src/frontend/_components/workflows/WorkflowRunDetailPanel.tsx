import { CodeDisplay, Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DocumentRunSummary } from "../../../contracts";
import type { GridsWorkflowRun, GridsWorkflowStepRun } from "../../../workflows/contracts";
import { downloadPdfResponse } from "../documents/document-download";
import { requestDocumentRunDownload, requestWorkflowDocumentsDownload } from "../documents/document-transfer-client";
import { errorMessage } from "../utils/api-helpers";
import {
  channelLabels,
  formatWorkflowRunDate as formatDate,
  formatWorkflowRunDuration as formatDuration,
  workflowRunStatusClass as statusClass,
} from "./workflow-display";
import { createWorkflowRunEventsProvider } from "./workflow-run-events-provider";

type WorkflowRunDetailApi = {
  [":runId"]: {
    $get: (input: { param: { runId: string } }, options?: { init?: RequestInit }) => Promise<Response>;
    steps: { $get: (input: { param: { runId: string } }, options?: { init?: RequestInit }) => Promise<Response> };
    documents: {
      $get: (input: { param: { runId: string }; query: { limit: string } }, options?: { init?: RequestInit }) => Promise<Response>;
    };
  };
};

const workflowRunDetailApi = apiClient.workflows.runs as unknown as WorkflowRunDetailApi;

const isTerminalRun = (run: GridsWorkflowRun): boolean =>
  run.status === "succeeded" || run.status === "failed" || run.status === "canceled" || run.status === "needs_attention";

export function WorkflowRunDetailPanel(props: { runId: string; onClose: () => void }) {
  const [run, setRun] = createSignal<GridsWorkflowRun | null>(null);
  const [steps, setSteps] = createSignal<GridsWorkflowStepRun[]>([]);
  const [documents, setDocuments] = createSignal<{ items: DocumentRunSummary[]; total: number; hasMore: boolean }>({
    items: [],
    total: 0,
    hasMore: false,
  });
  const [downloadingDocumentId, setDownloadingDocumentId] = createSignal<string | null>(null);
  const [downloadingAll, setDownloadingAll] = createSignal(false);

  const loadMut = mutations.create<void, string>({
    mutation: async (runId, { abortSignal }) => {
      const [runRes, stepsRes, documentsRes] = await Promise.all([
        workflowRunDetailApi[":runId"].$get({ param: { runId } }, { init: { signal: abortSignal } }),
        workflowRunDetailApi[":runId"].steps.$get({ param: { runId } }, { init: { signal: abortSignal } }),
        workflowRunDetailApi[":runId"].documents.$get({ param: { runId }, query: { limit: "100" } }, { init: { signal: abortSignal } }),
      ]);
      if (!runRes.ok) throw new Error(await errorMessage(runRes, "Could not load workflow run."));
      if (!stepsRes.ok) throw new Error(await errorMessage(stepsRes, "Could not load workflow run steps."));
      if (!documentsRes.ok) throw new Error(await errorMessage(documentsRes, "Could not load generated documents."));
      setRun((await runRes.json()) as GridsWorkflowRun);
      setSteps(((await stepsRes.json()) as { items: GridsWorkflowStepRun[] }).items);
      const documentPage = (await documentsRes.json()) as { items: DocumentRunSummary[]; total?: number; hasMore?: boolean };
      setDocuments({
        items: documentPage.items,
        total: documentPage.total ?? documentPage.items.length,
        hasMore: documentPage.hasMore ?? false,
      });
    },
  });

  const refresh = (runId = props.runId) => {
    if (!loadMut.loading()) loadMut.mutate(runId);
  };

  createEffect(() => {
    const runId = props.runId;
    setRun(null);
    setSteps([]);
    setDocuments({ items: [], total: 0, hasMore: false });
    loadMut.mutate(runId);
  });

  const liveRunId = createMemo(() => {
    const current = run();
    return current && !isTerminalRun(current) ? current.id : null;
  });
  const liveWorkflowId = createMemo(() => {
    const current = run();
    return current && !isTerminalRun(current) ? current.workflowId : null;
  });

  createEffect(() => {
    const runId = liveRunId();
    if (!runId) return;
    const workflowId = liveWorkflowId();
    const refreshSelectedRun = () => refresh(runId);
    const timer = setInterval(refreshSelectedRun, 2500);
    const events = workflowId
      ? createWorkflowRunEventsProvider({
          workflowId,
          onEvent: (event) => {
            if (event.run.id === runId) refreshSelectedRun();
          },
        })
      : null;
    events?.connect();
    onCleanup(() => {
      clearInterval(timer);
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
          <button
            type="button"
            class="icon-btn"
            onClick={() => refresh()}
            disabled={loadMut.loading()}
            title="Refresh run details"
            aria-label="Refresh run details"
          >
            <i class={loadMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} />
          </button>
          <button type="button" class="icon-btn" onClick={props.onClose} title="Close run details" aria-label="Close run details">
            <i class="ti ti-x" />
          </button>
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

        <section class="detail-section" classList={{ hidden: !run() }}>
          <h3 class="detail-section-label">Execution</h3>
          <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-xs">
            <dt class="text-dimmed">Channel</dt>
            <dd class="text-primary">{run() ? (channelLabels[run()!.channel] ?? run()!.channel) : "-"}</dd>
            <dt class="text-dimmed">Mode</dt>
            <dd class="text-primary">{run()?.mode === "dryRun" ? "Dry run" : "Execute"}</dd>
            <dt class="text-dimmed">Revision</dt>
            <dd class="text-primary tabular-nums">{run()?.workflowRevision ?? "-"}</dd>
            <dt class="text-dimmed">Started</dt>
            <dd class="text-primary">{run() ? formatDate(run()!.startedAt) : "-"}</dd>
            <dt class="text-dimmed">Finished</dt>
            <dd class="text-primary">{run() ? formatDate(run()!.finishedAt) : "-"}</dd>
            <dt class="text-dimmed">Duration</dt>
            <dd class="text-primary tabular-nums">{run() ? formatDuration(run()!) : "-"}</dd>
          </dl>
          <Show when={run()?.error}>{(error) => <p class="info-block-danger mt-3 text-xs">{error().message}</p>}</Show>
          <Show when={run()?.resultMessage}>{(message) => <p class="info-block-success mt-3 text-xs">{message()}</p>}</Show>
        </section>

        <section class="detail-section" classList={{ hidden: !run() }}>
          <h3 class="detail-section-label">Input</h3>
          <CodeDisplay language="text" code={JSON.stringify(run()?.inputs ?? {}, null, 2)} copy />
        </section>

        <section class="detail-section" classList={{ hidden: !run() }}>
          <h3 class="detail-section-label">Steps</h3>
          <div class="flex flex-col gap-2">
            <For
              each={steps()}
              fallback={
                <Placeholder align="left" class="py-3">
                  {loadMut.loading() ? "Loading steps..." : "No step details."}
                </Placeholder>
              }
            >
              {(step) => (
                <div class="grid grid-cols-[auto_1fr_auto] items-start gap-2 py-1 text-xs">
                  <span class={`badge ${statusClass(step.status)}`}>{step.status}</span>
                  <span class="min-w-0 truncate text-primary">
                    {step.sourcePath.length > 0 ? step.sourcePath.join(".") : step.key} · {step.action ?? step.kind}
                  </span>
                  <span class="text-dimmed tabular-nums">
                    {step.startedAt && step.finishedAt
                      ? `${Math.max(0, new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime())}ms`
                      : "-"}
                  </span>
                  <Show when={step.outcome && typeof step.outcome === "object" && "error" in step.outcome}>
                    <p class="col-span-3 text-red-600 dark:text-red-400">
                      {String((step.outcome as { error?: unknown }).error ?? "Step failed")}
                    </p>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </section>

        <section class="detail-section" classList={{ hidden: !run() }}>
          <div class="flex items-center justify-between gap-2">
            <h3 class="detail-section-label mb-0">Generated documents</h3>
            <Show when={documents().total > 0}>
              <button type="button" class="btn-simple btn-sm" onClick={() => void downloadAllDocuments()} disabled={downloadingAll()}>
                <i class={downloadingAll() ? "ti ti-loader-2 animate-spin" : "ti ti-download"} /> All
              </button>
            </Show>
          </div>
          <div class="mt-3 flex flex-col gap-2">
            <For
              each={documents().items}
              fallback={
                <Placeholder align="left" class="py-3">
                  No documents generated by this run.
                </Placeholder>
              }
            >
              {(document) => (
                <div class="grid grid-cols-[auto_1fr_auto] items-center gap-2 py-1 text-xs">
                  <i class="ti ti-file-type-pdf text-dimmed" />
                  <span class="min-w-0">
                    <span class="block truncate text-primary">{document.filename}</span>
                    <span class="block truncate text-dimmed">{document.documentNumber}</span>
                  </span>
                  <button
                    type="button"
                    class="icon-btn"
                    title="Download document"
                    aria-label={`Download ${document.filename}`}
                    onClick={() => void downloadDocument(document)}
                    disabled={downloadingDocumentId() === document.id}
                  >
                    {downloadingDocumentId() === document.id ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
                  </button>
                </div>
              )}
            </For>
          </div>
        </section>
      </div>
    </div>
  );
}
