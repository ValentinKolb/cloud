import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import {
  AutocompleteEditor,
  CheckboxCard,
  confirmDiscardIfDirty,
  dialogCore,
  PanelDialog,
  panelDialogWorkspaceOptions,
  prompts,
  type TemplateVariable,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { aggregateKindPattern } from "../../../aggregate-catalog";
import type { DocumentPreviewResponse, DocumentTemplate } from "../../../contracts";
import type { DocumentTemplateStarter } from "../../../document-template-starters";
import { requestDocumentTemplateDraftPreview } from "../documents/document-transfer-client";
import { buildBackendGqlCompletions } from "../query/query-autocomplete";
import RecordPicker from "../records/RecordPicker";
import { errorMessage } from "../utils/api-helpers";
import { DocumentTemplateEditorPanes } from "./DocumentTemplateEditorPanes";
import { templateVariablesFromData } from "./DocumentTemplatePreviewData";
import { defaultDocumentNumberTemplate, defaultDocumentStarter, starterPayload } from "./document-template-dialog-defaults";

const DOCUMENT_TEMPLATE_VARIABLES: TemplateVariable[] = [
  { name: "record", kind: "object" },
  { name: "table", kind: "object" },
  { name: "template", kind: "object" },
  { name: "run", kind: "object" },
  { name: "date", kind: "object" },
  { name: "rows", kind: "array" },
  { name: "columns", kind: "array" },
  { name: "query", kind: "object" },
  { name: "document", kind: "object" },
  { name: "snapshot", kind: "object" },
  { name: "app", kind: "object" },
  { name: "business", kind: "object" },
  { name: "images", kind: "array" },
  { name: "primaryImage", kind: "object" },
];

const documentGqlHighlight = highlight.compile(
  [
    { kind: "field", match: /"(?:""|[^"])*"/ },
    { kind: "string", match: /'(?:\\[\s\S]|[^'\\])*'/ },
    {
      kind: "keyword",
      match:
        /\b(?:from|table|view|select|join|left|as|on|where|formula|group|by|aggregate|having|sort|search|include|deleted|only|nulls|first|last|limit|offset|asc|desc|and|or|not)\b/i,
    },
    { kind: "function", match: aggregateKindPattern() },
    { kind: "placeholder", match: /\{[A-Za-z0-9_-]{1,200}\}/i },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

const diagnosticText = (diagnostic: { message: string; line?: number; column?: number }) =>
  diagnostic.line && diagnostic.column ? `Line ${diagnostic.line}, col ${diagnostic.column}: ${diagnostic.message}` : diagnostic.message;

const hasLiquidTags = (value: string) => /{{|{%/.test(value);

const readDocumentPreviewError = async (response: Response, fallback: string): Promise<{ message: string; phase: string | null }> => {
  try {
    const data = (await response.json()) as unknown;
    if (data && typeof data === "object") {
      const message = Object.getOwnPropertyDescriptor(data, "message")?.value;
      const phase = Object.getOwnPropertyDescriptor(data, "phase")?.value;
      return {
        message: typeof message === "string" && message.length > 0 ? message : fallback,
        phase: typeof phase === "string" ? phase : null,
      };
    }
  } catch {
    // Fall back below.
  }
  return { message: fallback, phase: null };
};

export function openDocumentTemplateEditorDialog(args: {
  baseId: string;
  tableId: string;
  tableName: string;
  template?: DocumentTemplate;
  starter?: DocumentTemplateStarter;
  onSaved?: (template: DocumentTemplate) => void;
}) {
  return dialogCore.open<void>((close) => <DocumentTemplateEditorDialog args={args} close={close} />, panelDialogWorkspaceOptions);
}

const templateReferenceHref = (baseShortId: string) => `/app/grids/${encodeURIComponent(baseShortId)}/reference/templates`;

const openTemplateReferenceWindow = (baseShortId: string) => {
  window.open(templateReferenceHref(baseShortId), "grids-template-reference", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
};

function DocumentTemplateEditorDialog(props: {
  args: {
    baseId: string;
    tableId: string;
    tableName: string;
    template?: DocumentTemplate;
    starter?: DocumentTemplateStarter;
    onSaved?: (template: DocumentTemplate) => void;
  };
  close: () => void;
}) {
  const template = props.args.template;
  const initialStarter = starterPayload(props.args.starter ?? defaultDocumentStarter(), props.args.tableId);
  const [name, setName] = createSignal(template?.name ?? initialStarter.name);
  const [description, setDescription] = createSignal(template?.description ?? initialStarter.description);
  const [numberTemplate, setNumberTemplate] = createSignal(template?.numberTemplate ?? initialStarter.numberTemplate);
  const [filenameTemplate, setFilenameTemplate] = createSignal(template?.filenameTemplate ?? initialStarter.filenameTemplate);
  const [source, setSource] = createSignal(template?.source ?? initialStarter.source);
  const [html, setHtml] = createSignal(template?.html ?? initialStarter.html);
  const [headerHtml, setHeaderHtml] = createSignal(template?.headerHtml ?? initialStarter.headerHtml);
  const [footerHtml, setFooterHtml] = createSignal(template?.footerHtml ?? initialStarter.footerHtml);
  const [pageCss, setPageCss] = createSignal(template?.pageCss ?? initialStarter.pageCss);
  const [enabled, setEnabled] = createSignal(template?.enabled ?? false);
  const [previewRecordId, setPreviewRecordId] = createSignal("");
  const [previewData, setPreviewData] = createSignal<DocumentPreviewResponse | null>(null);
  const [previewDataLoading, setPreviewDataLoading] = createSignal(false);
  const [previewDataError, setPreviewDataError] = createSignal<string | null>(null);
  const [previewSourceError, setPreviewSourceError] = createSignal<string | null>(null);
  const [lastSuccessfulPreviewSignature, setLastSuccessfulPreviewSignature] = createSignal<string | null>(null);
  const [gqlDiagnostics, setGqlDiagnostics] = createSignal<Array<{ message: string; line?: number; column?: number }>>([]);
  const [gqlDiagnosticError, setGqlDiagnosticError] = createSignal<string | null>(null);
  const [templateAccessEntries, { refetch: refetchTemplateAccessEntries }] = createResource(
    () => template?.id ?? "",
    async (templateId) => {
      if (!templateId) return [] as AccessEntry[];
      const res = await apiClient.access["by-document-template"][":templateId"].$get({ param: { templateId } });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not load document template access."));
      return res.json();
    },
  );
  const gqlCompletions = createMemo(() =>
    buildBackendGqlCompletions({
      currentSource: { kind: "table", tableId: props.args.tableId },
      fetchAutocomplete: async (request, signal) => {
        const response = await apiClient.gql["by-base"][":baseId"].autocomplete.$post(
          { param: { baseId: props.args.baseId }, json: request },
          { init: { signal } },
        );
        if (!response.ok) throw new Error(await errorMessage(response, "Could not load query suggestions."));
        return response.json();
      },
    }),
  );
  const templateVariables = createMemo<TemplateVariable[]>(() => {
    const byName = new Map<string, TemplateVariable>();
    for (const variable of [...DOCUMENT_TEMPLATE_VARIABLES, ...templateVariablesFromData(previewData()?.data)])
      byName.set(variable.name, variable);
    return [...byName.values()];
  });
  const dirty = () =>
    name() !== (template?.name ?? initialStarter.name) ||
    description() !== (template?.description ?? initialStarter.description) ||
    numberTemplate() !== (template?.numberTemplate ?? initialStarter.numberTemplate) ||
    filenameTemplate() !== (template?.filenameTemplate ?? initialStarter.filenameTemplate) ||
    source() !== (template?.source ?? initialStarter.source) ||
    html() !== (template?.html ?? initialStarter.html) ||
    headerHtml() !== (template?.headerHtml ?? initialStarter.headerHtml) ||
    footerHtml() !== (template?.footerHtml ?? initialStarter.footerHtml) ||
    pageCss() !== (template?.pageCss ?? initialStarter.pageCss) ||
    enabled() !== (template?.enabled ?? false);

  const currentPreviewSignature = () =>
    JSON.stringify({
      source: source().trim(),
      html: html().trim(),
      headerHtml: headerHtml().trim() || null,
      footerHtml: footerHtml().trim() || null,
      pageCss: pageCss().trim() || null,
      numberTemplate: numberTemplate().trim(),
      filenameTemplate: filenameTemplate().trim(),
      recordId: previewRecordId().trim(),
    });
  const hasCurrentSuccessfulPreview = () => lastSuccessfulPreviewSignature() === currentPreviewSignature();

  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };

  const saveMut = mutations.create<DocumentTemplate, void>({
    mutation: async () => {
      const payload = {
        name: name().trim(),
        description: description().trim() || null,
        numberTemplate: numberTemplate().trim(),
        filenameTemplate: filenameTemplate().trim(),
        source: source().trim(),
        html: html().trim(),
        headerHtml: headerHtml().trim() || null,
        footerHtml: footerHtml().trim() || null,
        pageCss: pageCss().trim() || null,
        enabled: enabled(),
      };
      if (!payload.name) throw new Error("Name is required");
      if (!payload.numberTemplate) throw new Error("Document number pattern is required");
      if (!payload.filenameTemplate) throw new Error("Filename template is required");
      if (!payload.source) throw new Error("GQL source is required");
      if (!payload.html) throw new Error("HTML template is required");
      const res = template
        ? await apiClient.documents.templates[":templateId"].$patch({ param: { templateId: template.id }, json: payload })
        : await apiClient.documents.templates["by-table"][":tableId"].$post({ param: { tableId: props.args.tableId }, json: payload });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save document template"));
      return res.json();
    },
    onSuccess: (saved) => {
      props.args.onSaved?.(saved);
      props.close();
    },
    onError: (e) => prompts.error(e.message),
  });

  const previewPdf = async () => {
    const recordId = previewRecordId().trim();
    if (!recordId) throw new Error("Preview record ID is required");
    const payload = {
      source: source().trim(),
      html: html().trim(),
      headerHtml: headerHtml().trim() || null,
      footerHtml: footerHtml().trim() || null,
      pageCss: pageCss().trim() || null,
      numberTemplate: numberTemplate().trim(),
      filenameTemplate: filenameTemplate().trim(),
      recordId,
    };
    const signature = currentPreviewSignature();
    const response = await requestDocumentTemplateDraftPreview({
      tableId: props.args.tableId,
      templateId: template?.id,
      draft: payload,
    });
    if (response.ok) setLastSuccessfulPreviewSignature(signature);
    return response;
  };

  const saveTemplate = async () => {
    const warnings: string[] = [];
    if (gqlDiagnosticError()) warnings.push(gqlDiagnosticError()!);
    if (previewSourceError()) warnings.push(previewSourceError()!);
    if (gqlDiagnostics().length > 0) warnings.push(...gqlDiagnostics().slice(0, 3).map(diagnosticText));
    if (enabled() && !hasCurrentSuccessfulPreview()) {
      warnings.push("This enabled template has not rendered a successful PDF preview for the current draft.");
    }
    if (warnings.length > 0) {
      const confirmed = await prompts.confirm(`Save this template anyway?\n\n${warnings.map((warning) => `• ${warning}`).join("\n")}`, {
        title: "Template has warnings",
        confirmText: "Save anyway",
      });
      if (!confirmed) return;
    }
    saveMut.mutate(undefined);
  };

  let previewDataToken = 0;
  let gqlDiagnosticsToken = 0;
  createEffect(() => {
    const sourceText = source().trim();
    if (!sourceText || hasLiquidTags(sourceText)) {
      gqlDiagnosticsToken += 1;
      setGqlDiagnostics([]);
      setGqlDiagnosticError(null);
      return;
    }

    const token = ++gqlDiagnosticsToken;
    const timeout = window.setTimeout(async () => {
      try {
        const response = await apiClient.gql["by-base"][":baseId"].autocomplete.$post({
          param: { baseId: props.args.baseId },
          json: {
            query: sourceText,
            caret: sourceText.length,
            currentTableId: props.args.tableId,
            currentSource: { kind: "table", tableId: props.args.tableId },
          },
        });
        if (token !== gqlDiagnosticsToken) return;
        if (!response.ok) throw new Error(await errorMessage(response, "Could not validate GQL source"));
        const data = await response.json();
        setGqlDiagnostics(data.diagnostics ?? []);
        setGqlDiagnosticError(null);
      } catch (e) {
        if (token === gqlDiagnosticsToken) {
          setGqlDiagnostics([]);
          setGqlDiagnosticError(e instanceof Error ? e.message : "Could not validate GQL source");
        }
      }
    }, 300);
    onCleanup(() => window.clearTimeout(timeout));
  });

  createEffect(() => {
    const recordId = previewRecordId().trim();
    const sourceText = source().trim();
    const htmlText = html().trim();
    const headerHtmlText = headerHtml().trim();
    const footerHtmlText = footerHtml().trim();
    const pageCssText = pageCss().trim();
    const numberTemplateText = numberTemplate().trim();
    const filenameTemplateText = filenameTemplate().trim();
    if (!recordId || !sourceText || !htmlText) {
      previewDataToken += 1;
      setPreviewData(null);
      setPreviewDataError(null);
      setPreviewSourceError(null);
      setPreviewDataLoading(false);
      return;
    }

    const token = ++previewDataToken;
    setPreviewDataLoading(true);
    setPreviewDataError(null);
    setPreviewSourceError(null);
    const timeout = window.setTimeout(async () => {
      try {
        const payload = {
          source: sourceText,
          html: htmlText,
          headerHtml: headerHtmlText || null,
          footerHtml: footerHtmlText || null,
          pageCss: pageCssText || null,
          numberTemplate: numberTemplateText,
          filenameTemplate: filenameTemplateText,
          recordId,
        };
        const response = template
          ? await apiClient.documents.templates[":templateId"]["preview-data-draft"].$post({
              param: { templateId: template.id },
              json: payload,
            })
          : await apiClient.documents.templates["by-table"][":tableId"]["preview-data-draft"].$post({
              param: { tableId: props.args.tableId },
              json: payload,
            });
        if (token !== previewDataToken) return;
        if (!response.ok) {
          const details = await readDocumentPreviewError(response, "Could not load preview data");
          setPreviewSourceError(details.phase === "source" ? details.message : null);
          throw new Error(details.message);
        }
        setPreviewData(await response.json());
        setPreviewSourceError(null);
      } catch (e) {
        if (token === previewDataToken) {
          setPreviewData(null);
          setPreviewDataError(e instanceof Error ? e.message : "Could not load preview data");
        }
      } finally {
        if (token === previewDataToken) setPreviewDataLoading(false);
      }
    }, 350);
    onCleanup(() => window.clearTimeout(timeout));
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={`${template ? "Edit" : "Add"} template — ${props.args.tableName}`}
        icon="ti ti-file-type-pdf"
        close={closeIfClean}
        actions={
          <button type="button" class="btn-input btn-sm" onClick={() => openTemplateReferenceWindow(props.args.baseId)}>
            <i class="ti ti-external-link" /> Reference
          </button>
        }
      />
      <PanelDialog.Body>
        <div class="flex h-full min-h-0 flex-col gap-2">
          <div class="grid shrink-0 gap-2 lg:grid-cols-2">
            <TextInput label="Name" value={name} onInput={setName} icon="ti ti-typography" required />
            <TextInput label="Description" value={description} onInput={setDescription} icon="ti ti-align-left" placeholder="Optional" />
            <div>
              <TextInput
                label="Document number"
                description="Liquid pattern for stable generated document numbers."
                value={numberTemplate}
                onInput={setNumberTemplate}
                icon="ti ti-hash"
                placeholder={defaultDocumentNumberTemplate}
                required
              />
            </div>
            <div>
              <TextInput
                label="Filename"
                description="Liquid pattern for generated PDF filenames. Users can edit the final filename before generating."
                value={filenameTemplate}
                onInput={setFilenameTemplate}
                icon="ti ti-file-text"
                placeholder="{{ document.number }}.pdf"
                required
              />
            </div>
            <div class="lg:col-span-2">
              <CheckboxCard
                value={enabled}
                onChange={setEnabled}
                label="Enabled"
                description="Enabled templates appear in document generation lists and the Documents sidebar."
                icon="ti ti-file-check"
                variant="input"
              />
            </div>
            <div class="lg:col-span-2">
              <RecordPicker
                tableId={props.args.tableId}
                templateId={template?.id}
                label="Preview record"
                value={previewRecordId}
                onChange={setPreviewRecordId}
                placeholder="Search preview record..."
              />
            </div>
            <div class="lg:col-span-2">
              <div class="mb-1.5 flex items-center justify-between gap-2">
                <div class="text-sm font-medium text-primary">
                  GQL source <span class="text-red-500">*</span>
                </div>
                <span class="text-xs text-dimmed">Scoped to {props.args.tableName}</span>
              </div>
              <AutocompleteEditor
                value={source}
                onInput={setSource}
                completions={gqlCompletions()}
                highlight={documentGqlHighlight}
                lines={4}
                placeholder={`from table ${props.args.tableName}\nwhere record.id = "{{ record.id }}"\nlimit 1`}
                spellcheck={false}
                ariaLabel="GQL source"
              />
              <Show when={gqlDiagnosticError() || previewSourceError() || gqlDiagnostics().length > 0}>
                <div class="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                  <Show
                    when={gqlDiagnosticError() || previewSourceError()}
                    fallback={
                      <ul class="grid gap-1">
                        <For each={gqlDiagnostics().slice(0, 4)}>{(diagnostic) => <li>{diagnosticText(diagnostic)}</li>}</For>
                      </ul>
                    }
                  >
                    {(message) => message()}
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          <DocumentTemplateEditorPanes
            template={template}
            html={html}
            setHtml={setHtml}
            headerHtml={headerHtml}
            setHeaderHtml={setHeaderHtml}
            footerHtml={footerHtml}
            setFooterHtml={setFooterHtml}
            pageCss={pageCss}
            setPageCss={setPageCss}
            templateVariables={templateVariables}
            previewData={previewData}
            previewDataLoading={previewDataLoading}
            previewDataError={previewDataError}
            source={source}
            previewRecordId={previewRecordId}
            previewPdf={previewPdf}
            accessEntries={templateAccessEntries}
            accessLoading={() => templateAccessEntries.loading}
            accessError={() => {
              const error = templateAccessEntries.error;
              return error instanceof Error ? error.message : error ? "Could not load document template access." : null;
            }}
            retryAccess={() => void refetchTemplateAccessEntries()}
          />
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={closeIfClean}>
            Cancel
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={() => void saveTemplate()} disabled={saveMut.loading()}>
            {saveMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save template"}
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}
