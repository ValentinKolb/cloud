import { STREAM_CURSOR_PATTERN } from "./yjs";

export const NOTEBOOKS_WORKSPACE_WS_TYPE = {
  subscribe: "notes.workspace.subscribe",
  ready: "notes.workspace.ready",
  event: "notes.workspace.event",
  error: "notes.workspace.error",
  revoked: "notes.workspace.revoked",
} as const;

export type NotebookWorkspaceNotebook = {
  id: string;
  shortId: string;
  name: string;
  description: string | null;
  icon: string | null;
  homepageNoteId: string | null;
  homepageNoteShortId: string | null;
  scriptsEnabled: boolean;
  defaultNoteTitleTemplate: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotebookWorkspaceNote = {
  id: string;
  shortId: string;
  notebookId: string;
  parentId: string | null;
  title: string;
  position: number;
  hasChildren: boolean;
  yjsSnapshotAt: string | null;
  contentMd: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
};

export type NotebookWorkspaceInvalidationScope = "notebook" | "tree" | "tags" | "references" | "permissions";

export type NotebookWorkspaceEvent =
  | {
      v: 1;
      type: "notebook.updated";
      notebookId: string;
      notebook: NotebookWorkspaceNotebook;
    }
  | {
      v: 1;
      type: "note.created";
      notebookId: string;
      note: NotebookWorkspaceNote;
    }
  | {
      v: 1;
      type: "note.updated";
      notebookId: string;
      note: NotebookWorkspaceNote;
    }
  | {
      v: 1;
      type: "note.deleted";
      notebookId: string;
      noteId: string;
      shortId: string;
    }
  | {
      v: 1;
      type: "note.favorite.changed";
      notebookId: string;
      noteId: string;
      userId: string;
      favorite: boolean;
    }
  | {
      v: 1;
      type: "workspace.invalidated";
      notebookId: string;
      reason: "bulk" | "template" | "permissions" | "unknown";
      scopes: NotebookWorkspaceInvalidationScope[];
    };

export const notebooksWorkspace = {
  wsType: NOTEBOOKS_WORKSPACE_WS_TYPE,
  streamCursorPattern: STREAM_CURSOR_PATTERN,
} as const;
