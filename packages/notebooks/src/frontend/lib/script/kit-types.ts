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
  /**
   * Host-provided liveness check for edit-mode re-runs. Async script
   * bodies cannot be cancelled once started, so kit methods that cause
   * visible or persistent side effects check this before acting.
   */
  isActive?: () => boolean;
};

/**
 * Throw if the host has marked the script run as no longer active.
 * Used by every kit method that performs a side effect (Y.Doc write,
 * API call, DOM mutation, …) so a late-completing await from a
 * superseded run can't corrupt the current state.
 */
export const assertActive = (ctx: KitContext): void => {
  if (ctx.isActive && !ctx.isActive()) {
    throw new Error("Script run is no longer active");
  }
};

// =============================================================================
// Public Kit shape
// =============================================================================

import type {
  charts as stdCharts,
  crypto as stdCrypto,
  dates as stdDates,
  encoding as stdEncoding,
  fuzzy as stdFuzzy,
  password as stdPassword,
  text as stdText,
  timing as stdTiming,
} from "@valentinkolb/stdlib";
import type { qr as stdQr } from "@valentinkolb/stdlib/qr";
import type { files as stdFiles, images as stdImages } from "@valentinkolb/stdlib/browser";

/**
 * Curated `@valentinkolb/stdlib` namespaces re-exposed on the kit so
 * script authors can build small applications without importing
 * anything. Each entry is a thin pass-through — the kit doesn't wrap
 * or rename functions, so the full stdlib API reference applies.
 *
 * What's NOT included on purpose:
 *  - `notifications`, `cache`, `gradients`, `svg` — user dropped.
 *  - `result`, `searchParams`, `streaming`, `theme`, `cookies`,
 *    `fileicons`, `solid/*` — not script-relevant.
 *  - `kvStore` — already exposed as `kit.localState.*` with proper
 *    namespacing per notebook.
 */
export type KitStdLib = {
  /** String manipulation — `slugify`, `humanize`, `truncate`,
   *  case conversion, `pprintBytes`, etc. */
  text: typeof stdText;
  /** Date / time formatting and calendar utilities. */
  dates: typeof stdDates;
  /** Fuzzy search / typo correction — `match`, `filter`, `closest`. */
  fuzzy: typeof stdFuzzy;
  /** Crypto primitives: hash (SHA-256 / FNV-1a), uuid, readableId,
   *  asymmetric / symmetric / TOTP. */
  crypto: typeof stdCrypto;
  /** Byte ↔ string conversions — Base64, Hex, Base62. */
  encoding: typeof stdEncoding;
  /** SVG chart generators — scatter, line, bar, pie, donut, sparkline.
   *  Combine with `kit.ui.html(svg)` to render the result. */
  charts: typeof stdCharts;
  /** QR-code generators (WiFi, email, tel, vCard, event) + SVG render. */
  qr: typeof stdQr;
  /** Password generators (random / memorable / pin) + strength meter. */
  password: typeof stdPassword;
  /** Async timing helpers — `sleep`, `debounce`, `throttle`, `jitter`,
   *  `withMinLoadTime`. */
  timing: typeof stdTiming;
  /** File downloads, ZIP archive creation, file/folder picker
   *  dialogs, MIME-type utilities. Browser-only. */
  files: typeof stdFiles;
  /** Chainable image processing — resize, crop, filter, rotate,
   *  flip, presets, batch. Browser-only. */
  images: typeof stdImages;
  /** Single-method facade — `kit.clipboard.copy(text)`. The full
   *  stdlib clipboard module has more (read, hasPermission, etc.)
   *  but we deliberately keep the surface minimal here. */
  clipboard: { copy: (text: string) => Promise<void> };
};

export type Kit = {
  note: KitCurrentNote;
  notes: KitNotesAPI;
  attachments: KitAttachmentsAPI;
  tags: KitTagsAPI;
  table: (name: string) => KitTableBlockAPI;
  list: (name: string) => KitListBlockAPI;
  data: (name: string) => KitDataBlockAPI;
  section: (name: string) => KitSectionBlockAPI;
  state: KitStateAPI;
  localState: KitLocalStateAPI;
  ui: KitUI;
} & KitStdLib;

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
  /** Short-id used in URLs and `note://...` links. */
  id: string;
  title: string;
  content: string | null;
  tags: string[];
  tasks: KitTask[];
  /** Parent note short-id, or null for root notes. */
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
   *  `KitQuery`. The string overload is the common shortcut.
   *
   *  When tag / date filters force a client-side post-filter pass,
   *  the result universe is capped at ~1000 notes. If the notebook
   *  has more, a `console.warn` fires AND the returned array has
   *  a non-enumerable `__truncated: true` property — scripts that
   *  need to detect cap-overflow can read it:
   *
   *      const notes = await kit.notes.search({ tags: ['old'] });
   *      if (notes.__truncated) { ... }
   *
   *  String-only searches forwarded to the server are NOT subject
   *  to this cap — the API handles offset/limit natively. */
  search(query: string | KitQuery): Promise<KitNote[] & { __truncated?: boolean }>;
  /** Convenience tag search. `searchTags("garden")` and
   *  `search("#garden")` use the same current-notebook filter. */
  searchTags(tags: string | string[], options?: { limit?: number; offset?: number }): Promise<KitNote[] & { __truncated?: boolean }>;
  create(data: { title: string; parentId?: string; content?: string }): Promise<KitNote>;
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

// ----- named blocks ------------------------------------------------

export type KitTableBlockAPI = {
  /** Add a row to every `@name` table in the current note. Accepts
   *  varargs, one array, or one object keyed by table headers. */
  add: (...cells: unknown[]) => Promise<void>;
};

export type KitListBlockAPI = {
  /** Append one or more list items to every `@name` list in the
   *  current note. */
  add: (...items: unknown[]) => Promise<void>;
};

export type KitDataBlockAPI = {
  /** Read the first `@name :::data` block in the current note. */
  get: () => Record<string, unknown> | null;
  /** Replace every `@name :::data` block in the current note. */
  set: (value: Record<string, unknown>) => Promise<void>;
};

export type KitSectionBlockAPI = {
  /** Append markdown to every `@name` heading section in the current note. */
  append: (markdown: string) => Promise<void>;
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
  /** Fire `cb` whenever `key` changes — same tab via the kvStore's
   *  internal watcher, OTHER tabs via the kvStore's BroadcastChannel.
   *  Auto-cleaned on script re-run / widget destroy. The returned
   *  function unsubscribes manually; running it twice is a no-op. */
  observe<T = unknown>(key: string, cb: (newValue: T | undefined) => void): () => void;
};

// ----- kit.ui ------------------------------------------------------

export type KitToastOptions = {
  variant?: "default" | "success" | "error";
  duration?: number;
  iconClass?: string;
  /** Override the variant-default title. */
  title?: string;
};

/**
 * The DOM element returned by every `kit.ui.*` builder. Carries a
 * `.show()` shortcut so users can mount via either of:
 *
 *   kit.ui.render(kit.ui.button("hi", fn));   // declarative
 *   kit.ui.button("hi", fn).show();           // chaining sugar
 *
 * The element is a plain `HTMLElement` under the hood — escape
 * hatches like `kit.ui.html(...)` and the children-as-`HTMLElement`
 * accept points let scripts plug in any DOM, not just kit-built
 * nodes.
 */
export type KitElement = HTMLElement & {
  /** Mount this element into the script's output container. Same
   *  effect as `kit.ui.render(this)`. Returns nothing. */
  show: () => void;
};

/** Anything the layout builders accept as a child:
 *  - a `KitElement` (returned by other `kit.ui.*` builders)
 *  - any raw `HTMLElement` (escape hatch — your own canvas, charts,
 *    third-party components)
 *  - a `string` (auto-wrapped in `kit.ui.text`)
 *  - `null` / `false` / `undefined` (skipped — useful for inline
 *    conditionals: `cond && kit.ui.text(...)`) */
export type KitChild = KitElement | HTMLElement | string | null | false | undefined;

export type KitButtonVariant = "primary" | "secondary" | "danger";

export type KitButtonOptions = {
  /** Visual variant. Default `primary`. */
  variant?: KitButtonVariant;
  /** Tabler-icon class — e.g. `"ti ti-check"`. Rendered before the
   *  label. */
  icon?: string;
  /** When true the button is non-interactive (greyed out, click
   *  handler not invoked). */
  disabled?: boolean;
};

export type KitHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type KitUI = {
  // ── Layout ─────────────────────────────────────────────────────
  /** Horizontal flex row with gap. Children wrap to a new visual
   *  line when they don't fit. */
  row: (...children: KitChild[]) => KitElement;
  /** Vertical flex column with gap. */
  col: (...children: KitChild[]) => KitElement;
  /** Container with padding — visual grouping for related content.
   *  Lays out children vertically (same as `col`) by default. */
  card: (...children: KitChild[]) => KitElement;
  /** Horizontal rule. */
  divider: () => KitElement;

  // ── Content ────────────────────────────────────────────────────
  /** Plain paragraph text. */
  text: (content: string) => KitElement;
  /** Heading level 1–6 (default 2). */
  heading: (content: string, level?: KitHeadingLevel) => KitElement;
  /** Render arbitrary markdown (same engine as the read-mode
   *  pipeline). Trusted scripts only — output is not sanitised. */
  md: (markdown: string) => KitElement;
  /** Render a clickable link to a note. Accepts a `KitNote` or a
   *  short-id string. */
  noteLink: (note: KitNote | string, label?: string) => KitElement;
  /** Render notes as a compact vertical list of note links. */
  noteList: (notes: KitNote[], options?: { emptyText?: string }) => KitElement;
  /** Render rows with the same tile-style table surface as Markdown
   *  tables. Notes become note links, tag arrays become tag pills,
   *  and task arrays / progress-like objects render as compact text. */
  table: (rows: unknown[][] | Record<string, unknown>[], options?: { columns?: string[]; emptyText?: string }) => KitElement;

  // ── Interactive ────────────────────────────────────────────────
  /** Button. Async `onClick` errors are caught and rendered as a
   *  small inline error chip next to the button. */
  button: (label: string, onClick: () => void | Promise<void>, options?: KitButtonOptions) => KitElement;

  // ── Escape hatch ───────────────────────────────────────────────
  /** Wrap raw HTML in a container. Trusted-script-only — the
   *  string is set via `innerHTML` without sanitisation. */
  html: (rawHtml: string) => KitElement;

  // ── Mount ──────────────────────────────────────────────────────
  /** Mount one or more elements into the script's output container.
   *  Equivalent to calling `.show()` on each one in order. */
  render: (...elements: KitChild[]) => void;

  // ── Side-effect (NOT mounted into the output tree) ─────────────
  /** Global toast notification. Fires the platform toast UI; not
   *  attached to the script's output. */
  toast: (description: string, options?: KitToastOptions) => void;
  /** Modal prompts — pass-through to the platform `prompts.*` API.
   *  Async, return null/undefined on cancel:
   *    - `kit.ui.prompt.alert(msg)` — info dialog with OK
   *    - `kit.ui.prompt.confirm(msg)` — Yes/No, returns boolean
   *    - `kit.ui.prompt.text(msg, def?)` — single text input
   *    - `kit.ui.prompt.form(spec)` — multi-field form (see platform
   *      docs for field types: text / number / select / boolean /
   *      tags / image / currency / pin) */
  prompt: KitPromptAPI;
};

/** Pass-through binding for the platform `prompts.*` modal API,
 *  exposed via `kit.ui.prompt`. We re-declare the surface here as a
 *  thin type so script-side typings don't reach into
 *  `@valentinkolb/cloud/ui`. */
export type KitPromptAPI = {
  alert: (message: string, options?: { title?: string; icon?: string }) => Promise<void>;
  confirm: (message: string, options?: { title?: string; icon?: string }) => Promise<boolean>;
  text: (message: string, defaultValue?: string, options?: { title?: string; placeholder?: string }) => Promise<string | null>;
  form: (spec: KitFormSpec) => Promise<Record<string, unknown> | null>;
};

/** Shape of the `kit.ui.prompt.form` argument. Mirrors the platform
 *  `prompts.form` config — fields can be text / textarea / number /
 *  boolean / select. Multi-line input is normalized to the platform's
 *  `{ type: "text", multiline: true }` shape at runtime. The platform supports more types (tags, image,
 *  currency, pin, datetime) — scripts needing those can drop down
 *  to `kit.ui.html` + a manual form. */
export type KitFormField =
  | {
      type: "text";
      label?: string;
      placeholder?: string;
      required?: boolean;
      default?: string;
      /** Render as multi-line textarea. */
      multiline?: boolean;
      /** Visible rows when `multiline` is true. Default ~3. */
      lines?: number;
    }
  | {
      type: "textarea";
      label?: string;
      placeholder?: string;
      required?: boolean;
      default?: string;
      /** Alias accepted by examples and common form APIs. */
      rows?: number;
      /** Platform-native row count alias. */
      lines?: number;
    }
  | { type: "number"; label?: string; placeholder?: string; required?: boolean; default?: number; min?: number; max?: number }
  | { type: "boolean"; label?: string; default?: boolean }
  | { type: "select"; label?: string; options: string[]; required?: boolean; default?: string };

export type KitFormSpec = {
  title?: string;
  icon?: string;
  submitText?: string;
  cancelText?: string;
  fields: Record<string, KitFormField>;
};
