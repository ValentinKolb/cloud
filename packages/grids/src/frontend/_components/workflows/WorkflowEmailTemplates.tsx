import { mutation as mutations } from "@k2b/stdlib/solid";
import {
  Button,
  CheckboxCard,
  confirmDiscardIfDirty,
  createTemplateEditorPanesLayout,
  dialogCore,
  IconButton,
  PanelDialog,
  Panes,
  Placeholder,
  panelDialogWorkspaceOptions,
  prompts,
  StatusBadge,
  TemplateEditor,
  TemplatePreview,
  TemplateSampleData,
  type TemplateVariable,
  TextInput,
  Tooltip,
  toast,
} from "@k2b/ui";
import { renderLiquidTemplate } from "@valentinkolb/cloud/shared";
import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import {
  type PublicEmailTemplate,
  type PublicEmailTemplateDependencyMap,
  PublicEmailTemplateDependencyMapSchema,
  PublicEmailTemplateListSchema,
  PublicEmailTemplateSchema,
} from "../../../api/public-email-template-contracts";
import { errorMessage } from "../utils/api-helpers";
import {
  createEmailTemplateSystemSampleData,
  DEFAULT_EMAIL_TEMPLATE_SAMPLE_DATA,
  EMAIL_TEMPLATE_SYSTEM_VARIABLES,
  emailTemplatePreviewContext,
  emailTemplateVariables,
  parseEmailTemplateSampleData,
} from "./email-template-preview-data";
import { workflowEmailTemplateDraft, workflowEmailTemplateDraftDirty } from "./workflow-email-template-draft";

const emailTemplateManagerApi = apiClient["email-templates"] as unknown as {
  "by-base": {
    ":baseId": {
      $get: (input: { param: { baseId: string } }, options?: { init?: RequestInit }) => Promise<Response>;
      dependencies: {
        $get: (input: { param: { baseId: string } }, options?: { init?: RequestInit }) => Promise<Response>;
      };
    };
  };
};

const DEFAULT_EMAIL_SUBJECT = "{{ workflow.name }}";
const DEFAULT_EMAIL_HTML = `<p>Hello,</p>
<p>A Grids workflow created an update for you.</p>
{% if data.link.url != blank %}
  <p><a href="{{ data.link.url }}">Open document</a></p>
{% endif %}
<p>{{ business.legalName | default: app.name }}</p>`;

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

const renderEmailTemplatePreview = (
  template: string,
  sampleData: Record<string, WorkflowJsonValue>,
  systemSampleData: Record<string, string>,
): string => {
  try {
    return buildEmailPreviewHtml(
      renderLiquidTemplate(template, emailTemplatePreviewContext(sampleData, systemSampleData)),
      systemSampleData["app.name"] ?? "Cloud",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template preview failed";
    return buildEmailPreviewHtml(`<p style="color:#b91c1c;">${escapePreviewText(message)}</p>`, systemSampleData["app.name"] ?? "Cloud");
  }
};

function EmailTemplateEditor(props: { baseId: string; template?: PublicEmailTemplate; onSaved: () => void; onClose: () => void }) {
  const cleanDraft = workflowEmailTemplateDraft(
    props.template,
    DEFAULT_EMAIL_SUBJECT,
    DEFAULT_EMAIL_HTML,
    DEFAULT_EMAIL_TEMPLATE_SAMPLE_DATA,
  );
  const [name, setName] = createSignal(cleanDraft.name);
  const [description, setDescription] = createSignal(cleanDraft.description);
  const [subject, setSubject] = createSignal(cleanDraft.subject);
  const [html, setHtml] = createSignal(cleanDraft.html);
  const [enabled, setEnabled] = createSignal(cleanDraft.enabled);
  const [layout, setLayout] = createSignal(createTemplateEditorPanesLayout());
  const cleanSampleDataSource = JSON.stringify(cleanDraft.sampleData, null, 2);
  const [sampleDataSource, setSampleDataSource] = createSignal(cleanSampleDataSource);
  const [systemSampleData, setSystemSampleData] = createSignal<Record<string, string>>(createEmailTemplateSystemSampleData());
  const parsedSampleData = createMemo(() => parseEmailTemplateSampleData(sampleDataSource()));
  const sampleData = createMemo(() => {
    const parsed = parsedSampleData();
    return parsed.ok ? parsed.data : cleanDraft.sampleData;
  });
  const variables = createMemo<TemplateVariable[]>(() => emailTemplateVariables(sampleData()));
  const renderedPreview = createMemo(() => {
    const parsed = parsedSampleData();
    if (!parsed.ok) {
      return buildEmailPreviewHtml(
        `<p style="color:#b91c1c;">${escapePreviewText(parsed.error)}</p>`,
        systemSampleData()["app.name"] ?? "Cloud",
      );
    }
    return renderEmailTemplatePreview(html(), parsed.data, systemSampleData());
  });
  const setSystemSampleValue = (name: string, value: string) => setSystemSampleData((current) => ({ ...current, [name]: value }));
  const dirty = () =>
    sampleDataSource() !== cleanSampleDataSource ||
    workflowEmailTemplateDraftDirty(
      { name: name(), description: description(), subject: subject(), html: html(), sampleData: sampleData(), enabled: enabled() },
      cleanDraft,
    );
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.onClose();
  };

  const saveMut = mutations.create<PublicEmailTemplate, void>({
    mutation: async (_, { abortSignal }) => {
      const payload = {
        name: name().trim(),
        description: description().trim() || null,
        subject: subject().trim(),
        html: html().trim(),
        sampleData: sampleData(),
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
      return PublicEmailTemplateSchema.parse(await res.json());
    },
    onSuccess: (saved) => {
      toast.success(`Saved "${saved.name}"`);
      props.onSaved();
      props.onClose();
    },
    onError: (error) => prompts.error(error.message),
  });

  const canSave = () =>
    name().trim().length > 0 && subject().trim().length > 0 && html().trim().length > 0 && parsedSampleData().ok && !saveMut.loading();

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
            <TextInput label="Name" value={name} onValueChange={setName} required icon="ti ti-mail" placeholder="Invoice email" />
            <TextInput
              label="Description"
              value={description}
              onValueChange={setDescription}
              icon="ti ti-align-left"
              placeholder="Optional"
            />
            <TextInput
              label="Subject"
              value={subject}
              onValueChange={setSubject}
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
                onValueChange={setEnabled}
              />
            </div>
          </div>
          <p class="shrink-0 text-xs text-dimmed">
            Type {"{{"} for values, {"{%"} for Liquid logic, or {"<"} for HTML snippets. Use sample data to change preview values.
          </p>
          <div class="min-h-[30rem] min-w-0 flex-1 overflow-hidden">
            <Panes
              layout={layout()}
              onLayoutChange={setLayout}
              class="h-full w-full"
              resizable={false}
              items={[
                {
                  id: "html",
                  title: "HTML",
                  icon: "ti ti-code",
                  render: () => (
                    <div class="h-full min-h-0 overflow-auto">
                      <TemplateEditor
                        value={html}
                        onValueChange={setHtml}
                        variables={variables()}
                        fill
                        placeholder="<p>Hello {{ business.legalName | default: app.name }}</p>"
                      />
                    </div>
                  ),
                },
                {
                  id: "preview",
                  title: "Preview",
                  icon: "ti ti-eye",
                  render: () => <TemplatePreview html={renderedPreview()} />,
                },
                {
                  id: "sample-data",
                  title: "Sample data",
                  icon: "ti ti-database",
                  render: () => (
                    <div class="flex h-full min-h-0 flex-col gap-2 overflow-auto">
                      <TextInput
                        label="Workflow data"
                        description="JSON available under data in the subject and HTML preview."
                        value={sampleDataSource}
                        onValueChange={setSampleDataSource}
                        error={() => {
                          const parsed = parsedSampleData();
                          return parsed.ok ? undefined : parsed.error;
                        }}
                        icon="ti ti-braces"
                        multiline
                        monospace
                        lines={14}
                        spellcheck={false}
                        autocapitalize="off"
                      />
                      <TemplateSampleData
                        variables={EMAIL_TEMPLATE_SYSTEM_VARIABLES}
                        values={systemSampleData()}
                        onValueChange={setSystemSampleValue}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div />
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={() => void closeIfClean()}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="button" disabled={!canSave()} onClick={() => saveMut.mutate()}>
            <i class={saveMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} /> Save email template
          </Button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export function EmailTemplateManager(props: { baseId: string; onChanged: () => void; onClose: () => void }) {
  const [templates, setTemplates] = createSignal<PublicEmailTemplate[]>([]);
  const [dependencies, setDependencies] = createSignal<PublicEmailTemplateDependencyMap>({});
  const loadMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const [templatesRes, dependenciesRes] = await Promise.all([
        emailTemplateManagerApi["by-base"][":baseId"].$get({ param: { baseId: props.baseId } }, { init: { signal: abortSignal } }),
        emailTemplateManagerApi["by-base"][":baseId"].dependencies.$get(
          { param: { baseId: props.baseId } },
          { init: { signal: abortSignal } },
        ),
      ]);
      if (!templatesRes.ok) throw new Error(await errorMessage(templatesRes, "Could not load email templates."));
      if (!dependenciesRes.ok) throw new Error(await errorMessage(dependenciesRes, "Could not load email template usage."));
      setTemplates(PublicEmailTemplateListSchema.parse(await templatesRes.json()));
      setDependencies(PublicEmailTemplateDependencyMapSchema.parse(await dependenciesRes.json()));
    },
    onError: (error) => prompts.error(error.message),
  });

  const deleteMut = mutations.create<{ deleted: boolean }, PublicEmailTemplate>({
    mutation: async (template, { abortSignal }) => {
      const usedBy = dependencies()[template.id] ?? [];
      if (usedBy.length > 0) {
        throw new Error(
          `This template is used by ${usedBy.length === 1 ? `workflow "${usedBy[0]!.workflowName}"` : `${usedBy.length} workflows`}. Edit those workflows before deleting it.`,
        );
      }
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

  const openEditor = async (template?: PublicEmailTemplate) => {
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
          <Button variant="primary" size="sm" type="button" onClick={() => void openEditor()}>
            <i class="ti ti-plus" /> Add email template
          </Button>
        }
        close={props.onClose}
      />
      <PanelDialog.Body scrollPreserveKey="grids-email-template-manager">
        <section class="paper flex flex-col gap-1 overflow-hidden p-1">
          <For
            each={templates()}
            fallback={
              <Placeholder
                state={loadMut.error() ? "error" : loadMut.loading() ? "loading" : "empty"}
                align="left"
                class="py-8"
                title={
                  loadMut.error()
                    ? "Could not load email templates"
                    : loadMut.loading()
                      ? "Loading email templates"
                      : "No email templates yet"
                }
                description={loadMut.error()?.message}
              />
            }
          >
            {(template) => (
              <article class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[var(--ui-radius-control)] px-3 py-2 transition-colors hover:bg-[var(--ui-hover)]">
                <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-secondary">
                  <i class="ti ti-mail" />
                </span>
                <button type="button" class="min-w-0 text-left" onClick={() => void openEditor(template)}>
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-sm font-semibold text-primary">{template.name}</span>
                    <StatusBadge tone={template.enabled ? "ok" : "neutral"} label={template.enabled ? "enabled" : "disabled"} />
                  </span>
                  <span class="mt-0.5 block truncate text-xs text-dimmed">{template.subject}</span>
                  <Show when={template.description}>
                    {(description) => <span class="mt-1 block truncate text-xs text-dimmed">{description()}</span>}
                  </Show>
                  <Show when={(dependencies()[template.id] ?? []).length > 0}>
                    <span class="mt-1 block truncate text-xs text-secondary">
                      Used by {(dependencies()[template.id] ?? []).map((dependency) => dependency.workflowName).join(", ")}
                    </span>
                  </Show>
                </button>
                <div class="flex items-center gap-1">
                  <Tooltip.Anchor content="Edit email template">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      type="button"
                      label="Edit email template"
                      onClick={() => void openEditor(template)}
                    >
                      <i class="ti ti-pencil" />
                    </IconButton>
                  </Tooltip.Anchor>
                  <Tooltip.Anchor content="Delete email template">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      type="button"
                      class="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      label="Delete email template"
                      disabled={deleteMut.loading() || (dependencies()[template.id] ?? []).length > 0}
                      onClick={() => deleteMut.mutate(template)}
                    >
                      <i class={deleteMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
                    </IconButton>
                  </Tooltip.Anchor>
                </div>
              </article>
            )}
          </For>
        </section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div />
        <Button variant="secondary" size="sm" type="button" onClick={props.onClose}>
          Close
        </Button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}
