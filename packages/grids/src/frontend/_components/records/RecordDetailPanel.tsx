import type { DateContext } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, DescriptionList, DetailPanel, Dropdown, IconButton, prompts, Tooltip } from "@k2b/ui";
import { Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { PublicField as Field, PublicGridRecord as GridRecord } from "../../../api/public-dto";
import type { ColumnSpec, RecordMutationAudit, TableAuditPolicy } from "../../../contracts";
import { recordAuditRequirementFor } from "../../../record-audit-policy";
import type { PublicDocumentTemplateSummary } from "../documents/public-document-types";
import { isUserEditable } from "../fields/field-prompt-schema";
import { errorMessage } from "../utils/api-helpers";
import type { PublicWorkspaceRecordDetail as WorkspaceRecordDetail } from "../workspace/workspace-public-state-model";
import { openRecordAuditDialog } from "./RecordAuditDialog";
import RecordComments from "./RecordComments.island";
import RecordDocumentsSection from "./RecordDocumentsSection";
import RecordFileField from "./RecordFileField";
import RecordHistorySection from "./RecordHistorySection";
import RecordReadView from "./RecordReadView";
import RecordReferencedBy from "./RecordReferencedBy.island";
import { openRecordUpsertDialog } from "./RecordUpsertDialog";
import { recordDisplayTitle } from "./record-display";

type Props = {
  baseId: string;
  tableId: string;
  tableName: string;
  fields: Field[];
  auditPolicy: TableAuditPolicy;
  /** Currently-displayed record. Controlled by RecordsView — when the
   *  user clicks a different row in the grid, the parent passes a new
   *  record here. null = panel renders nothing. */
  record: () => GridRecord | null;
  detail: () => WorkspaceRecordDetail | null;
  documentTemplates: PublicDocumentTemplateSummary[];
  /** "live" = edit/delete; "trash" = restore. Driven by the URL state's
   *  trash flag, lifted up to the parent. */
  mode: () => "live" | "trash";
  /** True if the user can edit/delete records on this table. */
  canWrite: boolean;
  /** Pre-resolved labels for linked records (target id → display label).
   *  Built SSR-side; used by relation cells to render presentable
   *  values instead of raw UUIDs. */
  relationLabels?: Record<string, string>;
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
    if (deleteMut.loading()) return;
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
    if (restoreMut.loading()) return;
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
          baseId={props.baseId}
          tableId={props.tableId}
          tableName={props.tableName}
          fields={props.fields}
          record={rec}
          mode={mode()}
          relationLabels={props.relationLabels}
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
                <Dropdown.Root
                  position="bottom-left"
                  items={[
                    {
                      sectionLabel: "Danger zone",
                      items: [
                        {
                          label: "Move to trash",
                          icon: "ti ti-trash",
                          variant: "danger",
                          action: () => handleDelete(rec),
                        },
                      ],
                    },
                  ]}
                >
                  <Dropdown.Trigger
                    iconOnly
                    variant="ghost"
                    size="sm"
                    type="button"
                    label="More record actions"
                    disabled={deleteMut.loading()}
                    tooltip="More record actions"
                  >
                    <i class={deleteMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-dots"} />
                  </Dropdown.Trigger>
                </Dropdown.Root>
              </Show>
              <Tooltip.Anchor content="Close details">
                <IconButton variant="ghost" size="sm" type="button" label="Close detail panel" onClick={() => props.onClose()}>
                  <i class="ti ti-x" />
                </IconButton>
              </Tooltip.Anchor>
            </>
          }
          quickActions={
            <>
              <Show when={props.canWrite && mode() === "live"}>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  aria-label="Edit record"
                  onClick={() => handleEdit(rec)}
                  disabled={updateMut.loading()}
                >
                  <i class="ti ti-pencil" /> Edit
                </Button>
              </Show>
              <Show when={props.canWrite && mode() === "trash"}>
                <Button variant="secondary" size="sm" type="button" onClick={() => handleRestore(rec)} disabled={restoreMut.loading()}>
                  <i class="ti ti-arrow-back-up" /> Restore
                </Button>
              </Show>
            </>
          }
          relationsAfter={
            <Show when={mode() === "live" && props.detail() && !props.detail()?.combinedOrigin}>
              <RecordReferencedBy baseId={props.baseId} tableId={props.tableId} recordId={rec.id} />
            </Show>
          }
        >
          <Show when={props.detail()?.combinedOrigin}>
            {(origin) => (
              <DetailPanel.Section title="Combined source" icon="ti ti-stack-2" tone="neutral">
                <DescriptionList
                  layout="rows"
                  size="sm"
                  items={[
                    {
                      term: "Published from",
                      description: `${origin().source.baseName} · ${origin().source.tableName}`,
                    },
                    ...(origin().deletedAt
                      ? [
                          {
                            term: "Deleted",
                            description: <time dateTime={origin().deletedAt!}>{formatDateTime(origin().deletedAt!)}</time>,
                          },
                        ]
                      : []),
                    {
                      term: "Access",
                      description: "Read-only publication. Restore or edit this record in its source table.",
                    },
                  ]}
                />
              </DetailPanel.Section>
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
          <Show when={mode() === "live"}>
            <RecordComments
              endpoint={`/api/grids/records/${encodeURIComponent(props.tableId)}/${encodeURIComponent(rec.id)}/comments`}
              dateConfig={props.dateConfig}
            />
          </Show>
          <RecordHistorySection entries={props.detail()?.auditEntries ?? []} fields={props.fields} dateConfig={props.dateConfig} />
        </RecordReadView>
      )}
    </Show>
  );
}
