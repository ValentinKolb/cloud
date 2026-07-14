import { renderLiquidTemplate } from "@valentinkolb/cloud/shared";
import {
  CheckboxCard,
  confirmDiscardIfDirty,
  createTemplateEditorPanesValue,
  dialogCore,
  PanelDialog,
  Panes,
  Placeholder,
  panelDialogWorkspaceOptions,
  prompts,
  TemplateEditor,
  TemplatePreview,
  TemplateSampleData,
  type TemplateVariable,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { EmailTemplate } from "../../../contracts";
import { errorMessage } from "../utils/api-helpers";
import { workflowEmailTemplateDraft, workflowEmailTemplateDraftDirty } from "./workflow-email-template-draft";

const EMAIL_TEMPLATE_VARIABLES: TemplateVariable[] = [
  { name: "data", kind: "object" },
  { name: "data.link.url", kind: "url" },
  { name: "data.link.expiresAt", kind: "string" },
  { name: "data.document.filename", kind: "string" },
  { name: "app.name", kind: "string" },
  { name: "app.logoSvgDataUrl", kind: "url" },
  { name: "business.legalName", kind: "string" },
  { name: "business.senderLine", kind: "string" },
  { name: "workflow.name", kind: "string" },
  { name: "run.id", kind: "string" },
  { name: "date.iso", kind: "string" },
];

const DEFAULT_EMAIL_SUBJECT = "{{ workflow.name }}";
const DEFAULT_EMAIL_HTML = `<p>Hello,</p>
<p>A Grids workflow created an update for you.</p>
{% if data.link.url != blank %}
  <p><a href="{{ data.link.url }}">Open document</a></p>
{% endif %}
<p>{{ business.legalName | default: app.name }}</p>`;

const EMAIL_TEMPLATE_SAMPLE_VARIABLES = EMAIL_TEMPLATE_VARIABLES.filter((variable) => variable.kind !== "object");

const EMAIL_TEMPLATE_SAMPLE_VALUES: Record<string, string> = {
  "data.link.url": "https://cloud.example.org/documents/download/example",
  "data.link.expiresAt": "31 Dec 2026",
  "data.document.filename": "invoice-2026-001.pdf",
  "app.name": "Cloud",
  "app.logoSvgDataUrl": "https://cloud.example.org/logo.svg",
  "business.legalName": "ACME Operations GmbH",
  "business.senderLine": "ACME Operations GmbH · Friedrichstrasse 120 · 10117 Berlin",
  "workflow.name": "Send signed document",
  "run.id": "run_01J2EXAMPLE",
  "date.iso": "2026-07-07",
};

const emailTemplateSampleValue = (name: string): string => EMAIL_TEMPLATE_SAMPLE_VALUES[name] ?? name;

const createEmailTemplateSampleData = (): Record<string, string> =>
  Object.fromEntries(EMAIL_TEMPLATE_SAMPLE_VARIABLES.map((variable) => [variable.name, emailTemplateSampleValue(variable.name)]));

const setNestedTemplateValue = (target: Record<string, unknown>, path: string[], value: string) => {
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]!;
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      const child: Record<string, unknown> = {};
      cursor[key] = child;
      cursor = child;
    } else {
      cursor = next as Record<string, unknown>;
    }
  }
  cursor[path[path.length - 1]!] = value;
};

const emailTemplateContext = (sampleData: Record<string, string>): Record<string, unknown> => {
  const context: Record<string, unknown> = {};
  for (const variable of EMAIL_TEMPLATE_SAMPLE_VARIABLES) {
    setNestedTemplateValue(context, variable.name.split("."), sampleData[variable.name] ?? emailTemplateSampleValue(variable.name));
  }
  return context;
};

const escapePreviewText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const buildEmailPreviewHtml = (content: string, appName: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;" cellpadding="0" cellspacing="0">
        <tr><td style="background:#ffffff;padding:20px 24px;border-radius:12px 12px 0 0;border:1px solid #e4e4e7;border-bottom:none;">
          <span style="font-size:16px;font-weight:600;color:#18181b;">${escapePreviewText(appName)}</span>
        </td></tr>
        <tr><td style="background:#ffffff;padding:28px 24px;border-left:1px solid #e4e4e7;border-right:1px solid #e4e4e7;">
          <div style="font-size:14px;line-height:1.6;color:#27272a;">${content}</div>
        </td></tr>
        <tr><td style="background:#fafafa;padding:16px 24px;border-radius:0 0 12px 12px;border:1px solid #e4e4e7;border-top:none;">
          <p style="margin:0;font-size:11px;color:#a1a1aa;text-align:center;">This message was sent automatically. Please do not reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;

const renderEmailTemplatePreview = (template: string, sampleData: Record<string, string>): string => {
  try {
    return buildEmailPreviewHtml(renderLiquidTemplate(template, emailTemplateContext(sampleData)), sampleData["app.name"] ?? "Cloud");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template preview failed";
    return buildEmailPreviewHtml(`<p style="color:#b91c1c;">${escapePreviewText(message)}</p>`, sampleData["app.name"] ?? "Cloud");
  }
};

function EmailTemplateEditor(props: { baseId: string; template?: EmailTemplate; onSaved: () => void; onClose: () => void }) {
  const cleanDraft = workflowEmailTemplateDraft(props.template, DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_HTML);
  const [name, setName] = createSignal(cleanDraft.name);
  const [description, setDescription] = createSignal(cleanDraft.description);
  const [subject, setSubject] = createSignal(cleanDraft.subject);
  const [html, setHtml] = createSignal(cleanDraft.html);
  const [enabled, setEnabled] = createSignal(cleanDraft.enabled);
  const [panes, setPanes] = createSignal(createTemplateEditorPanesValue());
  const [sampleData, setSampleData] = createSignal<Record<string, string>>(createEmailTemplateSampleData());
  const renderedPreview = createMemo(() => renderEmailTemplatePreview(html(), sampleData()));
  const setSampleValue = (name: string, value: string) => setSampleData((current) => ({ ...current, [name]: value }));
  const dirty = () =>
    workflowEmailTemplateDraftDirty(
      { name: name(), description: description(), subject: subject(), html: html(), enabled: enabled() },
      cleanDraft,
    );
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.onClose();
  };

  const saveMut = mutations.create<EmailTemplate, void>({
    mutation: async (_, { abortSignal }) => {
      const payload = {
        name: name().trim(),
        description: description().trim() || null,
        subject: subject().trim(),
        html: html().trim(),
        enabled: enabled(),
      };
      if (!payload.name) throw new Error("Name is required.");
      if (!payload.subject) throw new Error("Subject is required.");
      if (!payload.html) throw new Error("HTML is required.");
      const res = props.template
        ? await apiClient["email-templates"][":templateId"].$patch(
            { param: { templateId: props.template.id }, json: payload },
            { init: { signal: abortSignal } },
          )
        : await apiClient["email-templates"]["by-base"][":baseId"].$post(
            { param: { baseId: props.baseId }, json: payload },
            { init: { signal: abortSignal } },
          );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not save email template."));
      return res.json();
    },
    onSuccess: (saved) => {
      toast.success(`Saved "${saved.name}"`);
      props.onSaved();
      props.onClose();
    },
    onError: (error) => prompts.error(error.message),
  });

  const canSave = () => name().trim().length > 0 && subject().trim().length > 0 && html().trim().length > 0 && !saveMut.loading();

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.template ? `Email template — ${props.template.name}` : "New email template"}
        subtitle="Reusable Liquid email for workflow sendEmail steps."
        icon="ti ti-mail"
        close={() => void closeIfClean()}
      />
      <PanelDialog.Body scrollPreserveKey={`grids-email-template-editor-${props.template?.id ?? "new"}`}>
        <div class="flex min-h-[42rem] flex-1 flex-col gap-2">
          <div class="grid shrink-0 gap-2 md:grid-cols-2">
            <TextInput label="Name" value={name} onInput={setName} required icon="ti ti-mail" placeholder="Invoice email" />
            <TextInput label="Description" value={description} onInput={setDescription} icon="ti ti-align-left" placeholder="Optional" />
            <TextInput
              label="Subject"
              value={subject}
              onInput={setSubject}
              required
              icon="ti ti-text-caption"
              placeholder="{{ workflow.name }}"
              monospace
            />
            <div class="md:col-span-2">
              <CheckboxCard
                label="Enabled"
                description="Enabled email templates can be used by workflow sendEmail steps."
                icon="ti ti-mail-check"
                value={enabled}
                onChange={setEnabled}
              />
            </div>
          </div>
          <p class="shrink-0 text-xs text-dimmed">
            Type {"{{"} for values, {"{%"} for Liquid logic, or {"<"} for HTML snippets. Use sample data to change preview values.
          </p>
          <div class="min-h-[30rem] min-w-0 flex-1 overflow-hidden rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900">
            <Panes.Root value={panes()} onChange={setPanes} class="h-full w-full" allowResize={false}>
              <Panes.Element id="html" title="HTML" icon="ti ti-code">
                <div class="h-full min-h-0 overflow-auto">
                  <TemplateEditor
                    value={html}
                    onInput={setHtml}
                    variables={EMAIL_TEMPLATE_VARIABLES}
                    fill
                    placeholder="<p>Hello {{ business.legalName | default: app.name }}</p>"
                  />
                </div>
              </Panes.Element>
              <Panes.Element id="preview" title="Preview" icon="ti ti-eye">
                <TemplatePreview html={renderedPreview} />
              </Panes.Element>
              <Panes.Element id="sample-data" title="Sample data" icon="ti ti-database">
                <TemplateSampleData variables={EMAIL_TEMPLATE_SAMPLE_VARIABLES} values={sampleData} onChange={setSampleValue} />
              </Panes.Element>
            </Panes.Root>
          </div>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div />
        <div class="flex items-center gap-2">
          <button type="button" class="btn-input btn-sm" onClick={() => void closeIfClean()}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" disabled={!canSave()} onClick={() => saveMut.mutate()}>
            <i class={saveMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} /> Save email template
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export function EmailTemplateManager(props: { baseId: string; onChanged: () => void; onClose: () => void }) {
  const [templates, setTemplates] = createSignal<EmailTemplate[]>([]);
  const sortedTemplates = createMemo(() =>
    [...templates()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
  );

  const loadMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const res = await apiClient["email-templates"]["by-base"][":baseId"].$get(
        { param: { baseId: props.baseId } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load email templates."));
      setTemplates(await res.json());
    },
    onError: (error) => prompts.error(error.message),
  });

  const deleteMut = mutations.create<{ deleted: boolean }, EmailTemplate>({
    mutation: async (template, { abortSignal }) => {
      const confirmed = await prompts.confirm(`Delete "${template.name}"?`, {
        title: "Delete email template",
        icon: "ti ti-trash",
        confirmText: "Delete template",
        variant: "danger",
      });
      if (!confirmed) return { deleted: false };
      const res = await apiClient["email-templates"][":templateId"].$delete(
        { param: { templateId: template.id } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not delete email template."));
      return { deleted: true };
    },
    onSuccess: (result) => {
      if (!result.deleted) return;
      toast.success("Email template deleted");
      props.onChanged();
      loadMut.mutate();
    },
    onError: (error) => prompts.error(error.message),
  });

  onMount(() => loadMut.mutate());

  const openEditor = async (template?: EmailTemplate) => {
    await dialogCore.open<void>(
      (close) => (
        <EmailTemplateEditor
          baseId={props.baseId}
          template={template}
          onSaved={() => {
            props.onChanged();
            loadMut.mutate();
          }}
          onClose={close}
        />
      ),
      { ...panelDialogWorkspaceOptions, cancelBehavior: "ignore" },
    );
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Email templates"
        subtitle="Reusable Liquid emails for workflow sendEmail steps."
        icon="ti ti-mail"
        actions={
          <button type="button" class="btn-primary btn-sm" onClick={() => void openEditor()}>
            <i class="ti ti-plus" /> Add email template
          </button>
        }
        close={props.onClose}
      />
      <PanelDialog.Body scrollPreserveKey="grids-email-template-manager">
        <section class="paper overflow-hidden">
          <For
            each={sortedTemplates()}
            fallback={
              <Placeholder align="left" class="py-8">
                {loadMut.loading() ? "Loading email templates..." : "No email templates yet."}
              </Placeholder>
            }
          >
            {(template) => (
              <article class="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800">
                <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-secondary dark:bg-zinc-900">
                  <i class="ti ti-mail" />
                </span>
                <button type="button" class="min-w-0 text-left" onClick={() => void openEditor(template)}>
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-sm font-semibold text-primary">{template.name}</span>
                    <span class={`badge ${template.enabled ? "badge-success" : "badge-neutral"}`}>
                      {template.enabled ? "enabled" : "disabled"}
                    </span>
                  </span>
                  <span class="mt-0.5 block truncate text-xs text-dimmed">{template.subject}</span>
                  <Show when={template.description}>
                    {(description) => <span class="mt-1 block truncate text-xs text-dimmed">{description()}</span>}
                  </Show>
                </button>
                <div class="flex items-center gap-1">
                  <button type="button" class="icon-btn" title="Edit email template" onClick={() => void openEditor(template)}>
                    <i class="ti ti-pencil" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    title="Delete email template"
                    disabled={deleteMut.loading()}
                    onClick={() => deleteMut.mutate(template)}
                  >
                    <i class={deleteMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
                  </button>
                </div>
              </article>
            )}
          </For>
        </section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div />
        <button type="button" class="btn-input btn-sm" onClick={props.onClose}>
          Close
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}
