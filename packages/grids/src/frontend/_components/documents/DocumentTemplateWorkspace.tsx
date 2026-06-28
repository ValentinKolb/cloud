import { PdfPreview, Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { createResource, createSignal, For, Show } from "solid-js";
import type { DocumentRun, DocumentTemplate } from "../../../contracts";
import type { Table } from "../../../service";
import { openDocumentTemplateEditorDialog } from "../dialogs/TableAdminDialogs";
import RecordPicker from "../records/RecordPicker";
import { errorMessage } from "../utils/api-helpers";

type Props = {
  baseId: string;
  table: Table;
  template: DocumentTemplate;
  canManageTemplate: boolean;
  initialRecordId: string | null;
};

const iconActionClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center text-dimmed transition-colors hover:text-secondary disabled:cursor-not-allowed disabled:opacity-50";

const downloadPdfResponse = async (res: Response, fallbackName: string) => {
  if (!res.ok) throw new Error(await errorMessage(res, "Failed to render PDF"));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const formatRelativeTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86_400 * 30) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
};

export default function DocumentTemplateWorkspace(props: Props) {
  const [recordId, setRecordId] = createSignal(props.initialRecordId ?? "");
  const [busy, setBusy] = createSignal<string | null>(null);
  const [runs, { refetch: refetchRuns }] = createResource(recordId, async (selectedRecordId) => {
    if (!selectedRecordId) return { items: [] as DocumentRun[] };
    const res = await fetch(
      `/api/grids/documents/runs/by-template/${encodeURIComponent(props.template.id)}/${encodeURIComponent(selectedRecordId)}`,
    );
    if (!res.ok) return { items: [] as DocumentRun[] };
    const data = await res.json();
    return Array.isArray(data) ? { items: data as DocumentRun[] } : (data as { items: DocumentRun[] });
  });

  const setSelectedRecord = (nextRecordId: string) => {
    setRecordId(nextRecordId);
    const url = new URL(window.location.href);
    if (nextRecordId) url.searchParams.set("record", nextRecordId);
    else url.searchParams.delete("record");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
  };

  const previewPdf = async () => {
    const selectedRecordId = recordId().trim();
    if (!selectedRecordId) throw new Error("Choose a record first.");
    return fetch(`/api/grids/documents/templates/${encodeURIComponent(props.template.id)}/preview-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordId: selectedRecordId }),
    });
  };

  const generate = async () => {
    const selectedRecordId = recordId().trim();
    if (!selectedRecordId) {
      prompts.error("Choose a record first.");
      return;
    }
    setBusy("generate");
    try {
      const res = await fetch(`/api/grids/documents/templates/${encodeURIComponent(props.template.id)}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: selectedRecordId }),
      });
      const number = res.headers.get("X-Grids-Document-Number") ?? props.template.name;
      await downloadPdfResponse(res, `${number}.pdf`);
      await refetchRuns();
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to generate document");
    } finally {
      setBusy(null);
    }
  };

  const redownload = async (run: DocumentRun) => {
    setBusy(run.id);
    try {
      const res = await fetch(`/api/grids/documents/runs/${encodeURIComponent(run.id)}/download`);
      await downloadPdfResponse(res, `${run.documentNumber}.pdf`);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to download document");
    } finally {
      setBusy(null);
    }
  };

  const generatedRuns = () => runs()?.items ?? [];

  return (
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3" data-scroll-preserve="grids-document-template-workspace">
      <section class="paper p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="mb-1 flex items-center gap-2 text-xs text-dimmed">
              <i class="ti ti-file-type-pdf" />
              <span>{props.table.name}</span>
            </div>
            <h2 class="truncate text-lg font-semibold text-primary">{props.template.name}</h2>
            <Show when={props.template.description}>
              {(description) => <p class="mt-1 max-w-3xl text-sm text-dimmed">{description()}</p>}
            </Show>
          </div>
          <Show when={props.canManageTemplate}>
            <button
              type="button"
              class="btn-input btn-sm"
              onClick={() =>
                openDocumentTemplateEditorDialog({
                  baseId: props.baseId,
                  tableId: props.table.id,
                  tableName: props.table.name,
                  template: props.template,
                  onSaved: () => window.location.reload(),
                })
              }
            >
              <i class="ti ti-settings" />
              Manage
            </button>
          </Show>
        </div>
      </section>

      <section class="grid min-h-[34rem] flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)]">
        <div class="flex min-h-0 flex-col gap-3">
          <section class="paper p-4">
            <RecordPicker
              tableId={props.table.id}
              templateId={props.template.id}
              value={recordId}
              onChange={setSelectedRecord}
              label="Record"
              placeholder="Search records..."
            />
            <button
              type="button"
              class="btn-primary mt-3 w-full"
              onClick={() => void generate()}
              disabled={!recordId().trim() || busy() === "generate"}
            >
              {busy() === "generate" ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
              Generate PDF
            </button>
          </section>

          <section class="paper flex min-h-0 flex-col gap-3 p-4">
            <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary">Generated documents</h3>
            <Show when={runs.loading}>
              <p class="text-xs text-dimmed">Loading generated documents...</p>
            </Show>
            <Show when={!runs.loading && generatedRuns().length === 0}>
              <Placeholder align="left" class="px-0 py-2">
                No generated documents for this record.
              </Placeholder>
            </Show>
            <Show when={generatedRuns().length > 0}>
              <div class="flex flex-col gap-2">
                <For each={generatedRuns()}>
                  {(run) => (
                    <div class="flex min-w-0 items-center gap-2 text-xs">
                      <i class="ti ti-file-description text-dimmed" />
                      <span class="min-w-0 flex-1 truncate font-mono text-secondary">{run.documentNumber}</span>
                      <span class="shrink-0 text-dimmed">{formatRelativeTime(run.generatedAt)}</span>
                      <button
                        type="button"
                        class={iconActionClass}
                        title="Download document"
                        aria-label="Download document"
                        onClick={() => void redownload(run)}
                        disabled={busy() === run.id}
                      >
                        {busy() === run.id ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>

        <PdfPreview
          title="PDF preview"
          class="min-h-[28rem]"
          buttonLabel="Render preview"
          emptyText="Choose a record, then render a PDF preview before generating the document."
          disabled={() => !recordId().trim()}
          request={previewPdf}
        />
      </section>
    </div>
  );
}
