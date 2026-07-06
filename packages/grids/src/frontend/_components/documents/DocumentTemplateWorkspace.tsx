import {
  DataTable,
  type DataTableColumn,
  dialogCore,
  PanelDialog,
  PdfPreview,
  Placeholder,
  panelDialogOptions,
  prompts,
  TagsInput,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations, timed as timing } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DocumentRunSummary, DocumentTemplate, DocumentTemplateSummary } from "../../../contracts";
import type { Table } from "../../../service";
import { openDocumentTemplateEditorDialog } from "../dialogs/TableAdminDialogs";
import RecordPicker from "../records/RecordPicker";
import { errorMessage } from "../utils/api-helpers";
import { downloadPdfResponse } from "./document-download";

type Props = {
  baseId: string;
  table: Table;
  template: DocumentTemplateSummary;
  editableTemplate: DocumentTemplate | null;
  canManageTemplate: boolean;
  editMode: boolean;
  initialRecordId: string | null;
  dateConfig?: DateContext;
};

type DocumentViewMode = "table" | "folders" | "custom";
type DocumentRunPage = {
  items: DocumentRunSummary[];
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
};

const iconActionClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center text-dimmed transition-colors hover:text-secondary disabled:cursor-not-allowed disabled:opacity-50";
const PAGE_SIZE = 200;

const formatRelativeTime = (iso: string, dateConfig?: DateContext): string => dates.formatDateTimeRelative(iso, dateConfig);
const monthLabel = (iso: string, dateConfig?: DateContext): string =>
  new Intl.DateTimeFormat(dateConfig?.locale, { month: "long", timeZone: dateConfig?.timeZone }).format(new Date(iso));
const yearLabel = (iso: string, dateConfig?: DateContext): string => dates.formatDateKey(iso, dateConfig).slice(0, 4);

const fileTableColumns: DataTableColumn<DocumentRunSummary>[] = [
  { id: "filename", header: "Filename", value: "filename" },
  { id: "number", header: "Number", value: "documentNumber" },
  { id: "tags", header: "Tags", value: "tags" },
  { id: "generated", header: "Created", value: "generatedAt" },
  { id: "actions", header: "", value: "id", cellClass: "w-10" },
];

function DocumentTags(props: { tags: string[] }) {
  return (
    <Show when={props.tags.length > 0} fallback={<span class="text-dimmed">-</span>}>
      <span class="flex min-w-0 flex-wrap items-center gap-1">
        <For each={props.tags}>{(tag) => <span class="tag max-w-32 truncate">{tag}</span>}</For>
      </span>
    </Show>
  );
}

function ViewButton(props: {
  value: DocumentViewMode;
  current: () => DocumentViewMode;
  icon: string;
  label: string;
  disabled?: boolean;
  onSelect: (mode: DocumentViewMode) => void;
}) {
  const active = () => props.current() === props.value;
  return (
    <button
      type="button"
      class={`btn-input btn-input-sm ${active() ? "btn-input-active" : ""}`}
      onClick={() => props.onSelect(props.value)}
      disabled={props.disabled}
      title={props.disabled ? "Custom folders are not configured yet" : props.label}
    >
      <i class={props.icon} />
      {props.label}
    </button>
  );
}

const openDocumentGenerateDialog = (args: {
  table: Table;
  template: DocumentTemplateSummary;
  initialRecordId: string | null;
  onGenerated: () => void | Promise<void>;
}) => dialogCore.open<void>((close) => <DocumentGenerateDialog args={args} close={close} />, panelDialogOptions);

function DocumentGenerateDialog(props: {
  args: {
    table: Table;
    template: DocumentTemplateSummary;
    initialRecordId: string | null;
    onGenerated: () => void | Promise<void>;
  };
  close: () => void;
}) {
  const [recordId, setRecordId] = createSignal(props.args.initialRecordId ?? "");
  const [filename, setFilename] = createSignal("");
  const [tags, setTags] = createSignal<string[]>([]);
  const [previewedRecordId, setPreviewedRecordId] = createSignal<string | null>(null);

  const setSelectedRecord = (next: string) => {
    setRecordId(next);
    setPreviewedRecordId(null);
  };

  const hasCurrentPreview = () => {
    const selected = recordId().trim();
    return selected.length > 0 && previewedRecordId() === selected;
  };

  const previewPdf = async () => {
    const selected = recordId().trim();
    if (!selected) throw new Error("Choose a record first.");
    setPreviewedRecordId(null);
    const res = await fetch(`/api/grids/documents/templates/${encodeURIComponent(props.args.template.id)}/preview-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordId: selected }),
    });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("application/pdf")) setPreviewedRecordId(selected);
    return res;
  };

  const generateMut = mutations.create<void, void>({
    mutation: async (_, { abortSignal }) => {
      const selected = recordId().trim();
      if (!selected) throw new Error("Choose a record first.");
      if (!hasCurrentPreview()) throw new Error("Render a PDF preview before generating this document.");
      const res = await fetch(`/api/grids/documents/templates/${encodeURIComponent(props.args.template.id)}/generate`, {
        method: "POST",
        signal: abortSignal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: selected,
          filename: filename().trim() || undefined,
          tags: tags(),
        }),
      });
      await downloadPdfResponse(res, filename().trim() || `${props.args.template.name}.pdf`);
    },
    onSuccess: async () => {
      await props.args.onGenerated();
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={`Generate — ${props.args.template.name}`}
        subtitle={props.args.table.name}
        icon="ti ti-file-type-pdf"
        close={props.close}
      />
      <PanelDialog.Body>
        <div class="grid min-h-[34rem] gap-2 lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
          <section class="flex min-h-0 flex-col gap-2">
            <RecordPicker
              tableId={props.args.table.id}
              templateId={props.args.template.id}
              value={recordId}
              onChange={setSelectedRecord}
              label="Record"
              placeholder="Search records..."
            />
            <TextInput
              label="Filename"
              description="Optional override. Leave empty to use the template's Liquid filename pattern."
              value={filename}
              onInput={setFilename}
              icon="ti ti-file-text"
              placeholder="Use template default"
            />
            <TagsInput label="Tags" placeholder="customer, signed, 2026" value={tags} onChange={setTags} />
            <div class="info-block-info text-xs">
              <i class="ti ti-camera" />
              Generating stores a recursive snapshot. Redownloads use the stored snapshot and filename.
            </div>
          </section>

          <PdfPreview
            title="PDF preview"
            class="min-h-[30rem]"
            buttonLabel="Render preview"
            emptyText="Choose a record and render a PDF preview before generating."
            disabled={() => !recordId().trim()}
            request={previewPdf}
          />
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.close} disabled={generateMut.loading()}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => generateMut.mutate(undefined)}
            disabled={generateMut.loading() || !hasCurrentPreview()}
          >
            {generateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
            Generate PDF
          </button>
        </div>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function DocumentTemplateWorkspace(props: Props) {
  const [searchDraft, setSearchDraft] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [viewMode, setViewMode] = createSignal<DocumentViewMode>("table");
  const [busy, setBusy] = createSignal<string | null>(null);
  const [runItems, setRunItems] = createSignal<DocumentRunSummary[]>([]);
  const [runPage, setRunPage] = createSignal<{ total: number; hasMore: boolean; nextOffset: number | null }>({
    total: 0,
    hasMore: false,
    nextOffset: null,
  });

  const debouncedSearch = timing.debounce((next: string) => setSearch(next.trim()), 250);
  createEffect(() => {
    const next = searchDraft();
    if (next.trim()) setViewMode("table");
    debouncedSearch.debouncedFn(next);
  });

  const fetchRunPage = async (args: {
    templateId: string;
    search: string;
    offset: number;
    signal?: AbortSignal;
  }): Promise<DocumentRunPage> => {
    const res = await apiClient.documents.runs["by-template"][":templateId"].$get(
      {
        param: { templateId: args.templateId },
        query: {
          q: args.search,
          limit: String(PAGE_SIZE),
          offset: String(args.offset),
        },
      },
      args.signal ? { init: { signal: args.signal } } : undefined,
    );
    if (!res.ok) throw new Error(await errorMessage(res, "Could not load generated documents"));
    return (await res.json()) as DocumentRunPage;
  };

  const activeViewMode = () => (search().trim() ? "table" : viewMode());
  const [runs, { refetch: refetchRuns }] = createResource(
    () => ({ templateId: props.template.id, search: search() }),
    async ({ templateId, search }) => fetchRunPage({ templateId, search: search.trim(), offset: 0 }),
  );

  createEffect(() => {
    const page = runs();
    if (!page) return;
    setRunItems(page.items);
    setRunPage({
      total: page.total ?? page.items.length,
      hasMore: Boolean(page.hasMore),
      nextOffset: page.nextOffset ?? null,
    });
  });

  const loadMoreMut = mutations.create<DocumentRunPage, void, { search: string; offset: number }>({
    onBefore: () => {
      const offset = runPage().nextOffset;
      if (offset === null) throw new Error("No more documents to load.");
      return { search: search().trim(), offset };
    },
    mutation: async (_, { search, offset, abortSignal }) =>
      fetchRunPage({ templateId: props.template.id, search, offset, signal: abortSignal }),
    onSuccess: (page, ctx) => {
      if (!ctx || ctx.search !== search().trim()) return;
      setRunItems((items) => [...items, ...page.items]);
      setRunPage({
        total: page.total ?? runPage().total,
        hasMore: Boolean(page.hasMore),
        nextOffset: page.nextOffset ?? null,
      });
    },
    onError: (error) => prompts.error(error.message),
  });

  const generatedRuns = () => runItems();
  const documentCountLabel = () => {
    const total = runPage().total;
    const loaded = generatedRuns().length;
    return total > loaded ? `${loaded} of ${total} documents` : `${loaded} documents`;
  };
  const folderGroups = createMemo(() => {
    const years = new Map<string, Map<string, DocumentRunSummary[]>>();
    for (const run of generatedRuns()) {
      const year = yearLabel(run.generatedAt, props.dateConfig);
      const month = monthLabel(run.generatedAt, props.dateConfig);
      if (!years.has(year)) years.set(year, new Map());
      const months = years.get(year)!;
      months.set(month, [...(months.get(month) ?? []), run]);
    }
    return [...years.entries()].map(([year, months]) => ({
      year,
      months: [...months.entries()].map(([month, items]) => ({ month, items })),
    }));
  });

  const openGenerate = () =>
    void openDocumentGenerateDialog({
      table: props.table,
      template: props.template,
      initialRecordId: props.initialRecordId,
      onGenerated: async () => {
        await refetchRuns();
      },
    });

  const downloadMut = mutations.create<void, DocumentRunSummary, { runId: string }>({
    onBefore: (run) => {
      setBusy(run.id);
      return { runId: run.id };
    },
    mutation: async (run, { abortSignal }) => {
      const res = await fetch(`/api/grids/documents/runs/${encodeURIComponent(run.id)}/download`, { signal: abortSignal });
      await downloadPdfResponse(res, run.filename);
    },
    onError: (error) => prompts.error(error.message),
    onFinally: (ctx) => {
      if (ctx?.runId && busy() === ctx.runId) setBusy(null);
    },
  });

  const renderRunActions = (run: DocumentRunSummary) => (
    <button
      type="button"
      class={iconActionClass}
      title="Download document"
      aria-label="Download document"
      onClick={() => void downloadMut.mutate(run)}
      disabled={busy() === run.id}
    >
      {busy() === run.id ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-download" />}
    </button>
  );

  return (
    <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden" data-scroll-preserve="grids-document-template-workspace">
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <div class="min-w-64 flex-1">
          <TextInput
            type="search"
            icon="ti ti-search"
            placeholder="Search documents..."
            value={searchDraft}
            onInput={setSearchDraft}
            clearable
            onClear={() => {
              setSearchDraft("");
              setSearch("");
            }}
          />
        </div>
        <span class="whitespace-nowrap text-xs text-dimmed">{documentCountLabel()}</span>
        <ViewButton value="table" current={activeViewMode} icon="ti ti-table" label="Table" onSelect={setViewMode} />
        <ViewButton
          value="folders"
          current={activeViewMode}
          icon="ti ti-folders"
          label="Folders"
          onSelect={setViewMode}
          disabled={!!search().trim()}
        />
        <ViewButton value="custom" current={activeViewMode} icon="ti ti-folder-cog" label="Custom" onSelect={setViewMode} disabled />
        <button type="button" class="btn-input-primary btn-input-sm" onClick={openGenerate}>
          <i class="ti ti-plus" />
          Add new
        </button>
        <Show when={props.editMode && props.canManageTemplate ? props.editableTemplate : null}>
          {(editableTemplate) => (
            <button
              type="button"
              class="btn-input btn-input-sm"
              onClick={() =>
                openDocumentTemplateEditorDialog({
                  baseId: props.baseId,
                  tableId: props.table.id,
                  tableName: props.table.name,
                  template: editableTemplate(),
                  onSaved: () => refreshCurrentPath(),
                })
              }
            >
              <i class="ti ti-settings" />
              Manage
            </button>
          )}
        </Show>
      </div>

      <section class="paper min-h-0 flex-1 overflow-hidden">
        <Show when={!runs.loading} fallback={<div class="p-3 text-sm text-dimmed">Loading documents...</div>}>
          <Show
            when={!runs.error}
            fallback={<Placeholder class="h-full">{runs.error?.message ?? "Could not load generated documents."}</Placeholder>}
          >
            <Show
              when={generatedRuns().length > 0}
              fallback={
                <Placeholder class="h-full">
                  {search().trim() ? "No documents match this search." : "No generated documents yet."}
                </Placeholder>
              }
            >
              <Show
                when={activeViewMode() === "folders"}
                fallback={
                  <DataTable
                    rows={generatedRuns()}
                    columns={fileTableColumns}
                    getRowId={(run) => run.id}
                    class="h-full overflow-auto"
                    stickyHeader
                    fillHeight
                    hasMore={runPage().hasMore}
                    loadingMore={loadMoreMut.loading()}
                    onLoadMore={() => void loadMoreMut.mutate(undefined)}
                    renderCell={({ row, col, value, render }) => {
                      if (col.id === "filename")
                        return (
                          <div class="flex min-w-0 items-center gap-2">
                            <i class="ti ti-file-type-pdf shrink-0 text-dimmed" />
                            <span class="truncate font-medium text-primary">{row.filename}</span>
                          </div>
                        );
                      if (col.id === "number") return <span class="font-mono text-xs text-secondary">{row.documentNumber}</span>;
                      if (col.id === "tags") return <DocumentTags tags={row.tags} />;
                      if (col.id === "generated")
                        return <span class="text-secondary">{formatRelativeTime(row.generatedAt, props.dateConfig)}</span>;
                      if (col.id === "actions") return renderRunActions(row);
                      return render(value);
                    }}
                  />
                }
              >
                <div class="h-full overflow-auto">
                  <For each={folderGroups()}>
                    {(year) => (
                      <section class="border-b border-zinc-100 dark:border-zinc-800/60">
                        <div class="sticky top-0 z-10 flex items-center gap-2 bg-white px-3 py-2 text-xs font-semibold text-primary dark:bg-zinc-950">
                          <i class="ti ti-folder" />
                          {year.year}
                        </div>
                        <For each={year.months}>
                          {(month) => (
                            <div>
                              <div class="flex items-center gap-2 bg-zinc-50 px-6 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-secondary dark:bg-zinc-900/70">
                                <i class="ti ti-folder-open" />
                                {month.month}
                              </div>
                              <For each={month.items}>
                                {(run) => (
                                  <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-zinc-100 px-6 py-2 text-sm dark:border-zinc-800/60">
                                    <div class="min-w-0">
                                      <div class="flex min-w-0 items-center gap-2">
                                        <i class="ti ti-file-type-pdf shrink-0 text-dimmed" />
                                        <span class="truncate font-medium text-primary">{run.filename}</span>
                                      </div>
                                      <div class="mt-1 flex min-w-0 items-center gap-2 text-xs text-dimmed">
                                        <span class="font-mono">{run.documentNumber}</span>
                                        <DocumentTags tags={run.tags} />
                                      </div>
                                    </div>
                                    <span class="text-xs text-dimmed">{formatRelativeTime(run.generatedAt, props.dateConfig)}</span>
                                    {renderRunActions(run)}
                                  </div>
                                )}
                              </For>
                            </div>
                          )}
                        </For>
                      </section>
                    )}
                  </For>
                  <Show when={runPage().hasMore}>
                    <div class="flex justify-center p-3">
                      <button
                        type="button"
                        class="btn-input btn-input-sm"
                        onClick={() => void loadMoreMut.mutate(undefined)}
                        disabled={loadMoreMut.loading()}
                      >
                        {loadMoreMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-dots" />}
                        Load more documents
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </section>
    </div>
  );
}
