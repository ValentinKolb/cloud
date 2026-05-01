import { For, Show, createSignal } from "solid-js";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Field, GridRecord } from "../../service";
import { fieldToPromptSchema, isUserEditable, sanitizePayload } from "./field-prompt-schema";

type Props = {
  tableId: string;
  fields: Field[];
  records: GridRecord[];
  canWrite: boolean;
};

const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const data = (await res.json()) as { message?: string };
    if (typeof data.message === "string" && data.message.length > 0) return data.message;
  } catch {}
  return fallback;
};

const formatCell = (value: unknown, type: string, fieldConfig?: Record<string, unknown>): string => {
  if (value === null || value === undefined || value === "") return "";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "multi-select" && Array.isArray(value)) {
    const options = (fieldConfig?.options as Array<{ id: string; label: string }> | undefined) ?? [];
    const labels = value.map((id) => options.find((o) => o.id === id)?.label ?? String(id));
    return labels.join(", ");
  }
  if (type === "single-select") {
    const options = (fieldConfig?.options as Array<{ id: string; label: string }> | undefined) ?? [];
    return options.find((o) => o.id === value)?.label ?? String(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export default function RecordsGrid(props: Props) {
  const [records, setRecords] = createSignal(props.records);

  const visibleFields = () => props.fields.filter((f) => !f.deletedAt);

  const updateMutation = mutations.create<GridRecord, { record: GridRecord; payload: Record<string, unknown> }>({
    mutation: async ({ record, payload }) => {
      // Raw fetch — the typed Hono client doesn't expose the second-arg
      // init bag in this codebase's binding, but we need If-Match for the
      // optimistic-lock contract. Server returns 409 on version mismatch.
      const res = await fetch(`/api/grids/records/${props.tableId}/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": String(record.version) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update record"));
      return (await res.json()) as GridRecord;
    },
    onSuccess: (updated) => {
      setRecords(records().map((r) => (r.id === updated.id ? updated : r)));
    },
    onError: (e) => prompts.error(e.message),
  });

  const deleteMutation = mutations.create<string, string>({
    mutation: async (recordId) => {
      const res = await apiClient.records[":tableId"][":recordId"].$delete({
        param: { tableId: props.tableId, recordId },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete record"));
      return recordId;
    },
    onSuccess: (recordId) => {
      setRecords(records().filter((r) => r.id !== recordId));
    },
    onError: (e) => prompts.error(e.message),
  });

  const handleEdit = async (record: GridRecord) => {
    const usableFields = visibleFields().filter((f) => isUserEditable(f.type));
    if (usableFields.length === 0) {
      prompts.error("No editable fields. Add a field first.");
      return;
    }
    const formFields: Record<string, any> = {};
    for (const field of usableFields) {
      const schema = fieldToPromptSchema(field, record.data[field.id]);
      if (schema) formFields[field.id] = schema;
    }
    const result = await prompts.form({
      title: "Edit record",
      icon: "ti ti-edit",
      fields: formFields,
      confirmText: "Save",
    });
    if (!result) return;
    updateMutation.mutate({ record, payload: sanitizePayload(result) });
  };

  const handleDelete = async (record: GridRecord) => {
    const confirmed = await prompts.confirm("Soft-delete this record? It can be restored from the trash.", {
      title: "Delete record?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    deleteMutation.mutate(record.id);
  };

  return (
    <Show
      when={visibleFields().length > 0}
      fallback={
        <div class="paper p-6 text-center text-sm text-dimmed">
          No fields. Add one in the sidebar to populate this table.
        </div>
      }
    >
      <div class="paper overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
            <tr>
              <For each={visibleFields()}>
                {(f) => (
                  <th class="text-left px-3 py-2 font-medium text-secondary">
                    <span class="inline-flex items-center gap-1.5">
                      {f.name}
                      <span class="text-[10px] text-dimmed font-normal">{f.type}</span>
                    </span>
                  </th>
                )}
              </For>
              <Show when={props.canWrite}>
                <th class="w-10" />
              </Show>
            </tr>
          </thead>
          <tbody>
            <Show
              when={records().length > 0}
              fallback={
                <tr>
                  <td
                    colspan={visibleFields().length + (props.canWrite ? 1 : 0)}
                    class="px-3 py-8 text-center text-dimmed text-sm"
                  >
                    No records. {props.canWrite ? "Click “Add row” above." : ""}
                  </td>
                </tr>
              }
            >
              <For each={records()}>
                {(rec) => (
                  <tr class="group border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                    <For each={visibleFields()}>
                      {(f) => (
                        <td class="px-3 py-2 text-primary">{formatCell(rec.data[f.id], f.type, f.config)}</td>
                      )}
                    </For>
                    <Show when={props.canWrite}>
                      <td class="px-2 py-1 w-10">
                        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
                            onClick={() => handleEdit(rec)}
                            title="Edit"
                          >
                            <i class="ti ti-edit" />
                          </button>
                          <button
                            type="button"
                            class="btn-simple btn-sm text-xs text-dimmed hover:text-red-500"
                            onClick={() => handleDelete(rec)}
                            title="Delete"
                          >
                            <i class="ti ti-trash" />
                          </button>
                        </div>
                      </td>
                    </Show>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>
    </Show>
  );
}
