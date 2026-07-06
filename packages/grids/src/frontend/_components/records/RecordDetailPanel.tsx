import {
  dialogCore,
  PanelDialog,
  PdfPreview,
  Placeholder,
  panelDialogOptions,
  prompts,
  StructuredDataPreview,
} from "@valentinkolb/cloud/ui";
import { type DateContext, text } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ColumnSpec, DocumentRunSummary, DocumentTemplateSummary, RecordSnapshot, RecordSnapshotSummary } from "../../../contracts";
import type { AuditEntry, Field, GridFile, GridRecord } from "../../../service";
import { downloadPdfResponse } from "../documents/document-download";
import { isUserEditable } from "../fields/field-prompt-schema";
import { errorMessage } from "../utils/api-helpers";
import RecordReadView, { recordDisplayTitle } from "./RecordReadView";
import { openRecordUpsertDialog } from "./RecordUpsertDialog";

type Props = {
  baseId: string;
  baseShortId?: string;
  tableId: string;
  tableName: string;
  fields: Field[];
  /** Currently-displayed record. Controlled by RecordsView — when the
   *  user clicks a different row in the grid, the parent passes a new
   *  record here. null = panel renders nothing. */
  record: () => GridRecord | null;
  /** "live" = edit/delete; "trash" = restore. Driven by the URL state's
   *  trash flag, lifted up to the parent. */
  mode: () => "live" | "trash";
  /** True if the user can edit/delete records on this table. */
  canWrite: boolean;
  /** Pre-resolved labels for linked records (target id → display label).
   *  Built SSR-side; used by relation cells to render presentable
   *  values instead of raw UUIDs. */
  relationLabels?: Record<string, string>;
  tableShortIds?: Record<string, string>;
  fieldsByTable?: Record<string, Field[]>;
  viewColumns?: ColumnSpec[];
  dateConfig?: DateContext;
  /** Close the panel (delegates URL writeback to RecordsView). */
  onClose: () => void;
  /** Emitted after a successful edit. RecordsView refetches the data
   *  resource so the grid reflects the new value. */
  onUpdated: (record: GridRecord) => void;
  /** Emitted after a successful delete or restore. RecordsView closes
   *  the panel + refetches. */
  onRemoved: () => void;
};

type SnapshotField = Partial<Field> & {
  id?: unknown;
  shortId?: unknown;
  name?: unknown;
  type?: unknown;
  config?: unknown;
};

type SnapshotRecordNode = {
  id?: unknown;
  table?: unknown;
  fields?: unknown;
  data?: unknown;
  version?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
};

const snapshotObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const snapshotTableName = (snapshot: RecordSnapshot): string => {
  const table = snapshotObject(snapshotObject(snapshot.root).table);
  return typeof table.name === "string" && table.name.trim() ? table.name : "Snapshot record";
};

const normalizeSnapshotField = (field: SnapshotField, tableId: string, index: number): Field | null => {
  if (typeof field.id !== "string" || typeof field.name !== "string" || typeof field.type !== "string") return null;
  return {
    id: field.id,
    shortId: typeof field.shortId === "string" ? field.shortId : field.id.slice(0, 5),
    tableId,
    name: field.name,
    description: typeof field.description === "string" ? field.description : null,
    icon: typeof field.icon === "string" ? field.icon : null,
    type: field.type,
    config: snapshotObject(field.config),
    position: typeof field.position === "number" ? field.position : index,
    required: field.required === true,
    presentable: field.presentable === true,
    hideInTable: field.hideInTable === true,
    defaultValue: field.defaultValue,
    indexed: field.indexed === true,
    uniqueConstraint: field.uniqueConstraint === true,
    deletedAt: typeof field.deletedAt === "string" ? field.deletedAt : null,
    createdAt: typeof field.createdAt === "string" ? field.createdAt : "",
    updatedAt: typeof field.updatedAt === "string" ? field.updatedAt : "",
  };
};

const snapshotFields = (node: SnapshotRecordNode, tableId: string): Field[] =>
  (Array.isArray(node.fields) ? node.fields : [])
    .map((field, index) => normalizeSnapshotField(field as SnapshotField, tableId, index))
    .filter((field): field is Field => Boolean(field));

const snapshotGridRecord = (snapshot: RecordSnapshot): GridRecord => {
  const root = snapshot.root as SnapshotRecordNode;
  return {
    id: typeof root.id === "string" ? root.id : snapshot.recordId,
    tableId: snapshot.tableId,
    data: snapshotObject(root.data),
    version: typeof root.version === "number" ? root.version : 0,
    deletedAt: typeof root.deletedAt === "string" || root.deletedAt === null ? root.deletedAt : null,
    createdBy: null,
    updatedBy: null,
    createdAt: typeof root.createdAt === "string" ? root.createdAt : snapshot.createdAt,
    updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : snapshot.createdAt,
  };
};

const snapshotNodeLabel = (node: SnapshotRecordNode): string | null => {
  const table = snapshotObject(node.table);
  const fields = snapshotFields(node, typeof table.id === "string" ? table.id : "");
  const data = snapshotObject(node.data);
  const field =
    fields.find((item) => item.presentable && item.id in data) ?? fields.find((item) => item.type === "text" && item.id in data);
  if (field) {
    const value = data[field.id];
    if (typeof value === "string" && value.trim()) return value;
    if (value !== null && value !== undefined && typeof value !== "object") return String(value);
  }
  return typeof node.id === "string" ? node.id.slice(0, 8) : null;
};

const snapshotRelationLabels = (snapshot: RecordSnapshot): Record<string, string> => {
  const graph = snapshotObject(snapshot.graph);
  const records = snapshotObject(graph.records);
  const labels: Record<string, string> = {};
  for (const value of Object.values(records)) {
    const node = value as SnapshotRecordNode;
    if (typeof node.id !== "string") continue;
    const label = snapshotNodeLabel(node);
    if (label) labels[node.id] = label;
  }
  return labels;
};

/**
 * Detail panel for a single record. Pure controlled component:
 * RecordsView passes the record to display + close/update/remove
 * callbacks; this island handles edit / delete / restore mutations
 * and renders the form. No URL writes, no custom events.
 */
export default function RecordDetailPanel(props: Props) {
  const record = () => props.record();
  const mode = () => props.mode();

  const visibleFields = () => props.fields.filter((f) => !f.deletedAt);

  // ---- Mutations ---------------------------------------------------------
  const updateMut = mutations.create<GridRecord, { rec: GridRecord; payload: Record<string, unknown> }>({
    mutation: async ({ rec, payload }) => {
      const res = await apiClient.records[":tableId"][":recordId"].$patch(
        {
          param: { tableId: props.tableId, recordId: rec.id },
          json: payload,
        },
        { headers: { "If-Match": String(rec.version) } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update record"));
      return res.json();
    },
    onSuccess: (updated) => props.onUpdated(updated),
    onError: (e) => prompts.error(e.message),
  });

  const deleteMut = mutations.create<string, GridRecord>({
    mutation: async (rec) => {
      const res = await apiClient.records[":tableId"][":recordId"].$delete({
        param: { tableId: props.tableId, recordId: rec.id },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete record"));
      return rec.id;
    },
    onSuccess: () => props.onRemoved(),
    onError: (e) => prompts.error(e.message),
  });

  const restoreMut = mutations.create<string, GridRecord>({
    mutation: async (rec) => {
      const res = await apiClient.records[":tableId"][":recordId"].restore.$post({
        param: { tableId: props.tableId, recordId: rec.id },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to restore record"));
      return rec.id;
    },
    onSuccess: () => props.onRemoved(),
    onError: (e) => prompts.error(e.message),
  });

  // ---- Handlers ----------------------------------------------------------
  const handleEdit = async (rec: GridRecord) => {
    const usable = visibleFields().filter((f) => isUserEditable(f.type) || f.type === "relation");
    if (usable.length === 0) {
      prompts.error("No editable fields. Add a field first.");
      return;
    }
    const result = await openRecordUpsertDialog({
      mode: "edit",
      fields: visibleFields(),
      baseId: props.baseId,
      tableName: props.tableName,
      record: rec,
      relationLabels: props.relationLabels,
      dateConfig: props.dateConfig,
    });
    if (!result) return;
    updateMut.mutate({ rec, payload: result });
  };

  const handleDelete = async (rec: GridRecord) => {
    const confirmed = await prompts.confirm(
      `${recordDisplayTitle({
        fields: props.fields,
        record: rec,
        fieldsByTable: props.fieldsByTable,
        relationLabels: props.relationLabels,
        dateConfig: props.dateConfig,
        viewColumns: props.viewColumns,
      })}\n${props.tableName}\n\nThis record is moved to trash and can be restored.`,
      { title: "Delete record?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteMut.mutate(rec);
  };

  const handleRestore = (rec: GridRecord) => restoreMut.mutate(rec);

  return (
    <Show when={record()} fallback={null} keyed>
      {(rec) => (
        <div class="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
          <RecordReadView
            baseId={props.baseShortId ?? props.baseId}
            tableId={props.tableId}
            tableName={props.tableName}
            fields={props.fields}
            record={rec}
            mode={mode()}
            relationLabels={props.relationLabels}
            tableShortIds={props.tableShortIds}
            fieldsByTable={props.fieldsByTable}
            viewColumns={props.viewColumns}
            dateConfig={props.dateConfig}
            renderFileField={(field, record) => (
              <FileFieldCell tableId={props.tableId} recordId={record.id} field={field} canWrite={props.canWrite && mode() === "live"} />
            )}
            headerActions={
              <>
                <Show when={props.canWrite && mode() === "live"}>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-primary"
                    aria-label="Edit record"
                    title="Edit"
                    onClick={() => handleEdit(rec)}
                  >
                    <i class="ti ti-pencil" />
                  </button>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-red-500"
                    aria-label="Delete record"
                    title="Delete"
                    onClick={() => handleDelete(rec)}
                    disabled={deleteMut.loading()}
                  >
                    <i class="ti ti-trash" />
                  </button>
                </Show>
                <Show when={props.canWrite && mode() === "trash"}>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-emerald-600"
                    aria-label="Restore record"
                    title="Restore"
                    onClick={() => handleRestore(rec)}
                    disabled={restoreMut.loading()}
                  >
                    <i class="ti ti-arrow-back-up" />
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn-simple btn-sm text-dimmed hover:text-primary"
                  aria-label="Close detail panel"
                  title="Close"
                  onClick={() => props.onClose()}
                >
                  <i class="ti ti-x" />
                </button>
              </>
            }
          />

          <RecordDocumentsSection tableId={props.tableId} recordId={rec.id} live={mode() === "live"} />
          <RecordHistorySection tableId={props.tableId} recordId={rec.id} />
        </div>
      )}
    </Show>
  );
}

const openDocumentGenerationReviewDialog = (args: { tableId: string; recordId: string; template: DocumentTemplateSummary }) =>
  dialogCore.open<boolean>((close) => <DocumentGenerationReviewDialog args={args} close={close} />, panelDialogOptions);

function DocumentGenerationReviewDialog(props: {
  args: { tableId: string; recordId: string; template: DocumentTemplateSummary };
  close: (generated: boolean) => void;
}) {
  const [previewed, setPreviewed] = createSignal(false);
  const generateMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await fetch(`/api/grids/documents/templates/${props.args.template.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: props.args.recordId }),
      });
      await downloadPdfResponse(res, `${props.args.template.name}.pdf`);
    },
    onSuccess: () => props.close(true),
    onError: (error) => prompts.error(error.message),
  });

  const previewPdf = async () => {
    setPreviewed(false);
    const response = await fetch(`/api/grids/documents/templates/${props.args.template.id}/preview-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordId: props.args.recordId }),
    });
    if (response.ok && (response.headers.get("content-type") ?? "").includes("application/pdf")) setPreviewed(true);
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

            <div class="rounded-md border border-blue-500/20 bg-blue-500/10 p-3 text-xs leading-relaxed text-secondary">
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

function RecordDocumentsSection(props: { tableId: string; recordId: string; live: boolean }) {
  const [templates] = createResource(
    () => props.tableId,
    async (tableId) => {
      const res = await apiClient.documents.templates["by-table"][":tableId"].$get({ param: { tableId }, query: { min: "write" } });
      if (!res.ok) return [] as DocumentTemplateSummary[];
      return res.json();
    },
  );
  const [runs, { refetch: refetchRuns }] = createResource(
    () => `${props.tableId}:${props.recordId}`,
    async () => {
      const res = await apiClient.documents.runs["by-record"][":tableId"][":recordId"].$get({
        param: { tableId: props.tableId, recordId: props.recordId },
      });
      if (!res.ok) return { items: [] as DocumentRunSummary[] };
      return res.json();
    },
  );
  const [snapshots, { refetch: refetchSnapshots }] = createResource(
    () => `${props.tableId}:${props.recordId}`,
    async () => {
      const res = await apiClient.documents.snapshots["by-record"][":tableId"][":recordId"].$get({
        param: { tableId: props.tableId, recordId: props.recordId },
      });
      if (!res.ok) return { items: [] as RecordSnapshotSummary[] };
      return res.json();
    },
  );
  const [busy, setBusy] = createSignal<string | null>(null);

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
      const res = await fetch(`/api/grids/documents/runs/${run.id}/download`);
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
          <div class="flex max-h-[70vh] flex-col gap-3 overflow-auto p-4">
            <div class="flex flex-col gap-2">
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
                    <span>{formatRelativeTime(snapshot.createdAt)}</span>
                    <span>·</span>
                    <span class="font-mono">{snapshotRecord.id.slice(0, 8)}</span>
                  </div>
                }
              />
            </div>
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
            <details class="paper p-0">
              <summary class="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs font-medium text-secondary">
                <i class="ti ti-code text-sm" />
                Raw snapshot data
                <i class="ti ti-chevron-down ml-auto text-xs text-dimmed" />
              </summary>
              <div class="flex flex-col gap-3 px-3 pb-3">
                <StructuredDataPreview title="Root record" data={snapshot.root} defaultMode="raw" />
                <StructuredDataPreview title="Record graph" data={snapshot.graph} defaultMode="raw" />
              </div>
            </details>
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

  const availableTemplates = () => (templates() ?? []).filter((template) => template.enabled);
  const generatedRuns = () => {
    const value = runs();
    return Array.isArray(value) ? value : (value?.items ?? []);
  };
  const manualSnapshots = () => snapshots()?.items ?? [];

  return (
    <>
      <section class="paper p-4 flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary">Snapshots</h3>
          <Show when={props.live}>
            <button type="button" class="btn-input btn-sm" onClick={() => void createSnapshot()} disabled={busy() === "snapshot"}>
              {busy() === "snapshot" ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-camera" />}
              Snapshot
            </button>
          </Show>
        </div>

        <Show when={snapshots.loading}>
          <p class="text-xs text-dimmed">Loading snapshots…</p>
        </Show>
        <Show when={!snapshots.loading && manualSnapshots().length === 0}>
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
                  <span class="shrink-0 text-dimmed">{formatRelativeTime(snapshot.createdAt)}</span>
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
        <section class="paper p-4 flex flex-col gap-3">
          <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary">Generate document</h3>

          <Show when={templates.loading}>
            <p class="text-xs text-dimmed">Loading templates…</p>
          </Show>
          <Show when={!templates.loading && availableTemplates().length === 0}>
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
                    class="flex w-full min-w-0 items-center gap-2 rounded-md bg-zinc-50 px-2.5 py-2 text-left text-sm transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-900 dark:hover:bg-zinc-800"
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

      <section class="paper p-4 flex flex-col gap-3">
        <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary">Generated documents</h3>

        <Show when={runs.loading}>
          <p class="text-xs text-dimmed">Loading generated documents…</p>
        </Show>
        <Show when={!runs.loading && generatedRuns().length === 0}>
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
                  <span class="shrink-0 text-dimmed">{formatRelativeTime(run.generatedAt)}</span>
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

function FileFieldCell(props: { tableId: string; recordId: string; field: Field; canWrite: boolean }) {
  const [uploading, setUploading] = createSignal(false);
  const [files, { refetch }] = createResource(
    () => `${props.tableId}:${props.recordId}:${props.field.id}`,
    async () => {
      const res = await apiClient.records[":tableId"][":recordId"].files[":fieldId"].$get({
        param: { tableId: props.tableId, recordId: props.recordId, fieldId: props.field.id },
      });
      if (!res.ok) return { items: [] as GridFile[] };
      return res.json();
    },
  );

  const accept = () => {
    const raw = (props.field.config as { accept?: string[] }).accept;
    return Array.isArray(raw) ? raw.join(",") : undefined;
  };

  const upload = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      // FormData upload exception: the Hono client route is JSON-typed, native fetch keeps multipart exact.
      const res = await fetch(`/api/grids/records/${props.tableId}/${props.recordId}/files/${props.field.id}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to upload file"));
      await refetch();
    } catch (e) {
      prompts.error(e instanceof Error ? e.message : "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (file: GridFile) => {
    const confirmed = await prompts.confirm(`Delete "${file.filename}"?`, {
      title: "Delete file?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    const res = await apiClient.records[":tableId"][":recordId"].files[":fieldId"][":fileId"].$delete({
      param: { tableId: props.tableId, recordId: props.recordId, fieldId: props.field.id, fileId: file.id },
    });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to delete file"));
      return;
    }
    await refetch();
  };

  return (
    <div class="flex flex-col gap-2">
      <Show when={!files.loading && (files()?.items.length ?? 0) === 0}>
        <span class="text-dimmed">—</span>
      </Show>
      <Show when={(files()?.items.length ?? 0) > 0}>
        <div class="flex flex-col gap-1">
          <For each={files()?.items ?? []}>
            {(file) => (
              <div class="paper flex items-center gap-2 px-2.5 py-1.5 text-xs">
                <i class="ti ti-paperclip text-dimmed" />
                <a
                  class="min-w-0 flex-1 truncate text-secondary hover:text-primary"
                  href={`/api/grids/records/${props.tableId}/${props.recordId}/files/${props.field.id}/${file.id}/content`}
                  title={file.filename}
                >
                  {file.filename}
                </a>
                <span class="shrink-0 text-[10px] text-dimmed">{text.pprintBytes(file.sizeBytes)}</span>
                <Show when={props.canWrite}>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-red-500"
                    title="Delete file"
                    onClick={() => void remove(file)}
                  >
                    <i class="ti ti-trash" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.canWrite}>
        <label class={`btn-input btn-input-sm w-fit ${uploading() ? "pointer-events-none opacity-60" : ""}`}>
          <i class={`ti ${uploading() ? "ti-loader-2 animate-spin" : "ti-upload"} text-sm`} />
          Upload
          <input type="file" class="sr-only" accept={accept()} onChange={(event) => void upload(event)} disabled={uploading()} />
        </label>
      </Show>
    </div>
  );
}

type AuditEntryWithUser = AuditEntry & { userDisplayName: string | null };

const ACTION_ICONS: Record<string, string> = {
  created: "ti-plus",
  updated: "ti-pencil",
  deleted: "ti-trash",
  restored: "ti-arrow-back-up",
  imported: "ti-file-import",
};

const ACTION_COLORS: Record<string, string> = {
  created: "text-emerald-600 dark:text-emerald-400",
  updated: "text-blue-600 dark:text-blue-400",
  deleted: "text-red-600 dark:text-red-400",
  restored: "text-amber-600 dark:text-amber-400",
  imported: "text-zinc-600 dark:text-zinc-400",
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86_400 * 30) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function RecordHistorySection(props: { tableId: string; recordId: string }) {
  const [entries] = createResource(
    () => `${props.tableId}:${props.recordId}`,
    async () => {
      const res = await apiClient.records[":tableId"][":recordId"].audit.$get({
        param: { tableId: props.tableId, recordId: props.recordId },
      });
      if (!res.ok) return { items: [] as AuditEntryWithUser[] };
      return res.json();
    },
  );

  return (
    <details class="paper p-0 group">
      <summary class="cursor-pointer select-none flex items-center gap-2 px-3 py-2 text-xs font-medium text-secondary">
        <i class="ti ti-history text-sm" />
        History
        <Show when={!entries.loading && entries()}>
          <span class="text-[10px] text-dimmed">({entries()!.items.length})</span>
        </Show>
        <i class="ti ti-chevron-down ml-auto text-xs text-dimmed transition-transform group-open:rotate-180" />
      </summary>
      <div class="px-3 pb-3 flex flex-col gap-2">
        <Show when={entries.loading}>
          <p class="text-xs text-dimmed">Loading history…</p>
        </Show>
        <Show when={!entries.loading && entries() && entries()!.items.length === 0}>
          <Placeholder align="left" class="px-0 py-2">
            No history yet.
          </Placeholder>
        </Show>
        <For each={entries()?.items ?? []}>
          {(entry) => {
            const fieldsChanged = entry.diff ? Object.keys(entry.diff) : [];
            const summary =
              fieldsChanged.length === 0
                ? null
                : fieldsChanged.length <= 3
                  ? fieldsChanged.join(", ")
                  : `${fieldsChanged.slice(0, 3).join(", ")} +${fieldsChanged.length - 3} more`;
            return (
              <details class="text-xs">
                <summary class="cursor-pointer select-none flex items-baseline gap-2">
                  <i class={`ti ${ACTION_ICONS[entry.action] ?? "ti-circle"} ${ACTION_COLORS[entry.action] ?? "text-dimmed"} text-xs`} />
                  <span class="capitalize text-secondary">{entry.action}</span>
                  {/* Actor attribution. The audit row carries both a
                      `userId` (UUID of the actor at write time, or
                      null) and a `userDisplayName` resolved at read
                      time via JOIN to auth.users (null when the user
                      is gone OR when no user was ever associated).
                      Three states, three distinct strings:
                        - name resolved        → "by <name>"
                        - userId null          → "via public form"
                          (every null-actor audit on records comes
                          from the anonymous form-submit path; see
                          submitFormResponse in api/forms.ts)
                        - userId set, name nil → "by deleted user"
                          (italic to mark it as a phantom — the
                          actor existed but is no longer in auth.users)
                  */}
                  <Show
                    when={entry.userDisplayName}
                    fallback={
                      <Show when={entry.userId === null} fallback={<span class="text-dimmed italic">by deleted user</span>}>
                        <span class="text-dimmed inline-flex items-center gap-1">
                          <i class="ti ti-world text-[10px]" />
                          via public form
                        </span>
                      </Show>
                    }
                  >
                    {(name) => <span class="text-dimmed">by {name()}</span>}
                  </Show>
                  <span class="ml-auto text-[10px] text-dimmed shrink-0" title={entry.createdAt}>
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                </summary>
                <Show when={summary}>
                  <p class="ml-5 text-[11px] text-dimmed">changed {summary}</p>
                </Show>
                <Show when={entry.diff && fieldsChanged.length > 0}>
                  <pre class="ml-5 mt-1 max-h-40 overflow-auto rounded-md bg-zinc-50 dark:bg-zinc-800 p-2 text-[10px] font-mono text-zinc-700 dark:text-zinc-300">
                    {JSON.stringify(entry.diff, null, 2)}
                  </pre>
                </Show>
              </details>
            );
          }}
        </For>
      </div>
    </details>
  );
}
