import type { DateContext } from "@k2b/stdlib";
import { Button, prompts } from "@k2b/ui";
import { createSignal, Show } from "solid-js";
import type { RecordMutationAudit, TableAuditPolicy } from "../../contracts";
import type { CustomAppBlock } from "../../custom-apps/contracts";
import { recordAuditRequirementFor } from "../../record-audit-policy";
import type { Field, GridRecord } from "../../service";
import { formatFieldValueText } from "../_components/table/field-value-format";
import { openRecordAuditDialog } from "../_components/records/RecordAuditDialog";
import { openRecordUpsertDialog } from "../_components/records/RecordUpsertDialog";

type RecordBlock = Extract<CustomAppBlock, { type: "record" }>;

const responseMessage = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || fallback;
};

export default function RecordDetails(props: {
  block: RecordBlock;
  baseId: string;
  tableName: string;
  auditPolicy: TableAuditPolicy;
  record: GridRecord;
  fields: Field[];
  relationLabels: Record<string, string>;
  updateEndpoint?: string;
  dateConfig: DateContext;
}) {
  const [record, setRecord] = createSignal(props.record);
  const [saving, setSaving] = createSignal(false);
  const fieldsById = new Map(props.fields.map((field) => [field.id, field]));
  const displayedFields = props.block.fieldIds.map((fieldId) => fieldsById.get(fieldId)).filter((field): field is Field => Boolean(field));
  const editableFields = props.block.editableFieldIds
    .map((fieldId) => fieldsById.get(fieldId))
    .filter((field): field is Field => Boolean(field));

  const edit = async () => {
    if (!props.updateEndpoint || saving()) return;
    let audit: RecordMutationAudit | undefined;
    const current = record();
    const values = await openRecordUpsertDialog({
      mode: "edit",
      fields: editableFields,
      baseId: props.baseId,
      tableName: props.tableName,
      record: current,
      relationLabels: props.relationLabels,
      dateConfig: props.dateConfig,
      beforeSubmit: async (payload) => {
        const changedFieldIds = Object.keys(payload).filter(
          (fieldId) => JSON.stringify(payload[fieldId]) !== JSON.stringify(current.data[fieldId]),
        );
        const requirement = recordAuditRequirementFor(props.auditPolicy, "update", changedFieldIds);
        if (!requirement) return true;
        const answer = await openRecordAuditDialog({
          operation: "update",
          requirement,
          recordTitle: props.block.title ?? props.tableName,
        });
        if (!answer) return false;
        audit = answer;
        return true;
      },
    });
    if (!values) return;

    setSaving(true);
    try {
      const response = await fetch(props.updateEndpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json", "If-Match": String(current.version) },
        body: JSON.stringify({ values, audit }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Failed to update record"));
      setRecord((await response.json()) as GridRecord);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to update record");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="flex flex-col gap-3">
      <Show when={props.updateEndpoint && editableFields.length > 0}>
        <div class="flex justify-end">
          <Button variant="secondary" size="sm" disabled={saving()} onClick={() => void edit()}>
            <i class="ti ti-pencil" aria-hidden="true" />
            Edit
          </Button>
        </div>
      </Show>
      <dl class="divide-y rounded-xl border">
        {displayedFields.map((field) => (
          <div class="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)] sm:gap-4">
            <dt class="text-sm font-medium text-secondary">{field.name}</dt>
            <dd class="min-w-0 whitespace-pre-wrap break-words text-sm text-primary">
              {formatFieldValueText({
                field,
                value: record().data[field.id],
                record: record(),
                relationLabels: props.relationLabels,
                dateConfig: props.dateConfig,
              }) || "—"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
