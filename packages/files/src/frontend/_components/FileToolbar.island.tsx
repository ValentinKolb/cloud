import { Dropdown, ProgressBar, prompts, toast } from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { FileBaseInfo } from "@/contracts";
import {
  buildItemPath,
  buildSelectionKey,
  clearSelection,
  FILE_SELECTION_EVENT,
  fileApiUrl,
  fileAppUrlForPath,
  getFilenameFromKey,
  navigateWithParam,
  parseSelectionKey,
  type SelectionKey,
  setHighlightedFiles,
  setSelectedInUrl,
} from "./context";
import MoveTargetSearch from "./MoveTargetSearch.island";
import { createUploadManager, type FileUploadState } from "./upload";

type FileToolbarProps = {
  baseType: FileBaseInfo["type"];
  baseId: string;
  currentPath: string;
  initialFilterQuery?: string;
  initialSelected?: SelectionKey[];
  /** All item names in current directory (for Select All) */
  allItems?: string[];
  folderCount: number;
  fileCount: number;
  totalSize: string;
  bases?: FileBaseInfo[];
};

const validateName = (v: string | undefined) => {
  if (!v?.trim()) return "Name is required";
  if (v.includes("/")) return "Name cannot contain /";
  if (v === "." || v === "..") return "Invalid name";
  return null;
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
};

export default function FileToolbar({
  baseType,
  baseId,
  currentPath,
  initialFilterQuery = "",
  initialSelected = [],
  allItems = [],
  folderCount,
  fileCount,
  totalSize,
  bases = [],
}: FileToolbarProps) {
  const [filterQuery, setFilterQuery] = createSignal(initialFilterQuery);
  const [selected, setSelected] = createSignal<SelectionKey[]>(initialSelected);
  const uploadManager = createUploadManager();

  // Listen for selection changes from FileList
  onMount(() => {
    const handler = (e: Event) => {
      setSelected((e as CustomEvent<SelectionKey[]>).detail);
    };
    window.addEventListener(FILE_SELECTION_EVENT, handler);
    onCleanup(() => window.removeEventListener(FILE_SELECTION_EVENT, handler));
  });

  const allKeys = allItems.map((name) => buildSelectionKey(baseType, baseId, buildItemPath(currentPath, name)));
  const selectionCount = () => selected().length;
  const allSelected = () => selectionCount() === allKeys.length && allKeys.length > 0;

  const handleSelectAll = () => {
    setSelected(allKeys);
    setSelectedInUrl(new Set(allKeys));
  };

  const bulkDeleteMutation = mutations.create<{ total: number; errors: number } | null, void>({
    mutation: async () => {
      const keys = selected();
      if (keys.length === 0) return null;

      const confirmed = await prompts.confirm(`Move ${keys.length} item${keys.length > 1 ? "s" : ""} to Trash?`, {
        title: "Move to Trash",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Move to Trash",
        cancelText: "Cancel",
      });
      if (!confirmed) return null;

      let errors = 0;
      for (const key of keys) {
        const parsed = parseSelectionKey(key);
        if (!parsed) continue;
        const res = await apiClient[":baseType"][":baseId"].$delete({
          param: {
            baseType: parsed.baseType,
            baseId: parsed.baseId,
          },
          query: { path: parsed.path },
        });
        if (!res.ok) errors++;
      }
      return { total: keys.length, errors };
    },
    onSuccess: (result) => {
      if (!result) return;
      clearSelection();
      refreshCurrentPath();
      if (result.errors > 0) {
        void prompts.error(`Failed to delete ${result.errors} item${result.errors > 1 ? "s" : ""}`);
        return;
      }
      toast.success(`Moved ${result.total} item${result.total > 1 ? "s" : ""} to Trash`);
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleBulkDownload = () => {
    for (const key of selected()) {
      const parsed = parseSelectionKey(key);
      if (!parsed) continue;
      const link = document.createElement("a");
      link.href = `${fileApiUrl(parsed.baseType, parsed.baseId)}/content?path=${encodeURIComponent(parsed.path)}`;
      link.download = getFilenameFromKey(key);
      link.click();
    }
  };

  const handleBulkMove = () => {
    const keys = selected();
    if (keys.length === 0) return;
    const firstParsed = parseSelectionKey(keys[0]!);
    if (!firstParsed) return;
    const sourcePaths = keys.map((key) => parseSelectionKey(key)?.path ?? "").filter(Boolean);
    prompts.dialog(
      (close) => (
        <MoveTargetSearch
          sourceBaseType={firstParsed.baseType}
          sourceBaseId={firstParsed.baseId}
          sourcePaths={sourcePaths}
          bases={bases}
          onComplete={(target) => {
            clearSelection();
            setHighlightedFiles(target.movedFiles);
            navigateTo(fileAppUrlForPath(target.baseType, target.baseId, target.path));
          }}
          close={close}
        />
      ),
      {
        title: `Move ${keys.length} item${keys.length > 1 ? "s" : ""}`,
        icon: "ti ti-folder-share",
        size: "large",
      },
    );
  };

  const mkdirMutation = mutations.create<{ name: string } | null, void>({
    mutation: async () => {
      const result = await prompts.form({
        title: "New Folder",
        icon: "ti ti-folder-plus",
        confirmText: "Create",
        fields: {
          name: {
            type: "text",
            label: "Folder name",
            placeholder: "My Folder",
            required: true,
            validate: validateName,
          },
        },
      });
      if (!result) return null;

      const name = result.name.trim();
      const newPath = buildItemPath(currentPath, name);
      const res = await apiClient[":baseType"][":baseId"].$post({
        param: { baseType, baseId },
        query: { action: "mkdir", path: newPath },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to create folder");
      }
      return { name };
    },
    onSuccess: (folder) => {
      if (!folder) return;
      toast.success("Folder created");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const uploadOptions = {
    onComplete: () => setTimeout(() => refreshCurrentPath(), 500),
    onError: (err: Error) => prompts.error(err.message),
  };

  const handleUploadFiles = () => uploadManager.startUpload("files", baseType, baseId, currentPath, uploadOptions);
  const handleUploadFolder = () => uploadManager.startUpload("folder", baseType, baseId, currentPath, uploadOptions);

  const handleFilterSubmit = (e: Event) => {
    e.preventDefault();
    navigateWithParam("filter", filterQuery().trim() || undefined);
  };

  const isLoading = () => mkdirMutation.loading() || bulkDeleteMutation.loading();
  const visibleUploads = () => uploadManager.state.files.filter((f) => f.status !== "complete");

  const totalFiles = () => uploadManager.state.files.length;
  const completedFiles = () => uploadManager.state.files.filter((f) => f.status === "complete").length;
  const failedFiles = () => uploadManager.state.files.filter((f) => f.status === "error").length;

  const totalBytes = () => uploadManager.state.files.reduce((sum, file) => sum + file.size, 0);

  const uploadedBytes = () =>
    uploadManager.state.files.reduce((sum, file) => {
      const progress = Math.max(0, Math.min(100, file.progress));
      return sum + Math.round((file.size * progress) / 100);
    }, 0);

  const globalProgress = () => {
    const bytes = totalBytes();
    if (bytes <= 0) return 0;
    return Math.round((uploadedBytes() / bytes) * 100);
  };

  return (
    <div class="flex flex-col gap-2 w-full">
      <div class="flex flex-wrap items-center gap-2">
        <Dropdown
          trigger={
            <span
              class="btn-secondary btn-sm"
              classList={{
                "opacity-50 pointer-events-none": isLoading() || uploadManager.state.isUploading,
              }}
            >
              <i class={`ti text-sm ${uploadManager.state.isUploading ? "ti-loader-2 animate-spin" : "ti-plus"}`} />
              <span>New</span>
              <i class="ti ti-chevron-down text-[10px]" />
            </span>
          }
          elements={[
            {
              sectionLabel: "Upload",
              items: [
                {
                  icon: "ti ti-upload",
                  label: "Upload Files",
                  action: handleUploadFiles,
                },
                {
                  icon: "ti ti-folder-up",
                  label: "Upload Folder",
                  action: handleUploadFolder,
                },
              ],
            },
            {
              sectionLabel: "Create",
              items: [
                {
                  icon: "ti ti-folder-plus",
                  label: "New Folder",
                  action: () => mkdirMutation.mutate(undefined),
                },
              ],
            },
          ]}
          position="bottom-right"
          width="w-44"
        />

        <Show when={selectionCount() > 0}>
          <Dropdown
            trigger={
              <span class="btn-secondary btn-sm">
                <i class="ti ti-checks text-sm" />
                <span class="text-[10px]">{selectionCount()}</span>
                <i class="ti ti-chevron-down text-[10px]" />
              </span>
            }
            elements={[
              ...(bases.length > 0
                ? [
                    {
                      icon: "ti ti-folder-share",
                      label: "Move",
                      action: handleBulkMove,
                    },
                  ]
                : []),
              {
                icon: "ti ti-download",
                label: "Download",
                action: handleBulkDownload,
              },
              {
                icon: "ti ti-trash",
                label: "Delete",
                variant: "danger" as const,
                action: () => bulkDeleteMutation.mutate(undefined),
              },
              ...(!allSelected() && allKeys.length > 1
                ? [
                    {
                      icon: "ti ti-list-check",
                      label: "Select all",
                      action: handleSelectAll,
                    },
                  ]
                : []),
              {
                icon: "ti ti-x",
                label: "Deselect",
                action: clearSelection,
              },
            ]}
            position="bottom-right"
            width="w-40"
          />
        </Show>

        <form
          onSubmit={handleFilterSubmit}
          class="input flex min-h-[calc((var(--theme-input-py)*2)+1.25rem)] min-w-[14rem] flex-1 items-center gap-2 p-0 pr-2"
          role="search"
        >
          <input
            type="search"
            placeholder="Search in this folder..."
            aria-label="Search files"
            class="min-h-0 flex-1 bg-transparent px-3 py-0 text-sm focus-visible:outline-0"
            value={filterQuery()}
            onInput={(e) => setFilterQuery(e.currentTarget.value)}
          />
          <Show when={filterQuery()} fallback={<span class="hidden text-[11px] text-dimmed sm:inline">Enter</span>}>
            <button
              type="button"
              onClick={() => {
                setFilterQuery("");
                navigateWithParam("filter", undefined);
              }}
              class="text-dimmed transition-colors hover:text-primary"
              title="Clear search"
            >
              <i class="ti ti-x text-sm" />
            </button>
          </Show>
        </form>

        <div class="ml-auto inline-flex min-h-[var(--ui-control-sm)] items-center gap-3 px-1 text-xs text-dimmed">
          <Show when={folderCount > 0}>
            <span class="inline-flex items-center gap-1" title={`${folderCount} folder${folderCount !== 1 ? "s" : ""}`}>
              <i class="ti ti-folder text-[11px]" />
              <span>
                {folderCount} folder{folderCount !== 1 ? "s" : ""}
              </span>
            </span>
          </Show>
          <Show when={fileCount > 0}>
            <span class="inline-flex items-center gap-1" title={`${fileCount} file${fileCount !== 1 ? "s" : ""} (${totalSize})`}>
              <i class="ti ti-file text-[11px]" />
              <span>
                {fileCount} file{fileCount !== 1 ? "s" : ""}
              </span>
            </span>
          </Show>
          <Show when={folderCount === 0 && fileCount === 0}>
            <span>Empty</span>
          </Show>
          <Show when={totalSize !== "—" && fileCount > 0}>
            <span class="hidden sm:inline text-dimmed">{totalSize}</span>
          </Show>
        </div>
      </div>

      {/* Upload progress */}
      <Show when={uploadManager.state.files.length > 0}>
        <div class="paper flex flex-col gap-2 p-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-dimmed">
              {uploadManager.state.isUploading
                ? `Uploading ${completedFiles()}/${totalFiles()} files...`
                : failedFiles() > 0
                  ? `Upload finished (${completedFiles()} ok, ${failedFiles()} failed)`
                  : "Upload done"}
            </span>
            <Show when={!uploadManager.state.isUploading}>
              <button type="button" class="text-xs text-dimmed hover:text-primary" onClick={() => uploadManager.clearAll()}>
                Clear
              </button>
            </Show>
            <Show when={uploadManager.state.isUploading}>
              <button type="button" class="text-xs text-red-500 hover:text-red-600" onClick={() => uploadManager.cancel()}>
                Cancel
              </button>
            </Show>
          </div>
          <ProgressBar value={globalProgress()} size="sm" showValue />
          <div class="text-[11px] text-dimmed">
            {formatBytes(uploadedBytes())} / {formatBytes(totalBytes())}
          </div>
          <Show when={visibleUploads().length > 0}>
            <div class="max-h-40 overflow-y-auto">
              <div class="flex flex-col gap-1">
                <For each={visibleUploads()}>{(file) => <UploadProgressItem {...file} />}</For>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function UploadProgressItem(props: FileUploadState) {
  const statusIcon = () => {
    switch (props.status) {
      case "pending":
        return "ti-clock text-zinc-400";
      case "uploading":
        return "ti-loader-2 animate-spin text-primary";
      case "complete":
        return "ti-check text-green-500";
      case "error":
        return "ti-alert-triangle text-red-500";
    }
  };

  return (
    <Show
      when={props.status === "error"}
      fallback={
        <div class="flex items-center gap-2 text-xs">
          <i class={`ti ${statusIcon()}`} />
          <span class="flex-1 truncate" classList={{ "text-dimmed": props.status === "pending" }} title={props.filename}>
            {props.relativePath ?? props.filename}
          </span>
          <Show when={props.status === "uploading"}>
            <ProgressBar value={props.progress} size="xs" class="w-20" />
            <span class="w-8 text-right text-dimmed">{props.progress}%</span>
          </Show>
        </div>
      }
    >
      <div class="flex flex-col gap-0.5 rounded-[var(--ui-radius-control)] bg-red-500/10 px-2 py-1 text-xs">
        <div class="flex items-center gap-2">
          <i class={`ti ${statusIcon()}`} />
          <span class="text-red-500 font-medium truncate" title={props.filename}>
            {props.relativePath ?? props.filename}
          </span>
        </div>
        <span class="text-red-400 text-[11px] pl-5">{props.error ?? "Upload failed"}</span>
      </div>
    </Show>
  );
}
