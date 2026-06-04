import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import {
  Checkbox,
  confirmDiscardIfDirty,
  CopyButton,
  dialogCore,
  ImageInput,
  MultiSelectInput,
  panelDialogOptions,
  PanelDialog,
  prompts,
  Select,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { img } from "@valentinkolb/stdlib/browser";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Index, onMount, type JSX, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, Form } from "../../../service";
import type { FormConfig, FormFieldEntry } from "../../../service/forms";
import { TYPE_LABELS } from "../fields/field-config-editor";
import { isRecordInputField } from "../fields/field-render";
import { fieldTypeIcon, fieldTypeLabel } from "../fields/field-type-meta";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { errorMessage } from "../utils/api-helpers";
import { FieldInput } from "./form-fields";

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

export const openFormEditorDialog = (args: {
  form: Form;
  tableFields: Field[];
  initialAccessEntries?: AccessEntry[];
  canManageAccess: boolean;
  onSaved?: (next: Form) => void;
  onDelete?: () => Promise<void> | void;
}) => dialogCore.open<void>((close) => <FormEditorDialog args={args} close={close} />, panelDialogOptions);

function FormEditorDialog(props: {
  args: {
    form: Form;
    tableFields: Field[];
    initialAccessEntries?: AccessEntry[];
    canManageAccess: boolean;
    onSaved?: (next: Form) => void;
    onDelete?: () => Promise<void> | void;
  };
  close: () => void;
}) {
  const [dirty, setDirty] = createSignal(false);
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  return (
    <PanelDialog>
      <PanelDialog.Header title={`Edit form — ${props.args.form.name}`} icon="ti ti-forms" close={closeIfClean} />
      <FormEditor
        form={props.args.form}
        tableFields={props.args.tableFields}
        initialAccessEntries={props.args.initialAccessEntries ?? []}
        canManageAccess={props.args.canManageAccess}
        onDirtyChange={setDirty}
        onSaved={(next) => {
          setDirty(false);
          props.args.onSaved?.(next);
          props.close();
        }}
        onDelete={async () => {
          await props.args.onDelete?.();
          props.close();
        }}
        onCancel={closeIfClean}
      />
    </PanelDialog>
  );
}

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
          <div class="paper p-4">
            <p class="text-sm text-dimmed">No custom forms yet.</p>
          </div>
        }
      >
        <ul class="flex flex-col gap-2">
          <For each={forms()}>
            {(form) => (
              <li class="group paper transition-colors hover:bg-zinc-50 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-600 dark:hover:bg-zinc-800/40">
                <div class="flex min-h-12 items-center gap-2 px-3 py-2">
                  <span class="flex w-6 shrink-0 items-center justify-center">
                    <i
                      class={`ti ${form.publicToken ? "ti-world" : "ti-lock"} text-sm ${form.publicToken ? "text-emerald-600" : "text-dimmed"}`}
                    />
                  </span>
                  <button
                    type="button"
                    class="flex min-h-8 flex-1 min-w-0 items-center gap-2 text-left focus:outline-none focus-visible:outline-none"
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
        <button type="button" class="btn-input btn-input-sm self-start text-emerald-600 hover:text-emerald-700" onClick={handleCreate}>
          <i class="ti ti-plus" /> New form
        </button>
      </Show>
    </div>
  );
}

// =============================================================================
// FormEditor — expanded body of a form card
// =============================================================================

/**
 * Resize-and-encode pipeline for the form's optional title image.
 *
 * Free aspect ratio (banner / square / portrait all fine), preserved
 * through the resize. Caps the LONGEST side at `MAX_LONGEST` so a phone
 * photo (4032 × 3024) becomes ~1600 × 1200, and a wide banner
 * (3000 × 800) becomes 1600 × 427. Never upscales — a small icon
 * (300 × 200) passes through untouched. WebP at quality 0.85 typically
 * lands ~80–150 KB as base64 for these sizes, well inside the 1 MB
 * server-side cap on `config.titleImage`.
 */
const MAX_LONGEST = 1600;
const bannerTransform = async (file: File): Promise<string> => {
  const data = await img.create(file);
  const longest = Math.max(data.width, data.height);
  // Compute scale-down factor; clamp to 1 so we never upscale.
  const scale = Math.min(1, MAX_LONGEST / longest);
  const tw = Math.round(data.width * scale);
  const th = Math.round(data.height * scale);
  // No-op resize when scale === 1: encode the source as-is.
  const transformed = scale < 1 ? await img.resize(tw, th, "fill")(data) : data;
  return img.toBase64("webp", 0.85)(transformed);
};

type SaveFormRequest = {
  fields?: FormFieldEntry[];
  closeMainDialog: boolean;
  toastMessage?: string;
  resolve?: (next: Form | null) => void;
};

function FormEditor(props: {
  form: Form;
  tableFields: Field[];
  initialAccessEntries: AccessEntry[];
  canManageAccess: boolean;
  onSaved: (next: Form) => void;
  onDelete: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Cancel handler — only set when the editor lives inside a dialog.
   *  Footer adds a Cancel button so users have a clear no-op exit. */
  onCancel?: () => void;
}) {
  const [name, setName] = createSignal(props.form.name);
  const [isPublic, setIsPublic] = createSignal(Boolean(props.form.publicToken));
  const [isActive, setIsActive] = createSignal(props.form.isActive);
  const [title, setTitle] = createSignal(props.form.config.title ?? "");
  const [description, setDescription] = createSignal(props.form.config.description ?? "");
  const [submitLabel, setSubmitLabel] = createSignal(props.form.config.submitLabel ?? "");
  const [successMessage, setSuccessMessage] = createSignal(props.form.config.successMessage ?? "");
  const [redirectUrl, setRedirectUrl] = createSignal(props.form.config.redirectUrl ?? "");
  const [titleImage, setTitleImage] = createSignal<string | null>(props.form.config.titleImage ?? null);
  const [entries, setEntries] = createSignal<FormFieldEntry[]>(props.form.config.fields.map((e) => ({ ...e })));
  const [dirty, setDirty] = createSignal(false);

  const wrap =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
      props.onDirtyChange?.(true);
    };

  const userInputCount = createMemo(() => entries().filter((entry) => entry.kind === "user_input").length);
  const fixedValueCount = createMemo(() => entries().filter((entry) => entry.kind === "form_value").length);

  const updateMut = mutations.create<Form, SaveFormRequest, SaveFormRequest>({
    onBefore: (request) => request,
    mutation: async (request) => {
      const res = await apiClient.forms[":formId"].$patch({
        param: { formId: props.form.id },
        json: {
          name: name().trim(),
          isPublic: isPublic(),
          isActive: isActive(),
          config: {
            ...props.form.config,
            title: title().trim() || undefined,
            description: description().trim() || undefined,
            submitLabel: submitLabel().trim() || undefined,
            successMessage: successMessage().trim() || undefined,
            redirectUrl: redirectUrl().trim() || null,
            titleImage: titleImage() ?? undefined,
            fields: request.fields ?? entries(),
          },
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save form"));
      return res.json();
    },
    onSuccess: (next, request) => {
      setEntries(next.config.fields.map((entry) => ({ ...entry })));
      setDirty(false);
      props.onDirtyChange?.(false);
      if (request?.toastMessage) toast.success(request.toastMessage);
      request?.resolve?.(next);
      if (request?.closeMainDialog) props.onSaved(next);
    },
    onError: (e, request) => {
      request?.resolve?.(null);
      prompts.error(e.message);
    },
  });

  const saveForm = async (request: Omit<SaveFormRequest, "resolve">) => {
    if (!name().trim()) {
      prompts.error("Name is required");
      return null;
    }
    // Schema/config changes on a publicly-shared form take effect for
    // new submissions immediately. Surface that explicitly before save
    // so authors don't accidentally break a campaign mid-flight.
    if (props.form.publicToken && props.form.isActive) {
      const confirmed = await prompts.confirm(
        "This public form is live. Saved changes affect new submissions immediately. Existing submissions stay as-is. Continue?",
        { title: "Save live form?", confirmText: "Save" },
      );
      if (!confirmed) return null;
    }
    return new Promise<Form | null>((resolve) => {
      void updateMut.mutate({ ...request, resolve });
    });
  };

  const handleSave = () => {
    void saveForm({ closeMainDialog: true });
  };

  const openFieldsEditor = async () => {
    if (dirty()) {
      const confirmed = await prompts.confirm("Save form details before editing fields?", {
        title: "Save changes?",
        confirmText: "Save",
      });
      if (!confirmed) return;
      const saved = await saveForm({ closeMainDialog: false });
      if (!saved) return;
    }
    await openFormFieldsEditorDialog({
      formName: name().trim() || props.form.name,
      tableFields: props.tableFields,
      entries: entries(),
      saving: updateMut.loading,
      onSave: async (nextEntries) => {
        const saved = await saveForm({
          fields: nextEntries,
          closeMainDialog: false,
          toastMessage: "Fields saved",
        });
        return Boolean(saved);
      },
    });
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
          <code class="block break-all text-xs bg-zinc-100 dark:bg-zinc-800 rounded-md p-2 font-mono">{url}</code>
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
    <>
      <PanelDialog.Body>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput label="Name" value={name} onInput={wrap(setName)} icon="ti ti-typography" required />
          <TextInput
            label="Title"
            description="Heading shown on the form page (defaults to the name above)."
            value={title}
            onInput={wrap(setTitle)}
            icon="ti ti-heading"
            placeholder={name()}
          />
        </div>
        <TextInput
          label="Description"
          description="Optional subtitle shown under the title on the form page."
          value={description}
          onInput={wrap(setDescription)}
          icon="ti ti-align-left"
          multiline
          lines={2}
        />
        {/* Title image — banner displayed at the top of the form,
          above title and description. Stored inline as a base64
          WebP data-URL in form.config.titleImage. The transform
          preserves the source aspect ratio (no forced square),
          caps the longest side at 1600 px, and never upscales. */}
        <ImageInput
          label="Title image (optional)"
          description="Shown as a banner at the top of the form. Free aspect ratio; capped at 1600 px on the longest side."
          value={titleImage}
          onChange={wrap(setTitleImage)}
          transform={bannerTransform}
        />

        <FormEditorSection title="Access" subtitle="Who can submit, and whether the public link is live." icon="ti ti-world">
          <Checkbox
            label="Active"
            description="Submissions are accepted. Turn this off to pause the form without deleting it."
            value={isActive}
            onChange={wrap(setIsActive)}
          />
          <div class="flex items-center gap-3 flex-wrap">
            <Checkbox
              label="Public"
              description="Anyone with the link can submit, no login required."
              value={isPublic}
              onChange={async (next) => {
                // Disabling a public form is destructive: the existing
                // share token is nullified server-side and re-enabling
                // mints a fresh one. Anyone holding the old link is
                // permanently locked out — surface that explicitly.
                if (!next && props.form.publicToken) {
                  const confirmed = await prompts.confirm(
                    "This permanently breaks the existing share link. Anyone with it will no longer be able to access this form. Re-enabling later generates a fresh token. Continue?",
                    {
                      title: "Disable public link?",
                      variant: "danger",
                      confirmText: "Disable",
                    },
                  );
                  if (!confirmed) {
                    setIsPublic(false);
                    queueMicrotask(() => setIsPublic(true));
                    return;
                  }
                }
                wrap(setIsPublic)(next);
              }}
            />
            {/* Icon-only with tooltip, ALWAYS in the DOM. Hidden via opacity
              + pointer-events when there's no token yet — keeps the row's
              width stable so toggling public on doesn't cause a shift. */}
            <button
              type="button"
              class={`btn-simple btn-sm transition-opacity ${props.form.publicToken ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              onClick={handleCopyPublicUrl}
              title="Copy public URL"
              aria-label="Copy public URL"
            >
              <i class="ti ti-copy" />
            </button>
          </div>
        </FormEditorSection>

        {/* Submission */}
        <FormEditorSection title="Submission" subtitle="What happens after a visitor submits the form." icon="ti ti-send">
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
          <TextInput
            label="Redirect URL"
            description="When set, the public form redirects here after submit instead of showing the success message. Leave empty for the default in-page success card."
            value={redirectUrl}
            onInput={wrap(setRedirectUrl)}
            icon="ti ti-external-link"
            placeholder="https://example.com/thanks"
            type="url"
          />
        </FormEditorSection>

        <div class="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-primary">Fields</p>
            <p class="mt-0.5 text-[11px] text-dimmed">
              {entries().length} total · {userInputCount()} user input · {fixedValueCount()} fixed value
              {fixedValueCount() === 1 ? "" : "s"}
            </p>
          </div>
          <button type="button" class="btn-input btn-sm shrink-0" onClick={openFieldsEditor} disabled={updateMut.loading()}>
            <i class="ti ti-forms" /> Edit fields
          </button>
        </div>

        {/* Permissions — grants `write` on this form to specific users
          or groups. Form-write = "can submit this form even when it
          has no public token". The PermissionEditor renders as inline
          badges (no dropdown) because allowedLevels=["write"] is the
          single-pick case. Read+Admin on a form don't apply: read is
          implied by being granted access; admin == form CRUD which
          lives at table-admin (this whole panel). */}
        <FormEditorSection title="Permissions" subtitle="Extra submit access for private or internal forms." icon="ti ti-lock-access">
          <p class="text-[11px] text-dimmed leading-snug">
            Grant Write to let specific users or groups submit this form even without the public link. They won't see other submissions
            unless they also have table read.
          </p>
          <FormPermissions formId={props.form.id} initialEntries={props.initialAccessEntries} canEdit={props.canManageAccess} />
        </FormEditorSection>
      </PanelDialog.Body>

      {/* Footer */}
      <PanelDialog.Footer>
        <button type="button" class="btn-simple btn-sm text-red-500 hover:text-red-600" onClick={props.onDelete}>
          <i class="ti ti-trash" /> Delete form
        </button>
        <div class="flex items-center gap-2">
          <Show when={props.onCancel}>
            <button type="button" class="btn-input btn-sm" onClick={() => props.onCancel?.()}>
              Cancel
            </button>
          </Show>
          <button type="button" class="btn-primary btn-sm" onClick={handleSave} disabled={!dirty() || updateMut.loading()}>
            {updateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
          </button>
        </div>
      </PanelDialog.Footer>
    </>
  );
}

const openFormFieldsEditorDialog = (args: {
  formName: string;
  tableFields: Field[];
  entries: FormFieldEntry[];
  saving: () => boolean;
  onSave: (entries: FormFieldEntry[]) => Promise<boolean>;
}) =>
  dialogCore.open<void>(
    (close) => <FormFieldsEditorDialog args={args} close={close} />,
    panelDialogOptions,
  );

function FormFieldsEditorDialog(props: {
  args: {
    formName: string;
    tableFields: Field[];
    entries: FormFieldEntry[];
    saving: () => boolean;
    onSave: (entries: FormFieldEntry[]) => Promise<boolean>;
  };
  close: () => void;
}) {
  const [entries, setEntries] = createSignal<FormFieldEntry[]>(props.args.entries.map((entry) => ({ ...entry })));
  const [dirty, setDirty] = createSignal(false);
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  const handleSave = async () => {
    const saved = await props.args.onSave(entries());
    if (!saved) return;
    setDirty(false);
    props.close();
  };

  return (
    <PanelDialog>
      <PanelDialog.Header title={`Edit fields — ${props.args.formName}`} icon="ti ti-forms" close={closeIfClean} />
      <PanelDialog.Body>
        <FormFieldsEditor
          tableFields={props.args.tableFields}
          entries={entries}
          setEntries={setEntries}
          markDirty={() => setDirty(true)}
        />
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span class="text-[11px] text-dimmed">Field changes are saved immediately from this dialog.</span>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-input btn-sm" onClick={closeIfClean}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={handleSave} disabled={!dirty() || props.args.saving()}>
            {props.args.saving() ? <i class="ti ti-loader-2 animate-spin" /> : "Save fields"}
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

function FormFieldsEditor(props: {
  tableFields: Field[];
  entries: () => FormFieldEntry[];
  setEntries: (next: FormFieldEntry[]) => void;
  markDirty: () => void;
}) {
  const includedIds = createMemo(() => new Set(props.entries().map((entry) => entry.fieldId)));
  const addable = createMemo(() => props.tableFields.filter((field) => !field.deletedAt && canBeFormInput(field) && !includedIds().has(field.id)));
  const fieldById = createMemo(() => new Map(props.tableFields.map((field) => [field.id, field])));

  const replaceEntries = (next: FormFieldEntry[]) => {
    props.setEntries(next);
    props.markDirty();
  };

  const addEntry = async (fieldId: string) => {
    const field = fieldById().get(fieldId);
    if (!field) return;
    const kind = await chooseFormFieldEntryKind(field);
    if (!kind) return;
    replaceEntries([
      ...props.entries(),
      kind === "form_value"
        ? { kind: "form_value", fieldId, value: null }
        : { kind: "user_input", fieldId, required: field.required },
    ]);
  };

  const removeEntry = (index: number) => {
    replaceEntries(props.entries().filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => {
    replaceEntries(
      props.entries().map((entry, i) => {
        if (i !== index || entry.kind !== "user_input") return entry;
        return { ...entry, ...patch };
      }),
    );
  };

  const updateFormValue = (index: number, value: unknown) => {
    replaceEntries(
      props.entries().map((entry, i) => {
        if (i !== index || entry.kind !== "form_value") return entry;
        return { ...entry, value };
      }),
    );
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= props.entries().length) return;
    const next = [...props.entries()];
    [next[index], next[target]] = [next[target]!, next[index]!];
    replaceEntries(next);
  };

  return (
    <>
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-secondary">Fields in this form</span>
        <span class="text-[10px] text-dimmed">{props.entries().length} field(s)</span>
      </div>
      <Show
        when={props.entries().length > 0}
        fallback={<p class="text-xs text-dimmed py-1">No fields included. Pick one from the list below to start.</p>}
      >
        <ul class="flex flex-col gap-2">
          <Index each={props.entries()}>
            {(entry, idx) => {
              const field = () => fieldById().get(entry().fieldId);
              const valueEntry = () =>
                entry().kind === "form_value" ? (entry() as Extract<FormFieldEntry, { kind: "form_value" }>) : null;
              const userEntry = () =>
                entry().kind === "user_input" ? (entry() as Extract<FormFieldEntry, { kind: "user_input" }>) : null;
              const required = () => userEntry()?.required ?? field()?.required ?? false;
              return (
                <Show when={field()}>
                  {(f) => (
                    <Show
                      when={valueEntry()}
                      fallback={
                        <li class="paper p-4 flex flex-col gap-2">
                          <div class="flex items-center gap-2">
                            <div class="flex flex-col shrink-0">
                              <button
                                type="button"
                                class="h-3 flex items-center justify-center text-dimmed hover:text-blue-500 disabled:opacity-30 transition-colors"
                                onClick={() => moveEntry(idx, -1)}
                                disabled={idx === 0}
                                title="Move up"
                                aria-label="Move up"
                              >
                                <i class="ti ti-chevron-up text-xs" />
                              </button>
                              <button
                                type="button"
                                class="h-3 flex items-center justify-center text-dimmed hover:text-blue-500 disabled:opacity-30 transition-colors"
                                onClick={() => moveEntry(idx, 1)}
                                disabled={idx === props.entries().length - 1}
                                title="Move down"
                                aria-label="Move down"
                              >
                                <i class="ti ti-chevron-down text-xs" />
                              </button>
                            </div>
                            <i class={`${fieldTypeIcon(f().type, f().icon)} shrink-0 text-dimmed`} />
                            <span class="flex-1 min-w-0 flex items-baseline gap-2">
                              <span class="text-sm font-medium text-primary truncate">{f().name}</span>
                              <span class="text-[10px] text-dimmed">{TYPE_LABELS[f().type] ?? f().type}</span>
                            </span>
                            <Checkbox label="Required" value={required} onChange={(v) => updateEntry(idx, { required: v })} />
                            <button
                              type="button"
                              class="text-dimmed hover:text-red-500 px-1"
                              onClick={() => removeEntry(idx)}
                              title="Remove from form"
                              aria-label="Remove from form"
                            >
                              <i class="ti ti-x" />
                            </button>
                          </div>
                          <TextInput
                            label="Label override (optional)"
                            icon="ti ti-tag"
                            value={() => userEntry()?.label ?? ""}
                            onInput={(v) => updateEntry(idx, { label: v.trim() === "" ? undefined : v })}
                            placeholder={f().name}
                          />
                          <TextInput
                            label="Help text (optional)"
                            icon="ti ti-info-circle"
                            value={() => userEntry()?.helpText ?? ""}
                            onInput={(v) => updateEntry(idx, { helpText: v.trim() === "" ? undefined : v })}
                            placeholder="Shown under the input in the form"
                            multiline
                            lines={2}
                          />
                          <InlineCreateEditor field={f()} entry={userEntry()} onChange={(patch) => updateEntry(idx, patch)} />
                        </li>
                      }
                    >
                      {(ve) => (
                        <li class="paper p-4 flex flex-col gap-2">
                          <div class="flex items-center gap-2">
                            <i class={`${fieldTypeIcon(f().type, f().icon)} text-dimmed shrink-0`} />
                            <span class="flex-1 min-w-0 flex items-baseline gap-2">
                              <span class="text-sm font-medium text-primary truncate">{f().name}</span>
                              <span class="text-[10px] text-dimmed shrink-0">
                                {TYPE_LABELS[f().type] ?? f().type} · fixed value
                              </span>
                            </span>
                            <button
                              type="button"
                              class="text-dimmed hover:text-red-500 px-1"
                              onClick={() => removeEntry(idx)}
                              title="Remove from form"
                              aria-label="Remove from form"
                            >
                              <i class="ti ti-x" />
                            </button>
                          </div>
                          <FieldInput
                            field={f()}
                            entry={{ kind: "user_input", fieldId: f().id, required: false }}
                            value={ve().value}
                            onChange={(v) => updateFormValue(idx, v)}
                          />
                          <p class="text-[11px] text-dimmed leading-snug">
                            Every submission gets this value. Visitors don't see this field.
                          </p>
                        </li>
                      )}
                    </Show>
                  )}
                </Show>
              );
            }}
          </Index>
        </ul>
      </Show>

      <Show when={addable().length > 0}>
        <div class="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
          <Select
            label="Add field"
            description="Pick a table field, then choose whether visitors edit it or the form writes a fixed value."
            value={() => ""}
            onChange={(value) => {
              if (value) void addEntry(value);
            }}
            options={addable().map((field) => ({
              id: field.id,
              label: field.name,
              description: fieldTypeLabel(field.type),
              icon: fieldTypeIcon(field.type, field.icon),
            }))}
            placeholder="Pick a field..."
          />
        </div>
      </Show>
    </>
  );
}

const chooseFormFieldEntryKind = (field: Field) =>
  prompts.dialog<"user_input" | "form_value">(
    (close) => (
      <div class="flex flex-col gap-4">
        <div class="info-block-info text-xs">
          <p class="font-semibold">How should "{field.name}" be used?</p>
          <p class="mt-1">Form field means the visitor fills it in. Fixed value means the visitor never sees it; every submission stores the value you configure next.</p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={() => close("form_value")}>
            <i class="ti ti-lock" /> Add fixed value
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={() => close("user_input")}>
            <i class="ti ti-pencil" /> Add form field
          </button>
        </div>
      </div>
    ),
    { title: "Add field", icon: fieldTypeIcon(field.type, field.icon), size: "small" },
  );

function FormEditorSection(props: { title: string; subtitle?: string; icon: string; children: JSX.Element }) {
  return (
    <PanelDialog.Section title={props.title} subtitle={props.subtitle} icon={props.icon}>
      {props.children}
    </PanelDialog.Section>
  );
}

function InlineCreateEditor(props: {
  field: Field;
  entry: Extract<FormFieldEntry, { kind: "user_input" }> | null;
  onChange: (patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => void;
}) {
  const targetTableId = () =>
    props.field.type === "relation" ? (props.field.config as { targetTableId?: string }).targetTableId : undefined;
  const [targetFields, setTargetFields] = createSignal<Field[]>([]);

  onMount(async () => {
    const tableId = targetTableId();
    if (!tableId) return;
    const res = await apiClient.fields["by-table"][":tableId"].$get({ param: { tableId } });
    if (res.ok) setTargetFields(await res.json());
  });

  const enabled = () => Boolean(props.entry?.inlineCreate?.enabled);
  const selectedFieldIds = () => (props.entry?.inlineCreate?.fields ?? []).map((entry) => entry.fieldId);
  const candidateFields = createMemo(() =>
    targetFields().filter((field) => !field.deletedAt && isRecordInputField(field.type) && field.type !== "relation"),
  );

  const setEnabled = (next: boolean) => {
    props.onChange(
      next
        ? {
            inlineCreate: {
              enabled: true,
              fields:
                props.entry?.inlineCreate?.fields ??
                candidateFields()
                  .slice(0, 1)
                  .map((field) => ({ fieldId: field.id, required: field.required })),
            },
          }
        : { inlineCreate: undefined },
    );
  };

  const setInlineFieldIds = (ids: string[]) => {
    const fieldById = new Map(candidateFields().map((field) => [field.id, field]));
    props.onChange({
      inlineCreate: {
        enabled: true,
        fields: ids
          .map((fieldId) => {
            const field = fieldById.get(fieldId);
            return field ? { fieldId, required: field.required } : null;
          })
          .filter((entry): entry is { fieldId: string; required: boolean } => Boolean(entry)),
      },
    });
  };

  return (
    <Show when={targetTableId()}>
      <div class="mt-1 flex flex-col gap-2 border-l border-zinc-200 pl-3 dark:border-zinc-800">
        <Checkbox
          label="Create related records inline"
          description="Let this form create the linked record together with the main record. Nothing is saved until submit."
          value={enabled}
          onChange={setEnabled}
        />
        <Show when={enabled()}>
          <MultiSelectInput
            label="Inline fields"
            description="Fields shown for the new linked record."
            placeholder="Pick fields..."
            icon="ti ti-columns"
            value={selectedFieldIds}
            onChange={setInlineFieldIds}
            options={candidateFields().map((field) => ({
              id: field.id,
              label: field.name,
              description: TYPE_LABELS[field.type] ?? field.type,
              icon: fieldTypeIcon(field.type, field.icon),
            }))}
            clearable
          />
        </Show>
      </div>
    </Show>
  );
}

// =============================================================================
// FormPermissions — wraps PermissionEditor with form-API wires
// =============================================================================
// Mirrors TablePermissions / ViewPermissions. allowedLevels=["write"]
// collapses the dropdown / SegmentedControl into inline badges since
// there's only one meaningful level for forms.

function FormPermissions(props: { formId: string; initialEntries: AccessEntry[]; canEdit: boolean }) {
  return (
    <ScopedPermissionEditor
      scope={{ type: "form", id: props.formId }}
      initialEntries={props.initialEntries}
      canEdit={props.canEdit}
      allowedLevels={[{ level: "write", label: "Use", icon: "ti-cursor-text" }]}
    />
  );
}
