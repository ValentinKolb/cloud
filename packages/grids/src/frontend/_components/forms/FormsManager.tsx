import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import {
  Checkbox,
  CopyButton,
  confirmDiscardIfDirty,
  dialogCore,
  ImageInput,
  MultiSelectInput,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  panelDialogPanelClass,
  prompts,
  Select,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { img } from "@valentinkolb/stdlib/browser";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, Index, type JSX, Show } from "solid-js";
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

const formEditorDialogOptions = {
  ...panelDialogOptions,
  panelClassName: panelDialogPanelClass.replace("w-[min(96vw,48rem)]", "w-[min(96vw,72rem)]"),
};

export const openFormEditorDialog = (args: {
  form: Form;
  tableFields: Field[];
  initialAccessEntries?: AccessEntry[];
  canManageAccess: boolean;
  onSaved?: (next: Form) => void;
  onDelete?: () => Promise<void> | void;
}) => dialogCore.open<void>((close) => <FormEditorDialog args={args} close={close} />, formEditorDialogOptions);

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
          <Placeholder surface="paper" align="left">
            No custom forms yet.
          </Placeholder>
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
        <button type="button" class="btn-input-success btn-input-sm self-start" onClick={handleCreate}>
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
  closeMainDialog: boolean;
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

  const markDirty = () => {
    setDirty(true);
    props.onDirtyChange?.(true);
  };

  const wrap =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      markDirty();
    };

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
            fields: entries(),
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
      if (request?.closeMainDialog) props.onSaved(next);
    },
    onError: (e) => {
      prompts.error(e.message);
    },
  });

  const handleSave = async () => {
    if (!name().trim()) {
      prompts.error("Name is required");
      return;
    }
    // Schema/config changes on a publicly-shared form take effect for
    // new submissions immediately. Surface that explicitly before save
    // so authors don't accidentally break a campaign mid-flight.
    if (props.form.publicToken && props.form.isActive) {
      const confirmed = await prompts.confirm(
        "This public form is live. Saved changes affect new submissions immediately. Existing submissions stay as-is. Continue?",
        { title: "Save live form?", confirmText: "Save" },
      );
      if (!confirmed) return;
    }
    void updateMut.mutate({ closeMainDialog: true });
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
          <div class="rounded-md border border-zinc-200 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/35">
            <p class="text-xs font-semibold text-primary">Submit access</p>
            <p class="mt-1 text-[11px] leading-snug text-dimmed">
              Grant Write to specific users or groups when this form should be private or internal. Public forms still accept anyone with
              the link.
            </p>
            <div class="mt-3">
              <FormPermissions formId={props.form.id} initialEntries={props.initialAccessEntries} canEdit={props.canManageAccess} />
            </div>
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

        <FormEditorSection title="Fields" subtitle="Form structure and per-field behavior." icon="ti ti-forms">
          <FormFieldsEditor
            tableFields={props.tableFields}
            entries={entries}
            setEntries={(next) => {
              setEntries(next);
              markDirty();
            }}
          />
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

function FormFieldsEditor(props: { tableFields: Field[]; entries: () => FormFieldEntry[]; setEntries: (next: FormFieldEntry[]) => void }) {
  const [selectedEntryIndex, setSelectedEntryIndex] = createSignal(0);
  const includedIds = createMemo(() => new Set(props.entries().map((entry) => entry.fieldId)));
  const addable = createMemo(() =>
    props.tableFields.filter((field) => !field.deletedAt && canBeFormInput(field) && !includedIds().has(field.id)),
  );
  const fieldById = createMemo(() => new Map(props.tableFields.map((field) => [field.id, field])));
  const selectedIndex = createMemo(() => Math.min(selectedEntryIndex(), Math.max(props.entries().length - 1, 0)));
  const selectedEntry = createMemo(() => props.entries()[selectedIndex()] ?? null);
  const selectedField = createMemo(() => {
    const entry = selectedEntry();
    return entry ? fieldById().get(entry.fieldId) : undefined;
  });

  const replaceEntries = (next: FormFieldEntry[]) => {
    props.setEntries(next);
  };

  const addEntry = async (fieldId: string) => {
    const field = fieldById().get(fieldId);
    if (!field) return;
    const kind = await chooseFormFieldEntryKind(field);
    if (!kind) return;
    replaceEntries([
      ...props.entries(),
      kind === "form_value" ? { kind: "form_value", fieldId, value: null } : { kind: "user_input", fieldId, required: field.required },
    ]);
    setSelectedEntryIndex(props.entries().length);
  };

  const removeEntry = (index: number) => {
    replaceEntries(props.entries().filter((_, i) => i !== index));
    setSelectedEntryIndex(Math.max(0, Math.min(index, props.entries().length - 2)));
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
    setSelectedEntryIndex(target);
  };

  const openFieldSettings = async (index: number) => {
    const entry = props.entries()[index];
    const field = entry ? fieldById().get(entry.fieldId) : undefined;
    if (!entry || !field) return;
    const next = await openFormFieldSettingsDialog({ entry, field });
    if (!next) return;
    replaceEntries(props.entries().map((current, i) => (i === index ? next : current)));
    setSelectedEntryIndex(index);
  };

  return (
    <div class="grid min-h-[28rem] grid-cols-1 gap-3 md:grid-cols-2">
      <div class="flex min-h-0 flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-sm font-semibold text-primary">Form fields</p>
            <p class="text-[11px] text-dimmed">Order and choose what visitors see.</p>
          </div>
          <span class="text-[10px] text-dimmed">{props.entries().length}</span>
        </div>
        <Show
          when={props.entries().length > 0}
          fallback={
            <Placeholder surface="paper" align="left" class="p-3">
              No fields yet.
            </Placeholder>
          }
        >
          <ul class="flex min-h-0 flex-col gap-1 overflow-y-auto">
            <Index each={props.entries()}>
              {(entry, idx) => {
                const field = () => fieldById().get(entry().fieldId);
                const selected = () => selectedIndex() === idx;
                return (
                  <li>
                    <div
                      class={`paper flex w-full items-center gap-2 px-2 py-2 text-left transition-colors ${
                        selected()
                          ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                          : "hover:paper-highlighted"
                      }`}
                    >
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => setSelectedEntryIndex(idx)}
                      >
                        <Show when={field()} fallback={<i class="ti ti-alert-triangle text-dimmed" />}>
                          {(f) => <i class={`${fieldTypeIcon(f().type, f().icon)} shrink-0 text-dimmed`} />}
                        </Show>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-sm font-medium text-primary">{field()?.name ?? "Missing field"}</span>
                          <span class="block truncate text-[10px] text-dimmed">
                            {entry().kind === "form_value" ? "Fixed value" : fieldTypeLabel(field()?.type ?? "text")}
                          </span>
                        </span>
                      </button>
                      <Show when={entry().kind === "form_value"}>
                        <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-secondary dark:bg-zinc-800">Fixed</span>
                      </Show>
                      <Show when={entry().kind === "user_input" && (entry() as Extract<FormFieldEntry, { kind: "user_input" }>).required}>
                        <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-secondary dark:bg-zinc-800">Required</span>
                      </Show>
                      <div class="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          class="icon-btn"
                          onClick={() => moveEntry(idx, -1)}
                          disabled={idx === 0}
                          title="Move up"
                          aria-label="Move up"
                        >
                          <i class="ti ti-arrow-up" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          onClick={() => moveEntry(idx, 1)}
                          disabled={idx === props.entries().length - 1}
                          title="Move down"
                          aria-label="Move down"
                        >
                          <i class="ti ti-arrow-down" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn md:hidden"
                          onClick={() => void openFieldSettings(idx)}
                          title="Edit field settings"
                          aria-label="Edit field settings"
                        >
                          <i class="ti ti-pencil" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn text-red-500 hover:text-red-600"
                          onClick={() => removeEntry(idx)}
                          title="Remove from form"
                          aria-label="Remove from form"
                        >
                          <i class="ti ti-trash" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              }}
            </Index>
          </ul>
        </Show>
        <Show when={addable().length > 0}>
          <Select
            label="Add field"
            description="Pick a table field, then choose how the form uses it."
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
        </Show>
      </div>

      <FormFieldInspector
        class="hidden md:flex"
        entry={selectedEntry}
        field={selectedField}
        index={selectedIndex}
        updateEntry={updateEntry}
        updateFormValue={updateFormValue}
      />
    </div>
  );
}

function FormFieldInspector(props: {
  class?: string;
  entry: () => FormFieldEntry | null;
  field: () => Field | undefined;
  index: () => number;
  updateEntry: (index: number, patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => void;
  updateFormValue: (index: number, value: unknown) => void;
}) {
  const userEntry = createMemo(() =>
    props.entry()?.kind === "user_input" ? (props.entry() as Extract<FormFieldEntry, { kind: "user_input" }>) : null,
  );
  const valueEntry = createMemo(() =>
    props.entry()?.kind === "form_value" ? (props.entry() as Extract<FormFieldEntry, { kind: "form_value" }>) : null,
  );

  return (
    <Show
      when={props.entry() && props.field()}
      fallback={
        <div class={`paper min-h-64 items-center justify-center p-4 text-sm text-dimmed ${props.class ?? "flex"}`}>
          Select a field to configure it.
        </div>
      }
    >
      <div class={`paper min-h-0 flex-col gap-3 p-4 ${props.class ?? "flex"}`}>
        <FormFieldSettings
          entry={props.entry}
          field={props.field}
          userEntry={userEntry}
          valueEntry={valueEntry}
          updateEntry={(patch) => props.updateEntry(props.index(), patch)}
          updateFormValue={(value) => props.updateFormValue(props.index(), value)}
        />
      </div>
    </Show>
  );
}

function FormFieldSettings(props: {
  entry: () => FormFieldEntry | null;
  field: () => Field | undefined;
  userEntry: () => Extract<FormFieldEntry, { kind: "user_input" }> | null;
  valueEntry: () => Extract<FormFieldEntry, { kind: "form_value" }> | null;
  updateEntry: (patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => void;
  updateFormValue: (value: unknown) => void;
}) {
  return (
    <>
      <div class="flex items-start gap-3">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
          <i class={`${fieldTypeIcon(props.field()!.type, props.field()!.icon)} text-sm`} />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-primary">{props.field()!.name}</p>
          <p class="text-[11px] text-dimmed">
            {fieldTypeLabel(props.field()!.type)}
            <Show when={props.valueEntry()}> · fixed value</Show>
          </p>
        </div>
      </div>

      <Show when={props.userEntry()}>
        {(entry) => (
          <>
            <Checkbox
              label="Required"
              description="Visitors must provide a value before submitting."
              value={() => entry().required}
              onChange={(required) => props.updateEntry({ required })}
            />
            <div class="flex flex-col gap-3">
              <TextInput
                label="Label override (optional)"
                description="Use a different label on this form."
                icon="ti ti-tag"
                value={() => entry().label ?? ""}
                onInput={(value) => props.updateEntry({ label: value.trim() === "" ? undefined : value })}
                placeholder={props.field()!.name}
              />
              <TextInput
                label="Help text (optional)"
                description="Shown below the input."
                icon="ti ti-info-circle"
                value={() => entry().helpText ?? ""}
                onInput={(value) => props.updateEntry({ helpText: value.trim() === "" ? undefined : value })}
                placeholder="Extra context for visitors"
                multiline
                lines={2}
              />
            </div>
            <InlineCreateEditor field={props.field()!} entry={entry()} onChange={(patch) => props.updateEntry(patch)} />
          </>
        )}
      </Show>

      <Show when={props.valueEntry()}>
        {(entry) => (
          <>
            <div class="info-block-info text-xs">This field is hidden from visitors. Every submission stores the fixed value below.</div>
            <FieldInput
              field={props.field()!}
              entry={{ kind: "user_input", fieldId: props.field()!.id, required: false }}
              value={entry().value}
              onChange={props.updateFormValue}
            />
          </>
        )}
      </Show>
    </>
  );
}

const cloneFormFieldEntry = (entry: FormFieldEntry): FormFieldEntry => {
  if (entry.kind === "form_value") return { ...entry };
  return {
    ...entry,
    inlineCreate: entry.inlineCreate
      ? {
          enabled: entry.inlineCreate.enabled,
          fields: (entry.inlineCreate.fields ?? []).map((field) => ({ ...field })),
        }
      : undefined,
  };
};

const openFormFieldSettingsDialog = (args: { entry: FormFieldEntry; field: Field }) =>
  dialogCore.open<FormFieldEntry | null>((close) => {
    const [draft, setDraft] = createSignal<FormFieldEntry>(cloneFormFieldEntry(args.entry));
    const userEntry = createMemo(() =>
      draft().kind === "user_input" ? (draft() as Extract<FormFieldEntry, { kind: "user_input" }>) : null,
    );
    const valueEntry = createMemo(() =>
      draft().kind === "form_value" ? (draft() as Extract<FormFieldEntry, { kind: "form_value" }>) : null,
    );
    const updateEntry = (patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => {
      setDraft((current) => (current.kind === "user_input" ? { ...current, ...patch } : current));
    };
    const updateFormValue = (value: unknown) => {
      setDraft((current) => (current.kind === "form_value" ? { ...current, value } : current));
    };

    return (
      <PanelDialog>
        <PanelDialog.Header
          title={`Field settings — ${args.field.name}`}
          icon={fieldTypeIcon(args.field.type, args.field.icon)}
          close={() => close(null)}
        />
        <PanelDialog.Body>
          <FormFieldSettings
            entry={draft}
            field={() => args.field}
            userEntry={userEntry}
            valueEntry={valueEntry}
            updateEntry={updateEntry}
            updateFormValue={updateFormValue}
          />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span class="text-[11px] text-dimmed">Confirm stages the field settings. Use the main form Save to persist.</span>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-input btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={() => close(cloneFormFieldEntry(draft()))}>
              Confirm
            </button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);

const chooseFormFieldEntryKind = (field: Field) =>
  prompts.dialog<"user_input" | "form_value">(
    (close) => (
      <div class="flex flex-col gap-4">
        <div class="info-block-info text-xs">
          <p class="font-semibold">How should "{field.name}" be used?</p>
          <p class="mt-1">
            Form field means the visitor fills it in. Fixed value means the visitor never sees it; every submission stores the value you
            configure next.
          </p>
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

  createEffect(() => {
    const tableId = targetTableId();
    setTargetFields([]);
    if (!tableId) return;
    void (async () => {
      const res = await apiClient.fields["by-table"][":tableId"].$get({ param: { tableId } });
      if (res.ok && targetTableId() === tableId) setTargetFields(await res.json());
    })();
  });

  const enabled = () => Boolean(props.entry?.inlineCreate?.enabled);
  const selectedFieldIds = () => (props.entry?.inlineCreate?.fields ?? []).map((entry) => entry.fieldId);
  const candidateFields = createMemo(() =>
    targetFields().filter((field) => !field.deletedAt && isRecordInputField(field.type) && field.type !== "relation"),
  );
  const fieldOption = (field: Field) => ({
    id: field.id,
    label: field.name,
    description: TYPE_LABELS[field.type] ?? field.type,
    icon: fieldTypeIcon(field.type, field.icon),
  });
  const candidateOptions = createMemo(() => candidateFields().map(fieldOption));
  const selectedInlineOptions = createMemo(() =>
    selectedFieldIds()
      .map((fieldId) => targetFields().find((field) => field.id === fieldId))
      .filter((field): field is Field => Boolean(field))
      .map(fieldOption),
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
      <div class="paper mt-1 flex flex-col gap-2 p-3">
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
            options={candidateOptions()}
            selectedOptions={selectedInlineOptions}
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
