import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { Dropdown, ProgressBar } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/files/client";
import { createUploadManager, type FileUploadState } from "./upload";
import { refreshCurrentPath } from "../lib/navigation";
import {
  buildItemPath,
  buildSelectionKey,
  navigateWithParam,
  type SelectionKey,
  clearSelection,
  setSelectedInUrl,
  setHighlightedFiles,
  parseSelectionKey,
  getFilenameFromKey,
  fileApiUrl,
  fileAppUrlForPath,
  FILE_SELECTION_EVENT,
} from "./context";
import MoveTargetSearch from "./MoveTargetSearch.island";
import type { FileBaseInfo } from "@/files/contracts";

type FileToolbarProps = {
  baseType: string;
  baseId: string;
  currentPath: string;
  showFilter?: boolean;
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
  showFilter = false,
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

  const handleBulkDelete = async () => {
    const keys = selected();
    if (keys.length === 0) return;
    const confirmed = await prompts.confirm(`Move ${keys.length} item${keys.length > 1 ? "s" : ""} to Trash?`, {
      title: "Move to Trash",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Move to Trash",
      cancelText: "Cancel",
    });
    if (!confirmed) return;
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
    if (errors > 0) await prompts.error(`Failed to delete ${errors} item${errors > 1 ? "s" : ""}`);
    clearSelection();
    refreshCurrentPath();
  };

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
            window.location.href = fileAppUrlForPath(target.baseType, target.baseId, target.path);
          }}
          close={close}
        />
      ),
      {
        title: `Move ${keys.length} item${keys.length > 1 ? "s" : ""}`,
        icon: "ti ti-folder-share",
      },
    );
  };

  // Mutation helper
  const fileMutation = <T,>(mutation: (vars: T) => Promise<T>) =>
    mutations.create<T, T>({
      mutation,
      onSuccess: () => refreshCurrentPath(),
      onError: (err) => prompts.error(err.message),
    });

  const mkdirMutation = fileMutation(async ({ name }: { name: string }) => {
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
  });

  const handleNewFolder = async () => {
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
    if (result) await mkdirMutation.mutate({ name: result.name.trim() });
  };

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

  const isLoading = mkdirMutation.loading();
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
      {/* Action row */}
      <div class="flex items-center gap-2">
        <Dropdown
          trigger={
            <span
              class="btn-secondary btn-sm"
              classList={{
                "opacity-50 pointer-events-none": isLoading || uploadManager.state.isUploading,
              }}
            >
              <i class={`ti text-sm ${uploadManager.state.isUploading ? "ti-loader-2 animate-spin" : "ti-plus"}`} />
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
                  action: handleNewFolder,
                },
              ],
            },
          ]}
          position="bottom-right"
          width="w-44"
        />

        <button
          type="button"
          class="btn-secondary btn-sm"
          onClick={() => navigateWithParam("filter", showFilter ? undefined : "")}
          title={showFilter ? "Close filter" : "Filter files"}
        >
          <i class={`ti text-sm ${showFilter ? "ti-filter-off" : "ti-filter"}`} />
        </button>

        {/* Selection dropdown */}
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
                action: handleBulkDelete,
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

        <div class="flex-1" />

        <div class="flex items-center gap-2 text-xs text-dimmed">
          <Show when={folderCount > 0}>
            <span class="flex items-center gap-1" title={`${folderCount} folder${folderCount !== 1 ? "s" : ""}`}>
              <i class="ti ti-folder" />
              {folderCount}
            </span>
          </Show>
          <Show when={fileCount > 0}>
            <span class="flex items-center gap-1" title={`${fileCount} file${fileCount !== 1 ? "s" : ""} (${totalSize})`}>
              <i class="ti ti-file" />
              {fileCount}
              <Show when={totalSize !== "—"}>
                <span class="hidden sm:inline text-dimmed">({totalSize})</span>
              </Show>
            </span>
          </Show>
          <Show when={folderCount === 0 && fileCount === 0}>
            <span class="text-dimmed">Empty</span>
          </Show>
        </div>
      </div>

      {/* Filter bar */}
      <Show when={showFilter}>
        <form onSubmit={handleFilterSubmit} class="flex items-center gap-2" role="search">
          <div class="flex items-center gap-2 flex-1 input-subtle p-0 pr-2">
            <input
              type="search"
              placeholder="Filter in this folder..."
              aria-label="Filter files"
              class="flex-1 py-1.5 px-2 focus-visible:outline-0 min-w-0 text-sm"
              value={filterQuery()}
              onInput={(e) => setFilterQuery(e.currentTarget.value)}
              autofocus
            />
            <Show when={filterQuery()} fallback={<span class="text-[11px] text-dimmed hidden sm:inline">Enter</span>}>
              <button
                type="button"
                onClick={() => {
                  setFilterQuery("");
                  navigateWithParam("filter", undefined);
                }}
                class="text-dimmed hover:text-primary transition-colors"
                title="Clear filter"
              >
                <i class="ti ti-x text-sm" />
              </button>
            </Show>
          </div>
        </form>
      </Show>

      {/* Upload progress */}
      <Show when={uploadManager.state.files.length > 0}>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between mb-2">
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
      <div class="flex flex-col gap-0.5 text-xs py-1 border-l-2 border-red-500 pl-2">
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
