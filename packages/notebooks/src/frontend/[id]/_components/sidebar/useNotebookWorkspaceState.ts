import { createSignal, onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import { NOTE_SOFT_NAVIGATED_EVENT, NOTE_TITLE_CHANGED_EVENT } from "../detail/events";
import type { NotebookContext, NoteTreeNode } from "./types";
import { WORKSPACE_EVENT, type WorkspaceEventDetail } from "./workspace-events";

const cloneTree = (nodes: NoteTreeNode[]): NoteTreeNode[] => nodes.map((node) => ({ ...node, children: cloneTree(node.children) }));

const sortNodes = (nodes: NoteTreeNode[]) => {
  nodes.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
};

const removeNoteFromTree = (nodes: NoteTreeNode[], noteId: string): NoteTreeNode | null => {
  const index = nodes.findIndex((node) => node.id === noteId);
  if (index >= 0) return nodes.splice(index, 1)[0] ?? null;
  for (const node of nodes) {
    const removed = removeNoteFromTree(node.children, noteId);
    if (removed) {
      node.hasChildren = node.children.length > 0;
      return removed;
    }
  }
  return null;
};

const insertNoteIntoTree = (nodes: NoteTreeNode[], note: NoteTreeNode) => {
  if (!note.parentId) {
    nodes.push({ ...note, children: note.children ?? [] });
    sortNodes(nodes);
    return;
  }
  for (const node of nodes) {
    if (node.id === note.parentId) {
      node.children.push({ ...note, children: note.children ?? [] });
      node.hasChildren = true;
      sortNodes(node.children);
      return;
    }
    insertNoteIntoTree(node.children, note);
  }
};

const updateNoteTitle = (nodes: NoteTreeNode[], noteId: string, title: string): boolean => {
  for (const node of nodes) {
    if (node.id === noteId) {
      node.title = title;
      sortNodes(nodes);
      return true;
    }
    if (updateNoteTitle(node.children, noteId, title)) return true;
  }
  return false;
};

export function useNotebookWorkspaceState(ctx: NotebookContext) {
  const [notebook, setNotebook] = createSignal(ctx.notebook);
  const [noteTree, setNoteTree] = createSignal(ctx.tree);
  const [favoriteNoteIds, setFavoriteNoteIds] = createSignal(new Set(ctx.favoriteNoteIds));
  const [selectedNoteId, setSelectedNoteId] = createSignal(ctx.selectedNoteId);

  const refetchTree = async () => {
    const response = await apiClient[":id"].tree.$get({ param: { id: notebook().shortId } });
    if (!response.ok) return;
    setNoteTree((await response.json()) as NoteTreeNode[]);
  };

  const applyWorkspaceEvent = (detail: WorkspaceEventDetail) => {
    const event = detail.event;
    if (event.type === "notebook.updated") {
      setNotebook(event.notebook);
      return;
    }
    if (event.type === "workspace.invalidated") {
      if (event.scopes.includes("tree")) void refetchTree();
      return;
    }
    if (event.type === "note.deleted") {
      setNoteTree((current) => {
        const next = cloneTree(current);
        removeNoteFromTree(next, event.noteId);
        return next;
      });
      setFavoriteNoteIds((current) => {
        const next = new Set(current);
        next.delete(event.noteId);
        return next;
      });
      return;
    }
    if (event.type === "note.favorite.changed") {
      if (event.userId !== ctx.userId) return;
      setFavoriteNoteIds((current) => {
        const next = new Set(current);
        if (event.favorite) next.add(event.noteId);
        else next.delete(event.noteId);
        return next;
      });
      return;
    }
    if (event.type === "note.created" || event.type === "note.updated") {
      setNoteTree((current) => {
        const next = cloneTree(current);
        const existing = removeNoteFromTree(next, event.note.id);
        insertNoteIntoTree(next, { ...event.note, children: existing?.children ?? [] });
        return next;
      });
    }
  };

  onMount(() => {
    const onWorkspaceEvent = (raw: Event) => applyWorkspaceEvent((raw as CustomEvent<WorkspaceEventDetail>).detail);
    const onSoftNavigated = (raw: Event) => {
      const detail = (raw as CustomEvent<{ canonicalNoteId?: string }>).detail;
      if (detail?.canonicalNoteId) setSelectedNoteId(detail.canonicalNoteId);
    };
    const onTitleChanged = (raw: Event) => {
      const detail = (raw as CustomEvent<{ noteId?: string; title?: string }>).detail;
      if (!detail?.noteId || !detail.title) return;
      setNoteTree((current) => {
        const next = cloneTree(current);
        updateNoteTitle(next, detail.noteId!, detail.title!);
        return next;
      });
    };
    window.addEventListener(WORKSPACE_EVENT, onWorkspaceEvent);
    window.addEventListener(NOTE_SOFT_NAVIGATED_EVENT, onSoftNavigated);
    window.addEventListener(NOTE_TITLE_CHANGED_EVENT, onTitleChanged);
    onCleanup(() => {
      window.removeEventListener(WORKSPACE_EVENT, onWorkspaceEvent);
      window.removeEventListener(NOTE_SOFT_NAVIGATED_EVENT, onSoftNavigated);
      window.removeEventListener(NOTE_TITLE_CHANGED_EVENT, onTitleChanged);
    });
  });

  return { notebook, noteTree, favoriteNoteIds, selectedNoteId };
}
