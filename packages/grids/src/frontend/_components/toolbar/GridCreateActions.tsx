import { Dropdown, prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, Form, GridRecord } from "../../../service";
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
  onRecordCreated?: (record: GridRecord) => void;
  onRecordsChanged?: () => void;
  dateConfig?: DateContext;
};

export function GridCreateActions(props: Props) {
  const activeForms = createMemo(() => (props.forms ?? []).filter((form) => form.isActive));
  const addMutation = mutations.create<GridRecord, Record<string, unknown>>({
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
          <Show when={!props.disableDirectInsert}>
            <button type="button" class="btn-input-primary btn-input-sm" onClick={addRecord} disabled={addMutation.loading()}>
              <Show when={addMutation.loading()} fallback={<i class="ti ti-plus" />}>
                <i class="ti ti-loader-2 animate-spin" />
              </Show>
              Add record
            </button>
          </Show>
        }
      >
        <Show
          when={activeForms().length === 1 ? activeForms()[0] : undefined}
          fallback={
            <Dropdown
              position="bottom-right"
              trigger={
                <span class="btn-input-primary btn-input-sm">
                  <i class="ti ti-forms" />
                  Add with form
                  <i class="ti ti-chevron-down text-[10px] opacity-60" />
                </span>
              }
              elements={activeForms().map((form) => ({
                icon: "ti ti-forms",
                label: form.name,
                action: () => void submitForm(form),
              }))}
            />
          }
        >
          {(form) => (
            <button type="button" class="btn-input-primary btn-input-sm" onClick={() => void submitForm(form())}>
              <i class="ti ti-forms" />
              Add with form
            </button>
          )}
        </Show>
        <Show when={!props.disableDirectInsert}>
          <button type="button" class="btn-input-primary btn-input-sm" onClick={addRecord} disabled={addMutation.loading()}>
            <Show when={addMutation.loading()} fallback={<i class="ti ti-plus" />}>
              <i class="ti ti-loader-2 animate-spin" />
            </Show>
            Add record
          </button>
        </Show>
      </Show>
    </Show>
  );
}
