import {
  dialogCore,
  PanelDialog,
  PdfPreview,
  Placeholder,
  panelDialogOptions,
  prompts,
  StructuredDataPreview,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { DocumentRunSummary, DocumentTemplateSummary, RecordSnapshot, RecordSnapshotSummary } from "../../../contracts";
import { downloadPdfResponse } from "../documents/document-download";
import {
  isPdfResponse,
  requestDocumentRunDownload,
  requestDocumentTemplateGeneration,
  requestDocumentTemplatePreview,
} from "../documents/document-transfer-client";
import { errorMessage } from "../utils/api-helpers";
import { formatRecordRelativeTime } from "./RecordHistorySection";
import RecordReadView from "./RecordReadView";
import {
  type SnapshotRecordNode,
  snapshotFields,
  snapshotGridRecord,
  snapshotRelationLabels,
  snapshotTableName,
} from "./record-snapshot-model";

const openDocumentGenerationReviewDialog = (args: { tableId: string; recordId: string; template: DocumentTemplateSummary }) =>
  dialogCore.open<boolean>((close) => <DocumentGenerationReviewDialog args={args} close={close} />, panelDialogOptions);

function DocumentGenerationReviewDialog(props: {
  args: { tableId: string; recordId: string; template: DocumentTemplateSummary };
  close: (generated: boolean) => void;
}) {
  const [previewed, setPreviewed] = createSignal(false);
  const generateMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await requestDocumentTemplateGeneration({
        templateId: props.args.template.id,
        recordId: props.args.recordId,
      });
      await downloadPdfResponse(res, `${props.args.template.name}.pdf`);
    },
    onSuccess: () => props.close(true),
    onError: (error) => prompts.error(error.message),
  });

  const previewPdf = async () => {
    setPreviewed(false);
    const response = await requestDocumentTemplatePreview({
      templateId: props.args.template.id,
      recordId: props.args.recordId,
    });
    if (isPdfResponse(response)) setPreviewed(true);
    return response;
  };

  return (
    <PanelDialog>
      <PanelDialog.Header title={`Generate — ${props.args.template.name}`} icon="ti ti-file-type-pdf" close={() => props.close(false)} />
      <PanelDialog.Body>
        <div class="grid min-h-[30rem] gap-3 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
          <section class="paper flex min-h-0 flex-col gap-3 p-4">
            <div>
              <div class="mb-1 flex items-center gap-2 text-xs font-medium text-secondary">
                <i class="ti ti-file-type-pdf" />
                Document template
              </div>
              <h3 class="text-base font-semibold text-primary">{props.args.template.name}</h3>
              <Show when={props.args.template.description}>
                {(description) => <p class="mt-1 text-sm leading-relaxed text-dimmed">{description()}</p>}
              </Show>
            </div>

            <div class="info-block-info text-xs leading-relaxed">
              Generating creates a recursive record snapshot and stores a document run. The PDF can be redownloaded later from the generated
              document history.
            </div>

            <StructuredDataPreview
              title="Selected record"
              data={{
                tableId: props.args.tableId,
                recordId: props.args.recordId,
              }}
              maxRows={4}
            />
          </section>

          <PdfPreview
            title="PDF preview"
            class="min-h-[30rem]"
            buttonLabel="Render preview"
            emptyText="Render a preview before generating the final document."
            request={previewPdf}
          />
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={() => props.close(false)} disabled={generateMut.loading()}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => generateMut.mutate(undefined)}
            disabled={generateMut.loading() || !previewed()}
          >
            {generateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
            Generate PDF
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function RecordDocumentsSection(props: {
  tableId: string;
  recordId: string;
  live: boolean;
  templates: DocumentTemplateSummary[];
  initialRuns: DocumentRunSummary[];
  initialSnapshots: RecordSnapshotSummary[];
}) {
  const [runs, setRuns] = createSignal<DocumentRunSummary[]>(props.initialRuns);
  const [snapshots, setSnapshots] = createSignal<RecordSnapshotSummary[]>(props.initialSnapshots);
  const [busy, setBusy] = createSignal<string | null>(null);

  createEffect(() => setRuns(props.initialRuns));
  createEffect(() => setSnapshots(props.initialSnapshots));

  const refetchRuns = async () => {
    const res = await apiClient.documents.runs["by-record"][":tableId"][":recordId"].$get({
      param: { tableId: props.tableId, recordId: props.recordId },
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to load generated documents"));
    const value = (await res.json()) as { items: DocumentRunSummary[] } | DocumentRunSummary[];
    setRuns(Array.isArray(value) ? value : value.items);
  };

  const refetchSnapshots = async () => {
    const res = await apiClient.documents.snapshots["by-record"][":tableId"][":recordId"].$get({
      param: { tableId: props.tableId, recordId: props.recordId },
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to load snapshots"));
    setSnapshots(((await res.json()) as { items: RecordSnapshotSummary[] }).items);
  };

  const iconActionClass =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center text-dimmed transition-colors hover:text-secondary disabled:cursor-not-allowed disabled:opacity-50";

  const generate = async (template: DocumentTemplateSummary) => {
    const generated = await openDocumentGenerationReviewDialog({
      template,
      tableId: props.tableId,
      recordId: props.recordId,
    });
    if (generated) {
      await refetchRuns();
      await refetchSnapshots();
    }
  };

  const redownload = async (run: DocumentRunSummary) => {
    setBusy(run.id);
    try {
      const res = await requestDocumentRunDownload(run.id);
      await downloadPdfResponse(res, run.filename);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to download document");
    } finally {
      setBusy(null);
    }
  };

  const createSnapshot = async () => {
    setBusy("snapshot");
    try {
      const res = await apiClient.documents.snapshots["by-record"][":tableId"][":recordId"].$post({
        param: { tableId: props.tableId, recordId: props.recordId },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create snapshot"));
      await refetchSnapshots();
      prompts.success("Snapshot created.");
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to create snapshot");
    } finally {
      setBusy(null);
    }
  };

  const inspectSnapshot = async (summary: RecordSnapshotSummary) => {
    setBusy(summary.id);
    try {
      const res = await apiClient.documents.snapshots[":snapshotId"].$get({ param: { snapshotId: summary.id } });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to load snapshot"));
      const snapshot = (await res.json()) as RecordSnapshot;
      const root = snapshot.root as SnapshotRecordNode;
      const fields = snapshotFields(root, snapshot.tableId);
      const snapshotRecord = snapshotGridRecord(snapshot);
      const relationLabels = snapshotRelationLabels(snapshot);
      await prompts.dialog<void>(
        () => (
          <div class="h-[70vh] min-h-0">
            <RecordReadView
              baseId={snapshot.baseId}
              tableId={snapshot.tableId}
              tableName={snapshotTableName(snapshot)}
              fields={fields}
              record={snapshotRecord}
              mode="snapshot"
              relationLabels={relationLabels}
              headerMeta={
                <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-dimmed">
                  <span class="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                    <i class="ti ti-camera" /> snapshot
                  </span>
                  <span>·</span>
                  <span class="truncate">{snapshotTableName(snapshot)}</span>
                  <span>·</span>
                  <span>{formatRecordRelativeTime(snapshot.createdAt)}</span>
                  <span>·</span>
                  <span class="font-mono">{snapshotRecord.id.slice(0, 8)}</span>
                </div>
              }
            >
              <StructuredDataPreview
                title="Metadata"
                data={{
                  id: snapshot.id,
                  tableId: snapshot.tableId,
                  recordId: snapshot.recordId,
                  createdAt: snapshot.createdAt,
                  createdBy: snapshot.createdBy,
                }}
                maxRows={8}
              />
              <details class="detail-section group">
                <summary class="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-secondary">
                  <i class="ti ti-code text-sm" />
                  Raw snapshot data
                  <i class="ti ti-chevron-down ml-auto text-xs text-dimmed transition-transform group-open:rotate-180" />
                </summary>
                <div class="mt-3 flex flex-col gap-3">
                  <StructuredDataPreview title="Root record" data={snapshot.root} defaultMode="raw" />
                  <StructuredDataPreview title="Record graph" data={snapshot.graph} defaultMode="raw" />
                </div>
              </details>
            </RecordReadView>
          </div>
        ),
        { title: "Record snapshot", icon: "ti ti-camera", size: "large" },
      );
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to load snapshot");
    } finally {
      setBusy(null);
    }
  };

  const availableTemplates = () => props.templates.filter((template) => template.enabled);
  const generatedRuns = runs;
  const manualSnapshots = snapshots;

  return (
    <>
      <section class="detail-section flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="detail-section-label mb-0">Snapshots</h3>
          <Show when={props.live}>
            <button type="button" class="btn-input btn-sm" onClick={() => void createSnapshot()} disabled={busy() === "snapshot"}>
              {busy() === "snapshot" ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-camera" />}
              Snapshot
            </button>
          </Show>
        </div>

        <Show when={manualSnapshots().length === 0}>
          <Placeholder align="left" class="px-0 py-2">
            No manual snapshots yet.
          </Placeholder>
        </Show>
        <Show when={manualSnapshots().length > 0}>
          <div class="flex flex-col gap-2">
            <For each={manualSnapshots()}>
              {(snapshot) => (
                <div class="flex min-w-0 items-center gap-2 text-xs">
                  <i class="ti ti-camera text-dimmed" />
                  <span class="min-w-0 flex-1 truncate font-mono text-secondary">SNAP-{snapshot.id.slice(0, 8).toUpperCase()}</span>
                  <span class="shrink-0 text-dimmed">{formatRecordRelativeTime(snapshot.createdAt)}</span>
                  <button
                    type="button"
                    class={iconActionClass}
                    title="Inspect snapshot"
                    aria-label="Inspect snapshot"
                    onClick={() => void inspectSnapshot(snapshot)}
                    disabled={busy() === snapshot.id}
                  >
                    {busy() === snapshot.id ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-eye" />}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      <Show when={props.live}>
        <section class="detail-section flex flex-col gap-3">
          <h3 class="detail-section-label mb-0">Generate document</h3>

          <Show when={availableTemplates().length === 0}>
            <Placeholder align="left" class="px-0 py-2">
              No enabled document templates.
            </Placeholder>
          </Show>
          <Show when={availableTemplates().length > 0}>
            <div class="flex flex-col gap-2">
              <For each={availableTemplates()}>
                {(template) => (
                  <button
                    type="button"
                    class="flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--ui-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void generate(template)}
                    aria-label={`Review ${template.name}`}
                  >
                    <i class="ti ti-file-type-pdf shrink-0 text-dimmed" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate font-medium text-primary">{template.name}</span>
                      <Show when={template.description}>
                        {(description) => <span class="mt-0.5 block truncate text-xs text-dimmed">{description()}</span>}
                      </Show>
                    </span>
                    <span class="shrink-0 text-dimmed">
                      <i class="ti ti-chevron-right" />
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </section>
      </Show>

      <section class="detail-section flex flex-col gap-3">
        <h3 class="detail-section-label mb-0">Generated documents</h3>

        <Show when={generatedRuns().length === 0}>
          <Placeholder align="left" class="px-0 py-2">
            No generated documents yet.
          </Placeholder>
        </Show>
        <Show when={generatedRuns().length > 0}>
          <div class="flex flex-col gap-2">
            <For each={generatedRuns()}>
              {(run) => (
                <div class="flex items-center gap-2 text-xs">
                  <i class="ti ti-file-description text-dimmed" />
                  <span class="min-w-0 flex-1 truncate text-secondary">{run.filename}</span>
                  <span class="shrink-0 text-dimmed">{formatRecordRelativeTime(run.generatedAt)}</span>
                  <button
                    type="button"
                    class={iconActionClass}
                    title="Download document"
                    aria-label="Download document"
                    onClick={() => void redownload(run)}
                    disabled={busy() === run.id}
                  >
                    {busy() === run.id ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
    </>
  );
}
