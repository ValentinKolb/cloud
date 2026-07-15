import { AutocompleteEditor, CheckboxCard, confirmDiscardIfDirty, PanelDialog, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewDiagnostic } from "../../../contracts";
import type { Table, Workflow } from "../../../service";
import { WORKFLOW_REVISION_HEADER, type WorkflowAutocompleteResponse } from "../../../workflows/contracts";
import { errorMessage } from "../utils/api-helpers";
import { buildBackendWorkflowCompletions } from "./workflow-autocomplete";
import { type WorkflowEditorDraft, workflowEditorDraft, workflowEditorDraftDirty } from "./workflow-editor-draft";

type WorkflowEditorApi = {
  "by-base": {
    ":baseId": {
      autocomplete: {
        $post: (
          input: { param: { baseId: string }; json: { source: string; caret: number } },
          options?: { init?: RequestInit },
        ) => Promise<Response>;
      };
      $post: (input: { param: { baseId: string }; json: unknown }, options?: { init?: RequestInit }) => Promise<Response>;
    };
  };
  ":workflowId": {
    $get: (input: { param: { workflowId: string } }) => Promise<Response>;
    $patch: (input: { param: { workflowId: string }; json: unknown }, options?: { init?: RequestInit }) => Promise<Response>;
    $delete: (input: { param: { workflowId: string } }, options?: { init?: RequestInit }) => Promise<Response>;
  };
};

const workflowEditorApi = apiClient.workflows as unknown as WorkflowEditorApi;

type WorkflowEditorProps = {
  baseId: string;
  baseShortId: string;
  tables: Table[];
  workflow?: Workflow;
  onSaved: () => void;
  onClose: () => void;
};

class WorkflowConflictError extends Error {
  constructor() {
    super("This workflow changed while you were editing it.");
    this.name = "WorkflowConflictError";
  }
}

const workflowHighlight = highlight.compile(
  [
    { kind: "placeholder", match: /\$\{\{\s*[^{}]+?\s*\}\}/ },
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/ },
    {
      kind: "keyword",
      match:
        /\b(?:inputs|triggers|steps|type|table|required|options|schedule|recordEvent|with|field|event|cron|timezone|updateRecord|createRecord|generateDocument|createDocumentLink|sendEmail|httpRequest|setVariable|succeed|fail|if|then|else|switch|cases|default|forEach|as|do|record|recordList|text|number|boolean|date|dateTime|select|method|url|headers|json|timeoutMs|saveAs|set|values|template|document|expiresIn|comment|to|email|user|data|batch|filename|tags|message|name|description)\b/,
    },
    { kind: "function", match: /\bnow\(\)/ },
    { kind: "placeholder", match: /\binputs\.[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_ -]+)?\b/ },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /[:{}\[\],-]/ },
    { kind: "comment", match: /#[^\n]*/ },
  ],
  { classPrefix: "doc-token-" },
);

const workflowReferenceHref = (baseShortId: string) => `/app/grids/${encodeURIComponent(baseShortId)}/reference/workflows`;

const openWorkflowReferenceWindow = (baseShortId: string) => {
  if (typeof window === "undefined") return;
  window.open(workflowReferenceHref(baseShortId), "grids-workflow-reference", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
};

const yamlString = (value: string): string => JSON.stringify(value);

const defaultSource = (
  table?: Table,
) => `${table ? `inputs:\n  record:\n    type: record\n    table: ${yamlString(table.name)}\n` : ""}steps:
  - setVariable:
      name: ranAt
      value: \${{ now() }}
`;

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

export function WorkflowEditor(props: WorkflowEditorProps) {
  const initialDraft = workflowEditorDraft(props.workflow, defaultSource(props.tables[0]));
  let cleanDraft = initialDraft;
  const [name, setName] = createSignal(initialDraft.name);
  const [persistedName, setPersistedName] = createSignal(initialDraft.name);
  const [description, setDescription] = createSignal(initialDraft.description);
  const [enabled, setEnabled] = createSignal(initialDraft.enabled);
  const [source, setSource] = createSignal(initialDraft.source);
  const [revision, setRevision] = createSignal(initialDraft.revision);
  const [diagnostics, setDiagnostics] = createSignal<DslQueryPreviewDiagnostic[]>([]);
  const [validating, setValidating] = createSignal(false);
  let validationTimer: ReturnType<typeof setTimeout> | undefined;
  let validationAbort: AbortController | undefined;

  const currentDraft = (): WorkflowEditorDraft => ({
    name: name(),
    description: description(),
    enabled: enabled(),
    source: source(),
    revision: revision(),
  });
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(() => workflowEditorDraftDirty(currentDraft(), cleanDraft))) props.onClose();
  };

  const fetchAutocomplete = async (request: { source: string; caret: number }, signal: AbortSignal) => {
    const response = await workflowEditorApi["by-base"][":baseId"].autocomplete.$post(
      { param: { baseId: props.baseId }, json: request },
      { init: { signal } },
    );
    if (!response.ok) throw new Error(await errorMessage(response, "Could not load workflow suggestions."));
    return (await response.json()) as WorkflowAutocompleteResponse;
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

  const replaceDraft = (draft: WorkflowEditorDraft) => {
    cleanDraft = draft;
    setName(draft.name);
    setPersistedName(draft.name);
    setDescription(draft.description);
    setEnabled(draft.enabled);
    setSource(draft.source);
    setRevision(draft.revision);
  };

  const reloadWorkflow = async () => {
    if (!props.workflow) return;
    const response = await workflowEditorApi[":workflowId"].$get({ param: { workflowId: props.workflow.id } });
    if (!response.ok) throw new Error(await errorMessage(response, "Could not reload workflow."));
    const latest = (await response.json()) as Workflow;
    replaceDraft(workflowEditorDraft(latest, defaultSource(props.tables[0])));
    props.onSaved();
    toast.success("Loaded the latest workflow version");
  };

  const handleSaveError = async (error: Error) => {
    if (!(error instanceof WorkflowConflictError)) {
      await prompts.error(error.message);
      return;
    }
    const reload = await prompts.confirm(
      "This workflow changed while you were editing it. Reload the latest version? Your unsaved changes will be replaced.",
      {
        title: "Workflow changed",
        icon: "ti ti-refresh-alert",
        confirmText: "Reload workflow",
      },
    );
    if (!reload) return;
    try {
      await reloadWorkflow();
    } catch (reloadError) {
      await prompts.error(reloadError instanceof Error ? reloadError.message : "Could not reload workflow.");
    }
  };

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
        ? await workflowEditorApi[":workflowId"].$patch(
            { param: { workflowId: props.workflow.id }, json: payload },
            { init: { signal: abortSignal, headers: { [WORKFLOW_REVISION_HEADER]: String(revision()) } } },
          )
        : await workflowEditorApi["by-base"][":baseId"].$post(
            { param: { baseId: props.baseId }, json: payload },
            { init: { signal: abortSignal } },
          );
      if (res.status === 409) throw new WorkflowConflictError();
      if (!res.ok) throw new Error(await errorMessage(res, "Could not save workflow."));
      return (await res.json()) as Workflow;
    },
    onSuccess: (saved) => {
      toast.success(`Saved "${saved.name}"`);
      props.onSaved();
      props.onClose();
    },
    onError: (error) => void handleSaveError(error),
  });

  const deleteMut = mutations.create<{ deleted: boolean }, Workflow>({
    mutation: async (workflow, { abortSignal }) => {
      const confirmed = await prompts.confirm(`Delete "${persistedName() || workflow.name}"?`, {
        title: "Delete workflow",
        icon: "ti ti-trash",
        confirmText: "Delete workflow",
        variant: "danger",
      });
      if (!confirmed) return { deleted: false };
      const res = await workflowEditorApi[":workflowId"].$delete({ param: { workflowId: workflow.id } }, { init: { signal: abortSignal } });
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
        title={props.workflow ? `Manage workflow — ${persistedName()}` : "New workflow"}
        subtitle="Metadata, status, and executable YAML."
        icon="ti ti-route"
        close={() => void closeIfClean()}
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
          <button type="button" class="btn-input btn-sm" onClick={() => void closeIfClean()}>
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
