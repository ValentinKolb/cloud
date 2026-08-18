import { fileIcons } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import {
  Button,
  DetailPanel,
  Dropdown,
  dialogCore,
  isStructuredDataValue,
  NoticeCard,
  PanelDialog,
  PdfPreview,
  Placeholder,
  panelDialogOptions,
  prompts,
  StructuredDataPreview,
  toast,
} from "@k2b/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { downloadPdfResponse } from "../documents/document-download";
import {
  isPdfResponse,
  requestDocumentRunDownload,
  requestDocumentTemplateGeneration,
  requestDocumentTemplatePreview,
} from "../documents/document-transfer-client";
import type {
  PublicDocumentRunSummary,
  PublicDocumentTemplateSummary,
  PublicRecordSnapshot,
  PublicRecordSnapshotSummary,
} from "../documents/public-document-types";
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

const openDocumentGenerationReviewDialog = (args: { tableId: string; recordId: string; template: PublicDocumentTemplateSummary }) =>
  dialogCore.open<boolean>((close) => <DocumentGenerationReviewDialog args={args} close={close} />, panelDialogOptions);

function DocumentGenerationReviewDialog(props: {
  args: { tableId: string; recordId: string; template: PublicDocumentTemplateSummary };
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

            <NoticeCard tone="info" icon={false}>
              Generating creates a recursive record snapshot and stores a document run. The PDF can be redownloaded later from the generated
              document history.
            </NoticeCard>

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
          <Button variant="secondary" size="sm" type="button" onClick={() => props.close(false)} disabled={generateMut.loading()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={() => generateMut.mutate(undefined)}
            disabled={generateMut.loading() || !previewed()}
          >
            {generateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
            Generate PDF
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function RecordDocumentsSection(props: {
  tableId: string;
  recordId: string;
  live: boolean;
  templates: PublicDocumentTemplateSummary[];
  initialRuns: PublicDocumentRunSummary[];
  initialSnapshots: PublicRecordSnapshotSummary[];
}) {
  const [runs, setRuns] = createSignal<PublicDocumentRunSummary[]>(props.initialRuns);
  const [snapshots, setSnapshots] = createSignal<PublicRecordSnapshotSummary[]>(props.initialSnapshots);
  const [activeDownloadId, setActiveDownloadId] = createSignal<string | null>(null);
  const [activeSnapshotId, setActiveSnapshotId] = createSignal<string | null>(null);

  createEffect(() => setRuns(props.initialRuns));
  createEffect(() => setSnapshots(props.initialSnapshots));

  const loadRuns = async () => {
    const res = await apiClient.documents.runs["by-record"][":tableId"][":recordId"].$get({
      param: { tableId: props.tableId, recordId: props.recordId },
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to load generated documents"));
    const value = (await res.json()) as { items: PublicDocumentRunSummary[] } | PublicDocumentRunSummary[];
    return Array.isArray(value) ? value : value.items;
  };

  const loadSnapshots = async () => {
    const res = await apiClient.documents.snapshots["by-record"][":tableId"][":recordId"].$get({
      param: { tableId: props.tableId, recordId: props.recordId },
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to load snapshots"));
    return ((await res.json()) as { items: PublicRecordSnapshotSummary[] }).items;
  };

  const refreshDocumentsMut = mutations.create<{ runs: PublicDocumentRunSummary[]; snapshots: PublicRecordSnapshotSummary[] }, void>({
    mutation: async () => {
      const [nextRuns, nextSnapshots] = await Promise.all([loadRuns(), loadSnapshots()]);
      return { runs: nextRuns, snapshots: nextSnapshots };
    },
    onSuccess: (value) => {
      setRuns(value.runs);
      setSnapshots(value.snapshots);
    },
    onError: (error) => prompts.error(error.message),
  });

  const redownloadMut = mutations.create<void, PublicDocumentRunSummary>({
    onBefore: (run) => setActiveDownloadId(run.id),
    mutation: async (run) => {
      const res = await requestDocumentRunDownload(run.id);
      await downloadPdfResponse(res, run.filename);
    },
    onError: (error) => prompts.error(error.message),
    onFinally: () => setActiveDownloadId(null),
  });

  const createSnapshotMut = mutations.create<PublicRecordSnapshotSummary[], void>({
    mutation: async () => {
      const createRes = await apiClient.documents.snapshots["by-record"][":tableId"][":recordId"].$post({
        param: { tableId: props.tableId, recordId: props.recordId },
      });
      if (!createRes.ok) throw new Error(await errorMessage(createRes, "Failed to create snapshot"));
      return loadSnapshots();
    },
    onSuccess: (items) => {
      setSnapshots(items);
      toast.success("Snapshot created.");
    },
    onError: (error) => prompts.error(error.message),
  });

  const inspectSnapshotMut = mutations.create<void, PublicRecordSnapshotSummary>({
    onBefore: (snapshot) => setActiveSnapshotId(snapshot.id),
    mutation: async (summary) => {
      const res = await apiClient.documents.snapshots[":snapshotId"].$get({ param: { snapshotId: summary.id } });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to load snapshot"));
      const snapshot = (await res.json()) as PublicRecordSnapshot;
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
              <DetailPanel.Section title="Raw snapshot data" icon="ti ti-code" collapsible>
                <div class="flex flex-col gap-3">
                  <StructuredDataPreview
                    title="Root record"
                    data={isStructuredDataValue(snapshot.root) ? snapshot.root : { error: "Snapshot root is not valid JSON." }}
                    defaultMode="raw"
                  />
                  <StructuredDataPreview
                    title="Record graph"
                    data={isStructuredDataValue(snapshot.graph) ? snapshot.graph : { error: "Snapshot graph is not valid JSON." }}
                    defaultMode="raw"
                  />
                </div>
              </DetailPanel.Section>
            </RecordReadView>
          </div>
        ),
        { title: "Record snapshot", icon: "ti ti-camera", size: "large" },
      );
    },
    onError: (error) => prompts.error(error.message),
    onFinally: () => setActiveSnapshotId(null),
  });

  const generate = async (template: PublicDocumentTemplateSummary) => {
    const generated = await openDocumentGenerationReviewDialog({
      template,
      tableId: props.tableId,
      recordId: props.recordId,
    });
    if (generated) await refreshDocumentsMut.mutate(undefined);
  };

  const availableTemplates = () => props.templates.filter((template) => template.enabled);
  const generatedRuns = runs;
  const manualSnapshots = snapshots;
  const generationActions = () =>
    availableTemplates().map((template) => ({
      label: template.name,
      icon: "ti ti-file-type-pdf",
      action: () => void generate(template),
    }));

  return (
    <>
      <Show when={props.live || manualSnapshots().length > 0}>
        <DetailPanel.Section
          title="Snapshots"
          icon="ti ti-camera"
          meta={manualSnapshots().length}
          actions={
            <Show when={props.live}>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => createSnapshotMut.mutate(undefined)}
                disabled={createSnapshotMut.loading()}
                aria-busy={createSnapshotMut.loading()}
              >
                {createSnapshotMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-camera" />}
                Create snapshot
              </Button>
            </Show>
          }
        >
          <Show when={manualSnapshots().length === 0}>
            <Placeholder align="left" description="No snapshots yet." />
          </Show>
          <For each={manualSnapshots()}>
            {(snapshot) => (
              <button
                type="button"
                class="group flex min-w-0 items-center gap-2 py-1 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={`Inspect snapshot ${snapshot.id}`}
                onClick={() => inspectSnapshotMut.mutate(snapshot)}
                disabled={inspectSnapshotMut.loading()}
                aria-busy={activeSnapshotId() === snapshot.id}
              >
                <i
                  aria-hidden="true"
                  class={activeSnapshotId() === snapshot.id ? "ti ti-loader-2 shrink-0 animate-spin" : "ti ti-camera shrink-0 text-dimmed"}
                />
                <span class="min-w-0 flex-1 truncate font-mono text-secondary transition-colors group-hover:text-primary">
                  SNAP-{snapshot.id.slice(0, 8).toUpperCase()}
                </span>
                <span class="shrink-0 text-xs text-dimmed">{formatRecordRelativeTime(snapshot.createdAt)}</span>
                <i aria-hidden="true" class="ti ti-chevron-right shrink-0 text-dimmed" />
              </button>
            )}
          </For>
        </DetailPanel.Section>
      </Show>

      <Show when={generatedRuns().length > 0 || (props.live && availableTemplates().length > 0)}>
        <DetailPanel.Section
          title="Documents"
          icon="ti ti-file-type-pdf"
          meta={generatedRuns().length}
          actions={
            <Show when={props.live && availableTemplates().length > 0}>
              <Dropdown.Root position="bottom-left" width="16rem" items={generationActions()}>
                <Dropdown.Trigger variant="secondary" size="sm" type="button" disabled={refreshDocumentsMut.loading()}>
                  <i class="ti ti-file-plus" />
                  Generate
                  <i class="ti ti-chevron-down text-xs" />
                </Dropdown.Trigger>
              </Dropdown.Root>
            </Show>
          }
        >
          <Show when={generatedRuns().length === 0}>
            <Placeholder align="left" description="No generated documents yet." />
          </Show>
          <For each={generatedRuns()}>
            {(run) => (
              <button
                type="button"
                class="group flex min-w-0 items-center gap-2 py-1 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={`Download ${run.filename}`}
                onClick={() => redownloadMut.mutate(run)}
                disabled={redownloadMut.loading()}
                aria-busy={activeDownloadId() === run.id}
              >
                <i
                  aria-hidden="true"
                  class={
                    activeDownloadId() === run.id
                      ? "ti ti-loader-2 shrink-0 animate-spin"
                      : `ti ${fileIcons.getFileIcon({
                          name: run.filename,
                          type: "file",
                          mimeType: "application/pdf",
                        })} shrink-0 text-base`
                  }
                />
                <span class="min-w-0 flex-1 truncate text-secondary transition-colors group-hover:text-primary">{run.filename}</span>
                <span class="shrink-0 text-xs text-dimmed">{formatRecordRelativeTime(run.generatedAt)}</span>
                <i aria-hidden="true" class="ti ti-download shrink-0 text-dimmed" />
              </button>
            )}
          </For>
        </DetailPanel.Section>
      </Show>
    </>
  );
}
