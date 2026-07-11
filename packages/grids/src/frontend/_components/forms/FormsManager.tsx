import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import {
  Checkbox,
  CopyButton,
  confirmDiscardIfDirty,
  dialogCore,
  ImageInput,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  panelDialogPanelClass,
  prompts,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { img } from "@valentinkolb/stdlib/browser";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, type JSX, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, Form } from "../../../service";
import type { FormConfig, FormFieldEntry } from "../../../service/forms";
import { isRecordInputField } from "../fields/field-render";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { errorMessage } from "../utils/api-helpers";
import { FormFieldsEditor } from "./FormFieldsEditor";

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

function FormEditorSection(props: { title: string; subtitle?: string; icon: string; children: JSX.Element }) {
  return (
    <PanelDialog.Section title={props.title} subtitle={props.subtitle} icon={props.icon}>
      {props.children}
    </PanelDialog.Section>
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
