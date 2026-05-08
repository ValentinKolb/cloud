import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { prompts } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { buildNoteUrl, buildReadUrl } from "../../../params";
import { Dropdown } from "@valentinkolb/cloud/ui";
import SearchButton from "../search/SearchButton.island";
import { listAccessibleNotebooks } from "./notebooks";
import type { NoteTreeNode, Notebook } from "./types";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/cloud/ui";

type Props = {
  tree: NoteTreeNode[];
  /** Notebook short-id (6-char base62). Used both for URL building
   *  (`buildNoteUrl`, etc.) and for API path params — the API resolves
   *  short-ids to UUIDs at the boundary, so islands never need both
   *  forms. Same convention applies to `noteId` references below. */
  notebookId: string;
  notebookName: string;
  selectedNoteId: string | null;
  canWrite?: boolean;
  viewMode?: "read" | "edit";
  showSearch?: boolean;
  showHeaderActions?: boolean;
};

// =============================================================================
// Helpers
// =============================================================================

/** Flatten tree into a list, optionally excluding a node and its descendants */
function flattenTree(
  nodes: NoteTreeNode[],
  excludeId?: string
): NoteTreeNode[] {
  const result: NoteTreeNode[] = [];
  const walk = (list: NoteTreeNode[]) => {
    for (const node of list) {
      if (node.id === excludeId) continue;
      result.push(node);
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

/** Build indented label for flat tree list */
function getNodeDepthLabel(
  node: NoteTreeNode,
  allNodes: NoteTreeNode[]
): string {
  let depth = 0;
  let current = node;
  while (current.parentId) {
    const parent = allNodes.find((n) => n.id === current.parentId);
    if (!parent) break;
    depth++;
    current = parent;
  }
  return "\u00A0\u00A0".repeat(depth) + node.title;
}

// =============================================================================
// Note Actions
// =============================================================================

function useNoteActions(notebookId: string, tree: () => NoteTreeNode[]) {
  const createNoteMut = mutations.create<
    { id: string; shortId: string },
    { title: string; parentId?: string }
  >({
    mutation: async (data: { title: string; parentId?: string }) => {
      const res = await apiClient[":id"].notes.$post({
        param: { id: notebookId },
        json: data,
      });
      if (!res.ok) throw new Error("Failed to create note");
      return (await res.json()) as { id: string; shortId: string };
    },
    onSuccess: (data) => {
      navigateTo(buildNoteUrl(notebookId, data.shortId));
    },
    onError: (err) => prompts.error(err.message),
  });

  const updateNoteMut = mutations.create({
    mutation: async (data: { noteId: string; patch: { title?: string } }) => {
      const res = await apiClient[":id"].notes[":noteId"].$patch({
        param: { id: notebookId, noteId: data.noteId },
        json: data.patch,
      });
      if (!res.ok) throw new Error("Failed to update note");
      return res.json();
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const moveNoteMut = mutations.create({
    mutation: async (data: {
      noteId: string;
      parentId: string | null;
      position: number;
    }) => {
      const res = await apiClient[":id"].notes[":noteId"].move.$post({
        param: { id: notebookId, noteId: data.noteId },
        json: { parentId: data.parentId, position: data.position },
      });
      if (!res.ok) throw new Error("Failed to move note");
      return res.json();
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const copyNoteMut = mutations.create<
    { id: string; shortId: string; notebookId: string; notebookShortId: string },
    { noteId: string; targetNotebookId: string; targetParentId?: string | null }
  >({
    mutation: async (data: {
      noteId: string;
      targetNotebookId: string;
      targetParentId?: string | null;
    }) => {
      const res = await apiClient[":id"].notes[":noteId"].copy.$post({
        param: { id: notebookId, noteId: data.noteId },
        json: {
          targetNotebookId: data.targetNotebookId,
          targetParentId: data.targetParentId,
        },
      });
      if (!res.ok) throw new Error("Failed to duplicate note");
      const json = (await res.json()) as { id: string; shortId: string; notebookId: string };
      // The target notebook's short-id isn't on the response — we only
      // get the note's short-id and the target notebook's UUID. The
      // page-handler resolves either form so feeding the UUID through
      // `buildNoteUrl` works; if URL aesthetics on cross-notebook copy
      // become an issue we can hydrate the target notebook short-id
      // here with a small extra fetch.
      return { ...json, notebookShortId: json.notebookId };
    },
    onSuccess: (data) => {
      navigateTo(buildNoteUrl(data.notebookShortId, data.shortId));
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteNoteMut = mutations.create({
    mutation: async (noteId: string) => {
      const res = await apiClient[":id"].notes[":noteId"].$delete({
        param: { id: notebookId, noteId },
      });
      if (!res.ok) throw new Error("Failed to delete note");
    },
    onSuccess: () => {
      navigateTo(`/app/notebooks/${notebookId}`);
    },
    onError: (err) => prompts.error(err.message),
  });

  const lockNoteMut = mutations.create<unknown, string>({
    mutation: async (noteId: string) => {
      const res = await apiClient[":id"].notes[":noteId"].lock.$post({
        param: { id: notebookId, noteId },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message ?? "Failed to lock note");
      }
      return res.json();
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleCreateNote = async (parentId?: string) => {
    const result = await prompts.form({
      title: parentId ? "New Subnote" : "New Note",
      icon: "ti ti-file-plus",
      fields: {
        title: {
          type: "text" as const,
          label: "Title",
          required: true,
          placeholder: "Note title",
        },
      },
    });
    if (result) {
      createNoteMut.mutate({ title: result.title, parentId });
    }
  };

  const handleEdit = async (node: NoteTreeNode) => {
    const result = await prompts.form({
      title: "Edit Note",
      icon: "ti ti-pencil",
      fields: {
        title: {
          type: "text" as const,
          label: "Title",
          required: true,
          default: node.title,
        },
      },
    });
    if (result) {
      updateNoteMut.mutate({
        noteId: node.id,
        patch: {
          title: result.title,
        },
      });
    }
  };

  const handleMove = async (node: NoteTreeNode) => {
    const allFlat = flattenTree(tree(), node.id);

    const result = await prompts.dialog<{ parentId: string | null }>(
      (close) => {
        const [selected, setSelected] = createSignal<string | null>(
          node.parentId
        );

        return (
          <div class="flex flex-col gap-4">
            <p class="text-sm text-secondary">
              Move <strong>{node.title}</strong> to:
            </p>

            <div class="flex flex-col gap-1 max-h-64 overflow-y-auto">
              {/* Root level option */}
              <button
                type="button"
                onClick={() => setSelected(null)}
                class={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  selected() === null
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                    : "text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <i class="ti ti-home text-xs mr-1.5" />
                Root Level
              </button>

              <For each={allFlat}>
                {(target) => (
                  <button
                    type="button"
                    onClick={() => setSelected(target.id)}
                    class={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      selected() === target.id
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                        : "text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <i class="ti ti-file-text text-xs mr-1.5" />
                    {getNodeDepthLabel(target, allFlat)}
                  </button>
                )}
              </For>
            </div>

            <div class="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => close(undefined)}
                class="btn-secondary btn-md"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => close({ parentId: selected() })}
                class="btn-primary btn-md"
                disabled={selected() === node.parentId}
              >
                Move
              </button>
            </div>
          </div>
        );
      },
      { title: "Move Note", icon: "ti ti-arrow-move-right" }
    );

    if (result) {
      moveNoteMut.mutate({
        noteId: node.id,
        parentId: result.parentId,
        position: 0,
      });
    }
  };

  const handleCopy = async (node: NoteTreeNode) => {
    let allNotebooks: Notebook[] = [];
    try {
      allNotebooks = await listAccessibleNotebooks();
    } catch (error) {
      prompts.error(
        error instanceof Error ? error.message : "Failed to load notebooks."
      );
      return;
    }

    if (allNotebooks.length === 0) {
      await prompts.error("No notebooks available");
      return;
    }

    const result = await prompts.form({
      title: "Duplicate Note",
      icon: "ti ti-copy",
      fields: {
        targetNotebookId: {
          type: "select" as const,
          label: "Target Notebook",
          required: true,
          default: notebookId,
          options: allNotebooks.map((nb) => ({
            id: nb.id,
            label: nb.name,
            icon: `ti ${nb.icon || "ti-notebook"}`,
          })),
        },
      },
    });

    if (result) {
      copyNoteMut.mutate({
        noteId: node.id,
        targetNotebookId: result.targetNotebookId,
      });
    }
  };

  const handleDelete = async (node: NoteTreeNode) => {
    const hasKids = node.children.length > 0;
    const confirmed = await prompts.confirm(
      hasKids
        ? `Delete "${node.title}" and all its sub-notes? This cannot be undone.`
        : `Delete "${node.title}"? This cannot be undone.`,
      {
        title: "Delete Note",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
      }
    );
    if (confirmed) {
      deleteNoteMut.mutate(node.id);
    }
  };

  const handleLock = async (node: NoteTreeNode) => {
    const confirmed = await prompts.confirm(
      `Lock "${node.title}"?\n\nLocked notes cannot be edited or restored from previous versions. This action is PERMANENT and cannot be undone.\n\nThe note can still be deleted.`,
      {
        title: "Lock Note",
        icon: "ti ti-lock",
        variant: "danger",
        confirmText: "Lock Permanently",
      }
    );
    if (confirmed) {
      lockNoteMut.mutate(node.id);
    }
  };

  return {
    handleCreateNote,
    handleEdit,
    handleMove,
    handleCopy,
    handleDelete,
    handleLock,
    loading: () =>
      createNoteMut.loading() ||
      updateNoteMut.loading() ||
      moveNoteMut.loading() ||
      copyNoteMut.loading() ||
      deleteNoteMut.loading() ||
      lockNoteMut.loading(),
  };
}

// =============================================================================
// Tree Node
// =============================================================================

function TreeNode(props: {
  node: NoteTreeNode;
  depth: number;
  selectedNoteId: string | null;
  notebookId: string;
  canWrite: boolean;
  viewMode: "read" | "edit";
  actions: ReturnType<typeof useNoteActions>;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const isSelected = () => props.node.id === props.selectedNoteId;
  const hasChildren = () => props.node.children.length > 0;
  const href = () => {
    return props.viewMode === "read"
      ? buildReadUrl(props.notebookId, props.node.shortId)
      : buildNoteUrl(props.notebookId, props.node.shortId);
  };

  return (
    <div class="sidebar-tree-item">
      <div
        class={`sidebar-tree-row group/node ${
          isSelected() ? "sidebar-item-active" : ""
        }`}
        style={`--sidebar-level:${props.depth}`}
      >
        {/* Expand/collapse toggle or leaf dot */}
        {hasChildren() ? (
          <button
            type="button"
            class="sidebar-tree-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            <i
              class={`ti ti-chevron-right text-xs transition-transform ${
                expanded() ? "rotate-90" : ""
              }`}
            />
          </button>
        ) : (
          <span class="sidebar-tree-toggle">
            <span class="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          </span>
        )}

        {/* Note link */}
        <a href={href()} class="flex-1 min-w-0 no-underline py-1">
          <span class="flex min-w-0 items-center gap-1.5">
            <span class="truncate">{props.node.title || "Untitled"}</span>
            <Show when={props.node.lockedAt}>
              <i
                class="ti ti-lock shrink-0 text-xs text-amber-500"
                title="Locked"
              />
            </Show>
          </span>
        </a>

        {/* Context menu */}
        <Show when={props.canWrite}>
          <div class="opacity-0 group-hover/node:opacity-100 transition-opacity shrink-0">
            <Dropdown
              trigger={
                <span class="sidebar-item-action">
                  <i class="ti ti-dots text-xs" />
                </span>
              }
              position="bottom-right"
              width="w-48"
              elements={[
                {
                  icon: "ti ti-file-plus",
                  label: "New Subnote",
                  action: () => props.actions.handleCreateNote(props.node.id),
                },
                {
                  sectionLabel: "Manage",
                  items: [
                    ...(props.node.lockedAt
                      ? []
                      : [
                          {
                            icon: "ti ti-pencil",
                            label: "Edit Title",
                            action: () => props.actions.handleEdit(props.node),
                          },
                          {
                            icon: "ti ti-arrow-move-right",
                            label: "Move",
                            action: () => props.actions.handleMove(props.node),
                          },
                        ]),
                    {
                      icon: "ti ti-copy",
                      label: "Duplicate",
                      action: () => props.actions.handleCopy(props.node),
                    },
                  ],
                },
                ...(props.node.lockedAt
                  ? []
                  : [
                      {
                        sectionLabel: "Security",
                        items: [
                          {
                            icon: "ti ti-lock",
                            label: "Lock Note",
                            variant: "danger" as const,
                            action: () => props.actions.handleLock(props.node),
                          },
                        ],
                      },
                    ]),
                {
                  sectionLabel: "",
                  items: [
                    {
                      icon: "ti ti-trash",
                      label: "Delete",
                      variant: "danger" as const,
                      action: () => props.actions.handleDelete(props.node),
                    },
                  ],
                },
              ]}
            />
          </div>
        </Show>
      </div>

      {/* Children */}
      {expanded() && hasChildren() && (
        <For each={props.node.children}>
          {(child) => (
            <TreeNode
              node={child}
              depth={props.depth + 1}
              selectedNoteId={props.selectedNoteId}
              notebookId={props.notebookId}
              canWrite={props.canWrite}
              viewMode={props.viewMode}
              actions={props.actions}
            />
          )}
        </For>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function NoteTree(props: Props) {
  const actions = useNoteActions(props.notebookId, () => props.tree);
  const showHeaderActions = () => props.showHeaderActions ?? true;

  return (
    <div class="sidebar-tree">
      {/* Header with search + add buttons */}
      <Show when={showHeaderActions()}>
        <div class="flex items-center justify-between px-2 py-1">
          <span class="section-label mb-0">Notes</span>
          <div class="flex items-center gap-1">
            <Show when={props.showSearch}>
              <SearchButton
                notebookId={props.notebookId}
                notebookName={props.notebookName}
                variant="compact"
              />
            </Show>
            <Show when={props.canWrite}>
              <button
                type="button"
                onClick={() => actions.handleCreateNote()}
                disabled={actions.loading()}
                class="text-dimmed hover:text-primary transition-colors p-0.5"
                title="New Note (Mod+Alt+N)"
              >
                <i
                  class={`ti ${
                    actions.loading() ? "ti-loader-2 animate-spin" : "ti-plus"
                  } text-xs`}
                />
              </button>
            </Show>
          </div>
        </div>
      </Show>

      <div class="max-h-[42vh] overflow-y-auto">
        <For each={props.tree}>
          {(node) => (
            <TreeNode
              node={node}
              depth={0}
              selectedNoteId={props.selectedNoteId}
              notebookId={props.notebookId}
              canWrite={props.canWrite ?? false}
              viewMode={props.viewMode ?? "edit"}
              actions={actions}
            />
          )}
        </For>
      </div>

      {props.tree.length === 0 && (
        <p class="flex items-center justify-center gap-1.5 px-2 py-4 text-xs text-dimmed">
          <i class="ti ti-file-text text-sm" />
          No notes yet
        </p>
      )}
    </div>
  );
}
