/**
 * Type definitions for the kit API surface.
 *
 * Lives in its own file so that the sub-module factories
 * (`kit-note.ts`, `kit-notes.ts`, …) can share the wire shapes
 * without circular imports through the main `kit.ts` factory.
 */
import type * as Y from "yjs";

// =============================================================================
// Mode + context
// =============================================================================

export type KitMode = "edit" | "read";

/**
 * Snapshot of the current note's metadata + content captured at
 * script-run time. Used by the read-mode kit (no live Y.Doc); also
 * used by the edit-mode kit for fields that don't live in the doc
 * itself (createdAt, updatedAt, parentId — these come from the DB,
 * not from yjs).
 */
export type KitNoteSnapshot = {
  /** 6-char base62 — exposed to scripts as `kit.note.id` and used
   *  as the `noteId` param for API calls. The notebooks API accepts
   *  either UUID or short-id at the `:noteId` boundary, so the kit
   *  uses short-ids end-to-end for consistency with the user-facing
   *  identifier. */
  shortId: string;
  title: string;
  content: string;
  notebookName: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
};

/**
 * Inputs the host (CM6 extension or read-mode renderer) gives the
 * kit factory. Carries everything the kit modules might need so the
 * factory itself stays a thin wiring layer.
 *
 * Edit-mode contexts include `ytext` + `ydoc` for live mutations
 * and Y.Map-based state. Read-mode contexts omit them — write
 * methods on `kit.note` then throw and `kit.state.*` becomes a
 * no-op + console.warn.
 */
export type KitContext = {
  mode: KitMode;
  /** Notebook short-id (6-char base62). Exposed to scripts as
   *  `kit.note.notebook.id` and used as the `:id` param for every
   *  API call the kit makes. APIs accept either UUID or short-id;
   *  short-id keeps the wire form aligned with the user-visible
   *  identifier. */
  notebookId: string;
  /** Snapshot of the current note at script-run time. Updates to
   *  `ytext` (edit-mode) are reflected via the live getters in the
   *  kit factory; the snapshot is the fallback for fields the doc
   *  doesn't carry. */
  note: KitNoteSnapshot;
  /** Y.Text handle for the current note's content. Edit-mode only. */
  ytext?: Y.Text;
  /** Y.Doc — feeds `kit.state.*`. Edit-mode only. */
  ydoc?: Y.Doc;
  /** DOM container `kit.ui.*` mounts into. */
  outputEl: HTMLElement;
  /**
   * Register a teardown function to run when the script is about
   * to re-evaluate (debounced doc change in edit-mode) or the
   * widget is destroyed. Used by `kit.state.observe` to drop its
   * Y.Map listener so the old script run's callback doesn't keep
   * firing into a detached output slot. Optional: in read-mode
   * (no re-run) the runner doesn't need to track these — calls
   * are just dropped on the floor.
   */
  registerDisposer?: (fn: () => void) => void;
};

// =============================================================================
// Public Kit shape
// =============================================================================

export type Kit = {
  note: KitCurrentNote;
  notes: KitNotesAPI;
  attachments: KitAttachmentsAPI;
  tags: KitTagsAPI;
  state: KitStateAPI;
  localState: KitLocalStateAPI;
  ui: KitUI;
};

// ----- kit.note ----------------------------------------------------

/**
 * A single task extracted from the current note's markdown content.
 * Tasks are detected via the `- [ ]` / `- [x]` checkbox syntax (also
 * accepts `* [ ]` / `* [x]`); the `line` field is 0-indexed and refs
 * the line in `kit.note.content`.
 */
export type KitTask = {
  /** The task text, with the `- [ ]` checkbox stripped. */
  text: string;
  done: boolean;
  /** 0-indexed line in the note's content. Pass to
   *  `kit.note.toggleTask(line)` or `replaceLine(line, ...)`. */
  line: number;
};

export type KitCurrentNote = {
  // ----- read getters (live in edit-mode, snapshot in read-mode) -----
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly tags: string[];
  readonly tasks: KitTask[];
  readonly notebook: { id: string; name: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lockedAt: string | null;

  // ----- write methods (edit-mode only — throw in read-mode) -----

  /** Update the note's title. Persists via PATCH; visible to all
   *  collaborators after sync. */
  setTitle(title: string): Promise<void>;
  /** Replace the entire markdown content. Diff-based at the Y.Text
   *  level so collaborators' cursors jump as little as possible. */
  setContent(content: string): Promise<void>;
  /** Append markdown to the end of the note. A leading `\n\n` is
   *  inserted automatically when the existing content doesn't end
   *  with a newline, so paragraphs separate cleanly. */
  appendContent(markdown: string): Promise<void>;
  /** Prepend markdown to the start of the note. A trailing `\n\n`
   *  is inserted automatically. */
  prependContent(markdown: string): Promise<void>;
  /** Insert markdown at a specific position. `line` is 0-indexed;
   *  `col` defaults to 0 (start of line). `col` past the end of the
   *  line clamps to end-of-line. `line` past the end of the doc
   *  clamps to end-of-doc. */
  insertContentAt(position: { line: number; col?: number }, markdown: string): Promise<void>;
  /** Replace the entire `line` (0-indexed) with the given text. The
   *  newline at the end is preserved; pass text that doesn't
   *  contain `\n` to keep the line count stable. */
  replaceLine(line: number, text: string): Promise<void>;
  /** Toggle the task checkbox on the given 0-indexed line. Throws
   *  if the line doesn't contain a `- [ ]` / `- [x]` marker. The
   *  flip is a single-character Y.Text mutation so collab cursors
   *  stay put. */
  toggleTask(line: number): Promise<void>;
};

// ----- kit.notes ---------------------------------------------------

export type KitNote = {
  id: string;
  title: string;
  content: string | null;
  tags: string[];
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
};

/** Filter object for `kit.notes.search`. Single-string searches
 *  match against title + content; tag filter is AND (all listed
 *  tags must be present). All fields optional. */
export type KitQuery = {
  search?: string;
  tags?: string[];
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  /** Default 50, capped at 200. */
  limit?: number;
  offset?: number;
};

export type KitNotesAPI = {
  /** All notes in the current notebook. Notebook-scoped is a hard
   *  boundary — there is no parameter to query other notebooks. */
  list(): Promise<KitNote[]>;
  /** Fetch by short-id; returns null if the note doesn't exist or
   *  isn't in the current notebook. */
  get(shortId: string): Promise<KitNote | null>;
  /** Search by string (title + content substring) OR a structured
   *  `KitQuery`. The string overload is the common shortcut. */
  search(query: string | KitQuery): Promise<KitNote[]>;
  create(data: { title: string; parentId?: string }): Promise<KitNote>;
  update(shortId: string, data: { title?: string; parentId?: string | null }): Promise<KitNote>;
  remove(shortId: string): Promise<void>;
};

// ----- kit.attachments --------------------------------------------

export type KitAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "file";
  createdAt: string;
};

export type KitAttachmentsAPI = {
  /** All attachments uploaded to the current notebook. */
  list(): Promise<KitAttachment[]>;
  /** Only attachments referenced (`attach://<shortId>`) from the
   *  current note's content. */
  listInNote(): Promise<KitAttachment[]>;
  get(shortId: string): Promise<KitAttachment | null>;
  /** Upload a `File` or `Blob` to the current notebook. Filename
   *  defaults to `file.name` for File inputs; required for Blob. */
  upload(file: File | Blob, filename?: string): Promise<KitAttachment>;
  /** Open the browser's native file picker, then upload every
   *  picked file. Returns the uploaded attachments in pick-order. */
  uploadFromPicker(opts?: { accept?: string; multiple?: boolean }): Promise<KitAttachment[]>;
  /** Append `[filename](attach://shortId)` (or `![](attach://…)`
   *  for image kinds) to the current note's content. Edit-mode only. */
  insertIntoContent(shortId: string): Promise<void>;
  remove(shortId: string): Promise<void>;
};

// ----- kit.tags ---------------------------------------------------

export type KitTagSummary = { tag: string; count: number };

export type KitTagsAPI = {
  /** All tags used in the current notebook with their note counts. */
  list(): Promise<KitTagSummary[]>;
  /** Notes in the current notebook that reference the given tag.
   *  Filter is currently client-side (all notes → filter on
   *  `tags`); fast enough for typical notebooks but if the
   *  notebook grows large this should move server-side. */
  notesForTag(tag: string): Promise<KitNote[]>;
};

// ----- kit.state (collab Y.Map) -----------------------------------

export type KitStateAPI = {
  get<T = unknown>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
  /** All currently-set keys, sorted alphabetically. */
  keys(): string[];
  /** Fire `cb` whenever ANY peer (including the local client)
   *  changes the value for `key`. Returns an unsubscribe function. */
  observe<T = unknown>(key: string, cb: (newValue: T | undefined) => void): () => void;
};

// ----- kit.localState (OPFS, async) -------------------------------

export type KitLocalStateAPI = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys for THIS notebook's local-state namespace, sorted
   *  alphabetically. Other notebooks' keys aren't visible. */
  keys(): Promise<string[]>;
};

// ----- kit.ui ------------------------------------------------------

export type KitToastOptions = {
  variant?: "default" | "success" | "error";
  duration?: number;
  iconClass?: string;
  /** Override the variant-default title. */
  title?: string;
};

export type KitUI = {
  toast: (description: string, options?: KitToastOptions) => void;
  button: (label: string, onClick: () => void | Promise<void>) => void;
};
