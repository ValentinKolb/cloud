import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import { CopyButton, Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, Form } from "../../../service";
import type { FormConfig } from "../../../service/forms";
import { isRecordInputField } from "../fields/field-render";
import { errorMessage } from "../utils/api-helpers";
import { openFormEditorDialog } from "./FormEditorDialog";

export { openFormEditorDialog } from "./FormEditorDialog";

const canBeFormInput = (field: Field) => isRecordInputField(field.type);

const publicFormUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/share/grids/forms/${token}`;

type Props = {
  tableId: string;
  /** All fields on this table — drives the "Add field" picker and the
   *  rendered field rows inside each form. */
  fields: Field[];
  initialForms: Form[];
  canManage: boolean;
  onFormsChanged?: (forms: Form[]) => void;
  /** Pre-fetched ACL entries for each form, keyed by form id. The
   *  PermissionEditor inside the per-form expanded body uses
   *  `allowedLevels=["write"]` so it renders as inline badges (no
   *  dropdown) — read/admin on a form are rejected by the API. */
  initialFormAccessEntries?: Record<string, AccessEntry[]>;
};

/**
 * Form builder. Mirrors the field-editor card pattern: every form
 * collapses to a one-line summary; clicking expands it for full edit.
 * Each form's expanded body has three sub-sections — General (name +
 * public toggle), Submission (submit label + success message), Fields
 * (which table-fields appear, with per-row label/help/required overrides
 * and a + picker for fields not yet included).
 *
 * Default form (`default-<tableId>`) is virtual server-side and not
 * persisted; we filter it out of the editor list — users edit real
 * forms here, the default is always available regardless.
 */
export default function FormsManager(props: Props) {
  const [forms, setForms] = createSignal<Form[]>(props.initialForms.filter((f) => !f.isDefault));

  const updateForms = (next: Form[]) => {
    setForms(next);
    props.onFormsChanged?.(next);
  };

  /**
   * Open the form editor inside a centered modal. Previously each form
   * expanded inline below its row; with several forms the page grew to
   * multiple screens. The modal keeps the row list compact and gives
   * the editor a fixed viewport — same UX as the field editor.
   */
  const openFormEditor = (form: Form) =>
    openFormEditorDialog({
      form,
      tableFields: props.fields,
      initialAccessEntries: props.initialFormAccessEntries?.[form.id] ?? [],
      canManageAccess: props.canManage,
      onSaved: (next) => updateForms(forms().map((f) => (f.id === next.id ? next : f))),
      onDelete: () => handleDelete(form),
    });

  // ---- Create ----------------------------------------------------------
  const handleCreate = async () => {
    const result = await prompts.form({
      title: "New form",
      icon: "ti ti-forms",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. Public sign-up" },
      },
      confirmText: "Create",
    });
    if (!result) return;

    const eligibleFields = props.fields.filter((f) => !f.deletedAt && canBeFormInput(f));
    // Default config = include every editable field, in declared order.
    const config: FormConfig = {
      fields: eligibleFields.map((f) => ({
        kind: "user_input" as const,
        fieldId: f.id,
        required: f.required,
      })),
    };
    const res = await apiClient.forms["by-table"][":tableId"].$post({
      param: { tableId: props.tableId },
      json: { name: String(result.name).trim(), config, isPublic: false },
    });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to create form"));
      return;
    }
    const created = await res.json();
    updateForms([...forms(), created]);
    // Open the editor modal immediately so the user can configure the
    // newly created form. Mirrors the pre-modal auto-expand behaviour.
    openFormEditor(created);
  };

  // ---- Delete ----------------------------------------------------------
  const handleDelete = async (form: Form) => {
    const confirmed = await prompts.confirm(`Delete form "${form.name}"? Submissions already saved as records remain.`, {
      title: "Delete form?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    const res = await apiClient.forms[":formId"].$delete({ param: { formId: form.id } });
    if (res.status >= 400) {
      prompts.error(await errorMessage(res, "Failed to delete form"));
      return;
    }
    updateForms(forms().filter((f) => f.id !== form.id));
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <Show
        when={forms().length > 0}
        fallback={
          <Placeholder surface="paper" align="left">
            No custom forms yet.
          </Placeholder>
        }
      >
        <ul class="flex flex-col gap-2">
          <For each={forms()}>
            {(form) => (
              <li class="group paper transition-colors hover:paper-highlighted">
                <div class="flex min-h-12 items-center gap-2 px-3 py-2">
                  <span class="flex w-6 shrink-0 items-center justify-center">
                    <i
                      class={`ti ${form.publicToken ? "ti-world" : "ti-lock"} text-sm ${form.publicToken ? "text-emerald-600" : "text-dimmed"}`}
                    />
                  </span>
                  <button
                    type="button"
                    class="focus-ui flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => openFormEditor(form)}
                    aria-label={`Edit form ${form.name}`}
                  >
                    <span class="flex min-w-0 flex-1 items-baseline gap-2">
                      <span class="text-sm font-semibold text-primary truncate">{form.name}</span>
                      <span class="text-[10px] text-dimmed">
                        {form.config.fields.length} field
                        {form.config.fields.length === 1 ? "" : "s"}
                      </span>
                      <span class="text-[10px] text-dimmed">· {form.publicToken ? "public" : "private"}</span>
                    </span>
                  </button>
                  <div class="flex shrink-0 items-center gap-0">
                    <Show when={form.publicToken}>{(token) => <CopyButton text={publicFormUrl(token())} class="icon-btn" />}</Show>
                    <button
                      type="button"
                      class="icon-btn"
                      onClick={() => openFormEditor(form)}
                      title="Edit form"
                      aria-label={`Edit form ${form.name}`}
                    >
                      <i class="ti ti-pencil" />
                    </button>
                  </div>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={props.canManage}>
        <button type="button" class="btn-input-success btn-input-sm self-start" onClick={handleCreate}>
          <i class="ti ti-plus" /> New form
        </button>
      </Show>
    </div>
  );
}
