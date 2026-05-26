import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import {
  Checkbox,
  CopyButton,
  dialogCore,
  ImageInput,
  PermissionEditor,
  prompts,
  SegmentedControl,
  Select,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { img } from "@valentinkolb/stdlib/browser";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Index, type JSX, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, Form } from "../../../service";
import type { FormConfig, FormFieldEntry } from "../../../service/forms";
import { confirmDiscardIfDirty, GridsBareDialog, gridsBareDialogOptions } from "../dialogs/dialog-layout";
import { TYPE_LABELS } from "../fields/field-config-editor";
import { isUserEditable } from "../fields/field-prompt-schema";
import { errorMessage } from "../utils/api-helpers";
import { FieldInput } from "./form-fields";

const canBeFormInput = (field: Field) => isUserEditable(field.type) || field.type === "relation";

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
}) => dialogCore.open<void>((close) => <FormEditorDialog args={args} close={close} />, gridsBareDialogOptions);

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
    <GridsBareDialog title={`Edit form — ${props.args.form.name}`} icon="ti ti-forms" close={closeIfClean}>
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
    </GridsBareDialog>
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
    const created = (await res.json()) as Form;
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

  // Fields available to ADD — i.e. on the table, user-editable, not in the
  // form yet. Computed memo so the picker shrinks as the user adds rows.
  const includedIds = createMemo(() => new Set(entries().map((e) => e.fieldId)));
  const addable = createMemo(() => props.tableFields.filter((f) => !f.deletedAt && canBeFormInput(f) && !includedIds().has(f.id)));
  const fieldById = createMemo(() => new Map(props.tableFields.map((f) => [f.id, f])));

  const updateMut = mutations.create<Form, void>({
    mutation: async () => {
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
      return (await res.json()) as Form;
    },
    onSuccess: (next) => {
      setDirty(false);
      props.onDirtyChange?.(false);
      props.onSaved(next);
    },
    onError: (e) => prompts.error(e.message),
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
    updateMut.mutate(undefined);
  };

  // What kind of entry the next "Add field" pick creates. user_input
  // is the default (renders an input the visitor fills); form_value
  // is the power-user mode (the form supplies a fixed hidden
  // value, not editable by the visitor).
  const [addKind, setAddKind] = createSignal<"user_input" | "form_value">("user_input");

  const addEntry = (fieldId: string) => {
    const f = fieldById().get(fieldId);
    if (!f) return;
    if (addKind() === "form_value") {
      setEntries([...entries(), { kind: "form_value", fieldId, value: null }]);
    } else {
      setEntries([...entries(), { kind: "user_input", fieldId, required: f.required }]);
    }
    setDirty(true);
    props.onDirtyChange?.(true);
  };

  const removeEntry = (index: number) => {
    setEntries(entries().filter((_, i) => i !== index));
    setDirty(true);
    props.onDirtyChange?.(true);
  };

  /** Patch a user_input entry. */
  const updateEntry = (index: number, patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => {
    setEntries(
      entries().map((e, i) => {
        if (i !== index) return e;
        if (e.kind !== "user_input") return e;
        return { ...e, ...patch };
      }),
    );
    setDirty(true);
    props.onDirtyChange?.(true);
  };

  /** Patch a form_value entry's hidden fixed value. */
  const updateFormValue = (index: number, value: unknown) => {
    setEntries(
      entries().map((e, i) => {
        if (i !== index) return e;
        if (e.kind !== "form_value") return e;
        return { ...e, value };
      }),
    );
    setDirty(true);
    props.onDirtyChange?.(true);
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= entries().length) return;
    const next = [...entries()];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setEntries(next);
    setDirty(true);
    props.onDirtyChange?.(true);
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
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {/* General */}
        <FormEditorSection title="Identity" subtitle="Name, public page copy, and visual header." icon="ti ti-id">
          <TextInput label="Name" value={name} onInput={wrap(setName)} icon="ti ti-typography" required />
          <TextInput
            label="Title"
            description="Heading shown on the form page (defaults to the name above)."
            value={title}
            onInput={wrap(setTitle)}
            icon="ti ti-heading"
            placeholder={name()}
          />
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
            caps the longest side at 1600 px, and never upscales —
            so a phone photo (4032 × 3024) becomes ~1600 × 1200
            (~120 KB at q=0.85), while a small icon stays untouched.
            Rendered in submit surfaces as `w-full` with a height
            cap so a wide banner fills the form width naturally. */}
          <ImageInput
            label="Title image (optional)"
            description="Shown as a banner at the top of the form. Free aspect ratio; capped at 1600 px on the longest side."
            value={titleImage}
            onChange={wrap(setTitleImage)}
            transform={bannerTransform}
          />
        </FormEditorSection>

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

        {/* Fields */}
        <FormEditorSection title="Fields" subtitle="Inputs shown to visitors, plus optional fixed values." icon="ti ti-forms">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-secondary">Fields in this form</span>
            <span class="text-[10px] text-dimmed">{entries().length} field(s)</span>
          </div>
          <Show
            when={entries().length > 0}
            fallback={<p class="text-xs text-dimmed py-1">No fields included. Pick one from the list below to start.</p>}
          >
            <ul class="flex flex-col gap-2">
              {/* Index (not For) — keys by position. Each keystroke in
                label/help-text writes a fresh entries array with a
                replaced entry object at idx, which a reference-keyed
                For interprets as "row replaced", remounting the inputs
                and stealing focus. Index keeps the row stable. */}
              <Index each={entries()}>
                {(entry, idx) => {
                  const f = () => fieldById().get(entry().fieldId);
                  // Narrow accessors per kind. The actual `entry().kind`
                  // doesn't toggle during a typing session (the kind is
                  // chosen at add-time), so the Show branch below is
                  // stable enough to avoid focus loss inside it.
                  const valueEntry = () =>
                    entry().kind === "form_value" ? (entry() as Extract<FormFieldEntry, { kind: "form_value" }>) : null;
                  const userEntry = () =>
                    entry().kind === "user_input" ? (entry() as Extract<FormFieldEntry, { kind: "user_input" }>) : null;
                  const required = () => userEntry()?.required ?? f()?.required ?? false;
                  return (
                    <Show when={f()}>
                      {(field) => (
                        <Show
                          when={valueEntry()}
                          fallback={
                            <li class="paper p-4 flex flex-col gap-2">
                              <div class="flex items-center gap-2">
                                {/* Compact arrows (h-3 each = 24 px column)
                                  so the first row's height is close to
                                  the surrounding text height — keeps the
                                  paper's perceived top padding equal to
                                  left / right / bottom. Hover lands on
                                  blue (was text-primary, too close to
                                  the dimmed default to read as a state
                                  change). */}
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
                                    disabled={idx === entries().length - 1}
                                    title="Move down"
                                    aria-label="Move down"
                                  >
                                    <i class="ti ti-chevron-down text-xs" />
                                  </button>
                                </div>
                                <span class="flex-1 min-w-0 flex items-baseline gap-2">
                                  <span class="text-sm font-medium text-primary truncate">{field().name}</span>
                                  <span class="text-[10px] text-dimmed">{TYPE_LABELS[field().type] ?? field().type}</span>
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
                                placeholder={field().name}
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
                            </li>
                          }
                        >
                          {(ve) => (
                            // Fixed value tile — the visitor never sees
                            // this field but every submission gets stamped with
                            // the configured value (e.g. "source = website" on a
                            // public lead form). FieldInput renders the platform
                            // input matching the field type with a synthetic
                            // entry; we don't want overrides for label/help on a
                            // hidden value.
                            <li class="paper p-4 flex flex-col gap-2">
                              <div class="flex items-center gap-2">
                                <i class="ti ti-lock text-dimmed shrink-0" />
                                <span class="flex-1 min-w-0 flex items-baseline gap-2">
                                  <span class="text-sm font-medium text-primary truncate">{field().name}</span>
                                  <span class="text-[10px] text-dimmed shrink-0">
                                    {TYPE_LABELS[field().type] ?? field().type} · fixed value
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
                                field={field()}
                                entry={{ kind: "user_input", fieldId: field().id, required: false }}
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
            <div class="flex flex-col gap-2">
              <SegmentedControl
                options={[
                  { value: "user_input", label: "User input", icon: "ti ti-pencil" },
                  { value: "form_value", label: "Fixed value", icon: "ti ti-lock" },
                ]}
                value={addKind}
                onChange={(v) => setAddKind(v as "user_input" | "form_value")}
              />
              <p class="text-[11px] text-dimmed leading-snug">
                <Show when={addKind() === "form_value"} fallback="User-input fields show as inputs the visitor fills out.">
                  Fixed values don't show in the form. Every submission gets the configured value, such as source = website.
                </Show>
              </p>
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
            </div>
          </Show>
        </FormEditorSection>

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
      </div>

      {/* Footer */}
      <div class="paper flex shrink-0 items-center justify-between gap-2 p-4">
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
      </div>
    </div>
  );
}

function FormEditorSection(props: { title: string; subtitle?: string; icon: string; children: JSX.Element }) {
  return (
    <section class="paper p-4">
      <header class="mb-2 flex items-start gap-2">
        <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
          <i class={`${props.icon} text-sm`} />
        </span>
        <div class="min-w-0">
          <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">{props.title}</h3>
          <Show when={props.subtitle}>
            <p class="mt-0.5 text-[11px] leading-snug text-dimmed">{props.subtitle}</p>
          </Show>
        </div>
      </header>
      <div class="flex flex-col gap-3">{props.children}</div>
    </section>
  );
}

// =============================================================================
// FormPermissions — wraps PermissionEditor with form-API wires
// =============================================================================
// Mirrors TablePermissions / ViewPermissions. allowedLevels=["write"]
// collapses the dropdown / SegmentedControl into inline badges since
// there's only one meaningful level for forms.

function FormPermissions(props: { formId: string; initialEntries: AccessEntry[]; canEdit: boolean }) {
  const [entries, setEntries] = createSignal<AccessEntry[]>(props.initialEntries);
  return (
    <PermissionEditor
      initialEntries={entries()}
      canEdit={props.canEdit}
      allowedLevels={[{ level: "write", label: "Use", icon: "ti-cursor-text" }]}
      grantAccess={async (principal, permission) => {
        const res = await apiClient.access["by-form"][":formId"].$post({
          param: { formId: props.formId },
          json: { principal, permission },
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
        const created = (await res.json()) as { accessId: string };
        const listRes = await apiClient.access["by-form"][":formId"].$get({
          param: { formId: props.formId },
        });
        const list = listRes.ok ? ((await listRes.json()) as AccessEntry[]) : entries();
        setEntries(list);
        return list.find((e) => e.id === created.accessId) ?? list[list.length - 1]!;
      }}
      updateAccess={async (accessId, permission) => {
        const res = await apiClient.access[":accessId"].$patch({
          param: { accessId },
          json: { permission },
        });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to update access"));
        setEntries(entries().map((e) => (e.id === accessId ? { ...e, permission } : e)));
      }}
      revokeAccess={async (accessId) => {
        const res = await apiClient.access[":accessId"].$delete({ param: { accessId } });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to revoke access"));
        setEntries(entries().filter((e) => e.id !== accessId));
      }}
    />
  );
}
