import { createSignal, For, Show, onMount } from "solid-js";
import { diffLines } from "diff";
import { apiClient } from "@/notebooks/client";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { buildNoteUrl } from "../../../params";
import dayjs from "dayjs";

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

type DiffPart = {
  added?: boolean;
  removed?: boolean;
  value: string;
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

const PER_PAGE = 20;

/** Pseudo-ID for "Current version" */
const CURRENT_ID = "__current__";

export default function VersionHistory(props: Props) {
  const [versions, setVersions] = createSignal<NoteVersion[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [pagination, setPagination] = createSignal<PaginationInfo | null>(null);

  // A = older/left side, B = newer/right side
  // Default: A = clicked version, B = current
  const [sideA, setSideA] = createSignal<string | null>(null);
  const [sideB, setSideB] = createSignal<string>(CURRENT_ID);

  const [diffParts, setDiffParts] = createSignal<DiffPart[]>([]);
  const [previewLoading, setPreviewLoading] = createSignal(false);

  // Cache loaded version data to avoid re-fetching
  const versionCache = new Map<string, VersionData>();

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

  const computeDiff = async () => {
    const a = sideA();
    const b = sideB();
    if (!a) return;

    setPreviewLoading(true);
    setDiffParts([]);

    const [dataA, dataB] = await Promise.all([fetchVersionData(a), fetchVersionData(b)]);

    if (dataA && dataB) {
      const parts = diffLines(dataA.contentMd ?? "", dataB.contentMd ?? "");
      setDiffParts(parts as DiffPart[]);
    }

    setPreviewLoading(false);
  };

  // ── Selection logic ──

  const handleVersionClick = (versionId: string) => {
    const currentA = sideA();
    const currentB = sideB();

    if (versionId === currentA) {
      setSideA(null);
      setSideB(CURRENT_ID);
      setDiffParts([]);
      return;
    }

    if (versionId === currentB) {
      setSideB(CURRENT_ID);
      computeDiff();
      return;
    }

    if (!currentA) {
      setSideA(versionId);
      setSideB(CURRENT_ID);
      computeDiff();
    } else if (currentB === CURRENT_ID) {
      setSideB(versionId);
      computeDiff();
    } else {
      setSideA(versionId);
      computeDiff();
    }
  };

  const resetToCurrentComparison = () => {
    setSideB(CURRENT_ID);
    computeDiff();
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
    const a = sideA();
    if (!a || a === CURRENT_ID) return null;
    return versionCache.get(a)?.yjsSnapshot ?? null;
  };

  const restoreMut = mutations.create({
    mutation: async (snapshot: string) => {
      const res = await apiClient[":id"].notes[":noteId"].restore.$post({
        param: { id: props.notebookId, noteId: props.noteId },
        json: { yjsSnapshot: snapshot },
      });
      if (!res.ok) throw new Error("Failed to restore version");
      return res.json();
    },
    onSuccess: () => {
      window.location.href = backUrl;
    },
    onError: (err) => prompts.error(err.message),
  });

  const restoreAsNewMut = mutations.create({
    mutation: async (data: { title: string; snapshot: string }) => {
      const createRes = await apiClient[":id"].notes.$post({
        param: { id: props.notebookId },
        json: { title: data.title },
      });
      if (!createRes.ok) throw new Error("Failed to create note");
      const newNote = (await createRes.json()) as { id: string };

      const restoreRes = await apiClient[":id"].notes[":noteId"].restore.$post({
        param: { id: props.notebookId, noteId: newNote.id },
        json: { yjsSnapshot: data.snapshot },
      });
      if (!restoreRes.ok) throw new Error("Failed to restore content");
      return newNote;
    },
    onSuccess: (data: any) => {
      window.location.href = buildNoteUrl(props.notebookId, data.id);
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleRestore = async () => {
    const snapshot = getRestoreSnapshot();
    if (!snapshot) return;
    const confirmed = await prompts.confirm(
      "Restore this version? Current content will be overwritten. A backup of the current state will be saved.",
      {
        title: "Restore Version",
        icon: "ti ti-history",
        confirmText: "Restore",
      },
    );
    if (confirmed) restoreMut.mutate(snapshot);
  };

  const handleRestoreAsNew = async () => {
    const snapshot = getRestoreSnapshot();
    if (!snapshot) return;
    const result = await prompts.form({
      title: "Restore as New Page",
      icon: "ti ti-file-plus",
      fields: {
        title: {
          type: "text" as const,
          label: "Title",
          required: true,
          default: `${props.noteTitle} (restored)`,
        },
      },
    });
    if (result) restoreAsNewMut.mutate({ title: result.title, snapshot });
  };

  // ── Helpers ──

  const formatDate = (iso: string) => dayjs(iso).format("DD.MM.YYYY HH:mm");

  const isWorking = () => restoreMut.loading() || restoreAsNewMut.loading();

  const splitLines = (value: string): string[] => {
    const lines = value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  };

  const getSelectionRole = (versionId: string): "a" | "b" | null => {
    if (versionId === sideA()) return "a";
    if (versionId === sideB()) return "b";
    return null;
  };

  const comparisonLabel = (): { from: string; to: string } | null => {
    const a = sideA();
    if (!a) return null;
    const b = sideB();

    const aVersion = versions().find((v) => v.id === a);
    const fromLabel = aVersion ? formatDate(aVersion.createdAt) : "?";

    if (b === CURRENT_ID) {
      return { from: fromLabel, to: "Current" };
    }
    const bVersion = versions().find((v) => v.id === b);
    return {
      from: fromLabel,
      to: bVersion ? formatDate(bVersion.createdAt) : "?",
    };
  };

  return (
    <div class="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 shrink-0">
        <div class="flex items-center gap-3">
          <a href={backUrl} class="p-1.5 text-dimmed hover:text-primary transition-colors" title="Back to editor">
            <i class="ti ti-arrow-left" />
          </a>
          <div>
            <h2 class="text-sm font-semibold">Version History</h2>
            <p class="text-xs text-dimmed">{props.noteTitle}</p>
          </div>
        </div>

        <Show when={sideA()}>
          <div class="flex items-center gap-2">
            <Show when={props.isLocked}>
              <span class="text-xs text-dimmed flex items-center gap-1">
                <i class="ti ti-lock text-xs" />
                Locked
              </span>
            </Show>
            <button
              type="button"
              onClick={handleRestore}
              disabled={props.isLocked || isWorking() || previewLoading() || !getRestoreSnapshot()}
              class="btn-primary btn-sm"
            >
              {restoreMut.loading() ? (
                <i class="ti ti-loader-2 animate-spin" />
              ) : (
                <>
                  <i class="ti ti-history mr-1" />
                  Restore
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleRestoreAsNew}
              disabled={isWorking() || previewLoading() || !getRestoreSnapshot()}
              class="btn-secondary btn-sm"
            >
              {restoreAsNewMut.loading() ? (
                <i class="ti ti-loader-2 animate-spin" />
              ) : (
                <>
                  <i class="ti ti-file-plus mr-1" />
                  New Page
                </>
              )}
            </button>
          </div>
        </Show>
      </div>

      <hr class="divider" />

      {/* Loading */}
      <Show when={loading()}>
        <div class="flex-1 flex items-center justify-center">
          <i class="ti ti-loader-2 animate-spin text-dimmed" />
        </div>
      </Show>

      {/* Empty */}
      <Show when={!loading() && versions().length === 0}>
        <div class="flex-1 flex items-center justify-center">
          <p class="flex items-center gap-1.5 text-xs text-dimmed">
            <i class="ti ti-history text-sm" />
            No versions yet
          </p>
        </div>
      </Show>

      {/* Two-column body */}
      <Show when={!loading() && versions().length > 0}>
        <div class="flex-1 min-h-0 app-cols">
          {/* Left: version list */}
          <div class="w-48 shrink-0 overflow-y-auto scrollbar">
            <div class="flex flex-col gap-0.5 p-2">
              <For each={versions()}>
                {(version) => {
                  const role = () => getSelectionRole(version.id);
                  return (
                    <button
                      type="button"
                      onClick={() => handleVersionClick(version.id)}
                      class={`text-left px-2.5 py-1.5 refined:rounded-lg text-xs transition-colors ${
                        role() === "a"
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                          : role() === "b"
                            ? "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 font-medium"
                            : "text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <div class="flex items-center gap-1.5">
                        <Show when={role()} fallback={<i class="ti ti-clock text-[10px] text-dimmed" />}>
                          <span
                            class={`text-[9px] font-bold uppercase leading-none ${role() === "a" ? "text-blue-500" : "text-purple-500"}`}
                          >
                            {role() === "a" ? "A" : "B"}
                          </span>
                        </Show>
                        <span>{formatDate(version.createdAt)}</span>
                      </div>
                    </button>
                  );
                }}
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

          {/* Right: diff preview */}
          <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
            {/* Comparison context bar */}
            <Show when={comparisonLabel()}>
              {(label) => (
                <div class="flex items-center gap-2 px-4 py-2 text-xs text-dimmed shrink-0">
                  <i class="ti ti-git-compare text-sm" />
                  <span>
                    <span class="font-medium text-blue-600 dark:text-blue-400">{label().from}</span>
                    {" → "}
                    <span class="font-medium text-purple-600 dark:text-purple-400">{label().to}</span>
                  </span>
                  <Show when={sideB() !== CURRENT_ID}>
                    <button
                      type="button"
                      onClick={resetToCurrentComparison}
                      class="ml-auto text-[10px] text-dimmed hover:text-primary transition-colors"
                    >
                      Compare to Current
                    </button>
                  </Show>
                </div>
              )}
            </Show>

            {/* Diff content */}
            <div class="flex-1 min-h-0 overflow-auto scrollbar">
              <Show when={!sideA()}>
                <div class="flex items-center justify-center h-full text-xs text-dimmed">
                  <div class="text-center flex flex-col gap-1">
                    <i class="ti ti-git-compare text-lg" />
                    <p>Select a version to see changes</p>
                    <p class="text-[10px]">Click a second version to compare two versions</p>
                  </div>
                </div>
              </Show>

              <Show when={sideA()}>
                <Show when={previewLoading()}>
                  <div class="flex items-center justify-center h-full">
                    <i class="ti ti-loader-2 animate-spin text-dimmed" />
                  </div>
                </Show>

                <Show when={!previewLoading() && diffParts().length > 0}>
                  <div class="font-mono text-xs leading-5">
                    <For each={diffParts()}>
                      {(part) => (
                        <For each={splitLines(part.value)}>
                          {(line) => (
                            <div
                              class={`px-1 ${
                                part.added
                                  ? "bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300"
                                  : part.removed
                                    ? "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300"
                                    : "text-secondary"
                              }`}
                            >
                              <span class="inline-block w-5 text-center text-dimmed select-none shrink-0">
                                {part.added ? "+" : part.removed ? "-" : " "}
                              </span>
                              <span class="whitespace-pre-wrap">{line || " "}</span>
                            </div>
                          )}
                        </For>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={!previewLoading() && sideA() && diffParts().length === 0}>
                  <div class="flex items-center justify-center h-full text-xs text-dimmed">No differences</div>
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
