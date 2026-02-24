import { useContext } from "solid-js";
import { Dropdown } from "@valentinkolb/cloud/lib/ui";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/files/client";
import MoveTargetSearch from "./MoveTargetSearch.island";
import { FileContext, setHighlightedFiles, fileAppUrlForPath } from "./context";
import { refreshCurrentPath } from "../lib/navigation";

export type FileAction = {
  icon: string;
  label: string;
  url: string;
  openInNewTab?: boolean;
};

type FileActionsProps = {
  actions: FileAction[];
  filename: string;
  itemPath: string;
  isDirectory: boolean;
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

export default function FileActions({ actions, filename, itemPath, isDirectory }: FileActionsProps) {
  const ctx = useContext(FileContext);
  if (!ctx) return null;

  const { baseType, baseId, bases } = ctx;

  const handleDelete = async () => {
    const message = isDirectory ? `Move "${filename}" and all contained items to Trash?` : `Move "${filename}" to Trash?`;

    const confirmed = await prompts.confirm(message, {
      title: "Move to Trash",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Move to Trash",
      cancelText: "Cancel",
    });

    if (!confirmed) return;

    const res = await apiClient[":baseType"][":baseId"].$delete({
      param: { baseType, baseId },
      query: { path: itemPath },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: "Delete failed" }));
      await prompts.error("message" in data ? data.message : "Delete failed");
      return;
    }

    refreshCurrentPath();
  };

  const handleMove = () => {
    prompts.dialog(
      (close) => (
        <MoveTargetSearch
          sourceBaseType={baseType}
          sourceBaseId={baseId}
          sourcePaths={[itemPath]}
          bases={bases}
          onComplete={(target) => {
            setHighlightedFiles(target.movedFiles);
            const url = fileAppUrlForPath(target.baseType, target.baseId, target.path);
            window.location.href = url;
          }}
          close={close}
        />
      ),
      { title: `Move "${filename}"`, icon: "ti ti-folder-share" },
    );
  };

  const handleRename = async () => {
    const result = await prompts.form({
      title: isDirectory ? "Rename Folder" : "Rename File",
      icon: "ti ti-pencil",
      confirmText: "Rename",
      fields: {
        newName: {
          type: "text",
          label: "New name",
          default: filename,
          required: true,
          validate: (v) => {
            if (!v?.trim()) return "Name is required";
            if (v.includes("/")) return "Name cannot contain /";
            if (v === "." || v === "..") return "Invalid name";
            return null;
          },
        },
      },
    });

    if (!result || result.newName.trim() === filename) return;
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

    // Calculate new path (parent directory + new name)
    const parentPath = itemPath.substring(0, itemPath.lastIndexOf("/")) || "/";
    const newPath = parentPath === "/" ? `/${newName}` : `${parentPath}/${newName}`;

    const res = await apiClient[":baseType"][":baseId"].$post({
      param: { baseType, baseId },
      query: { action: "move", path: itemPath, to: newPath },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: "Rename failed" }));
      await prompts.error("message" in data ? data.message : "Rename failed");
      return;
    }

    refreshCurrentPath();
  };

  const handleDuplicate = async () => {
    const defaultName = buildCopyName(filename);

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
          validate: (v) => {
            if (!v?.trim()) return "Name is required";
            if (v.includes("/")) return "Name cannot contain /";
            return null;
          },
        },
      },
    });

    if (!result) return;

    const res = await apiClient[":baseType"][":baseId"].duplicate.$post({
      param: { baseType, baseId },
      json: { path: itemPath, newName: result.newName.trim() },
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: "Duplicate failed" }));
      await prompts.error("message" in data ? data.message : "Duplicate failed");
      return;
    }

    refreshCurrentPath();
  };

  const dropdownElements = [
    ...actions.map((action) =>
      action.openInNewTab
        ? {
            icon: action.icon,
            label: action.label,
            href: action.url,
            external: true,
          }
        : {
            icon: action.icon,
            label: action.label,
            action: () => {
              const link = document.createElement("a");
              link.href = action.url;
              link.download = filename;
              link.click();
            },
          },
    ),
    { icon: "ti ti-pencil", label: "Rename", action: handleRename },
    ...(bases.length > 0
      ? [
          {
            icon: "ti ti-folder-share",
            label: "Move to...",
            action: handleMove,
          },
        ]
      : []),
    { icon: "ti ti-copy", label: "Duplicate", action: handleDuplicate },
    {
      icon: "ti ti-trash",
      label: "Delete",
      variant: "danger" as const,
      action: handleDelete,
    },
  ];

  return (
    <Dropdown
      trigger={
        <span class="text-dimmed hover:text-blue-500 transition-colors">
          <i class="ti ti-dots-vertical" />
        </span>
      }
      elements={dropdownElements}
      position="bottom-left"
      width="w-44"
    />
  );
}
