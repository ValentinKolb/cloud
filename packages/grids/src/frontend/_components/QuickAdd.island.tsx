import { Show } from "solid-js";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Field, GridRecord } from "../../service";
import { fieldToPromptSchema, isUserEditable, sanitizePayload } from "./field-prompt-schema";

type Props = {
  tableId: string;
  fields: Field[];
  canWrite: boolean;
};

const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const data = (await res.json()) as { message?: string };
    if (typeof data.message === "string" && data.message.length > 0) return data.message;
  } catch {}
  return fallback;
};

export default function QuickAdd(props: Props) {
  const createMutation = mutations.create<GridRecord, Record<string, unknown>>({
    mutation: async (payload) => {
      const res = await apiClient.records["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: payload,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create record"));
      return (await res.json()) as GridRecord;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const handleClick = async () => {
    const usableFields = props.fields.filter((f) => !f.deletedAt && isUserEditable(f.type));

    if (usableFields.length === 0) {
      prompts.error("This table has no editable fields. Add at least one field first.");
      return;
    }

    const formFields: Record<string, any> = {};
    for (const field of usableFields) {
      const schema = fieldToPromptSchema(field);
      if (schema) formFields[field.id] = schema;
    }

    const result = await prompts.form({
      title: "New record",
      icon: "ti ti-row-insert-bottom",
      fields: formFields,
      confirmText: "Create",
    });
    if (!result) return;
    createMutation.mutate(sanitizePayload(result));
  };

  return (
    <Show when={props.canWrite}>
      <button
        type="button"
        class="btn-primary btn-sm"
        onClick={handleClick}
        disabled={createMutation.loading()}
        title="Add a new record"
      >
        <Show when={createMutation.loading()} fallback={<i class="ti ti-plus" />}>
          <i class="ti ti-loader-2 animate-spin" />
        </Show>
        Add row
      </button>
    </Show>
  );
}
