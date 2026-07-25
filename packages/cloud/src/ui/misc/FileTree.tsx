/**
 * FileTree — path-first tree over a flat entry list (folders derived from
 * paths, explicit folder entries allowed for empty dirs). Capabilities are
 * enabled by the presence of action callbacks; without them the tree is a
 * pure read-only browser. Context menus render through the platform
 * ContextMenu. Minimal look: text rows, bevel on selection, no hover motion.
 */
import { fileIcons } from "@valentinkolb/stdlib";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import ContextMenu from "./ContextMenu";
import { allFolderPaths, buildTree, type FileTreeEntry, flattenVisible, parentOf, type TreeNode } from "./file-tree";
import Dropdown, { type DropdownItem } from "./Dropdown";

export type { FileTreeEntry } from "./file-tree";

/** Presence of a callback enables the matching UI affordance. */
export type FileTreeActions = {
  rename?: (path: string, nextName: string) => void | Promise<void>;
  remove?: (path: string) => void | Promise<void>;
  createFile?: (dirPath: string) => void | Promise<void>;
  createFolder?: (dirPath: string) => void | Promise<void>;
  /** Enables drag & drop of files and folders onto folders (and the tree root). */
  move?: (path: string, targetDir: string) => void | Promise<void>;
  /** Download menu entry — folders arrive as "Download as ZIP". */
  download?: (path: string, isFolder: boolean) => void | Promise<void>;
};

export type FileTreeProps = {
  entries: FileTreeEntry[];
  selectedPath?: string | null;
  onSelect?: (entry: FileTreeEntry) => void;
  /** Controlled expansion; omit for internal state (folders start expanded). */
  expandedPaths?: Set<string>;
  onExpandedChange?: (expanded: Set<string>) => void;
  /** Extra context-menu items per entry, merged above the built-in actions. */
  contextMenu?: (entry: FileTreeEntry) => DropdownItem[];
  actions?: FileTreeActions;
  class?: string;
};

export default function FileTree(props: FileTreeProps) {
  const tree = createMemo(() => buildTree(props.entries));

  const [internalExpanded, setInternalExpanded] = createSignal<Set<string>>(new Set(allFolderPaths(tree())), { equals: false });
  // Newly appearing folders start expanded in uncontrolled mode.
  createEffect((previous: Set<string>) => {
    const current = new Set(allFolderPaths(tree()));
    const added = [...current].filter((path) => !previous.has(path));
    if (added.length > 0 && !props.expandedPaths) setInternalExpanded((expanded) => new Set([...expanded, ...added]));
    return current;
  }, new Set<string>());

  const expanded = () => props.expandedPaths ?? internalExpanded();
  const setExpanded = (next: Set<string>) => {
    if (props.onExpandedChange) props.onExpandedChange(next);
    if (!props.expandedPaths) setInternalExpanded(next);
  };
  const toggleFolder = (path: string) => {
    const next = new Set(expanded());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };

  const visible = createMemo(() => flattenVisible(tree(), expanded()));
  const [renamingPath, setRenamingPath] = createSignal<string | null>(null);
  /** Folder currently hovered by a drag ("/" = tree root). */
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);

  const DRAG_MIME = "application/x-filetree-path";
  const canDrop = (event: DragEvent) => props.actions?.move && event.dataTransfer?.types.includes(DRAG_MIME);
  const handleDrop = (event: DragEvent, targetDir: string) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const path = event.dataTransfer?.getData(DRAG_MIME);
    if (!path || parentOf(path) === targetDir || path === targetDir || targetDir.startsWith(`${path}/`)) return;
    void props.actions?.move?.(path, targetDir);
  };

  const select = (node: TreeNode) => {
    if (node.isFolder) toggleFolder(node.entry.path);
    else props.onSelect?.(node.entry);
  };

  const commitRename = async (node: TreeNode, value: string) => {
    setRenamingPath(null);
    const nextName = value.trim();
    if (!nextName || nextName === node.name || nextName.includes("/")) return;
    await props.actions?.rename?.(node.entry.path, nextName);
  };

  const menuItems = (node: TreeNode): DropdownItem[] => {
    const items: DropdownItem[] = [...(props.contextMenu?.(node.entry) ?? [])];
    if (node.isFolder && props.actions?.createFile) {
      items.push({ icon: "ti ti-file-plus", label: "New file", action: () => void props.actions?.createFile?.(node.entry.path) });
    }
    if (node.isFolder && props.actions?.createFolder) {
      items.push({ icon: "ti ti-folder-plus", label: "New folder", action: () => void props.actions?.createFolder?.(node.entry.path) });
    }
    if (props.actions?.download) {
      items.push({
        icon: node.isFolder ? "ti ti-file-zip" : "ti ti-download",
        label: node.isFolder ? "Download as ZIP" : "Download",
        action: () => void props.actions?.download?.(node.entry.path, node.isFolder),
      });
    }
    if (!node.isFolder && props.actions?.rename) {
      items.push({ icon: "ti ti-cursor-text", label: "Rename", action: () => setRenamingPath(node.entry.path) });
    }
    if (props.actions?.remove) {
      items.push({ icon: "ti ti-trash", label: "Delete", variant: "danger", action: () => void props.actions?.remove?.(node.entry.path) });
    }
    return items;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (renamingPath()) return;
    const rows = visible();
    const index = rows.findIndex((node) => node.entry.path === props.selectedPath);
    const focus = (next: TreeNode | undefined) => {
      if (!next) return;
      if (next.isFolder) props.onSelect?.(next.entry);
      else props.onSelect?.(next.entry);
    };
    const current = index >= 0 ? rows[index] : undefined;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focus(rows[Math.min(index + 1, rows.length - 1)] ?? rows[0]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focus(rows[Math.max(index - 1, 0)] ?? rows[0]);
    } else if (event.key === "ArrowRight" && current?.isFolder && !expanded().has(current.entry.path)) {
      event.preventDefault();
      toggleFolder(current.entry.path);
    } else if (event.key === "ArrowLeft" && current?.isFolder && expanded().has(current.entry.path)) {
      event.preventDefault();
      toggleFolder(current.entry.path);
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      select(current);
    } else if (event.key === "F2" && current && !current.isFolder && props.actions?.rename) {
      event.preventDefault();
      setRenamingPath(current.entry.path);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: composite tree widget with roving selection.
    <ul
      class={`file-tree flex min-w-0 flex-col gap-0.5 outline-none ${dropTarget() === "/" ? "rounded-md bg-zinc-200/40 dark:bg-zinc-800/40" : ""} ${props.class ?? ""}`}
      role="tree"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        if (!canDrop(event)) return;
        event.preventDefault();
        if (dropTarget() === null) setDropTarget("/");
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropTarget(null);
      }}
      onDrop={(event) => handleDrop(event, "/")}
    >
      <For each={visible()}>
        {(node) => {
          const isSelected = () => !node.isFolder && props.selectedPath === node.entry.path;
          const isDropTarget = () => node.isFolder && dropTarget() === node.entry.path;
          const icon = () =>
            node.isFolder
              ? expanded().has(node.entry.path)
                ? "ti-folder-open"
                : "ti-folder"
              : (node.entry.icon ??
                fileIcons.getFileIcon({ name: node.name, type: "file", mimeType: node.entry.mediaType ?? "text/plain" }));
          const items = menuItems(node);
          const row = (
            <li
              class="group/row"
              role="treeitem"
              aria-selected={isSelected()}
              aria-expanded={node.isFolder ? expanded().has(node.entry.path) : undefined}
            >
              <Show
                when={renamingPath() === node.entry.path}
                fallback={
                  <div
                    data-state={isSelected() ? "selected" : isDropTarget() ? "drop-target" : "idle"}
                    class={`flex min-w-0 items-center rounded-md transition-colors ${
                      isSelected()
                        ? "bg-white font-medium text-primary [box-shadow:var(--ui-control-bevel)] dark:bg-zinc-800"
                        : isDropTarget()
                          ? "bg-cyan-50 text-secondary dark:bg-cyan-950/40"
                          : "text-secondary hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70"
                    }`}
                  >
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-xs"
                      style={{ "padding-left": `${6 + node.depth * 14}px` }}
                      title={node.entry.path}
                      draggable={Boolean(props.actions?.move)}
                      onDragStart={(event) => event.dataTransfer?.setData(DRAG_MIME, node.entry.path)}
                      onDragOver={(event) => {
                        if (!node.isFolder || !canDrop(event)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setDropTarget(node.entry.path);
                      }}
                      onDragLeave={() => {
                        if (isDropTarget()) setDropTarget(null);
                      }}
                      onDrop={(event) => node.isFolder && handleDrop(event, node.entry.path)}
                      onClick={() => select(node)}
                    >
                      <i class={`ti ${icon()} shrink-0 text-sm text-dimmed`} aria-hidden="true" />
                      <span class="min-w-0 flex-1 truncate">{node.name}</span>
                      <Show when={node.entry.badge}>
                        <span class="shrink-0 rounded bg-zinc-200/70 px-1 text-[10px] leading-4 text-dimmed dark:bg-zinc-800">
                          {node.entry.badge}
                        </span>
                      </Show>
                    </button>
                    <Show when={items.length > 0}>
                      <Dropdown
                        position="bottom-left"
                        elements={items}
                        trigger={
                          <span
                            class="mr-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-dimmed opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover/row:opacity-100"
                            title="Actions"
                          >
                            <i class="ti ti-dots text-xs" aria-hidden="true" />
                            <span class="sr-only">Actions for {node.name}</span>
                          </span>
                        }
                      />
                    </Show>
                  </div>
                }
              >
                <input
                  class="input h-6 w-full px-1.5 text-xs"
                  style={{ "margin-left": `${6 + node.depth * 14}px`, width: `calc(100% - ${6 + node.depth * 14}px)` }}
                  value={node.name}
                  // select() alone doesn't focus — without focus, Enter/Escape never reach the input.
                  ref={(element) =>
                    requestAnimationFrame(() => {
                      element.focus();
                      element.select();
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitRename(node, event.currentTarget.value);
                    if (event.key === "Escape") setRenamingPath(null);
                  }}
                  onBlur={(event) => void commitRename(node, event.currentTarget.value)}
                />
              </Show>
            </li>
          );
          return items.length > 0 ? <ContextMenu elements={items}>{row}</ContextMenu> : row;
        }}
      </For>
    </ul>
  );
}
