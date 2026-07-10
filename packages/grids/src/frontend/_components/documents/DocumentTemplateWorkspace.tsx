import { prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations, timed as timing } from "@valentinkolb/stdlib/solid";
import { createEffect, createResource, createSignal, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type {
  DocumentRunBrowseResponse,
  DocumentRunFolder,
  DocumentRunSummary,
  DocumentTemplate,
  DocumentTemplateSummary,
} from "../../../contracts";
import type { Table } from "../../../service";
import { openDocumentTemplateEditorDialog } from "../dialogs/TableAdminDialogs";
import { type GridsDocumentViewMode, setDocumentViewMode } from "../sidebar/GridsSettingsStore";
import { errorMessage } from "../utils/api-helpers";
import DocumentBrowser, { type DocumentBreadcrumb } from "./DocumentBrowser";
import DocumentBrowserToolbar from "./DocumentBrowserToolbar";
import { openDocumentGenerateDialog } from "./DocumentGenerateDialog";
import { openDocumentLinkDialog } from "./DocumentLinkDialog";
import { openDocumentRunDetailsDialog } from "./DocumentRunDetailsDialog";
import {
  activeDocumentViewMode,
  appendDocumentBrowserPage,
  type DocumentViewMode,
  documentBrowserEmptyText,
  documentBrowserKey,
  documentCountLabel,
  replaceDocumentBrowserPage,
  serializeDocumentBrowserKey,
} from "./document-browser-model";
import { downloadPdfResponse } from "./document-download";
import { formatDocumentMonth } from "./document-workspace-utils";

type Props = {
  baseId: string;
  table: Table;
  template: DocumentTemplateSummary;
  editableTemplate: DocumentTemplate | null;
  canWriteTemplate: boolean;
  canManageTemplate: boolean;
  editMode: boolean;
  initialRecordId: string | null;
  initialDocumentViewMode: GridsDocumentViewMode;
  dateConfig?: DateContext;
};

const PAGE_SIZE = 200;

const fetchBrowserPage = async (
  args: ReturnType<typeof documentBrowserKey> & { cursor?: string | null; signal?: AbortSignal },
): Promise<DocumentRunBrowseResponse> => {
  const res = await apiClient.documents.runs["by-template"][":templateId"].browse.$get(
    {
      param: { templateId: args.templateId },
      query: {
        q: args.search,
        limit: String(PAGE_SIZE),
        cursor: args.cursor ?? "",
        mode: args.mode,
        path: args.path.join("/"),
      },
    },
    args.signal ? { init: { signal: args.signal } } : undefined,
  );
  if (!res.ok) throw new Error(await errorMessage(res, "Could not load generated documents"));
  return (await res.json()) as DocumentRunBrowseResponse;
};

export default function DocumentTemplateWorkspace(props: Props) {
  const [searchDraft, setSearchDraft] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [viewMode, setViewMode] = createSignal<DocumentViewMode>(props.initialDocumentViewMode);
  const [folderPath, setFolderPath] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [runItems, setRunItems] = createSignal<DocumentRunSummary[]>([]);
  const [folderItems, setFolderItems] = createSignal<DocumentRunFolder[]>([]);
  const [runPage, setRunPage] = createSignal<{ total: number; hasMore: boolean; nextCursor: string | null }>({
    total: 0,
    hasMore: false,
    nextCursor: null,
  });

  const debouncedSearch = timing.debounce((next: string) => setSearch(next.trim()), 250);
  createEffect(() => debouncedSearch.debouncedFn(searchDraft()));

  const activeViewMode = () => activeDocumentViewMode(viewMode(), search());
  const currentBrowserKey = () => documentBrowserKey(props.template.id, viewMode(), search(), folderPath());
  const browserKeyString = (key = currentBrowserKey()) => serializeDocumentBrowserKey(key);
  const [browser, { refetch: refetchBrowser }] = createResource(currentBrowserKey, (key) =>
    fetchBrowserPage({ ...key, search: key.search.trim() }),
  );

  createEffect(() => {
    const page = browser();
    if (!page) return;
    const next = replaceDocumentBrowserPage(page);
    setRunItems(next.runs);
    setFolderItems(next.folders);
    setRunPage({ total: next.total, hasMore: next.hasMore, nextCursor: next.nextCursor });
  });

  const loadMoreMut = mutations.create<DocumentRunBrowseResponse, void, { key: string; cursor: string }>({
    onBefore: () => {
      const cursor = runPage().nextCursor;
      if (!cursor) throw new Error("No more documents to load.");
      return { key: browserKeyString(), cursor };
    },
    mutation: async (_, { cursor, abortSignal }) => fetchBrowserPage({ ...currentBrowserKey(), cursor, signal: abortSignal }),
    onSuccess: (page, ctx) => {
      if (!ctx) return;
      const current = {
        runs: runItems(),
        folders: folderItems(),
        total: runPage().total,
        hasMore: runPage().hasMore,
        nextCursor: runPage().nextCursor,
      };
      const next = appendDocumentBrowserPage(current, page, ctx.key, browserKeyString());
      if (next === current) return;
      setRunItems(next.runs);
      setRunPage({ total: next.total, hasMore: next.hasMore, nextCursor: next.nextCursor });
    },
    onError: (error) => prompts.error(error.message),
  });

  const generatedRuns = () => runItems();
  const folders = () => folderItems();
  const countLabel = () => documentCountLabel(activeViewMode(), folders(), generatedRuns(), runPage().total);
  const folderTitle = (folder: DocumentRunFolder) => {
    if (folder.kind === "year") return folder.label;
    const [year, month] = folder.path;
    return year && month ? formatDocumentMonth(year, month, props.dateConfig) : folder.label;
  };
  const breadcrumbs = (): DocumentBreadcrumb[] => {
    const path = folderPath();
    const items: DocumentBreadcrumb[] = [{ label: "Documents", path: [] }];
    if (path[0]) items.push({ label: path[0], path: [path[0]] });
    if (path[0] && path[1]) items.push({ label: formatDocumentMonth(path[0], path[1], props.dateConfig), path: [path[0], path[1]] });
    return items;
  };
  const setMode = (mode: DocumentViewMode) => {
    if (mode === "custom") return;
    setViewMode(mode);
    setDocumentViewMode(mode);
    if (mode !== "folders") setFolderPath([]);
  };
  const openFolder = (folder: DocumentRunFolder) => {
    setViewMode("folders");
    setDocumentViewMode("folders");
    setFolderPath(folder.path);
  };
  const replaceRun = (next: DocumentRunSummary) => {
    setRunItems((items) => items.map((item) => (item.id === next.id ? next : item)));
  };
  const downloadRun = async (run: DocumentRunSummary, signal?: AbortSignal) => {
    const res = await fetch(`/api/grids/documents/runs/${encodeURIComponent(run.id)}/download`, signal ? { signal } : undefined);
    await downloadPdfResponse(res, run.filename);
  };
  const openCreateLink = (run: DocumentRunSummary) => {
    if (!props.canWriteTemplate) return;
    void openDocumentLinkDialog({ run, onCreated: async () => {} });
  };
  const openRunDetails = (run: DocumentRunSummary) =>
    void openDocumentRunDetailsDialog({
      run,
      canWrite: props.canWriteTemplate,
      dateConfig: props.dateConfig,
      onSaved: replaceRun,
      onDownload: (item) => downloadRun(item),
    });
  const openGenerate = () => {
    if (!props.canWriteTemplate) return;
    void openDocumentGenerateDialog({
      table: props.table,
      template: props.template,
      initialRecordId: props.initialRecordId,
      onGenerated: async () => {
        await refetchBrowser();
      },
    });
  };

  const downloadMut = mutations.create<void, DocumentRunSummary, { runId: string }>({
    onBefore: (run) => {
      setBusy(run.id);
      return { runId: run.id };
    },
    mutation: async (run, { abortSignal }) => downloadRun(run, abortSignal),
    onError: (error) => prompts.error(error.message),
    onFinally: (ctx) => {
      if (ctx?.runId && busy() === ctx.runId) setBusy(null);
    },
  });

  const emptyText = () => documentBrowserEmptyText(search(), activeViewMode(), folderPath());

  return (
    <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden" data-scroll-preserve="grids-document-template-workspace">
      <DocumentBrowserToolbar
        canWrite={props.canWriteTemplate}
        searchDraft={searchDraft}
        setSearchDraft={setSearchDraft}
        clearSearch={() => {
          setSearchDraft("");
          setSearch("");
        }}
        activeMode={activeViewMode() === "folders" ? "folders" : "list"}
        searching={Boolean(search().trim())}
        countLabel={countLabel()}
        onGenerate={openGenerate}
        onMode={setMode}
      />
      <Show when={props.editMode && props.canManageTemplate ? props.editableTemplate : null}>
        {(editableTemplate) => (
          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn-input-success btn-input-sm"
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
          </div>
        )}
      </Show>
      <DocumentBrowser
        loading={browser.loading}
        error={browser.error}
        mode={activeViewMode() === "folders" ? "folders" : "list"}
        searching={Boolean(search().trim())}
        folders={folders()}
        runs={generatedRuns()}
        breadcrumbs={breadcrumbs()}
        emptyText={emptyText()}
        hasMore={runPage().hasMore}
        loadingMore={loadMoreMut.loading()}
        busyRunId={busy()}
        canWrite={props.canWriteTemplate}
        dateConfig={props.dateConfig}
        folderTitle={folderTitle}
        onBreadcrumb={setFolderPath}
        onFolder={openFolder}
        onRun={openRunDetails}
        onEdit={openRunDetails}
        onLink={openCreateLink}
        onDownload={(run) => void downloadMut.mutate(run)}
        onLoadMore={() => void loadMoreMut.mutate(undefined)}
      />
    </div>
  );
}
