import type { NotebookSettings } from "../settings/NotebookSettingsStore";

/** Notebook metadata (matches backend NotebookSchema) */
export type Notebook = {
  id: string;
  shortId: string;
  name: string;
  description: string | null;
  icon: string | null;
  /** Per-notebook opt-in for `\`\`\`script` block execution. */
  scriptsEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Note tree node (matches backend NoteTreeNodeSchema) */
export type NoteTreeNode = {
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
  children: NoteTreeNode[];
};

/** Shared context for notebook components */
export type NotebookContext = {
  notebook: Notebook;
  tree: NoteTreeNode[];
  selectedNoteId: string | null;
  settings: NotebookSettings;
  permission: string;
  viewMode: "read" | "edit";
  /** Number of attachments in the notebook — gates the sidebar link. */
  attachmentCount: number;
  /** Number of distinct tags in the notebook — gates the sidebar link. */
  tagCount: number;
};
