import { For, createSignal, Show } from "solid-js";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Field } from "../../service";

type Props = {
  tableId: string;
  initialFields: Field[];
  /** True if the user is admin on this table (gates write actions). */
  canManage: boolean;
};

const TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "decimal", label: "Decimal (money-safe)" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "single-select", label: "Single select" },
  { value: "multi-select", label: "Multi select" },
  { value: "rating", label: "Rating" },
  { value: "autonumber", label: "Auto-number" },
];

const niceTypeLabel = (t: string): string =>
  TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;

const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const data = (await res.json()) as { message?: string };
    if (typeof data.message === "string" && data.message.length > 0) return data.message;
  } catch {}
  return fallback;
};

export default function FieldsManager(props: Props) {
  const [fields, setFields] = createSignal(props.initialFields);

  const createMutation = mutations.create<Field, { name: string; type: string }>({
    mutation: async (input) => {
      const res = await apiClient.fields["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: { name: input.name, type: input.type },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create field"));
      return (await res.json()) as Field;
    },
    onSuccess: (field) => {
      setFields([...fields(), field]);
      // SSR rerender so the table renders the new column.
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  const handleAdd = async () => {
    const result = await prompts.form({
      title: "Add field",
      icon: "ti ti-plus",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. Status" },
        type: {
          type: "select",
          label: "Type",
          options: TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label })),
          required: true,
        },
      },
      confirmText: "Create",
    });
    if (!result) return;
    createMutation.mutate({ name: String(result.name).trim(), type: String(result.type) });
  };

  const handleDelete = async (field: Field) => {
    // Pre-flight: surface any blocking dependents.
    const depsRes = await apiClient.fields[":fieldId"].dependents.$get({
      param: { fieldId: field.id },
    });
    if (!depsRes.ok) {
      prompts.error("Could not check field dependents");
      return;
    }
    const deps = (await depsRes.json()) as {
      dependents: Array<{ type: string; resourceName: string; blocking: boolean }>;
      hasBlocking: boolean;
    };
    if (deps.hasBlocking) {
      const blockers = deps.dependents
        .filter((d) => d.blocking)
        .map((d) => `• ${d.type}: ${d.resourceName}`)
        .join("\n");
      prompts.error(`Cannot delete — remove these references first:\n\n${blockers}`);
      return;
    }

    const message = deps.dependents.length > 0
      ? `${deps.dependents.length} non-blocking reference(s) will be auto-cleaned (views, forms).`
      : "This soft-deletes the field. Records keep their data; the column is hidden from the UI.";
    const confirmed = await prompts.confirm(message, {
      title: `Delete field "${field.name}"?`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;

    const res = await apiClient.fields[":fieldId"].$delete({ param: { fieldId: field.id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to delete field"));
      return;
    }
    setFields(fields().filter((f) => f.id !== field.id));
    refreshCurrentPath();
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs uppercase tracking-wide text-dimmed">Fields</span>
        <Show when={props.canManage}>
          <button
            type="button"
            class="btn-simple btn-sm text-xs"
            onClick={handleAdd}
            disabled={createMutation.loading()}
            title="Add field"
          >
            <Show when={createMutation.loading()} fallback={<i class="ti ti-plus" />}>
              <i class="ti ti-loader-2 animate-spin" />
            </Show>
          </button>
        </Show>
      </div>
      <ul class="flex flex-col gap-0.5">
        <For each={fields()}>
          {(field) => (
            <li class="group flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span class="flex items-baseline gap-2 min-w-0">
                <span class="truncate text-primary">{field.name}</span>
                <span class="text-[10px] text-dimmed">{niceTypeLabel(field.type)}</span>
              </span>
              <Show when={props.canManage}>
                <button
                  type="button"
                  class="opacity-0 group-hover:opacity-100 text-xs text-dimmed hover:text-red-500 transition-opacity"
                  onClick={() => handleDelete(field)}
                  title="Delete field"
                >
                  <i class="ti ti-trash" />
                </button>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
