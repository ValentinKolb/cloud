import type { DocumentRunFolder, DocumentRunSummary } from "../../../contracts";
import type { GridsDocumentViewMode } from "../sidebar/GridsSettingsStore";

export type DocumentViewMode = GridsDocumentViewMode | "custom";
export type DocumentBrowserMode = "list" | "folders";
export type DocumentBrowserKey = { templateId: string; search: string; mode: DocumentBrowserMode; path: string[] };
export type DocumentBrowserPageState = {
  runs: DocumentRunSummary[];
  folders: DocumentRunFolder[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export const activeDocumentViewMode = (viewMode: DocumentViewMode, search: string): DocumentBrowserMode =>
  search.trim() ? "list" : viewMode === "folders" ? "folders" : "list";

export const documentBrowserKey = (templateId: string, viewMode: DocumentViewMode, search: string, path: string[]): DocumentBrowserKey => {
  const mode = activeDocumentViewMode(viewMode, search);
  return { templateId, search, mode, path: mode === "folders" ? path : [] };
};

export const serializeDocumentBrowserKey = (key: DocumentBrowserKey): string =>
  `${key.templateId}:${key.mode}:${key.search.trim()}:${key.path.join("/")}`;

export const replaceDocumentBrowserPage = (page: {
  items: DocumentRunSummary[];
  folders: DocumentRunFolder[];
  total?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}): DocumentBrowserPageState => ({
  runs: page.items,
  folders: page.folders,
  total: page.total ?? page.items.length,
  hasMore: Boolean(page.hasMore),
  nextCursor: page.nextCursor ?? null,
});

export const appendDocumentBrowserPage = (
  current: DocumentBrowserPageState,
  page: { items: DocumentRunSummary[]; total?: number; hasMore?: boolean; nextCursor?: string | null },
  requestKey: string,
  currentKey: string,
): DocumentBrowserPageState =>
  requestKey === currentKey
    ? {
        ...current,
        runs: [...current.runs, ...page.items],
        total: page.total ?? current.total,
        hasMore: Boolean(page.hasMore),
        nextCursor: page.nextCursor ?? null,
      }
    : current;

export const documentCountLabel = (
  mode: DocumentBrowserMode,
  folders: DocumentRunFolder[],
  runs: DocumentRunSummary[],
  total: number,
): string => {
  const effectiveTotal = mode === "folders" && folders.length > 0 ? folders.reduce((sum, folder) => sum + folder.count, 0) : total;
  if (folders.length > 0) return `${effectiveTotal} documents`;
  return effectiveTotal > runs.length ? `${runs.length} of ${effectiveTotal} documents` : `${runs.length} documents`;
};

export const documentBrowserEmptyText = (search: string, mode: DocumentBrowserMode, folderPath: string[]): string => {
  if (search.trim()) return "No documents match this search.";
  if (mode === "folders" && folderPath.length > 0) return "This folder is empty.";
  return "No generated documents yet.";
};

export const documentRunActionState = (canWrite: boolean, busyRunId: string | null, runId: string) => ({
  showEdit: canWrite,
  showLink: canWrite,
  downloadBusy: busyRunId === runId,
});
