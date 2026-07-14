import { dialogCore, PanelDialog, panelDialogOptions, prompts } from "@valentinkolb/cloud/ui";
import { createResource, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { DocumentTemplate } from "../../../contracts";
import { DOCUMENT_TEMPLATE_STARTERS, type DocumentTemplateStarter } from "../../../document-template-starters";
import { errorMessage } from "../utils/api-helpers";
import { openDocumentTemplateEditorDialog } from "./DocumentTemplateEditorDialog";
import { defaultDocumentStarter } from "./document-template-dialog-defaults";

export const openDocumentTemplatesDialog = (args: { baseId: string; tableId: string; tableName: string }) =>
  dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title={`Templates — ${args.tableName}`} icon="ti ti-file-type-pdf" close={() => close()} />
        <PanelDialog.Body>
          <DocumentTemplatesManager baseId={args.baseId} tableId={args.tableId} tableName={args.tableName} />
        </PanelDialog.Body>
      </PanelDialog>
    ),
    panelDialogOptions,
  );

function DocumentTemplatesManager(props: { baseId: string; tableId: string; tableName: string }) {
  const [reordering, setReordering] = createSignal(false);
  const [templates, { refetch }] = createResource(
    () => props.tableId,
    async (tableId) => {
      const res = await apiClient.documents.templates["by-table"][":tableId"].full.$get({ param: { tableId } });
      if (!res.ok) {
        prompts.error(await errorMessage(res, "Failed to load document templates"));
        return [] as DocumentTemplate[];
      }
      return res.json();
    },
  );

  const deleteTemplate = async (template: DocumentTemplate) => {
    const confirmed = await prompts.confirm(`Delete "${template.name}"? Existing generated documents can still be redownloaded.`, {
      title: "Delete document template?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    const res = await apiClient.documents.templates[":templateId"].$delete({ param: { templateId: template.id } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to delete document template"));
      return;
    }
    await refetch();
  };

  const patchTemplate = async (template: DocumentTemplate, patch: Partial<Pick<DocumentTemplate, "enabled" | "position">>) => {
    const res = await apiClient.documents.templates[":templateId"].$patch({ param: { templateId: template.id }, json: patch });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to update document template"));
      return false;
    }
    await refetch();
    return true;
  };

  const duplicateTemplate = async (template: DocumentTemplate) => {
    const res = await apiClient.documents.templates["by-table"][":tableId"].$post({
      param: { tableId: props.tableId },
      json: {
        name: `${template.name} copy`,
        description: template.description,
        source: template.source,
        numberTemplate: template.numberTemplate,
        filenameTemplate: template.filenameTemplate,
        html: template.html,
        headerHtml: template.headerHtml,
        footerHtml: template.footerHtml,
        pageCss: template.pageCss,
        enabled: false,
      },
    });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to duplicate document template"));
      return;
    }
    await refetch();
  };

  const moveTemplate = async (template: DocumentTemplate, direction: -1 | 1) => {
    const ordered = [...(templates() ?? [])].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    const index = ordered.findIndex((item) => item.id === template.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    const next = [...ordered];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    setReordering(true);
    try {
      const res = await apiClient.documents.templates["by-table"][":tableId"].reorder.$patch({
        param: { tableId: props.tableId },
        json: { templateIds: next.map((item) => item.id) },
      });
      if (!res.ok) {
        await prompts.error(await errorMessage(res, "Failed to reorder document templates"));
        return;
      }
      await refetch();
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Failed to reorder document templates");
    } finally {
      setReordering(false);
    }
  };

  const openEditor = (template?: DocumentTemplate, starter?: DocumentTemplateStarter) => {
    openDocumentTemplateEditorDialog({
      baseId: props.baseId,
      tableId: props.tableId,
      tableName: props.tableName,
      template,
      starter,
      onSaved: () => void refetch(),
    });
  };

  const addTemplate = async () => {
    const starter = await chooseDocumentTemplateStarter();
    if (starter) openEditor(undefined, starter);
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-dimmed">{templates.loading ? "Loading..." : `${templates()?.length ?? 0} templates`}</span>
        <button type="button" class="btn-input btn-sm" onClick={() => void addTemplate()}>
          <i class="ti ti-plus" /> Add template
        </button>
      </div>

      <Show when={!templates.loading && (templates()?.length ?? 0) === 0}>
        <div class="paper p-3 text-sm text-dimmed">No document templates yet.</div>
      </Show>

      <For each={[...(templates() ?? [])].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))}>
        {(template, index) => (
          <div class="paper flex items-start gap-3 p-3">
            <i class="ti ti-file-type-pdf mt-0.5 text-lg text-dimmed" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-semibold text-primary">{template.name}</span>
                <Show when={!template.enabled}>
                  <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-dimmed dark:bg-zinc-800">disabled</span>
                </Show>
              </div>
              <Show when={template.description}>
                <p class="mt-1 text-xs text-dimmed">{template.description}</p>
              </Show>
            </div>
            <button
              type="button"
              class="btn-simple btn-sm"
              title={template.enabled ? "Disable template" : "Enable template"}
              onClick={() => void patchTemplate(template, { enabled: !template.enabled })}
            >
              <i class={`ti ${template.enabled ? "ti-toggle-right" : "ti-toggle-left"}`} />
            </button>
            <button
              type="button"
              class="btn-simple btn-sm"
              title="Move up"
              disabled={reordering() || index() === 0}
              onClick={() => void moveTemplate(template, -1)}
            >
              <i class="ti ti-arrow-up" />
            </button>
            <button
              type="button"
              class="btn-simple btn-sm"
              title="Move down"
              disabled={reordering() || index() === (templates()?.length ?? 0) - 1}
              onClick={() => void moveTemplate(template, 1)}
            >
              <i class="ti ti-arrow-down" />
            </button>
            <button type="button" class="btn-simple btn-sm" title="Duplicate template" onClick={() => void duplicateTemplate(template)}>
              <i class="ti ti-copy" />
            </button>
            <button type="button" class="btn-simple btn-sm" title="Edit template" onClick={() => openEditor(template)}>
              <i class="ti ti-pencil" />
            </button>
            <button
              type="button"
              class="btn-simple btn-sm text-dimmed hover:text-red-500"
              title="Delete template"
              onClick={() => void deleteTemplate(template)}
            >
              <i class="ti ti-trash" />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}

const chooseDocumentTemplateStarter = () =>
  dialogCore.open<DocumentTemplateStarter | null>((close) => {
    const blank = defaultDocumentStarter();
    return (
      <PanelDialog>
        <PanelDialog.Header title="Choose template starter" icon="ti ti-file-type-pdf" close={() => close(null)} />
        <PanelDialog.Body>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            <For each={[blank, ...DOCUMENT_TEMPLATE_STARTERS]}>
              {(starter) => (
                <button type="button" class="paper p-3 text-left transition hover:paper-highlighted" onClick={() => close(starter)}>
                  <div class="flex items-start gap-3">
                    <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-white shadow-[var(--theme-shadow-elevated)] dark:bg-zinc-950">
                      <i class={`${starter.icon} text-lg text-primary`} />
                    </span>
                    <div class="min-w-0">
                      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                        <div class="truncate text-sm font-semibold text-primary">{starter.name}</div>
                        <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-dimmed dark:bg-zinc-800">
                          {starter.category}
                        </span>
                      </div>
                      <p class="mt-1 text-xs leading-snug text-dimmed">{starter.description}</p>
                      <div class="mt-2 grid gap-1 text-[11px] leading-snug text-dimmed">
                        <div>
                          <span class="font-medium text-secondary">Best for:</span> {starter.bestFor}
                        </div>
                        <div>
                          <span class="font-medium text-secondary">Data:</span> {starter.expectedData}
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{starter.page}</span>
                          <For each={starter.uses ?? []}>
                            {(use) => <span class="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{use}</span>}
                          </For>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </PanelDialog.Body>
      </PanelDialog>
    );
  }, panelDialogOptions);
