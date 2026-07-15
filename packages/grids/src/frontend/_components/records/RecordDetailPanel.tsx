import { prompts } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ColumnSpec, DocumentTemplateSummary } from "../../../contracts";
import type { Field, GridRecord } from "../../../service";
import { isUserEditable } from "../fields/field-prompt-schema";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceRecordDetail } from "../workspace/workspace-state-model";
import RecordDocumentsSection from "./RecordDocumentsSection";
import RecordFileField from "./RecordFileField";
import RecordHistorySection from "./RecordHistorySection";
import RecordReadView from "./RecordReadView";
import { openRecordUpsertDialog } from "./RecordUpsertDialog";
import { recordDisplayTitle } from "./record-display";

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
  detail: () => WorkspaceRecordDetail | null;
  documentTemplates: DocumentTemplateSummary[];
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
          scrollPreserveKey={`grids-record-detail-${props.tableId}-${rec.id}`}
          renderFileField={(field, record) => (
            <RecordFileField
              tableId={props.tableId}
              recordId={record.id}
              field={field}
              canWrite={props.canWrite && mode() === "live"}
              initialFiles={props.detail()?.filesByField[field.id] ?? []}
            />
          )}
          headerActions={
            <>
              <Show when={props.canWrite && mode() === "live"}>
                <button type="button" class="icon-btn" aria-label="Edit record" title="Edit record" onClick={() => handleEdit(rec)}>
                  <i class="ti ti-pencil" />
                </button>
                <button
                  type="button"
                  class="icon-btn text-dimmed hover:text-red-500"
                  aria-label="Delete record"
                  title="Delete record"
                  onClick={() => handleDelete(rec)}
                  disabled={deleteMut.loading()}
                >
                  <i class="ti ti-trash" />
                </button>
              </Show>
              <Show when={props.canWrite && mode() === "trash"}>
                <button
                  type="button"
                  class="icon-btn text-dimmed hover:text-emerald-600"
                  aria-label="Restore record"
                  title="Restore record"
                  onClick={() => handleRestore(rec)}
                  disabled={restoreMut.loading()}
                >
                  <i class="ti ti-arrow-back-up" />
                </button>
              </Show>
              <button type="button" class="icon-btn" aria-label="Close detail panel" title="Close detail" onClick={() => props.onClose()}>
                <i class="ti ti-x" />
              </button>
            </>
          }
        >
          <RecordDocumentsSection
            tableId={props.tableId}
            recordId={rec.id}
            live={mode() === "live"}
            templates={props.documentTemplates}
            initialRuns={props.detail()?.documentRuns ?? []}
            initialSnapshots={props.detail()?.snapshots ?? []}
          />
          <RecordHistorySection entries={props.detail()?.auditEntries ?? []} />
        </RecordReadView>
      )}
    </Show>
  );
}
