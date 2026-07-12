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
    <>
      <section class="detail-section">
        <div class="flex items-start gap-3">
          <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-secondary dark:bg-zinc-900">
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
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Execution</h3>
        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
          <span class="text-dimmed">Trigger</span>
          <span class="text-primary">{run() ? (triggerLabels[run()!.triggerKind] ?? run()!.triggerKind) : "-"}</span>
          <span class="text-dimmed">Started</span>
          <span class="text-primary">{run() ? formatDate(run()!.startedAt) : "-"}</span>
          <span class="text-dimmed">Finished</span>
          <span class="text-primary">{run() ? formatDate(run()!.finishedAt) : "-"}</span>
          <span class="text-dimmed">Duration</span>
          <span class="text-primary">{run() ? formatDuration(run()!) : "-"}</span>
        </div>
        <Show when={run()?.error}>
          {(error) => (
            <p class="mt-3 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error()}</p>
          )}
        </Show>
        <Show when={run()?.resultMessage}>
          {(message) => (
            <p class="mt-3 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              {message()}
            </p>
          )}
        </Show>
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Input</h3>
        <CodeDisplay language="text" code={JSON.stringify(run()?.resolvedInput ?? run()?.triggerInput ?? {}, null, 2)} copy />
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Steps</h3>
        <For
          each={steps()}
          fallback={
            <Placeholder align="left" class="py-3">
              {loadMut.loading() ? "Loading steps..." : "No step details."}
            </Placeholder>
          }
        >
          {(step) => (
            <div class="grid grid-cols-[auto_1fr_auto] gap-2 border-b border-zinc-100 py-2 text-xs last:border-b-0 dark:border-zinc-800">
              <span class={`badge ${statusClass(step.status)}`}>{step.status}</span>
              <span class="min-w-0 truncate text-primary">
                {step.stepPath} · {step.kind}
              </span>
              <span class="text-dimmed">{step.durationMs == null ? "-" : `${step.durationMs}ms`}</span>
              <Show when={step.error}>
                <p class="col-span-3 text-red-600 dark:text-red-400">{step.error}</p>
              </Show>
            </div>
          )}
        </For>
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
        <For
          each={documents().items}
          fallback={
            <Placeholder align="left" class="py-3">
              No documents generated by this run.
            </Placeholder>
          }
        >
          {(document) => (
            <div class="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-zinc-100 py-2 text-xs last:border-b-0 dark:border-zinc-800">
              <i class="ti ti-file-type-pdf text-dimmed" />
              <span class="min-w-0">
                <span class="block truncate text-primary">{document.filename}</span>
                <span class="block truncate text-dimmed">{document.documentNumber}</span>
              </span>
              <button
                type="button"
                class="btn-simple btn-sm"
                title="Download document"
                onClick={() => void downloadDocument(document)}
                disabled={downloadingDocumentId() === document.id}
              >
                {downloadingDocumentId() === document.id ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
              </button>
            </div>
          )}
        </For>
      </section>
    </>
  );
}
