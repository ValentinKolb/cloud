import { For, Show, createMemo, createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import { TextInput, Select, prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { Field, Form } from "../../service";
import type { FormConfig, FormFieldEntry } from "../../service/forms";
import { errorMessage } from "./api-helpers";
import { TYPE_LABELS } from "./field-config-editor";
import { isUserEditable } from "./field-prompt-schema";

type Props = {
  tableId: string;
  /** All fields on this table — drives the "Add field" picker and the
   *  rendered field rows inside each form. */
  fields: Field[];
  initialForms: Form[];
  canManage: boolean;
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
  const [forms, setForms] = createSignal<Form[]>(
    props.initialForms.filter((f) => !f.isDefault),
  );
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

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

    const eligibleFields = props.fields.filter((f) => !f.deletedAt && isUserEditable(f.type));
    // Default config = include every editable field, in declared order.
    const config: FormConfig = {
      fields: eligibleFields.map((f) => ({ fieldId: f.id, required: f.required })),
    };
    const res = await apiClient.forms["by-table"][":tableId"].$post({
      param: { tableId: props.tableId },
      json: { name: String(result.name).trim(), config, isPublic: false },
    });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to create form"));
      return;
    }
    const created = (await res.json()) as Form;
    setForms([...forms(), created]);
    setExpandedId(created.id);
    refreshCurrentPath();
  };

  // ---- Delete ----------------------------------------------------------
  const handleDelete = async (form: Form) => {
    const confirmed = await prompts.confirm(
      `Delete form "${form.name}"? Submissions already saved as records remain.`,
      { title: "Delete form?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    const res = await apiClient.forms[":formId"].$delete({ param: { formId: form.id } });
    if (res.status >= 400) {
      prompts.error(await errorMessage(res, "Failed to delete form"));
      return;
    }
    setForms(forms().filter((f) => f.id !== form.id));
    refreshCurrentPath();
  };

  return (
    <div class="flex flex-col gap-2">
      <Show
        when={forms().length > 0}
        fallback={<p class="text-xs text-dimmed py-2">No custom forms yet.</p>}
      >
        <ul class="flex flex-col gap-2">
          <For each={forms()}>
            {(form) => {
              const isExpanded = () => expandedId() === form.id;
              return (
                <li
                  class={`paper transition-colors ${
                    isExpanded()
                      ? "border-blue-500! dark:border-blue-400!"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left"
                    onClick={() => setExpandedId(isExpanded() ? null : form.id)}
                    aria-expanded={isExpanded()}
                  >
                    <i
                      class={`ti ${form.publicToken ? "ti-world" : "ti-lock"} text-sm ${
                        form.publicToken ? "text-emerald-600" : "text-dimmed"
                      }`}
                    />
                    <span class="flex-1 min-w-0 flex items-baseline gap-2">
                      <span class="text-sm font-semibold text-primary truncate">{form.name}</span>
                      <span class="text-[10px] text-dimmed">
                        {form.config.fields.length} field
                        {form.config.fields.length === 1 ? "" : "s"}
                      </span>
                      <span class="text-[10px] text-dimmed">
                        · {form.publicToken ? "public" : "private"}
                      </span>
                    </span>
                    <i
                      class={`ti ti-chevron-down text-sm text-dimmed transition-transform ${
                        isExpanded() ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  <Show when={isExpanded()}>
                    <FormEditor
                      form={form}
                      tableFields={props.fields}
                      onSaved={(next) => setForms(forms().map((f) => (f.id === next.id ? next : f)))}
                      onDelete={() => handleDelete(form)}
                    />
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>

      <Show when={props.canManage}>
        <button
          type="button"
          class="btn-input btn-input-sm self-start text-emerald-600 hover:text-emerald-700"
          onClick={handleCreate}
        >
          <i class="ti ti-plus" /> New form
        </button>
      </Show>
    </div>
  );
}

// =============================================================================
// FormEditor — expanded body of a form card
// =============================================================================

function FormEditor(props: {
  form: Form;
  tableFields: Field[];
  onSaved: (next: Form) => void;
  onDelete: () => void;
}) {
  const [name, setName] = createSignal(props.form.name);
  const [isPublic, setIsPublic] = createSignal(Boolean(props.form.publicToken));
  const [submitLabel, setSubmitLabel] = createSignal(props.form.config.submitLabel ?? "");
  const [successMessage, setSuccessMessage] = createSignal(props.form.config.successMessage ?? "");
  const [entries, setEntries] = createSignal<FormFieldEntry[]>(
    props.form.config.fields.map((e) => ({ ...e })),
  );
  const [dirty, setDirty] = createSignal(false);

  const wrap =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  // Fields available to ADD — i.e. on the table, user-editable, not in the
  // form yet. Computed memo so the picker shrinks as the user adds rows.
  const includedIds = createMemo(() => new Set(entries().map((e) => e.fieldId)));
  const addable = createMemo(() =>
    props.tableFields
      .filter((f) => !f.deletedAt && isUserEditable(f.type) && !includedIds().has(f.id)),
  );
  const fieldById = createMemo(() => new Map(props.tableFields.map((f) => [f.id, f])));

  const updateMut = mutations.create<Form, void>({
    mutation: async () => {
      const res = await apiClient.forms[":formId"].$patch({
        param: { formId: props.form.id },
        json: {
          name: name().trim(),
          isPublic: isPublic(),
          config: {
            ...props.form.config,
            submitLabel: submitLabel().trim() || undefined,
            successMessage: successMessage().trim() || undefined,
            fields: entries(),
          },
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save form"));
      return (await res.json()) as Form;
    },
    onSuccess: (next) => {
      setDirty(false);
      props.onSaved(next);
    },
    onError: (e) => prompts.error(e.message),
  });

  const handleSave = () => {
    if (!name().trim()) {
      prompts.error("Name is required");
      return;
    }
    updateMut.mutate(undefined);
  };

  const addEntry = (fieldId: string) => {
    const f = fieldById().get(fieldId);
    if (!f) return;
    setEntries([...entries(), { fieldId, required: f.required }]);
    setDirty(true);
  };

  const removeEntry = (index: number) => {
    setEntries(entries().filter((_, i) => i !== index));
    setDirty(true);
  };

  const updateEntry = (index: number, patch: Partial<FormFieldEntry>) => {
    setEntries(entries().map((e, i) => (i === index ? { ...e, ...patch } : e)));
    setDirty(true);
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= entries().length) return;
    const next = [...entries()];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setEntries(next);
    setDirty(true);
  };

  const handleCopyPublicUrl = async () => {
    if (!props.form.publicToken) return;
    const url = `${window.location.origin}/share/grids/forms/${props.form.publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can fail in non-https / sandboxed iframes — fall through
      // to the dialog so the user can copy by hand.
    }
    // Custom dialog with a `break-all` URL block so long tokens wrap inside
    // the dialog instead of overflowing past its border.
    await prompts.dialog<void>(
      (close) => (
        <div class="flex flex-col gap-3">
          <p class="text-xs text-secondary">Copied to clipboard:</p>
          <code class="block break-all text-xs bg-zinc-100 dark:bg-zinc-800 rounded-md p-2 font-mono">
            {url}
          </code>
          <div class="flex justify-end">
            <button type="button" class="btn-primary btn-sm" onClick={() => close()}>
              OK
            </button>
          </div>
        </div>
      ),
      { title: "Public URL", icon: "ti ti-link" },
    );
  };

  return (
    <div class="px-4 pb-4 pt-1 flex flex-col gap-5">
      {/* General */}
      <div class="flex flex-col gap-3">
        <span class="text-xs font-medium text-secondary">General</span>
        <TextInput label="Name" value={name} onInput={wrap(setName)} icon="ti ti-typography" required />
        <div class="flex items-center gap-3 flex-wrap">
          <label class="inline-flex items-center gap-2 text-xs text-secondary">
            <input
              type="checkbox"
              checked={isPublic()}
              onChange={(e) => wrap(setIsPublic)(e.currentTarget.checked)}
            />
            Public — anyone with the link can submit, no login required
          </label>
          {/* Icon-only with tooltip, ALWAYS in the DOM. Hidden via opacity
              + pointer-events when there's no token yet — keeps the row's
              width stable so toggling public on doesn't cause a shift. */}
          <button
            type="button"
            class={`btn-simple btn-sm transition-opacity ${
              props.form.publicToken
                ? "opacity-100"
                : "opacity-0 pointer-events-none"
            }`}
            onClick={handleCopyPublicUrl}
            title="Copy public URL"
            aria-label="Copy public URL"
          >
            <i class="ti ti-copy" />
          </button>
        </div>
      </div>

      {/* Submission */}
      <div class="flex flex-col gap-3">
        <span class="text-xs font-medium text-secondary">Submission</span>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput
            label="Submit button label"
            description='Defaults to "Save".'
            value={submitLabel}
            onInput={wrap(setSubmitLabel)}
            icon="ti ti-send"
            placeholder="Save"
          />
          <TextInput
            label="Success message"
            description='Shown after a successful submit. Defaults to "Saved".'
            value={successMessage}
            onInput={wrap(setSuccessMessage)}
            icon="ti ti-circle-check"
            placeholder="Saved"
          />
        </div>
      </div>

      {/* Fields */}
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-secondary">Fields in this form</span>
          <span class="text-[10px] text-dimmed">{entries().length} field(s)</span>
        </div>
        <Show
          when={entries().length > 0}
          fallback={
            <p class="text-xs text-dimmed py-1">
              No fields included. Pick one from the list below to start.
            </p>
          }
        >
          <ul class="flex flex-col gap-2">
            <For each={entries()}>
              {(entry, idx) => {
                const f = fieldById().get(entry.fieldId);
                if (!f) return null;
                const required = () => entry.required ?? f.required;
                return (
                  <li class="paper p-3 flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                      <div class="flex flex-col gap-0.5">
                        <button
                          type="button"
                          class="text-dimmed hover:text-primary disabled:opacity-30"
                          onClick={() => moveEntry(idx(), -1)}
                          disabled={idx() === 0}
                          title="Move up"
                          aria-label="Move up"
                        >
                          <i class="ti ti-chevron-up text-xs" />
                        </button>
                        <button
                          type="button"
                          class="text-dimmed hover:text-primary disabled:opacity-30"
                          onClick={() => moveEntry(idx(), 1)}
                          disabled={idx() === entries().length - 1}
                          title="Move down"
                          aria-label="Move down"
                        >
                          <i class="ti ti-chevron-down text-xs" />
                        </button>
                      </div>
                      <span class="flex-1 min-w-0 flex items-baseline gap-2">
                        <span class="text-sm font-medium text-primary truncate">{f.name}</span>
                        <span class="text-[10px] text-dimmed">{TYPE_LABELS[f.type] ?? f.type}</span>
                      </span>
                      <label class="inline-flex items-center gap-1.5 text-[11px] text-secondary">
                        <input
                          type="checkbox"
                          checked={required()}
                          onChange={(e) =>
                            updateEntry(idx(), { required: e.currentTarget.checked })
                          }
                        />
                        Required
                      </label>
                      <button
                        type="button"
                        class="text-dimmed hover:text-red-500 px-1"
                        onClick={() => removeEntry(idx())}
                        title="Remove from form"
                        aria-label="Remove from form"
                      >
                        <i class="ti ti-x" />
                      </button>
                    </div>
                    <TextInput
                      label="Label override (optional)"
                      icon="ti ti-tag"
                      value={() => entry.label ?? ""}
                      onInput={(v) => updateEntry(idx(), { label: v.trim() === "" ? undefined : v })}
                      placeholder={f.name}
                    />
                    <TextInput
                      label="Help text (optional)"
                      icon="ti ti-info-circle"
                      value={() => entry.helpText ?? ""}
                      onInput={(v) =>
                        updateEntry(idx(), { helpText: v.trim() === "" ? undefined : v })
                      }
                      placeholder="Shown under the input in the form"
                      multiline
                      lines={2}
                    />
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>

        <Show when={addable().length > 0}>
          <div class="flex items-center gap-2">
            <span class="text-xs text-dimmed">Add field:</span>
            <div class="min-w-[14rem]">
              <Select
                value={() => ""}
                onChange={(v) => v && addEntry(v)}
                options={addable().map((f) => ({
                  id: f.id,
                  label: f.name,
                  description: TYPE_LABELS[f.type] ?? f.type,
                }))}
                placeholder="Pick a field..."
              />
            </div>
          </div>
        </Show>
      </div>

      {/* Footer */}
      <div class="flex items-center justify-between gap-2 pt-2">
        <button type="button" class="btn-simple btn-sm text-red-500 hover:text-red-600" onClick={props.onDelete}>
          <i class="ti ti-trash" /> Delete form
        </button>
        <Show when={dirty()}>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={handleSave}
            disabled={updateMut.loading()}
          >
            {updateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
          </button>
        </Show>
      </div>
    </div>
  );
}
