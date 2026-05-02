import { For, Show, createSignal } from "solid-js";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Field, Form } from "../../service";
import { errorMessage } from "./api-helpers";

type Props = {
  tableId: string;
  fields: Field[];
  initialForms: Form[];
  canManage: boolean;
};

const userInputableTypes = (fields: Field[]): Field[] =>
  fields.filter(
    (f) =>
      !f.deletedAt &&
      ["text", "longtext", "number", "decimal", "rating", "boolean", "date", "single-select", "multi-select"].includes(
        f.type,
      ),
  );

/**
 * Sidebar widget that lists custom forms for a table and lets table-admins
 * create, edit (toggle public, rename), and delete them. Each form's
 * public URL is exposed with a copy-button when the form has a token.
 *
 * Phase 3b scope is intentionally narrow: forms reuse all eligible fields
 * (no per-field opt-out yet). That UI lands in Phase 3 polish — the data
 * model already supports it.
 */
export default function FormsManager(props: Props) {
  const [forms, setForms] = createSignal(props.initialForms);

  const createMutation = mutations.create<Form, { name: string; isPublic: boolean }>({
    mutation: async (input) => {
      // Default config = every eligible field, in declared order.
      const config = {
        title: input.name,
        fields: userInputableTypes(props.fields).map((f) => ({ fieldId: f.id, required: f.required })),
        submitLabel: "Save",
        successMessage: "Saved",
      };
      const res = await apiClient.forms["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: { name: input.name, config, isPublic: input.isPublic },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create form"));
      return (await res.json()) as Form;
    },
    onSuccess: (form) => {
      setForms([...forms(), form]);
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  const togglePublicMutation = mutations.create<Form, { id: string; isPublic: boolean }>({
    mutation: async (input) => {
      const res = await apiClient.forms[":formId"].$patch({
        param: { formId: input.id },
        json: { isPublic: input.isPublic },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to toggle public"));
      return (await res.json()) as Form;
    },
    onSuccess: (updated) => setForms(forms().map((f) => (f.id === updated.id ? updated : f))),
    onError: (e) => prompts.error(e.message),
  });

  const deleteMutation = mutations.create<string, string>({
    mutation: async (formId) => {
      const res = await apiClient.forms[":formId"].$delete({ param: { formId } });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete form"));
      return formId;
    },
    onSuccess: (formId) => setForms(forms().filter((f) => f.id !== formId)),
    onError: (e) => prompts.error(e.message),
  });

  const handleCreate = async () => {
    const result = await prompts.form({
      title: "New form",
      icon: "ti ti-forms",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. Contact request" },
        isPublic: { type: "boolean", label: "Make form public (shareable URL, anonymous submit)" },
      },
      confirmText: "Create",
    });
    if (!result) return;
    createMutation.mutate({ name: String(result.name).trim(), isPublic: Boolean(result.isPublic) });
  };

  const handleCopyPublicUrl = async (form: Form) => {
    if (!form.publicToken) return;
    const url = `${window.location.origin}/public/grids/forms/${form.publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
      prompts.alert(`Copied URL:\n${url}`, { title: "Public URL", icon: "ti ti-link" });
    } catch {
      prompts.alert(url, { title: "Public URL", icon: "ti ti-link" });
    }
  };

  const handleDelete = async (form: Form) => {
    const confirmed = await prompts.confirm(
      `Delete form "${form.name}"? Submissions already saved as records remain.`,
      { title: "Delete form?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteMutation.mutate(form.id);
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs uppercase tracking-wide text-dimmed">Forms</span>
        <Show when={props.canManage}>
          <button
            type="button"
            class="btn-simple btn-sm text-xs"
            onClick={handleCreate}
            disabled={createMutation.loading()}
            title="Create form"
          >
            <Show when={createMutation.loading()} fallback={<i class="ti ti-plus" />}>
              <i class="ti ti-loader-2 animate-spin" />
            </Show>
          </button>
        </Show>
      </div>
      <Show
        when={forms().length > 0}
        fallback={<div class="text-xs text-dimmed px-2 py-1.5">No custom forms yet.</div>}
      >
        <ul class="flex flex-col gap-0.5">
          <For each={forms()}>
            {(form) => (
              <li class="group flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <span class="flex-1 min-w-0 flex items-center gap-1.5">
                  <i class={`text-xs ${form.publicToken ? "ti ti-world" : "ti ti-lock"} text-dimmed`} />
                  <span class="truncate text-primary">{form.name}</span>
                </span>
                <Show when={props.canManage}>
                  <Show when={form.publicToken}>
                    <button
                      type="button"
                      class="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-dimmed hover:text-primary"
                      onClick={() => handleCopyPublicUrl(form)}
                      title="Copy public URL"
                    >
                      <i class="ti ti-copy" />
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-dimmed hover:text-primary"
                    onClick={() => togglePublicMutation.mutate({ id: form.id, isPublic: !form.publicToken })}
                    title={form.publicToken ? "Disable public access" : "Enable public access"}
                    disabled={togglePublicMutation.loading()}
                  >
                    <i class={form.publicToken ? "ti ti-world-off" : "ti ti-world"} />
                  </button>
                  <button
                    type="button"
                    class="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-dimmed hover:text-red-500"
                    onClick={() => handleDelete(form)}
                    title="Delete form"
                  >
                    <i class="ti ti-trash" />
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
