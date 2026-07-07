import { renderLiquidTemplate } from "@valentinkolb/cloud/shared";
import {
  AutocompleteEditor,
  CheckboxCard,
  CodeDisplay,
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
import { highlight } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type {
  DocumentRunSummary,
  DslQueryPreviewDiagnostic,
  EmailTemplate,
  Workflow,
  WorkflowEmailDelivery,
  WorkflowRun,
  WorkflowRunStats,
  WorkflowStepRun,
  WorkflowTriggerKind,
} from "../../../contracts";
import type { Table } from "../../../service";
import { downloadPdfResponse } from "../documents/document-download";
import { errorMessage } from "../utils/api-helpers";
import { buildBackendWorkflowCompletions } from "./workflow-autocomplete";

type Props = {
  baseId: string;
  baseShortId: string;
  tables: Table[];
  workflows: Workflow[];
  activeWorkflow: Workflow | null;
  selectedRunId: string | null;
  canCreateWorkflows: boolean;
  canRunActiveWorkflow: boolean;
  canManageActiveWorkflow: boolean;
  editMode: boolean;
  onWorkflowChanged: () => void;
  onSelectRun: (runId: string | null) => void;
};

type WorkflowRunPage = {
  items: WorkflowRun[];
  nextCursor?: string | null;
};

type WorkflowEmailDeliveryPage = {
  items: WorkflowEmailDelivery[];
  nextCursor?: string | null;
};

const workflowHighlight = highlight.compile(
  [
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/ },
    {
      kind: "keyword",
      match:
        /\b(?:inputs|triggers|steps|type|table|required|options|form|api|scanner|bulkSelection|dashboardButton|schedule|recordEvent|enabled|input|resolve|by|field|event|cron|timezone|updateRecord|createRecord|generateDocument|createDocumentLink|sendEmail|httpRequest|setVariable|fail|if|then|else|switch|cases|default|forEach|as|do|record|recordList|text|number|boolean|date|dateTime|select|method|url|headers|json|timeoutMs|saveAs|set|values|template|document|expiresIn|comment|to|email|user|data|batch|filename|tags|message|name|description)\b/,
    },
    { kind: "function", match: /\bnow\(\)/ },
    { kind: "placeholder", match: /\binputs\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_ -]+)?\b/ },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /[:{}\[\],-]/ },
    { kind: "comment", match: /#[^\n]*/ },
  ],
  { classPrefix: "doc-token-" },
);

const triggerLabels: Record<WorkflowTriggerKind, string> = {
  form: "Form",
  api: "API",
  scanner: "Scanner",
  bulkSelection: "Bulk",
  dashboardButton: "Dashboard",
  schedule: "Schedule",
  recordEvent: "Record event",
};

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
          <div style="font-size:14px;line-height:1.6;color:#27272a;">
            ${content}
          </div>
        </td></tr>
        <tr><td style="background:#fafafa;padding:16px 24px;border-radius:0 0 12px 12px;border:1px solid #e4e4e7;border-top:none;">
          <p style="margin:0;font-size:11px;color:#a1a1aa;text-align:center;">
            This message was sent automatically. Please do not reply to this email.
          </p>
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

const workflowReferenceHref = (baseShortId: string) => `/app/grids/${encodeURIComponent(baseShortId)}/reference/workflows`;

const openWorkflowReferenceWindow = (baseShortId: string) => {
  if (typeof window === "undefined") return;
  window.open(workflowReferenceHref(baseShortId), "grids-workflow-reference", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
};

const statusClass = (status: WorkflowRun["status"]) =>
  status === "succeeded" ? "badge-success" : status === "failed" || status === "canceled" ? "badge-danger" : "badge-neutral";

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "-");

const formatDuration = (run: WorkflowRun): string => {
  if (!run.startedAt || !run.finishedAt) return "-";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
};

const triggerSummary = (workflow: Workflow): string => {
  const triggers = Object.keys(workflow.compiled.triggers) as WorkflowTriggerKind[];
  if (triggers.length === 0) return "No trigger";
  return triggers.map((trigger) => triggerLabels[trigger] ?? trigger).join(", ");
};

const workflowTriggers = (workflow: Workflow): WorkflowTriggerKind[] => Object.keys(workflow.compiled.triggers) as WorkflowTriggerKind[];

const workflowSearch = (workflow: Workflow): string =>
  [workflow.name, workflow.description ?? "", workflow.source, triggerSummary(workflow)].join(" ").toLowerCase();

const yamlString = (value: string): string => JSON.stringify(value);

const defaultSource = (
  table?: Table,
) => `${table ? `inputs:\n  record:\n    type: record\n    table: ${yamlString(table.name)}\n` : ""}triggers:
  form: {}
steps:
  - setVariable:
      name: ranAt
      value: now()
`;

const directRunTriggers = (workflow: Workflow): WorkflowTriggerKind[] =>
  (["form", "api", "dashboardButton"] as WorkflowTriggerKind[]).filter((trigger) => workflow.compiled.triggers[trigger]);

const emptyStats = (): WorkflowRunStats => ({
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  canceled: 0,
  failedLast24h: 0,
  lastRunAt: null,
});

function DiagnosticsPanel(props: { diagnostics: DslQueryPreviewDiagnostic[]; validating: boolean }) {
  const hasDiagnostics = () => props.diagnostics.length > 0;
  return (
    <div class={`text-xs ${hasDiagnostics() ? "info-block-danger" : "info-block-success"}`}>
      <div class="flex items-center gap-2 font-medium">
        <i class={`ti ${props.validating ? "ti-loader-2 animate-spin" : hasDiagnostics() ? "ti-alert-triangle" : "ti-circle-check"}`} />
        <span>{props.validating ? "Validating..." : hasDiagnostics() ? "Workflow YAML has diagnostics" : "Workflow YAML is valid"}</span>
      </div>
      <Show when={hasDiagnostics()}>
        <ul class="mt-2 space-y-1">
          <For each={props.diagnostics}>
            {(diagnostic) => (
              <li>
                <Show when={diagnostic.line || diagnostic.column}>
                  <span class="font-mono text-[11px] uppercase">
                    {diagnostic.line ? `Line ${diagnostic.line}` : ""}
                    {diagnostic.column ? ` · Col ${diagnostic.column}` : ""}
                    {": "}
                  </span>
                </Show>
                {diagnostic.message}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function WorkflowEditor(props: Props & { workflow?: Workflow; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = createSignal(props.workflow?.name ?? "");
  const [description, setDescription] = createSignal(props.workflow?.description ?? "");
  const [enabled, setEnabled] = createSignal(props.workflow?.enabled ?? false);
  const [source, setSource] = createSignal(props.workflow?.source ?? defaultSource(props.tables[0]));
  const [diagnostics, setDiagnostics] = createSignal<DslQueryPreviewDiagnostic[]>([]);
  const [validating, setValidating] = createSignal(false);
  let validationTimer: ReturnType<typeof setTimeout> | undefined;
  let validationAbort: AbortController | undefined;

  const fetchAutocomplete = async (request: { source: string; caret: number }, signal: AbortSignal) => {
    const response = await apiClient.workflows["by-base"][":baseId"].autocomplete.$post(
      { param: { baseId: props.baseId }, json: request },
      { init: { signal } },
    );
    if (!response.ok) throw new Error(await errorMessage(response, "Could not load workflow suggestions."));
    return response.json();
  };

  const completions = createMemo(() =>
    buildBackendWorkflowCompletions({
      fetchAutocomplete,
      onDiagnostics: (response) => setDiagnostics(response.diagnostics),
    }),
  );

  const runValidation = async (value: string) => {
    validationAbort?.abort();
    const abort = new AbortController();
    validationAbort = abort;
    if (!value.trim()) {
      setDiagnostics([{ message: "Workflow source is required" }]);
      setValidating(false);
      return;
    }
    setValidating(true);
    try {
      const response = await fetchAutocomplete({ source: value, caret: value.length }, abort.signal);
      if (!abort.signal.aborted) setDiagnostics(response.diagnostics);
    } catch (error) {
      if (!abort.signal.aborted) setDiagnostics([{ message: error instanceof Error ? error.message : "Could not validate workflow." }]);
    } finally {
      if (!abort.signal.aborted) setValidating(false);
    }
  };

  createEffect(() => {
    const current = source();
    if (validationTimer) clearTimeout(validationTimer);
    validationTimer = setTimeout(() => void runValidation(current), 350);
  });

  onCleanup(() => {
    if (validationTimer) clearTimeout(validationTimer);
    validationAbort?.abort();
  });

  const saveMut = mutations.create<Workflow, void>({
    mutation: async (_, { abortSignal }) => {
      const payload = {
        name: name().trim(),
        description: description().trim() || null,
        enabled: enabled(),
        source: source(),
      };
      if (!payload.name) throw new Error("Name is required.");
      const res = props.workflow
        ? await apiClient.workflows[":workflowId"].$patch(
            { param: { workflowId: props.workflow.id }, json: payload },
            { init: { signal: abortSignal } },
          )
        : await apiClient.workflows["by-base"][":baseId"].$post(
            { param: { baseId: props.baseId }, json: payload },
            { init: { signal: abortSignal } },
          );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not save workflow."));
      return res.json();
    },
    onSuccess: (saved) => {
      toast.success(`Saved "${saved.name}"`);
      props.onSaved();
      props.onClose();
    },
    onError: (error) => prompts.error(error.message),
  });

  const deleteMut = mutations.create<{ deleted: boolean }, Workflow>({
    mutation: async (workflow, { abortSignal }) => {
      const confirmed = await prompts.confirm(`Delete "${workflow.name}"?`, {
        title: "Delete workflow",
        icon: "ti ti-trash",
        confirmText: "Delete workflow",
        variant: "danger",
      });
      if (!confirmed) return { deleted: false };
      const res = await apiClient.workflows[":workflowId"].$delete(
        { param: { workflowId: workflow.id } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not delete workflow."));
      return { deleted: true };
    },
    onSuccess: (result) => {
      if (!result.deleted) return;
      toast.success("Workflow deleted");
      props.onSaved();
      props.onClose();
    },
    onError: (error) => prompts.error(error.message),
  });

  const canSave = () =>
    name().trim().length > 0 && source().trim().length > 0 && diagnostics().length === 0 && !validating() && !saveMut.loading();

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.workflow ? `Manage workflow — ${props.workflow.name}` : "New workflow"}
        subtitle="Metadata, status, and executable YAML."
        icon="ti ti-route"
        close={props.onClose}
      />
      <PanelDialog.Body scrollPreserveKey={`grids-workflow-editor-${props.workflow?.id ?? "new"}`}>
        <div class="flex min-h-[34rem] flex-1 flex-col gap-2">
          <div class="grid shrink-0 gap-2 md:grid-cols-2">
            <TextInput label="Name" value={name} onInput={setName} required icon="ti ti-route" placeholder="Workflow name" />
            <TextInput label="Description" value={description} onInput={setDescription} icon="ti ti-align-left" placeholder="Optional" />
            <div class="md:col-span-2">
              <CheckboxCard
                label="Enabled"
                description="Enabled workflows can run from declared triggers and manual runs."
                icon="ti ti-player-play"
                value={enabled}
                onChange={setEnabled}
              />
            </div>
          </div>

          <section class="flex min-h-0 flex-1 flex-col gap-2">
            <div class="flex items-center justify-between gap-2">
              <div>
                <h3 class="detail-section-label mb-0">YAML source</h3>
                <p class="text-xs text-dimmed">Defines inputs, triggers, and steps.</p>
              </div>
              <button type="button" class="btn-input btn-input-sm" onClick={() => openWorkflowReferenceWindow(props.baseShortId)}>
                <i class="ti ti-external-link" /> Open reference
              </button>
            </div>
            <div class="min-h-[24rem] flex-1">
              <AutocompleteEditor
                value={source}
                onInput={setSource}
                completions={completions()}
                highlight={workflowHighlight}
                variant="paper"
                fill
                restoreExpansionOnBackspace={false}
                placeholder={defaultSource(props.tables[0])}
                ariaLabel="Workflow YAML source"
              />
            </div>
            <DiagnosticsPanel diagnostics={diagnostics()} validating={validating()} />
          </section>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div>
          <Show when={props.workflow}>
            {(workflow) => (
              <button type="button" class="btn-danger btn-sm" disabled={deleteMut.loading()} onClick={() => deleteMut.mutate(workflow())}>
                <i class={deleteMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} /> Delete workflow
              </button>
            )}
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" disabled={!canSave()} onClick={() => saveMut.mutate()}>
            <i class={saveMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} /> Save workflow
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

function EmailTemplateEditor(props: { baseId: string; template?: EmailTemplate; onSaved: () => void; onClose: () => void }) {
  const [name, setName] = createSignal(props.template?.name ?? "");
  const [description, setDescription] = createSignal(props.template?.description ?? "");
  const [subject, setSubject] = createSignal(props.template?.subject ?? DEFAULT_EMAIL_SUBJECT);
  const [html, setHtml] = createSignal(props.template?.html ?? DEFAULT_EMAIL_HTML);
  const [enabled, setEnabled] = createSignal(props.template?.enabled ?? true);
  const [panes, setPanes] = createSignal(createTemplateEditorPanesValue());
  const [sampleData, setSampleData] = createSignal<Record<string, string>>(createEmailTemplateSampleData());
  const renderedPreview = createMemo(() => renderEmailTemplatePreview(html(), sampleData()));
  const setSampleValue = (name: string, value: string) => {
    setSampleData((current) => ({ ...current, [name]: value }));
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
        close={props.onClose}
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
          <button type="button" class="btn-input btn-sm" onClick={props.onClose}>
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

function EmailTemplateManager(props: { baseId: string; onChanged: () => void; onClose: () => void }) {
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
      panelDialogWorkspaceOptions,
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

function StatCard(props: { label: string; value: number | string; icon: string; tone?: "default" | "danger" | "success" }) {
  const toneClass = () =>
    props.tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : props.tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-secondary";
  return (
    <div class="paper flex min-w-0 items-center gap-3 px-3 py-2">
      <span class={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-900 ${toneClass()}`}>
        <i class={`ti ti-${props.icon}`} />
      </span>
      <span class="min-w-0">
        <span class="block text-xs uppercase tracking-wider text-dimmed">{props.label}</span>
        <span class="block truncate text-lg font-semibold text-primary">{props.value}</span>
      </span>
    </div>
  );
}

function WorkflowCard(props: { baseShortId: string; workflow: Workflow; active?: boolean }) {
  const href = () => `/app/grids/${props.baseShortId}/workflows/${props.workflow.shortId}`;
  return (
    <a
      href={href()}
      class={`flex min-w-0 items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
        props.active
          ? "border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/20"
          : "border-zinc-100 bg-white hover:border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      }`}
    >
      <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-secondary dark:bg-zinc-900">
        <i class="ti ti-route" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-semibold text-primary">{props.workflow.name}</span>
          <span class={`badge ${props.workflow.enabled ? "badge-success" : "badge-neutral"}`}>
            {props.workflow.enabled ? "enabled" : "disabled"}
          </span>
        </span>
        <Show when={props.workflow.description}>
          {(description) => <span class="mt-0.5 block truncate text-xs text-dimmed">{description()}</span>}
        </Show>
        <span class="mt-2 flex flex-wrap gap-1">
          <For each={workflowTriggers(props.workflow)}>{(trigger) => <span class="tag">{triggerLabels[trigger] ?? trigger}</span>}</For>
        </span>
      </span>
    </a>
  );
}

function RunTimeline(props: {
  runs: WorkflowRun[];
  workflows: Workflow[];
  selectedRunId: string | null;
  showWorkflow?: boolean;
  loading?: boolean;
  nextCursor?: string | null;
  onSelect: (runId: string) => void;
  onLoadMore?: () => void;
}) {
  const workflowById = createMemo(() => new Map(props.workflows.map((workflow) => [workflow.id, workflow])));
  return (
    <div class="flex min-h-0 flex-col">
      <For
        each={props.runs}
        fallback={
          <Placeholder align="left" class="py-8">
            {props.loading ? "Loading runs..." : "No workflow runs yet."}
          </Placeholder>
        }
      >
        {(run) => {
          const workflow = () => (run.workflowId ? workflowById().get(run.workflowId) : null);
          return (
            <button
              type="button"
              class={`grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 border-b border-zinc-100 px-3 py-2 text-left text-xs last:border-b-0 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/70 ${
                props.selectedRunId === run.id ? "bg-blue-50/60 dark:bg-blue-950/20" : ""
              }`}
              onClick={() => props.onSelect(run.id)}
            >
              <span class={`badge ${statusClass(run.status)}`}>{run.status}</span>
              <span class="min-w-0">
                <span class="block truncate font-medium text-primary">
                  {props.showWorkflow ? (workflow()?.name ?? "Deleted workflow") : (triggerLabels[run.triggerKind] ?? run.triggerKind)}
                </span>
                <span class="mt-0.5 block truncate text-dimmed">
                  {props.showWorkflow ? `${triggerLabels[run.triggerKind] ?? run.triggerKind} · ` : ""}
                  {formatDate(run.createdAt)}
                </span>
                <Show when={run.error}>{(error) => <span class="mt-1 block truncate text-red-600 dark:text-red-400">{error()}</span>}</Show>
              </span>
              <span class="whitespace-nowrap text-dimmed">{formatDuration(run)}</span>
            </button>
          );
        }}
      </For>
      <Show when={props.nextCursor}>
        <div class="border-t border-zinc-100 px-3 py-2 text-center dark:border-zinc-800">
          <button type="button" class="btn-simple btn-sm" onClick={props.onLoadMore} disabled={props.loading}>
            <i class={props.loading ? "ti ti-loader-2 animate-spin" : "ti ti-chevrons-down"} /> Load more
          </button>
        </div>
      </Show>
    </div>
  );
}

function EmailDeliveryTable(props: {
  deliveries: WorkflowEmailDelivery[];
  workflows: Workflow[];
  loading?: boolean;
  nextCursor?: string | null;
  showWorkflow?: boolean;
  onLoadMore?: () => void;
}) {
  const workflowById = createMemo(() => new Map(props.workflows.map((workflow) => [workflow.id, workflow])));
  const recipients = (delivery: WorkflowEmailDelivery) =>
    delivery.recipients.map((recipient) => `${recipient.kind}:${recipient.recipient}`).join(", ") || "-";
  return (
    <section class="paper min-h-0 overflow-hidden">
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <div class="min-w-0">
          <h2 class="truncate text-sm font-semibold text-primary">Email deliveries</h2>
          <p class="text-xs text-dimmed">Workflow sendEmail audit trail.</p>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-zinc-50 text-[11px] uppercase tracking-wider text-dimmed dark:bg-zinc-900/70">
            <tr>
              <th class="px-3 py-2 font-medium">Status</th>
              <Show when={props.showWorkflow}>
                <th class="px-3 py-2 font-medium">Workflow</th>
              </Show>
              <th class="px-3 py-2 font-medium">Subject</th>
              <th class="px-3 py-2 font-medium">Recipients</th>
              <th class="px-3 py-2 font-medium">Sent</th>
            </tr>
          </thead>
          <tbody>
            <For
              each={props.deliveries}
              fallback={
                <tr>
                  <td colSpan={props.showWorkflow ? 5 : 4}>
                    <Placeholder align="left" class="py-8">
                      {props.loading ? "Loading email deliveries..." : "No workflow emails sent yet."}
                    </Placeholder>
                  </td>
                </tr>
              }
            >
              {(delivery) => (
                <tr class="border-t border-zinc-100 dark:border-zinc-800">
                  <td class="px-3 py-2">
                    <span class={`badge ${delivery.status === "failed" ? "badge-danger" : "badge-success"}`}>{delivery.status}</span>
                    <Show when={delivery.error}>
                      {(error) => <span class="mt-1 block max-w-48 truncate text-red-600 dark:text-red-400">{error()}</span>}
                    </Show>
                  </td>
                  <Show when={props.showWorkflow}>
                    <td class="max-w-48 truncate px-3 py-2 text-primary">
                      {delivery.workflowId ? (workflowById().get(delivery.workflowId)?.name ?? "Deleted workflow") : "-"}
                    </td>
                  </Show>
                  <td class="max-w-72 truncate px-3 py-2 text-primary">{delivery.subject ?? "-"}</td>
                  <td class="max-w-72 truncate px-3 py-2 text-dimmed">{recipients(delivery)}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-dimmed">{formatDate(delivery.createdAt)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={props.nextCursor}>
        <div class="border-t border-zinc-100 px-3 py-2 text-center dark:border-zinc-800">
          <button type="button" class="btn-simple btn-sm" onClick={props.onLoadMore} disabled={props.loading}>
            <i class={props.loading ? "ti ti-loader-2 animate-spin" : "ti ti-chevrons-down"} /> Load more
          </button>
        </div>
      </Show>
    </section>
  );
}

export function WorkflowRunDetailPanel(props: { runId: string; onClose: () => void }) {
  const [run, setRun] = createSignal<WorkflowRun | null>(null);
  const [steps, setSteps] = createSignal<WorkflowStepRun[]>([]);
  const [documents, setDocuments] = createSignal<{ items: DocumentRunSummary[]; total: number; hasMore: boolean }>({
    items: [],
    total: 0,
    hasMore: false,
  });
  const [downloadingDocumentId, setDownloadingDocumentId] = createSignal<string | null>(null);
  const [downloadingAll, setDownloadingAll] = createSignal(false);

  const loadMut = mutations.create<void, string>({
    mutation: async (runId, { abortSignal }) => {
      const [runRes, stepsRes, documentsRes] = await Promise.all([
        apiClient.workflows.runs[":runId"].$get({ param: { runId } }, { init: { signal: abortSignal } }),
        apiClient.workflows.runs[":runId"].steps.$get({ param: { runId } }, { init: { signal: abortSignal } }),
        apiClient.workflows.runs[":runId"].documents.$get({ param: { runId }, query: { limit: "100" } }, { init: { signal: abortSignal } }),
      ]);
      if (!runRes.ok) throw new Error(await errorMessage(runRes, "Could not load workflow run."));
      if (!stepsRes.ok) throw new Error(await errorMessage(stepsRes, "Could not load workflow run steps."));
      if (!documentsRes.ok) throw new Error(await errorMessage(documentsRes, "Could not load generated documents."));
      setRun(await runRes.json());
      setSteps((await stepsRes.json()).items);
      const documentPage = await documentsRes.json();
      setDocuments({
        items: documentPage.items,
        total: documentPage.total ?? documentPage.items.length,
        hasMore: documentPage.hasMore ?? false,
      });
    },
    onError: (error) => prompts.error(error.message),
  });

  createEffect(() => loadMut.mutate(props.runId));

  const downloadDocument = async (document: DocumentRunSummary) => {
    setDownloadingDocumentId(document.id);
    try {
      const res = await fetch(`/api/grids/documents/runs/${encodeURIComponent(document.id)}/download`);
      await downloadPdfResponse(res, document.filename);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not download document.");
    } finally {
      setDownloadingDocumentId(null);
    }
  };

  const downloadAllDocuments = async () => {
    setDownloadingAll(true);
    try {
      const res = await fetch(`/api/grids/workflows/runs/${encodeURIComponent(props.runId)}/documents/download`);
      await downloadPdfResponse(res, `workflow-run-${props.runId.slice(0, 8)}.pdf`);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not download generated documents.");
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <>
      <section class="detail-section">
        <div class="flex items-start gap-3">
          <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-secondary dark:bg-zinc-900">
            <i class="ti ti-activity" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <h2 class="truncate text-sm font-semibold text-primary">Workflow run</h2>
              <Show when={run()}>{(current) => <span class={`badge ${statusClass(current().status)}`}>{current().status}</span>}</Show>
            </div>
            <p class="mt-0.5 text-xs text-dimmed">{run() ? formatDate(run()!.createdAt) : "Loading..."}</p>
          </div>
          <button type="button" class="icon-btn" onClick={props.onClose} title="Close run details" aria-label="Close run details">
            <i class="ti ti-x" />
          </button>
        </div>
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Execution</h3>
        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
          <span class="text-dimmed">Trigger</span>
          <span class="text-primary">{run() ? (triggerLabels[run()!.triggerKind] ?? run()!.triggerKind) : "-"}</span>
          <span class="text-dimmed">Started</span>
          <span class="text-primary">{run() ? formatDate(run()!.startedAt) : "-"}</span>
          <span class="text-dimmed">Finished</span>
          <span class="text-primary">{run() ? formatDate(run()!.finishedAt) : "-"}</span>
          <span class="text-dimmed">Duration</span>
          <span class="text-primary">{run() ? formatDuration(run()!) : "-"}</span>
        </div>
        <Show when={run()?.error}>
          {(error) => (
            <p class="mt-3 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error()}</p>
          )}
        </Show>
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Input</h3>
        <CodeDisplay language="text" code={JSON.stringify(run()?.resolvedInput ?? run()?.triggerInput ?? {}, null, 2)} copy />
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Steps</h3>
        <For
          each={steps()}
          fallback={
            <Placeholder align="left" class="py-3">
              {loadMut.loading() ? "Loading steps..." : "No step details."}
            </Placeholder>
          }
        >
          {(step) => (
            <div class="grid grid-cols-[auto_1fr_auto] gap-2 border-b border-zinc-100 py-2 text-xs last:border-b-0 dark:border-zinc-800">
              <span class={`badge ${statusClass(step.status)}`}>{step.status}</span>
              <span class="min-w-0 truncate text-primary">
                {step.stepPath} · {step.kind}
              </span>
              <span class="text-dimmed">{step.durationMs == null ? "-" : `${step.durationMs}ms`}</span>
              <Show when={step.error}>
                <p class="col-span-3 text-red-600 dark:text-red-400">{step.error}</p>
              </Show>
            </div>
          )}
        </For>
      </section>

      <section class="detail-section">
        <div class="flex items-center justify-between gap-2">
          <h3 class="detail-section-label mb-0">Generated documents</h3>
          <Show when={documents().total > 0}>
            <button type="button" class="btn-simple btn-sm" onClick={() => void downloadAllDocuments()} disabled={downloadingAll()}>
              <i class={downloadingAll() ? "ti ti-loader-2 animate-spin" : "ti ti-download"} /> All
            </button>
          </Show>
        </div>
        <For
          each={documents().items}
          fallback={
            <Placeholder align="left" class="py-3">
              No documents generated by this run.
            </Placeholder>
          }
        >
          {(document) => (
            <div class="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-zinc-100 py-2 text-xs last:border-b-0 dark:border-zinc-800">
              <i class="ti ti-file-type-pdf text-dimmed" />
              <span class="min-w-0">
                <span class="block truncate text-primary">{document.filename}</span>
                <span class="block truncate text-dimmed">{document.documentNumber}</span>
              </span>
              <button
                type="button"
                class="btn-simple btn-sm"
                title="Download document"
                onClick={() => void downloadDocument(document)}
                disabled={downloadingDocumentId() === document.id}
              >
                {downloadingDocumentId() === document.id ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
              </button>
            </div>
          )}
        </For>
      </section>
    </>
  );
}

export default function WorkflowsPage(props: Props) {
  const [search, setSearch] = createSignal("");
  const [items, setItems] = createSignal<Workflow[]>(props.workflows);
  const [stats, setStats] = createSignal<WorkflowRunStats>(emptyStats());
  const [runs, setRuns] = createSignal<WorkflowRun[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [emailDeliveries, setEmailDeliveries] = createSignal<WorkflowEmailDelivery[]>([]);
  const [nextEmailCursor, setNextEmailCursor] = createSignal<string | null>(null);

  createEffect(() => setItems(props.workflows));

  const rows = createMemo(() => {
    const query = search().trim().toLowerCase();
    const workflows = [...items()].sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    return query ? workflows.filter((workflow) => workflowSearch(workflow).includes(query)) : workflows;
  });

  const refreshWorkflowsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const res = await apiClient.workflows["by-base"][":baseId"].$get(
        { param: { baseId: props.baseId } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflows."));
      setItems(await res.json());
    },
    onError: (error) => prompts.error(error.message),
  });

  const statsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const res = await apiClient.workflows["by-base"][":baseId"]["run-stats"].$get(
        { param: { baseId: props.baseId } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow stats."));
      setStats(await res.json());
    },
    onError: (error) => prompts.error(error.message),
  });

  const fetchRuns = async (cursor?: string | null, signal?: AbortSignal): Promise<WorkflowRunPage> => {
    const res = await apiClient.workflows["by-base"][":baseId"].runs.$get(
      {
        param: { baseId: props.baseId },
        query: {
          limit: "50",
          ...(props.activeWorkflow ? { workflowId: props.activeWorkflow.id } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
      { init: { signal } },
    );
    if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow runs."));
    return res.json();
  };

  const runsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const page = await fetchRuns(null, abortSignal);
      setRuns(page.items);
      setNextCursor(page.nextCursor ?? null);
    },
    onError: (error) => prompts.error(error.message),
  });

  const loadMoreRunsMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const cursor = nextCursor();
      if (!cursor) return;
      const page = await fetchRuns(cursor, abortSignal);
      setRuns((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor ?? null);
    },
    onError: (error) => prompts.error(error.message),
  });

  const fetchEmailDeliveries = async (cursor?: string | null, signal?: AbortSignal): Promise<WorkflowEmailDeliveryPage> => {
    const res = await apiClient.workflows["by-base"][":baseId"]["email-deliveries"].$get(
      {
        param: { baseId: props.baseId },
        query: {
          limit: "50",
          ...(props.activeWorkflow ? { workflowId: props.activeWorkflow.id } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
      { init: { signal } },
    );
    if (!res.ok) throw new Error(await errorMessage(res, "Could not load workflow email deliveries."));
    return res.json();
  };

  const emailDeliveriesMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const page = await fetchEmailDeliveries(null, abortSignal);
      setEmailDeliveries(page.items);
      setNextEmailCursor(page.nextCursor ?? null);
    },
    onError: (error) => prompts.error(error.message),
  });

  const loadMoreEmailDeliveriesMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const cursor = nextEmailCursor();
      if (!cursor) return;
      const page = await fetchEmailDeliveries(cursor, abortSignal);
      setEmailDeliveries((current) => [...current, ...page.items]);
      setNextEmailCursor(page.nextCursor ?? null);
    },
    onError: (error) => prompts.error(error.message),
  });

  const reloadAll = () => {
    refreshWorkflowsMut.mutate();
    statsMut.mutate();
    runsMut.mutate();
    emailDeliveriesMut.mutate();
  };

  onMount(reloadAll);

  const openEditor = async (workflow?: Workflow) => {
    await dialogCore.open<void>(
      (close) => (
        <WorkflowEditor
          {...props}
          workflow={workflow}
          onSaved={() => {
            props.onWorkflowChanged();
            reloadAll();
          }}
          onClose={close}
        />
      ),
      panelDialogWorkspaceOptions,
    );
  };

  const openEmailTemplates = async () => {
    await dialogCore.open<void>(
      (close) => (
        <EmailTemplateManager
          baseId={props.baseId}
          onChanged={() => {
            props.onWorkflowChanged();
          }}
          onClose={close}
        />
      ),
      panelDialogWorkspaceOptions,
    );
  };

  const runMut = mutations.create<WorkflowRun, WorkflowTriggerKind>({
    mutation: async (triggerKind, { abortSignal }) => {
      const workflow = props.activeWorkflow;
      if (!workflow) throw new Error("Choose a workflow first.");
      const endpoint =
        triggerKind === "api"
          ? apiClient.workflows[":workflowId"].run.api
          : triggerKind === "dashboardButton"
            ? apiClient.workflows[":workflowId"].run["dashboard-button"]
            : apiClient.workflows[":workflowId"].run.form;
      const res = await endpoint.$post({ param: { workflowId: workflow.id }, json: { input: {} } }, { init: { signal: abortSignal } });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not run workflow."));
      return res.json();
    },
    onSuccess: (run) => {
      toast.success(`Workflow run ${run.status}`);
      reloadAll();
      props.onSelectRun(run.id);
    },
    onError: (error) => prompts.error(error.message),
  });

  const activeWorkflow = () => props.activeWorkflow;
  const runTriggers = () => (activeWorkflow() && props.canRunActiveWorkflow ? directRunTriggers(activeWorkflow()!) : []);

  return (
    <div class="flex-1 min-h-0 overflow-y-auto" style="scrollbar-gutter: stable" data-scroll-preserve="grids-workflows-main">
      <div class="flex flex-col gap-2">
        <div class="flex min-w-0 flex-col gap-2" style="view-transition-name: grids-workflows-title">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h1 class="min-w-0 text-base font-semibold text-primary">{activeWorkflow()?.name ?? "Workflows"}</h1>
              <p class="mt-0.5 text-xs text-dimmed">
                {activeWorkflow()?.description ??
                  "Monitor and run YAML workflows from forms, APIs, scanners, selections, schedules, and record events."}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Show when={activeWorkflow() && runTriggers().length > 0}>
                <For each={runTriggers()}>
                  {(trigger) => (
                    <button type="button" class="btn-primary btn-sm" disabled={runMut.loading()} onClick={() => runMut.mutate(trigger)}>
                      <i class={runMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-player-play"} /> Run{" "}
                      {triggerLabels[trigger] ?? trigger}
                    </button>
                  )}
                </For>
              </Show>
              <Show when={props.editMode && activeWorkflow() && props.canManageActiveWorkflow}>
                <button type="button" class="btn-input-success btn-input-sm" onClick={() => void openEditor(activeWorkflow()!)}>
                  <i class="ti ti-settings" /> Manage
                </button>
              </Show>
            </div>
          </div>
          <Show when={props.editMode && props.canCreateWorkflows}>
            <div class="flex items-center gap-2">
              <button type="button" class="btn-input-success btn-input-sm" onClick={() => void openEditor()}>
                <i class="ti ti-plus" /> Add workflow
              </button>
              <button type="button" class="btn-input-success btn-input-sm" onClick={() => void openEmailTemplates()}>
                <i class="ti ti-mail" /> Email templates
              </button>
            </div>
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          <TextInput type="search" value={search} onInput={setSearch} icon="ti ti-search" placeholder="Search workflows..." clearable />
          <div class="flex flex-wrap items-center gap-2 text-xs text-dimmed">
            <span>{rows().length} workflows</span>
            <span>{stats().total} runs</span>
            <button type="button" class="btn-simple btn-sm ml-auto" onClick={reloadAll}>
              <i class={runsMut.loading() || statsMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-refresh"} /> Refresh
            </button>
          </div>
        </div>

        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Running" value={stats().running + stats().queued} icon="player-play" />
          <StatCard label="Succeeded" value={stats().succeeded} icon="circle-check" tone="success" />
          <StatCard label="Failed" value={stats().failed} icon="alert-triangle" tone={stats().failed > 0 ? "danger" : "default"} />
          <StatCard
            label="Failed 24h"
            value={stats().failedLast24h}
            icon="clock-exclamation"
            tone={stats().failedLast24h > 0 ? "danger" : "default"}
          />
        </div>

        <div class="grid min-h-0 gap-2 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]">
          <section class="paper min-h-0 overflow-hidden">
            <div class="px-3 py-2">
              <h2 class="text-sm font-semibold text-primary">{activeWorkflow() ? "Workflows" : "Workflow catalog"}</h2>
              <p class="text-xs text-dimmed">Definitions and trigger surfaces in this base.</p>
            </div>
            <div class="flex max-h-[34rem] min-h-0 flex-col gap-2 overflow-y-auto p-2">
              <For
                each={rows()}
                fallback={
                  <Placeholder align="left" class="py-8">
                    No workflows match this search.
                  </Placeholder>
                }
              >
                {(workflow) => (
                  <WorkflowCard baseShortId={props.baseShortId} workflow={workflow} active={activeWorkflow()?.id === workflow.id} />
                )}
              </For>
            </div>
          </section>

          <section class="paper min-h-0 overflow-hidden">
            <div class="flex items-center justify-between gap-2 px-3 py-2">
              <div class="min-w-0">
                <h2 class="truncate text-sm font-semibold text-primary">{activeWorkflow() ? "Workflow runs" : "Recent activity"}</h2>
                <p class="text-xs text-dimmed">
                  {activeWorkflow() ? "Executions for this workflow." : "Latest executions across visible workflows."}
                </p>
              </div>
            </div>
            <RunTimeline
              runs={runs()}
              workflows={items()}
              selectedRunId={props.selectedRunId}
              showWorkflow={!activeWorkflow()}
              loading={runsMut.loading() || loadMoreRunsMut.loading()}
              nextCursor={nextCursor()}
              onSelect={props.onSelectRun}
              onLoadMore={() => loadMoreRunsMut.mutate()}
            />
          </section>
        </div>

        <EmailDeliveryTable
          deliveries={emailDeliveries()}
          workflows={items()}
          showWorkflow={!activeWorkflow()}
          loading={emailDeliveriesMut.loading() || loadMoreEmailDeliveriesMut.loading()}
          nextCursor={nextEmailCursor()}
          onLoadMore={() => loadMoreEmailDeliveriesMut.mutate()}
        />
      </div>
    </div>
  );
}
