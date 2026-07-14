import { CodeDisplay, Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DocumentRunSummary, WorkflowRun, WorkflowStepRun } from "../../../contracts";
import { downloadPdfResponse } from "../documents/document-download";
import { requestDocumentRunDownload, requestWorkflowDocumentsDownload } from "../documents/document-transfer-client";
import { errorMessage } from "../utils/api-helpers";
import {
  formatWorkflowRunDate as formatDate,
  formatWorkflowRunDuration as formatDuration,
  workflowRunStatusClass as statusClass,
  triggerLabels,
} from "./workflow-display";

export function WorkflowRunDetailPanel(props: { runId: string; onClose: () => void }) {
  const [run, setRun] = createSignal<WorkflowRun | null>(null);
  const [steps, setSteps] = createSignal<WorkflowStepRun[]>([]);
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
        apiClient.workflows.runs[":runId"].$get({ param: { runId } }, { init: { signal: abortSignal } }),
        apiClient.workflows.runs[":runId"].steps.$get({ param: { runId } }, { init: { signal: abortSignal } }),
        apiClient.workflows.runs[":runId"].documents.$get({ param: { runId }, query: { limit: "100" } }, { init: { signal: abortSignal } }),
      ]);
      if (!runRes.ok) throw new Error(await errorMessage(runRes, "Could not load workflow run."));
      if (!stepsRes.ok) throw new Error(await errorMessage(stepsRes, "Could not load workflow run steps."));
      if (!documentsRes.ok) throw new Error(await errorMessage(documentsRes, "Could not load generated documents."));
      setRun(await runRes.json());
      setSteps((await stepsRes.json()).items);
      const documentPage = await documentsRes.json();
      setDocuments({
        items: documentPage.items,
        total: documentPage.total ?? documentPage.items.length,
        hasMore: documentPage.hasMore ?? false,
      });
    },
    onError: (error) => prompts.error(error.message),
  });

  createEffect(() => loadMut.mutate(props.runId));

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
              <Show when={run()}>{(current) => <span class={`badge ${statusClass(current().status)}`}>{current().status}</span>}</Show>
            </div>
            <p class="mt-0.5 text-xs text-dimmed">{run() ? formatDate(run()!.createdAt) : "Loading..."}</p>
          </div>
          <button type="button" class="icon-btn" onClick={props.onClose} title="Close run details" aria-label="Close run details">
            <i class="ti ti-x" />
          </button>
        </div>
      </header>

      <div class="detail-stack" data-scroll-preserve={`grids-workflow-run-detail-${props.runId}`}>
        <section class="detail-section">
          <h3 class="detail-section-label">Execution</h3>
          <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-xs">
            <dt class="text-dimmed">Trigger</dt>
            <dd class="text-primary">{run() ? (triggerLabels[run()!.triggerKind] ?? run()!.triggerKind) : "-"}</dd>
            <dt class="text-dimmed">Started</dt>
            <dd class="text-primary">{run() ? formatDate(run()!.startedAt) : "-"}</dd>
            <dt class="text-dimmed">Finished</dt>
            <dd class="text-primary">{run() ? formatDate(run()!.finishedAt) : "-"}</dd>
            <dt class="text-dimmed">Duration</dt>
            <dd class="text-primary tabular-nums">{run() ? formatDuration(run()!) : "-"}</dd>
          </dl>
          <Show when={run()?.error}>{(error) => <p class="info-block-danger mt-3 text-xs">{error()}</p>}</Show>
          <Show when={run()?.resultMessage}>{(message) => <p class="info-block-success mt-3 text-xs">{message()}</p>}</Show>
        </section>

        <section class="detail-section">
          <h3 class="detail-section-label">Input</h3>
          <CodeDisplay language="text" code={JSON.stringify(run()?.resolvedInput ?? run()?.triggerInput ?? {}, null, 2)} copy />
        </section>

        <section class="detail-section">
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
                    {step.stepPath} · {step.kind}
                  </span>
                  <span class="text-dimmed tabular-nums">{step.durationMs == null ? "-" : `${step.durationMs}ms`}</span>
                  <Show when={step.error}>
                    <p class="col-span-3 text-red-600 dark:text-red-400">{step.error}</p>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </section>

        <section class="detail-section">
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
