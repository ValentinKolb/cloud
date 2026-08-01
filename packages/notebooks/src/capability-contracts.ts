import { z } from "zod";

const TimestampSchema = z.string().datetime({ offset: true });
const PermissionSchema = z.enum(["read", "write", "admin"]);
const CursorSchema = z.string().min(1).max(256).optional().describe("Opaque cursor returned by the previous page.");
const LimitSchema = z.number().int().min(1).max(100).default(25).describe("Maximum number of results to return.");
const QuerySchema = z.string().trim().max(500).optional().describe("Optional text search.");
const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const NamedBlockTypeSchema = z.enum(["table", "list", "data", "section", "script", "unknown"]);

const NotebookDataShape = {
  id: z.uuid(),
  shortId: z.string().min(1).max(6),
  name: z.string().min(1),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  homepageNoteId: z.uuid().nullable(),
  homepageNoteShortId: z.string().nullable(),
  permission: PermissionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
};

export const NotebookDataSchema = z.object(NotebookDataShape).strict();
export const NotebookListDataSchema = z.array(NotebookDataSchema).max(100);
export const NotebookListInputSchema = z
  .object({
    query: QuerySchema,
    minimumPermission: PermissionSchema.default("read").describe("Minimum effective permission required for returned notebooks."),
    cursor: CursorSchema,
    limit: LimitSchema,
  })
  .strict();
export const NotebookGetInputSchema = z.object({ notebookId: z.uuid().describe("Stable notebook UUID.") }).strict();

export const NoteSummaryDataSchema = z
  .object({
    id: z.uuid(),
    shortId: z.string().min(1).max(6),
    notebookId: z.uuid(),
    parentId: z.uuid().nullable(),
    title: z.string(),
    position: z.number().int().nonnegative(),
    hasChildren: z.boolean(),
    locked: z.boolean(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const NoteTreeInputSchema = z
  .object({
    notebookId: z.uuid().describe("Readable notebook whose complete note index should be traversed."),
    cursor: CursorSchema,
    limit: z.number().int().min(1).max(2000).default(500).describe("Maximum lightweight tree entries to return."),
  })
  .strict();
export const NoteTreeDataSchema = z
  .array(
    z
      .object({
        id: z.uuid(),
        shortId: z.string().min(1).max(6),
        parentId: z.uuid().nullable(),
        title: z.string(),
        position: z.number().int().nonnegative(),
        hasChildren: z.boolean(),
      })
      .strict(),
  )
  .max(2000);

export const NoteGetInputSchema = z
  .object({
    noteId: z.uuid().describe("Stable note UUID."),
    contentOffset: z.number().int().nonnegative().default(0).describe("Zero-based character offset into the Markdown source."),
    contentLimit: z.number().int().min(1).max(50_000).default(20_000).describe("Maximum Markdown characters to return."),
  })
  .strict();

export const NamedBlockSummaryDataSchema = z
  .object({
    name: z.string(),
    type: NamedBlockTypeSchema,
    line: z.number().int().positive(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    hash: ContentHashSchema,
  })
  .strict();

export const NoteDetailDataSchema = NoteSummaryDataSchema.extend({
  content: z.string().max(50_000),
  contentOffset: z.number().int().nonnegative(),
  contentLength: z.number().int().nonnegative(),
  contentHash: ContentHashSchema,
  contentComplete: z.boolean(),
  nextContentOffset: z.number().int().positive().nullable(),
  lineCount: z.number().int().positive(),
  tags: z.array(z.string().min(1)).max(500),
  tagsTruncated: z.boolean(),
  blocks: z.array(NamedBlockSummaryDataSchema).max(500),
  blocksTruncated: z.boolean(),
}).strict();

export const NoteLinksInputSchema = z
  .object({
    noteId: z.uuid().describe("Stable note UUID whose readable relations should be listed."),
    direction: z.enum(["incoming", "outgoing", "all"]).default("all").describe("Link direction relative to the selected note."),
    cursor: CursorSchema,
    limit: LimitSchema,
  })
  .strict();
export const NoteLinksDataSchema = z
  .array(
    z
      .object({
        direction: z.enum(["incoming", "outgoing"]),
        noteId: z.uuid(),
        noteShortId: z.string().min(1).max(6),
        title: z.string(),
        notebookId: z.uuid(),
        notebookShortId: z.string().min(1).max(6),
        notebookName: z.string(),
        updatedAt: TimestampSchema,
      })
      .strict(),
  )
  .max(100);

export const TagListInputSchema = z
  .object({
    notebookId: z.uuid().describe("Readable notebook whose tag vocabulary should be listed."),
    cursor: CursorSchema,
    limit: LimitSchema,
  })
  .strict();
export const TagListDataSchema = z.array(z.object({ tag: z.string().min(1), count: z.number().int().nonnegative() }).strict()).max(100);

export const TagNotesInputSchema = z
  .object({
    notebookId: z.uuid().describe("Readable notebook containing the selected tag."),
    tag: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z][\w-]*(?:\/[\w-]+)*$/)
      .describe("Notebook tag without the leading hash sign."),
    query: QuerySchema,
    cursor: CursorSchema,
    limit: LimitSchema,
  })
  .strict();
export const TagNotesDataSchema = z
  .array(
    z
      .object({
        id: z.uuid(),
        shortId: z.string().min(1).max(6),
        title: z.string(),
        preview: z.string().nullable(),
        updatedAt: TimestampSchema,
      })
      .strict(),
  )
  .max(100);

const EditBlockSelectorShape = {
  name: z.string().trim().min(1).max(200),
  type: NamedBlockTypeSchema.optional(),
  index: z.number().int().nonnegative().optional(),
};
const EditContentSchema = z.string().max(200_000);

export const NoteEditOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set-content"), content: EditContentSchema }).strict(),
  z.object({ kind: z.literal("append"), content: EditContentSchema }).strict(),
  z.object({ kind: z.literal("prepend"), content: EditContentSchema }).strict(),
  z.object({ kind: z.literal("insert-before-line"), line: z.number().int().positive(), content: EditContentSchema }).strict(),
  z.object({ kind: z.literal("insert-after-line"), line: z.number().int().positive(), content: EditContentSchema }).strict(),
  z
    .object({
      kind: z.literal("replace-lines"),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      content: EditContentSchema,
    })
    .strict(),
  z.object({ kind: z.literal("delete-lines"), startLine: z.number().int().positive(), endLine: z.number().int().positive() }).strict(),
  z
    .object({
      kind: z.literal("replace-block"),
      ...EditBlockSelectorShape,
      includeHandle: z.boolean().optional(),
      content: EditContentSchema,
    })
    .strict(),
  z.object({ kind: z.literal("append-block"), ...EditBlockSelectorShape, content: EditContentSchema }).strict(),
  z.object({ kind: z.literal("prepend-block"), ...EditBlockSelectorShape, content: EditContentSchema }).strict(),
]);

export const NoteCreateInputSchema = z
  .object({
    notebookId: z.uuid().describe("Writable notebook UUID."),
    parentId: z.uuid().optional().describe("Optional parent note UUID in the same notebook."),
    position: z.number().int().nonnegative().optional().describe("Optional sibling position; defaults to append."),
    content: z.string().max(200_000).optional().describe("Initial Markdown source; a title is derived or generated by the notebook."),
  })
  .strict();

export const NoteEditInputSchema = z
  .object({
    noteId: z.uuid().describe("Stable writable note UUID."),
    operations: z.array(NoteEditOperationSchema).min(1).max(20).describe("Ordered structural Markdown edits."),
    ifUpdatedAt: TimestampSchema.optional().describe("Reject when the note timestamp changed."),
    ifContentHash: ContentHashSchema.optional().describe("Reject when the complete Markdown hash changed."),
    ifBlockHash: ContentHashSchema.optional().describe("Reject when the selected named block changed."),
  })
  .strict();

export const NoteEditDataSchema = z
  .object({
    note: NoteSummaryDataSchema,
    changed: z.boolean(),
    beforeHash: ContentHashSchema,
    afterHash: ContentHashSchema,
    blocks: z.array(NamedBlockSummaryDataSchema).max(500),
    blocksTruncated: z.boolean(),
  })
  .strict();

export const NoteMoveInputSchema = z
  .object({
    noteId: z.uuid().describe("Stable writable note UUID."),
    parentId: z.uuid().nullable().describe("New parent note UUID in the same notebook, or null for a root note."),
    position: z.number().int().nonnegative().describe("New sibling position."),
  })
  .strict();
