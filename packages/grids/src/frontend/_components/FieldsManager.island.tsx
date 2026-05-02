import { For, createSignal, Show } from "solid-js";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Field } from "../../service";
import { errorMessage } from "./api-helpers";

type Props = {
  tableId: string;
  initialFields: Field[];
  /** True if the user is admin on this table (gates write actions). */
  canManage: boolean;
};

// Only types whose default config is already valid are surfaced in the
// quick "+ Add field" UI. decimal needs precision/scale; single-select and
// multi-select need options; these go through a dedicated config modal in
// Phase 2 (or via the API today). Keeping them out of this dropdown
// prevents users from picking a type and getting a 400 they can't fix.
const TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "rating", label: "Rating" },
  { value: "autonumber", label: "Auto-number" },
];

// Nice labels for ALL Tier-1 types — including the ones we don't surface
// in the create dropdown but that may exist via API (decimal, selects).
const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  longtext: "Long text",
  number: "Number",
  decimal: "Decimal",
  boolean: "Boolean",
  date: "Date",
  "single-select": "Single select",
  "multi-select": "Multi select",
  rating: "Rating",
  autonumber: "Auto-number",
  created_at: "Created at",
  updated_at: "Updated at",
  created_by: "Created by",
  updated_by: "Updated by",
};

const niceTypeLabel = (t: string): string => TYPE_LABELS[t] ?? t;


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

  const renameMutation = mutations.create<Field, { id: string; name: string }>({
    mutation: async (input) => {
      const res = await apiClient.fields[":fieldId"].$patch({
        param: { fieldId: input.id },
        json: { name: input.name },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to rename field"));
      return (await res.json()) as Field;
    },
    onSuccess: (updated) => {
      setFields(fields().map((f) => (f.id === updated.id ? updated : f)));
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  const handleRename = async (field: Field) => {
    const result = await prompts.form({
      title: "Rename field",
      icon: "ti ti-edit",
      fields: { name: { type: "text", label: "Name", required: true, default: field.name } },
      confirmText: "Save",
    });
    if (!result) return;
    const next = String(result.name).trim();
    if (next === field.name) return;
    renameMutation.mutate({ id: field.id, name: next });
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
                <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    class="text-xs text-dimmed hover:text-primary"
                    onClick={() => handleRename(field)}
                    title="Rename field"
                  >
                    <i class="ti ti-edit" />
                  </button>
                  <button
                    type="button"
                    class="text-xs text-dimmed hover:text-red-500"
                    onClick={() => handleDelete(field)}
                    title="Delete field"
                  >
                    <i class="ti ti-trash" />
                  </button>
                </div>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
