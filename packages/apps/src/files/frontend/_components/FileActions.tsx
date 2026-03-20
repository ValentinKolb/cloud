import { useContext } from "solid-js";
import { Dropdown, prompts } from "@valentinkolb/cloud/lib/ui";
import type { DropdownItem } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/files/client";
import MoveTargetSearch from "./MoveTargetSearch.island";
import { FileContext, fileAppUrlForPath, fileApiUrl, requestFileLightboxOpen, setDetailFileInUrl, setHighlightedFiles } from "./context";
import { refreshCurrentPath } from "../lib/navigation";
import type { FileBaseInfo, FileInfo } from "@/files/contracts";

export type FileActionContext = {
  baseType: FileBaseInfo["type"];
  baseId: string;
  bases: FileBaseInfo[];
};

export type FileActionOptions = {
  item: FileInfo;
  itemPath: string;
  ctx: FileActionContext;
  onShowDetail?: () => void;
  onCloseDetail?: () => void;
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

export const canOpenFileInline = (item: FileInfo) => {
  const mime = item.mimeType ?? "";
  return mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") || mime === "application/pdf" || mime.startsWith("text/");
};

export const openFileItem = ({ item, itemPath, ctx }: Pick<FileActionOptions, "item" | "itemPath" | "ctx">) => {
  if (item.type === "directory") {
    window.location.href = fileAppUrlForPath(ctx.baseType, ctx.baseId, itemPath);
    return;
  }

  if ((item.mimeType ?? "").startsWith("image/")) {
    requestFileLightboxOpen({
      baseType: ctx.baseType,
      baseId: ctx.baseId,
      path: itemPath,
    });
    return;
  }

  window.open(`${fileApiUrl(ctx.baseType, ctx.baseId)}/content?path=${encodeURIComponent(itemPath)}&inline=true`, "_blank", "noopener,noreferrer");
};

export const downloadFileItem = ({ item, itemPath, ctx }: Pick<FileActionOptions, "item" | "itemPath" | "ctx">) => {
  const link = document.createElement("a");
  link.href = `${fileApiUrl(ctx.baseType, ctx.baseId)}/content?path=${encodeURIComponent(itemPath)}`;
  link.download = item.name;
  link.click();
};

export const renameFileItem = async ({ item, itemPath, ctx }: Pick<FileActionOptions, "item" | "itemPath" | "ctx">) => {
  const isDirectory = item.type === "directory";
  const result = await prompts.form({
    title: isDirectory ? "Rename Folder" : "Rename File",
    icon: "ti ti-pencil",
    confirmText: "Rename",
    fields: {
      newName: {
        type: "text",
        label: "New name",
        default: item.name,
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

  if (!result || result.newName.trim() === item.name) return;
  const newName = result.newName.trim();

  if (!isDirectory && !hasFileExtension(newName)) {
    const confirmed = await prompts.confirm(`The new filename "${newName}" has no extension. Do you want to continue?`, {
      title: "Rename without extension",
      icon: "ti ti-alert-triangle",
      confirmText: "Rename anyway",
      cancelText: "Cancel",
    });
    if (!confirmed) return;
  }

  const parentPath = itemPath.substring(0, itemPath.lastIndexOf("/")) || "/";
  const newPath = parentPath === "/" ? `/${newName}` : `${parentPath}/${newName}`;
  const res = await apiClient[":baseType"][":baseId"].$post({
    param: { baseType: ctx.baseType, baseId: ctx.baseId },
    query: { action: "move", path: itemPath, to: newPath },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: "Rename failed" }));
    throw new Error("message" in data ? data.message : "Rename failed");
  }
};

export const duplicateFileItem = async ({ item, itemPath, ctx }: Pick<FileActionOptions, "item" | "itemPath" | "ctx">) => {
  const defaultName = buildCopyName(item.name);
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
    param: { baseType: ctx.baseType, baseId: ctx.baseId },
    json: { path: itemPath, newName: result.newName.trim() },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: "Duplicate failed" }));
    throw new Error("message" in data ? data.message : "Duplicate failed");
  }
};

export const deleteFileItem = async ({ item, itemPath, ctx }: Pick<FileActionOptions, "item" | "itemPath" | "ctx">) => {
  const message =
    item.type === "directory" ? `Move "${item.name}" and all contained items to Trash?` : `Move "${item.name}" to Trash?`;
  const confirmed = await prompts.confirm(message, {
    title: "Move to Trash",
    icon: "ti ti-trash",
    variant: "danger",
    confirmText: "Move to Trash",
    cancelText: "Cancel",
  });
  if (!confirmed) return;

  const res = await apiClient[":baseType"][":baseId"].$delete({
    param: { baseType: ctx.baseType, baseId: ctx.baseId },
    query: { path: itemPath },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: "Delete failed" }));
    throw new Error("message" in data ? data.message : "Delete failed");
  }
};

export const moveFileItem = async ({ item, itemPath, ctx, onCloseDetail }: Pick<FileActionOptions, "item" | "itemPath" | "ctx" | "onCloseDetail">) => {
  if (ctx.bases.length === 0) return;

  prompts.dialog(
    (close) => (
      <MoveTargetSearch
        sourceBaseType={ctx.baseType}
        sourceBaseId={ctx.baseId}
        sourcePaths={[itemPath]}
        bases={ctx.bases}
        onComplete={(target) => {
          onCloseDetail?.();
          setHighlightedFiles(target.movedFiles);
          window.location.href = fileAppUrlForPath(target.baseType, target.baseId, target.path);
        }}
        close={close}
      />
    ),
    { title: `Move "${item.name}"`, icon: "ti ti-folder-share", size: "large" },
  );
};

export const buildFileMenuElements = ({ item, itemPath, ctx, onShowDetail, onCloseDetail }: FileActionOptions): DropdownItem[] => {
  const detailItemKey = itemPath;
  const canOpenInline = item.type === "directory" || canOpenFileInline(item);

  return [
    {
      icon: "ti ti-file-info",
      label: item.type === "directory" ? "Show folder detail" : "Show detail",
      action: () => onShowDetail?.(),
    },
    {
      icon: item.type === "directory" ? "ti ti-folder-open" : "ti ti-eye",
      label: item.type === "directory" ? "Open folder" : "Open",
      action: () => openFileItem({ item, itemPath, ctx }),
    },
    {
      icon: "ti ti-download",
      label: item.type === "directory" ? "Download .tar" : "Download",
      action: () => downloadFileItem({ item, itemPath, ctx }),
    },
    {
      icon: "ti ti-pencil",
      label: "Rename",
      action: async () => {
        await renameFileItem({ item, itemPath, ctx });
        if (onShowDetail) {
          setDetailFileInUrl(detailItemKey, item, ctx.baseType, ctx.baseId);
        }
        refreshCurrentPath();
      },
    },
    {
      icon: "ti ti-copy",
      label: "Duplicate",
      action: async () => {
        await duplicateFileItem({ item, itemPath, ctx });
        refreshCurrentPath();
      },
    },
    ...(ctx.bases.length > 0
      ? [
          {
            icon: "ti ti-folder-share",
            label: "Move to...",
            action: () => moveFileItem({ item, itemPath, ctx, onCloseDetail }),
          },
        ]
      : []),
    ...(canOpenInline && item.type !== "directory"
      ? [
          {
            icon: "ti ti-external-link",
            label: "Open in new tab",
            action: () => window.open(`${fileApiUrl(ctx.baseType, ctx.baseId)}/content?path=${encodeURIComponent(itemPath)}&inline=true`, "_blank"),
          },
        ]
      : []),
    {
      icon: "ti ti-trash",
      label: "Delete",
      variant: "danger" as const,
      action: async () => {
        await deleteFileItem({ item, itemPath, ctx });
        onCloseDetail?.();
        refreshCurrentPath();
      },
    },
  ];
};

type FileActionsProps = {
  item: FileInfo;
  itemPath: string;
};

export default function FileActions(props: FileActionsProps) {
  const ctx = useContext(FileContext);
  if (!ctx) return null;

  return (
    <Dropdown
      trigger={
        <span class="inline-flex h-8 w-8 items-center justify-center text-dimmed transition-colors hover:text-blue-500" data-dnd-ignore>
          <i class="ti ti-dots" />
        </span>
      }
      elements={buildFileMenuElements({
        item: props.item,
        itemPath: props.itemPath,
        ctx,
      })}
      position="bottom-left"
      width="w-48"
    />
  );
}
