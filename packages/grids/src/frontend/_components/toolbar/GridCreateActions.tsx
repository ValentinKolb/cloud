import { refreshCurrentPath } from "@k2b/ssr/nav";
import type { DateContext } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, Dropdown, prompts, Tooltip } from "@k2b/ui";
import { createMemo, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { PublicField as Field, PublicForm as Form, PublicGridRecord } from "../../../api/public-dto";
import { isUserEditable } from "../fields/field-prompt-schema";
import { openFormModal } from "../records/FormSubmitModal";
import { openRecordUpsertDialog } from "../records/RecordUpsertDialog";
import { errorMessage } from "../utils/api-helpers";

type Props = {
  baseId: string;
  tableId: string;
  tableName: string;
  disableDirectInsert: boolean;
  fields: Field[];
  forms?: Form[];
  canWrite: boolean;
  canDirectWrite: boolean;
  canSubmitForms: boolean;
  onRecordCreated?: (record: PublicGridRecord) => void;
  onRecordsChanged?: () => void;
  dateConfig?: DateContext;
};

export function GridCreateActions(props: Props) {
  const activeForms = createMemo(() => (props.canSubmitForms ? (props.forms ?? []).filter((form) => form.isActive) : []));
  const blockedReason = () =>
    props.canSubmitForms
      ? "Add an active form before creating records in this table."
      : "This table does not allow changes from direct editing or forms.";
  const addMutation = mutations.create<PublicGridRecord, Record<string, unknown>>({
    mutation: async (payload) => {
      const response = await apiClient.records["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: payload,
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Failed to create record"));
      return response.json();
    },
    onSuccess: (created) => {
      if (props.onRecordCreated) props.onRecordCreated(created);
      else refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const addRecord = async () => {
    const liveFields = props.fields.filter((field) => !field.deletedAt);
    const fillable = liveFields.filter((field) => isUserEditable(field.type) || field.type === "relation");
    if (fillable.length === 0) {
      prompts.error("This table has no editable fields. Add one first.");
      return;
    }
    const result = await openRecordUpsertDialog({
      mode: "create",
      fields: liveFields,
      baseId: props.baseId,
      tableName: props.tableName,
      dateConfig: props.dateConfig,
    });
    if (result) addMutation.mutate(result);
  };

  const submitForm = (form: Form) =>
    openFormModal(form, props.fields, {
      onSubmitted: () => props.onRecordsChanged?.(),
      dateConfig: props.dateConfig,
    });

  return (
    <Show when={props.canWrite}>
      <Show
        when={activeForms().length > 0}
        fallback={
          <>
            <Show when={props.canDirectWrite && !props.disableDirectInsert}>
              <Button variant="primary" size="sm" type="button" onClick={addRecord} disabled={addMutation.loading()}>
                <Show when={addMutation.loading()} fallback={<i class="ti ti-plus" />}>
                  <i class="ti ti-loader-2 animate-spin" />
                </Show>
                Add record
              </Button>
            </Show>
            <Show when={!props.canDirectWrite}>
              <Tooltip.Anchor content={blockedReason()}>
                <Button variant="secondary" size="sm" type="button" disabled aria-label={`Add record unavailable: ${blockedReason()}`}>
                  <i class="ti ti-lock" aria-hidden="true" /> Add record
                </Button>
              </Tooltip.Anchor>
            </Show>
          </>
        }
      >
        <Show
          when={activeForms().length === 1 ? activeForms()[0] : undefined}
          fallback={
            <Dropdown.Root
              position="bottom-right"
              items={activeForms().map((form) => ({
                icon: "ti ti-forms",
                label: form.name,
                action: () => void submitForm(form),
              }))}
            >
              <Dropdown.Trigger variant="primary" size="sm">
                <i class="ti ti-forms" />
                Add with form
                <i class="ti ti-chevron-down text-[10px] opacity-60" />
              </Dropdown.Trigger>
            </Dropdown.Root>
          }
        >
          {(form) => (
            <Button variant="primary" size="sm" type="button" onClick={() => void submitForm(form())}>
              <i class="ti ti-forms" />
              Add with form
            </Button>
          )}
        </Show>
        <Show when={props.canDirectWrite && !props.disableDirectInsert}>
          <Button variant="primary" size="sm" type="button" onClick={addRecord} disabled={addMutation.loading()}>
            <Show when={addMutation.loading()} fallback={<i class="ti ti-plus" />}>
              <i class="ti ti-loader-2 animate-spin" />
            </Show>
            Add record
          </Button>
        </Show>
      </Show>
    </Show>
  );
}
