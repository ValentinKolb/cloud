import { prompts } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ColumnSpec, DocumentTemplateSummary, RecordMutationAudit, TableAuditPolicy } from "../../../contracts";
import { recordAuditRequirementFor } from "../../../record-audit-policy";
import type { Field, GridRecord } from "../../../service";
import { isUserEditable } from "../fields/field-prompt-schema";
import { errorMessage } from "../utils/api-helpers";
import type { WorkspaceRecordDetail } from "../workspace/workspace-state-model";
import { openRecordAuditDialog } from "./RecordAuditDialog";
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
  auditPolicy: TableAuditPolicy;
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
  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(props.dateConfig?.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: props.dateConfig?.timeZone,
    }).format(new Date(value));

  // ---- Mutations ---------------------------------------------------------
  const updateMut = mutations.create<GridRecord, { rec: GridRecord; payload: Record<string, unknown>; audit?: RecordMutationAudit }>({
    mutation: async ({ rec, payload, audit }) => {
      const res = await apiClient.records[":tableId"][":recordId"].$patch(
        {
          param: { tableId: props.tableId, recordId: rec.id },
          json: { values: payload, audit },
        },
        { headers: { "If-Match": String(rec.version) } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update record"));
      return res.json();
    },
    onSuccess: (updated) => props.onUpdated(updated),
    onError: (e) => prompts.error(e.message),
  });

  const deleteMut = mutations.create<string, { rec: GridRecord; audit?: RecordMutationAudit }>({
    mutation: async ({ rec, audit }) => {
      const res = await apiClient.records[":tableId"][":recordId"].trash.$post({
        param: { tableId: props.tableId, recordId: rec.id },
        json: { audit },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete record"));
      return rec.id;
    },
    onSuccess: () => props.onRemoved(),
    onError: (e) => prompts.error(e.message),
  });

  const restoreMut = mutations.create<string, { rec: GridRecord; audit?: RecordMutationAudit }>({
    mutation: async ({ rec, audit }) => {
      const res = await apiClient.records[":tableId"][":recordId"].restore.$post({
        param: { tableId: props.tableId, recordId: rec.id },
        json: { audit },
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
    let audit: RecordMutationAudit | undefined;
    const result = await openRecordUpsertDialog({
      mode: "edit",
      fields: visibleFields(),
      baseId: props.baseId,
      tableName: props.tableName,
      record: rec,
      relationLabels: props.relationLabels,
      dateConfig: props.dateConfig,
      beforeSubmit: async (payload) => {
        const changedFieldIds = Object.keys(payload).filter(
          (fieldId) => JSON.stringify(payload[fieldId]) !== JSON.stringify(rec.data[fieldId]),
        );
        const requirement = recordAuditRequirementFor(props.auditPolicy, "update", changedFieldIds);
        if (!requirement) {
          audit = undefined;
          return true;
        }
        const answer = await openRecordAuditDialog({
          operation: "update",
          requirement,
          recordTitle: recordDisplayTitle({
            fields: props.fields,
            record: rec,
            fieldsByTable: props.fieldsByTable,
            relationLabels: props.relationLabels,
            dateConfig: props.dateConfig,
            viewColumns: props.viewColumns,
          }),
        });
        if (!answer) return false;
        audit = answer;
        return true;
      },
    });
    if (!result) return;
    updateMut.mutate({ rec, payload: result, audit });
  };

  const handleDelete = async (rec: GridRecord) => {
    const title = recordDisplayTitle({
      fields: props.fields,
      record: rec,
      fieldsByTable: props.fieldsByTable,
      relationLabels: props.relationLabels,
      dateConfig: props.dateConfig,
      viewColumns: props.viewColumns,
    });
    const requirement = recordAuditRequirementFor(props.auditPolicy, "delete");
    const audit = requirement ? await openRecordAuditDialog({ operation: "delete", requirement, recordTitle: title }) : undefined;
    if (requirement && !audit) return;
    if (
      !requirement &&
      !(await prompts.confirm(`${title}\n${props.tableName}\n\nThis record is moved to trash and can be restored.`, {
        title: "Move record to trash?",
        variant: "danger",
        confirmText: "Move to trash",
      }))
    ) {
      return;
    }
    deleteMut.mutate({ rec, audit: audit ?? undefined });
  };

  const handleRestore = async (rec: GridRecord) => {
    const requirement = recordAuditRequirementFor(props.auditPolicy, "restore");
    const audit = requirement
      ? await openRecordAuditDialog({
          operation: "restore",
          requirement,
          recordTitle: recordDisplayTitle({
            fields: props.fields,
            record: rec,
            fieldsByTable: props.fieldsByTable,
            relationLabels: props.relationLabels,
            dateConfig: props.dateConfig,
            viewColumns: props.viewColumns,
          }),
        })
      : undefined;
    if (requirement && !audit) return;
    restoreMut.mutate({ rec, audit: audit ?? undefined });
  };

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
          <Show when={props.detail()?.combinedOrigin}>
            {(origin) => (
              <section class="detail-section flex flex-col gap-2">
                <h3 class="detail-section-label mb-0">Combined source</h3>
                <dl class="grid grid-cols-[minmax(6rem,0.42fr)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  <dt class="text-xs text-dimmed">Published from</dt>
                  <dd class="min-w-0 break-words text-primary">
                    {origin().source.baseName} · {origin().source.tableName}
                  </dd>
                  <Show when={origin().deletedAt}>
                    {(deletedAt) => (
                      <>
                        <dt class="text-xs text-dimmed">Deleted</dt>
                        <dd class="text-primary">
                          <time dateTime={deletedAt()}>{formatDateTime(deletedAt())}</time>
                        </dd>
                      </>
                    )}
                  </Show>
                  <dt class="text-xs text-dimmed">Access</dt>
                  <dd class="text-secondary">Read-only publication. Restore or edit this record in its source table.</dd>
                </dl>
              </section>
            )}
          </Show>
          <RecordDocumentsSection
            tableId={props.tableId}
            recordId={rec.id}
            live={mode() === "live"}
            templates={props.documentTemplates}
            initialRuns={props.detail()?.documentRuns ?? []}
            initialSnapshots={props.detail()?.snapshots ?? []}
          />
          <RecordHistorySection entries={props.detail()?.auditEntries ?? []} fields={props.fields} />
        </RecordReadView>
      )}
    </Show>
  );
}
