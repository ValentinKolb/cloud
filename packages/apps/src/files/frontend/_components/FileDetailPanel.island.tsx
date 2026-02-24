import { createSignal, onMount, onCleanup, Show } from "solid-js";
import type { FileInfo, FileBaseInfo } from "@/files/contracts";
import { dates, fileIcons } from "@valentinkolb/cloud/lib/shared";
import { formatBytes } from "@valentinkolb/filegate/utils";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/files/client";
import MoveTargetSearch from "./MoveTargetSearch.island";
import { refreshCurrentPath } from "../lib/navigation";
import {
  fileApiUrl,
  setHighlightedFiles,
  fileAppUrlForPath,
  setDetailFileInUrl,
  DETAIL_FILE_SELECT_EVENT,
  type DetailFileSelectPayload,
  requestFileLightboxOpen,
} from "./context";

type FileDetailPanelProps = {
  initialFile: FileInfo | null;
  initialFilePath: string | null;
  initialBaseType: string;
  initialBaseId: string;
  items: FileInfo[];
  bases: FileBaseInfo[];
  useFullDetailKey?: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  image: "Image",
  pdf: "PDF Document",
  video: "Video",
  audio: "Audio",
  text: "Text File",
  code: "Source Code",
  document: "Document",
  archive: "Archive",
  other: "File",
};

const parseFullDetailKey = (key: string) => {
  const firstColon = key.indexOf(":");
  const secondColon = key.indexOf(":", firstColon + 1);
  if (firstColon > 0 && secondColon > firstColon) {
    return {
      baseType: key.substring(0, firstColon),
      baseId: key.substring(firstColon + 1, secondColon),
      path: key.substring(secondColon + 1),
    };
  }
  return null;
};

const hasFileExtension = (name: string) => {
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  return dotIndex > 0 && dotIndex < trimmed.length - 1;
};

const buildCopyName = (name: string) => {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? `${name.slice(0, dotIndex)}-copy${name.slice(dotIndex)}` : `${name}-copy`;
};

export default function FileDetailPanel(props: FileDetailPanelProps) {
  const [file, setFile] = createSignal<FileInfo | null>(props.initialFile);
  const [filePath, setFilePath] = createSignal<string | null>(props.initialFilePath);
  const [baseType, setBaseType] = createSignal(props.initialBaseType);
  const [baseId, setBaseId] = createSignal(props.initialBaseId);

  onMount(() => {
    const handleSelect = (e: Event) => {
      const payload = (e as CustomEvent<DetailFileSelectPayload>).detail;
      setFile(payload.item);
      setFilePath(payload.itemKey);
      setBaseType(payload.baseType);
      setBaseId(payload.baseId);
    };

    const handlePopState = () => {
      const url = new URL(window.location.href);
      const key = url.searchParams.get("file");
      if (!key) {
        setFile(null);
        setFilePath(null);
        return;
      }

      if (props.useFullDetailKey) {
        const parsed = parseFullDetailKey(key);
        if (!parsed) return;
        const found = props.items.find((item) => item.path === parsed.path);
        setFile(found ?? null);
        setFilePath(key);
        setBaseType(parsed.baseType);
        setBaseId(parsed.baseId);
        return;
      }

      const found = props.items.find((item) => {
        const itemPath = item.path || `${props.initialBaseType}/${props.initialBaseId}/${item.name}`;
        return itemPath === key || item.name === key.split("/").pop();
      });
      setFile(found ?? null);
      setFilePath(key);
    };

    window.addEventListener(DETAIL_FILE_SELECT_EVENT, handleSelect);
    window.addEventListener("popstate", handlePopState);
    onCleanup(() => {
      window.removeEventListener(DETAIL_FILE_SELECT_EVENT, handleSelect);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  const isDirectory = () => file()?.type === "directory";
  const category = () => (file() ? fileIcons.getFileCategory(file()!) : "other");
  const icon = () => (file() ? fileIcons.getFileIcon(file()!) : "ti-file");

  const itemPath = () => {
    const currentPath = filePath();
    if (!currentPath) return "";
    if (props.useFullDetailKey) {
      const parsed = parseFullDetailKey(currentPath);
      return parsed?.path ?? currentPath;
    }
    return currentPath;
  };

  const contentUrl = () => `${fileApiUrl(baseType(), baseId())}/content?path=${encodeURIComponent(itemPath())}`;
  const canPreviewInline = () => ["image", "pdf", "video", "audio", "text", "code"].includes(category());

  const handleClose = () => setDetailFileInUrl(null);

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = contentUrl();
    link.download = file()?.name ?? "download";
    link.click();
  };

  const handleOpen = () => {
    if (category() === "image") {
      requestFileLightboxOpen({
        baseType: baseType(),
        baseId: baseId(),
        path: itemPath(),
      });
      return;
    }
    window.open(`${contentUrl()}&inline=true`, "_blank");
  };

  const handleDelete = async () => {
    const currentFile = file();
    if (!currentFile) return;

    const message = isDirectory() ? `Move "${currentFile.name}" and all contained items to Trash?` : `Move "${currentFile.name}" to Trash?`;

    const confirmed = await prompts.confirm(message, {
      title: "Move to Trash",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Move to Trash",
      cancelText: "Cancel",
    });

    if (!confirmed) return;

    const res = await apiClient[":baseType"][":baseId"].$delete({
      param: { baseType: baseType(), baseId: baseId() },
      query: { path: itemPath() },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: "Delete failed" }));
      await prompts.error("message" in data ? data.message : "Delete failed");
      return;
    }

    setDetailFileInUrl(null);
    refreshCurrentPath();
  };

  const handleRename = async () => {
    const currentFile = file();
    if (!currentFile) return;

    const result = await prompts.form({
      title: isDirectory() ? "Rename Folder" : "Rename File",
      icon: "ti ti-pencil",
      confirmText: "Rename",
      fields: {
        newName: {
          type: "text",
          label: "New name",
          default: currentFile.name,
          required: true,
          validate: (value) => {
            if (!value?.trim()) return "Name is required";
            if (value.includes("/")) return "Name cannot contain /";
            if (value === "." || value === "..") return "Invalid name";
            return null;
          },
        },
      },
    });

    if (!result || result.newName.trim() === currentFile.name) return;
    const newName = result.newName.trim();

    if (!isDirectory() && !hasFileExtension(newName)) {
      const confirmed = await prompts.confirm(`The new filename "${newName}" has no extension. Do you want to continue?`, {
        title: "Rename without extension",
        icon: "ti ti-alert-triangle",
        confirmText: "Rename anyway",
        cancelText: "Cancel",
      });
      if (!confirmed) return;
    }

    const currentItemPath = itemPath();
    const parentPath = currentItemPath.substring(0, currentItemPath.lastIndexOf("/")) || "/";
    const newPath = parentPath === "/" ? `/${newName}` : `${parentPath}/${newName}`;

    const res = await apiClient[":baseType"][":baseId"].$post({
      param: { baseType: baseType(), baseId: baseId() },
      query: { action: "move", path: currentItemPath, to: newPath },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: "Rename failed" }));
      await prompts.error("message" in data ? data.message : "Rename failed");
      return;
    }

    refreshCurrentPath();
  };

  const handleMove = () => {
    const currentFile = file();
    if (!currentFile) return;

    prompts.dialog(
      (close) => (
        <MoveTargetSearch
          sourceBaseType={baseType()}
          sourceBaseId={baseId()}
          sourcePaths={[itemPath()]}
          bases={props.bases}
          onComplete={(target) => {
            setHighlightedFiles(target.movedFiles);
            const url = fileAppUrlForPath(target.baseType, target.baseId, target.path);
            window.location.href = url;
          }}
          close={close}
        />
      ),
      { title: `Move "${currentFile.name}"`, icon: "ti ti-folder-share" },
    );
  };

  const handleDuplicate = async () => {
    const currentFile = file();
    if (!currentFile) return;

    const defaultName = buildCopyName(currentFile.name);
    const result = await prompts.form({
      title: "Duplicate",
      icon: "ti ti-copy",
      confirmText: "Duplicate",
      fields: {
        newName: {
          type: "text",
          label: "New name",
          placeholder: defaultName,
          default: defaultName,
          required: true,
          validate: (value) => {
            if (!value?.trim()) return "Name is required";
            if (value.includes("/")) return "Name cannot contain /";
            return null;
          },
        },
      },
    });

    if (!result) return;

    const res = await apiClient[":baseType"][":baseId"].duplicate.$post({
      param: { baseType: baseType(), baseId: baseId() },
      json: { path: itemPath(), newName: result.newName.trim() },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: "Duplicate failed" }));
      await prompts.error("message" in data ? data.message : "Duplicate failed");
      return;
    }

    refreshCurrentPath();
  };

  const fullPath = () => {
    const baseName = baseType() === "home" ? "~" : baseId();
    const path = itemPath();
    return `${baseName}${path.startsWith("/") ? "" : "/"}${path}`;
  };

  return (
    <Show
      when={file()}
      fallback={
        <div class="p-8 flex items-center justify-center text-dimmed text-xs gap-2">
          <i class="ti ti-file-info text-sm" />
          Select a file to view details
        </div>
      }
    >
      {(currentFile) => (
        <div class="flex flex-col overflow-y-auto">
          <div class="flex items-center justify-between px-3 py-2">
            <span class="section-label mb-0">Detail</span>
            <button type="button" onClick={handleClose} class="p-1 text-dimmed hover:text-primary transition-colors" aria-label="Close">
              <i class="ti ti-x" />
            </button>
          </div>

          <div class="px-4 pb-4 flex flex-col gap-4">
            <div class="flex justify-center py-4">
              {category() === "image" && !isDirectory() ? (
                <img src={`${contentUrl()}&inline=true`} alt={currentFile().name} class="max-w-full max-h-40 thumbnail object-contain" />
              ) : (
                <div class="w-20 h-20 flex items-center justify-center thumbnail bg-zinc-100 dark:bg-zinc-800">
                  <i class={`ti ${icon()} text-4xl`} />
                </div>
              )}
            </div>

            <div class="text-center">
              <h4 class="font-medium text-primary break-all text-sm">{currentFile().name}</h4>
              <p class="text-xs text-dimmed">{isDirectory() ? "Folder" : CATEGORY_LABELS[category()] || "File"}</p>
            </div>

            <div class="flex flex-col gap-1 text-xs text-dimmed">
              {!isDirectory() && (
                <div class="flex items-center gap-1.5">
                  <i class="ti ti-file text-[10px]" />
                  <span>{formatBytes({ bytes: currentFile().size })}</span>
                </div>
              )}
              <div class="flex items-center gap-1.5">
                <i class="ti ti-clock text-[10px]" />
                <span>{dates.formatDateTime(currentFile().mtime)}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <i class="ti ti-folder text-[10px]" />
                <span class="font-mono break-all">{fullPath()}</span>
              </div>
            </div>

            <div class="flex items-center justify-center gap-1 pt-2 border-t border-zinc-200 dark:border-zinc-700">
              {!isDirectory() && (
                <>
                  <button
                    type="button"
                    onClick={handleDownload}
                    class="p-2 text-dimmed hover:text-primary transition-colors"
                    title="Download"
                  >
                    <i class="ti ti-download" />
                  </button>
                  {canPreviewInline() && (
                    <button
                      type="button"
                      onClick={handleOpen}
                      class="p-2 text-dimmed hover:text-primary transition-colors"
                      title={category() === "image" ? "View image" : "Open in browser"}
                    >
                      <i class="ti ti-eye" />
                    </button>
                  )}
                </>
              )}

              {isDirectory() && (
                <a
                  href={fileAppUrlForPath(baseType(), baseId(), itemPath())}
                  class="p-2 text-dimmed hover:text-primary transition-colors"
                  title="Open folder"
                >
                  <i class="ti ti-folder-open" />
                </a>
              )}

              <button type="button" onClick={handleRename} class="p-2 text-dimmed hover:text-primary transition-colors" title="Rename">
                <i class="ti ti-pencil" />
              </button>

              {props.bases.length > 0 && (
                <button type="button" onClick={handleMove} class="p-2 text-dimmed hover:text-primary transition-colors" title="Move to...">
                  <i class="ti ti-folder-share" />
                </button>
              )}

              <button
                type="button"
                onClick={handleDuplicate}
                class="p-2 text-dimmed hover:text-primary transition-colors"
                title="Duplicate"
              >
                <i class="ti ti-copy" />
              </button>

              <button type="button" onClick={handleDelete} class="p-2 text-dimmed hover:text-red-500 transition-colors" title="Delete">
                <i class="ti ti-trash" />
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
