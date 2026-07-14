import { markdown } from "@valentinkolb/cloud/shared";
import { MarkdownView, Placeholder, prompts, SelectInput } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import dayjs from "dayjs";
import { diffLines } from "diff";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { buildNoteUrl } from "../../../params";
import { buildDiffRows, type DiffRow, orderComparison, summarizeDiff } from "./version-history";

type NoteVersion = {
  id: string;
  noteId: string;
  createdBy: string | null;
  createdAt: string;
};

type PaginationInfo = {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
};

type VersionData = {
  contentMd: string | null;
  yjsSnapshot: string;
};

type Props = {
  notebookId: string;
  noteId: string;
  noteTitle: string;
  isLocked?: boolean;
  currentContentMd: string | null;
};

type PreviewMode = "content" | "changes";

const PER_PAGE = 20;

/** Pseudo-ID for "Current version" */
const CURRENT_ID = "__current__";

export default function VersionHistory(props: Props) {
  const [versions, setVersions] = createSignal<NoteVersion[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [pagination, setPagination] = createSignal<PaginationInfo | null>(null);

  const [selectedVersionId, setSelectedVersionId] = createSignal<string | null>(null);
  const [selectedVersionData, setSelectedVersionData] = createSignal<VersionData | null>(null);
  const [comparisonVersionId, setComparisonVersionId] = createSignal(CURRENT_ID);
  const [previewMode, setPreviewMode] = createSignal<PreviewMode>("content");
  const [diffRows, setDiffRows] = createSignal<DiffRow[]>([]);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal(false);

  // Cache loaded version data to avoid re-fetching
  const versionCache = new Map<string, VersionData>();
  let previewRequestId = 0;

  const backUrl = buildNoteUrl(props.notebookId, props.noteId);

  // ── Data fetching ──

  const fetchVersions = async (page: number, append = false) => {
    try {
      const res = await apiClient[":id"].notes[":noteId"].versions.$get({
        param: { id: props.notebookId, noteId: props.noteId },
        query: { page: String(page), per_page: String(PER_PAGE) },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          data: NoteVersion[];
          pagination: PaginationInfo;
        };
        setVersions(append ? [...versions(), ...data.data] : data.data);
        setPagination(data.pagination);
      }
    } catch {
      /* ignore */
    }
  };

  const fetchVersionData = async (versionId: string): Promise<VersionData | null> => {
    if (versionId === CURRENT_ID) {
      return { contentMd: props.currentContentMd, yjsSnapshot: "" };
    }

    const cached = versionCache.get(versionId);
    if (cached) return cached;

    try {
      const res = await apiClient[":id"].notes[":noteId"].versions[":versionId"].content.$get({
        param: { id: props.notebookId, noteId: props.noteId, versionId },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          yjsSnapshot: string;
          contentMd: string | null;
        };
        const result: VersionData = {
          contentMd: data.contentMd,
          yjsSnapshot: data.yjsSnapshot,
        };
        versionCache.set(versionId, result);
        return result;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  // ── Diff computation ──

  const computeDiff = async (selectedId: string, comparisonId: string) => {
    const requestId = ++previewRequestId;
    const { fromId, toId } = orderComparison(selectedId, comparisonId, versions(), CURRENT_ID);
    setPreviewLoading(true);
    setPreviewError(false);
    setDiffRows([]);

    const [selectedData, comparisonData] = await Promise.all([fetchVersionData(selectedId), fetchVersionData(comparisonId)]);
    if (requestId !== previewRequestId) return;

    setSelectedVersionData(selectedData);
    const fromData = fromId === selectedId ? selectedData : comparisonData;
    const toData = toId === selectedId ? selectedData : comparisonData;

    if (fromData && toData) {
      setDiffRows(buildDiffRows(diffLines(fromData.contentMd ?? "", toData.contentMd ?? "")));
    } else {
      setPreviewError(true);
    }

    setPreviewLoading(false);
  };

  // ── Selection logic ──

  const selectVersion = (versionId: string) => {
    setSelectedVersionId(versionId);
    setSelectedVersionData(null);
    setComparisonVersionId(CURRENT_ID);
    void computeDiff(versionId, CURRENT_ID);
  };

  const changeComparison = (versionId: string) => {
    const selectedId = selectedVersionId();
    if (!selectedId || versionId === selectedId) return;
    setComparisonVersionId(versionId);
    setPreviewMode("changes");
    void computeDiff(selectedId, versionId);
  };

  // ── Init ──

  onMount(async () => {
    await fetchVersions(1);
    setLoading(false);
  });

  const loadMore = async () => {
    const p = pagination();
    if (!p || !p.has_next) return;
    setLoadingMore(true);
    await fetchVersions(p.page + 1, true);
    setLoadingMore(false);
  };

  // ── Restore ──

  const getRestoreSnapshot = (): string | null => {
    const selectedId = selectedVersionId();
    if (!selectedId) return null;
    return versionCache.get(selectedId)?.yjsSnapshot ?? null;
  };

  const restoreAsNewMut = mutations.create<{ id: string; shortId: string }, { title: string; snapshot: string }>({
    mutation: async (data: { title: string; snapshot: string }) => {
      const createRes = await apiClient[":id"].notes.$post({
        param: { id: props.notebookId },
        json: { title: data.title },
      });
      if (!createRes.ok) throw new Error("Failed to create note");
      const newNote = (await createRes.json()) as { id: string; shortId: string };

      const restoreRes = await apiClient[":id"].notes[":noteId"].restore.$post({
        param: { id: props.notebookId, noteId: newNote.id },
        json: { yjsSnapshot: data.snapshot },
      });
      if (!restoreRes.ok) throw new Error("Failed to restore content");
      return newNote;
    },
    onSuccess: (data) => {
      navigateTo(buildNoteUrl(props.notebookId, data.shortId));
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleRestoreAsNew = async () => {
    const snapshot = getRestoreSnapshot();
    if (!snapshot) return;
    const result = await prompts.form({
      title: "Create Note from Version",
      icon: "ti ti-file-plus",
      fields: {
        title: {
          type: "text" as const,
          label: "Title",
          required: true,
          default: `${props.noteTitle} (version copy)`,
        },
      },
    });
    if (result) restoreAsNewMut.mutate({ title: result.title, snapshot });
  };

  // ── Helpers ──

  const formatDate = (iso: string) => dayjs(iso).format("DD.MM.YYYY HH:mm");

  const isWorking = () => restoreAsNewMut.loading();

  const comparisonOptions = createMemo(() => [
    { id: CURRENT_ID, label: "Current note", icon: "ti ti-file-text" },
    ...versions()
      .filter((version) => version.id !== selectedVersionId())
      .map((version) => ({ id: version.id, label: formatDate(version.createdAt), icon: "ti ti-history" })),
  ]);

  const comparisonLabel = createMemo((): { from: string; to: string } | null => {
    const selectedId = selectedVersionId();
    if (!selectedId) return null;
    const comparisonId = comparisonVersionId();
    const { fromId, toId } = orderComparison(selectedId, comparisonId, versions(), CURRENT_ID);
    const labelFor = (id: string) => {
      if (id === CURRENT_ID) return "Current note";
      const version = versions().find((entry) => entry.id === id);
      return version ? formatDate(version.createdAt) : "Unknown version";
    };
    return { from: labelFor(fromId), to: labelFor(toId) };
  });

  const diffSummary = createMemo(() => summarizeDiff(diffRows()));

  const selectedContentHtml = createMemo(() => markdown.renderSync(selectedVersionData()?.contentMd ?? ""));

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      {/* Header */}
      <div class="flex shrink-0 items-center justify-between px-2 pt-2">
        <div class="flex items-center gap-2">
          <a href={backUrl} class="icon-btn h-8 w-8 text-dimmed" title="Back to editor" aria-label="Back to editor">
            <i class="ti ti-arrow-left" />
          </a>
          <div>
            <h2 class="text-sm font-semibold">Version History</h2>
            <p class="text-xs text-dimmed">{props.noteTitle}</p>
          </div>
        </div>

        <Show when={selectedVersionId()}>
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-1" role="group" aria-label="Version preview">
              <button
                type="button"
                class={`btn-input btn-input-sm ${previewMode() === "content" ? "btn-input-active" : ""}`}
                aria-pressed={previewMode() === "content"}
                onClick={() => setPreviewMode("content")}
              >
                <i class="ti ti-file-text" />
                Content
              </button>
              <button
                type="button"
                class={`btn-input btn-input-sm ${previewMode() === "changes" ? "btn-input-active" : ""}`}
                aria-pressed={previewMode() === "changes"}
                onClick={() => setPreviewMode("changes")}
              >
                <i class="ti ti-git-compare" />
                Changes
              </button>
            </div>
            <Show when={props.isLocked}>
              <span class="text-xs text-dimmed flex items-center gap-1">
                <i class="ti ti-lock text-xs" />
                Locked
              </span>
            </Show>
            <button
              type="button"
              onClick={handleRestoreAsNew}
              disabled={isWorking() || previewLoading() || !getRestoreSnapshot()}
              class="btn-input btn-input-sm"
              title="Creates a new note. The current note stays unchanged."
            >
              {restoreAsNewMut.loading() ? (
                <i class="ti ti-loader-2 animate-spin" />
              ) : (
                <>
                  <i class="ti ti-file-plus mr-1" />
                  Create note from version
                </>
              )}
            </button>
          </div>
        </Show>
      </div>

      {/* Loading */}
      <Show when={loading()}>
        <div class="flex-1 flex items-center justify-center">
          <i class="ti ti-loader-2 animate-spin text-dimmed" />
        </div>
      </Show>

      {/* Empty */}
      <Show when={!loading() && versions().length === 0}>
        <div class="flex-1 flex items-center justify-center">
          <Placeholder icon="ti ti-history">No versions yet</Placeholder>
        </div>
      </Show>

      {/* Two-column body */}
      <Show when={!loading() && versions().length > 0}>
        <div class="flex-1 min-h-0 app-cols">
          {/* Left: version list */}
          <div class="notebooks-version-history-list overflow-y-auto scrollbar">
            <div class="flex flex-col gap-0.5 p-2">
              <p class="px-2.5 pb-1 text-[10px] font-semibold uppercase text-dimmed">Saved versions</p>
              <For each={versions()}>
                {(version) => (
                  <button
                    type="button"
                    onClick={() => selectVersion(version.id)}
                    class={`list-item w-full !px-2.5 !py-1.5 text-left text-xs ${selectedVersionId() === version.id ? "list-item-active" : ""}`}
                    aria-pressed={selectedVersionId() === version.id}
                  >
                    <i class="ti ti-history text-[11px] text-dimmed" />
                    <span>{formatDate(version.createdAt)}</span>
                  </button>
                )}
              </For>

              {/* Load more */}
              <Show when={pagination()?.has_next}>
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore()}
                  class="text-[10px] text-dimmed hover:text-primary transition-colors py-1.5 text-center"
                >
                  {loadingMore() ? <i class="ti ti-loader-2 animate-spin" /> : "Load more..."}
                </button>
              </Show>

              <Show when={pagination()}>
                <p class="text-[10px] text-dimmed text-center py-1">
                  {versions().length} / {pagination()!.total}
                </p>
              </Show>
            </div>
          </div>

          {/* Right: saved content and optional comparison */}
          <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
            <Show when={selectedVersionId() && previewMode() === "changes" && comparisonLabel()}>
              <div class="flex shrink-0 flex-wrap items-end gap-3 px-3 pb-2">
                <div class="min-w-0 flex-1">
                  <p class="text-[10px] font-semibold uppercase text-dimmed">Comparing</p>
                  <p class="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
                    <span class="truncate font-medium text-primary">{comparisonLabel()!.from}</span>
                    <i class="ti ti-arrow-right shrink-0 text-dimmed" />
                    <span class="truncate font-medium text-primary">{comparisonLabel()!.to}</span>
                  </p>
                </div>
                <Show when={!previewLoading() && diffSummary().hasChanges}>
                  <div class="flex items-center gap-2 pb-2 font-mono text-[11px] tabular-nums">
                    <span class="text-green-700 dark:text-green-300">+{diffSummary().added}</span>
                    <span class="text-red-700 dark:text-red-300">-{diffSummary().removed}</span>
                  </div>
                </Show>
                <div class="w-full sm:w-52">
                  <SelectInput
                    label="Compare with"
                    icon="ti ti-git-compare"
                    value={comparisonVersionId}
                    onChange={changeComparison}
                    options={comparisonOptions()}
                  />
                </div>
              </div>
            </Show>

            <div class="flex-1 min-h-0 overflow-auto scrollbar">
              <Show when={!selectedVersionId()}>
                <div class="flex h-full items-center justify-center">
                  <Placeholder
                    icon="ti ti-file-search"
                    title="Select a saved version"
                    description="Its saved content opens here. You can then inspect its changes against the current note."
                  />
                </div>
              </Show>

              <Show when={selectedVersionId()}>
                <Show when={previewLoading()}>
                  <div class="flex h-full items-center justify-center">
                    <i class="ti ti-loader-2 animate-spin text-dimmed" />
                  </div>
                </Show>

                <Show when={!previewLoading() && previewMode() === "content" && !selectedVersionData()}>
                  <div class="flex h-full items-center justify-center">
                    <Placeholder
                      icon="ti ti-alert-circle"
                      title="Version could not be loaded"
                      description="Select the version again to retry."
                    />
                  </div>
                </Show>

                <Show when={!previewLoading() && previewMode() === "content" && selectedVersionData()}>
                  <Show
                    when={selectedVersionData()?.contentMd?.trim()}
                    fallback={
                      <div class="flex h-full items-center justify-center">
                        <Placeholder
                          icon="ti ti-file-off"
                          title="Empty version"
                          description="This saved version has no Markdown content."
                        />
                      </div>
                    }
                  >
                    <div class="mx-auto w-full max-w-4xl p-4">
                      <MarkdownView html={selectedContentHtml()} />
                    </div>
                  </Show>
                </Show>

                <Show when={!previewLoading() && previewMode() === "changes" && previewError()}>
                  <div class="flex h-full items-center justify-center">
                    <Placeholder
                      icon="ti ti-alert-circle"
                      title="Comparison could not be loaded"
                      description="Select the version again to retry."
                    />
                  </div>
                </Show>

                <Show when={!previewLoading() && previewMode() === "changes" && !previewError() && diffSummary().hasChanges}>
                  <div class="min-w-max font-mono text-xs leading-5">
                    <For each={diffRows()}>
                      {(row) => (
                        <div
                          class={`grid grid-cols-[2.5rem_2.5rem_1.5rem_minmax(20rem,1fr)] ${
                            row.kind === "added"
                              ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300"
                              : row.kind === "removed"
                                ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                                : "text-secondary"
                          }`}
                        >
                          <span class="select-none px-1 text-right text-dimmed tabular-nums">{row.oldLine ?? ""}</span>
                          <span class="select-none px-1 text-right text-dimmed tabular-nums">{row.newLine ?? ""}</span>
                          <span class="select-none text-center text-dimmed">
                            {row.kind === "added" ? "+" : row.kind === "removed" ? "-" : " "}
                          </span>
                          <span class="whitespace-pre-wrap break-words pr-3">{row.value || " "}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={!previewLoading() && previewMode() === "changes" && !previewError() && !diffSummary().hasChanges}>
                  <div class="flex h-full items-center justify-center">
                    <Placeholder icon="ti ti-check" title="No differences" description="Both versions contain the same Markdown content." />
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
