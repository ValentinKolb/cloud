import { For, createSignal, Show } from "solid-js";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Field } from "../../service";
import { errorMessage } from "./api-helpers";
import { collectConfigForType, typeNeedsConfig } from "./field-config";

type Props = {
  tableId: string;
  initialFields: Field[];
  /** True if the user is admin on this table (gates write actions). */
  canManage: boolean;
};

const TYPE_OPTIONS = [
  // Tier 1
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
  // Tier 2 — text/number subtypes with built-in validation
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
  { value: "phone", label: "Phone" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
  { value: "duration", label: "Duration" },
  { value: "slug", label: "Slug" },
  // Tier 3 — specialised
  { value: "barcode", label: "Barcode / QR" },
  { value: "isbn", label: "ISBN" },
  { value: "color", label: "Color" },
  { value: "rich-text", label: "Rich text (markdown)" },
  { value: "json", label: "JSON" },
  { value: "signature", label: "Signature" },
  { value: "location", label: "Location" },
];

// Nice labels for every type currently supported on the platform.
const TYPE_LABELS: Record<string, string> = {
  // Tier 1
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
  // Tier 2
  email: "Email",
  url: "URL",
  phone: "Phone",
  currency: "Currency",
  percent: "Percent",
  duration: "Duration",
  slug: "Slug",
  // Tier 3
  barcode: "Barcode",
  isbn: "ISBN",
  location: "Location",
  color: "Color",
  "rich-text": "Rich text",
  json: "JSON",
  signature: "Signature",
};

const niceTypeLabel = (t: string): string => TYPE_LABELS[t] ?? t;


export default function FieldsManager(props: Props) {
  const [fields, setFields] = createSignal(props.initialFields);

  const createMutation = mutations.create<
    Field,
    { name: string; type: string; config: Record<string, unknown> }
  >({
    mutation: async (input) => {
      const res = await apiClient.fields["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: { name: input.name, type: input.type, config: input.config },
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
      confirmText: "Continue",
    });
    if (!result) return;
    const name = String(result.name).trim();
    const type = String(result.type);
    // Two-step: types that need config open a per-type config dialog
    // before we POST. Cancelling the config dialog cancels the create.
    const config = await collectConfigForType(type);
    if (config === null) return;
    createMutation.mutate({ name, type, config });
  };

  const updateMutation = mutations.create<
    Field,
    { id: string; name?: string; config?: Record<string, unknown> }
  >({
    mutation: async (input) => {
      const res = await apiClient.fields[":fieldId"].$patch({
        param: { fieldId: input.id },
        json: { name: input.name, config: input.config },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update field"));
      return (await res.json()) as Field;
    },
    onSuccess: (updated) => {
      setFields(fields().map((f) => (f.id === updated.id ? updated : f)));
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  const handleEditConfig = async (field: Field) => {
    const next = await collectConfigForType(field.type, field.config);
    if (next === null) return;
    updateMutation.mutate({ id: field.id, config: next });
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
                  <Show when={typeNeedsConfig(field.type)}>
                    <button
                      type="button"
                      class="text-xs text-dimmed hover:text-primary"
                      onClick={() => handleEditConfig(field)}
                      title="Edit config"
                    >
                      <i class="ti ti-settings" />
                    </button>
                  </Show>
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
