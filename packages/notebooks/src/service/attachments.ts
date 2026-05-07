/**
 * Attachments service — file blobs stored in Postgres bytea, FK-bound to a
 * notebook (cascades on notebook delete).
 *
 * Markdown encodes attachment references as `attachment://<id>`. Resolution
 * to the real download URL happens at render time (see `transformAttachments`)
 * and inside CodeMirror image/file widgets (client-side).
 *
 * All primitives here are permission-blind. The API/page layer is
 * responsible for `notebook.permission.get(...)` checks before calling.
 */
import { sql } from "bun";
import { fileIcons } from "@valentinkolb/stdlib";
import { generateUniqueShortId, isShortId } from "../lib/short-id";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type AttachmentKind = "image" | "file";

export type Attachment = {
  id: string;
  shortId: string;
  notebookId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
  createdBy: string | null;
  createdAt: string;
};

export type AttachmentContent = Attachment & { content: Uint8Array };

type DbRow = {
  id: string;
  short_id: string;
  notebook_id: string;
  filename: string;
  mime_type: string;
  size_bytes: string | number; // BIGINT may serialize as string
  kind: AttachmentKind;
  created_by: string | null;
  created_at: string;
};

const mapRow = (r: DbRow): Attachment => ({
  id: r.id,
  shortId: r.short_id,
  notebookId: r.notebook_id,
  filename: r.filename,
  mimeType: r.mime_type,
  sizeBytes: Number(r.size_bytes),
  kind: r.kind,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

/** Map a MIME type / filename to our binary `kind`. Image-vs-everything-else. */
export const detectKind = (filename: string, mimeType: string): AttachmentKind =>
  fileIcons.getFileCategory({ name: filename, type: "file", mimeType }) === "image" ? "image" : "file";

// =============================================================================
// CRUD
// =============================================================================

export const upload = async (params: {
  notebookId: string;
  filename: string;
  mimeType: string;
  content: Uint8Array;
  userId: string;
}): Promise<Attachment> => {
  const kind = detectKind(params.filename, params.mimeType);
  const shortId = await generateUniqueShortId("attachment");
  const [row] = await sql<DbRow[]>`
    INSERT INTO notebooks.attachments
      (short_id, notebook_id, filename, mime_type, size_bytes, kind, content, created_by)
    VALUES
      (${shortId}, ${params.notebookId}, ${params.filename}, ${params.mimeType},
       ${params.content.byteLength}, ${kind}, ${params.content}, ${params.userId})
    RETURNING id, short_id, notebook_id, filename, mime_type, size_bytes, kind, created_by, created_at
  `;
  return mapRow(row!);
};

export const get = async (params: { id: string }): Promise<Attachment | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, short_id, notebook_id, filename, mime_type, size_bytes, kind, created_by, created_at
    FROM notebooks.attachments WHERE id = ${params.id}
  `;
  return row ? mapRow(row) : null;
};

/**
 * Resolve an attachment by either UUID or short-id. Format-detection
 * branches keep each query on its own single-column index — same
 * pattern as `notebooks.getByIdOrShortId` and `notes.getByIdOrShortId`.
 * Used by the content-serving route + detail-panel hydration so the
 * `attach://` markdown scheme can carry short-ids end-to-end.
 */
export const getByIdOrShortId = async (params: { idOrShortId: string }): Promise<Attachment | null> => {
  const v = params.idOrShortId;
  if (isShortId(v)) {
    const [row] = await sql<DbRow[]>`
      SELECT id, short_id, notebook_id, filename, mime_type, size_bytes, kind, created_by, created_at
      FROM notebooks.attachments WHERE short_id = ${v}
    `;
    return row ? mapRow(row) : null;
  }
  return get({ id: v });
};

export const getContent = async (params: { id: string }): Promise<AttachmentContent | null> => {
  const [row] = await sql<(DbRow & { content: Uint8Array })[]>`
    SELECT id, short_id, notebook_id, filename, mime_type, size_bytes, kind, created_by, created_at, content
    FROM notebooks.attachments WHERE id = ${params.id}
  `;
  return row ? { ...mapRow(row), content: row.content } : null;
};

/** `getContent` variant accepting UUID OR short-id — used by the
 *  attachment serving endpoint when callers reference blobs via the
 *  user-facing short-id form. */
export const getContentByIdOrShortId = async (params: { idOrShortId: string }): Promise<AttachmentContent | null> => {
  const v = params.idOrShortId;
  if (isShortId(v)) {
    const [row] = await sql<(DbRow & { content: Uint8Array })[]>`
      SELECT id, short_id, notebook_id, filename, mime_type, size_bytes, kind, created_by, created_at, content
      FROM notebooks.attachments WHERE short_id = ${v}
    `;
    return row ? { ...mapRow(row), content: row.content } : null;
  }
  return getContent({ id: v });
};

export const list = async (params: { notebookId: string }): Promise<Attachment[]> => {
  const rows = await sql<DbRow[]>`
    SELECT id, short_id, notebook_id, filename, mime_type, size_bytes, kind, created_by, created_at
    FROM notebooks.attachments
    WHERE notebook_id = ${params.notebookId}
    ORDER BY created_at DESC
  `;
  return rows.map(mapRow);
};

/** Hydrate metadata for a specific set of ids — used by detail panel
 *  when only `attachment://` ids referenced in the current note matter. */
export const listByIds = async (params: { ids: string[] }): Promise<Attachment[]> => {
  if (params.ids.length === 0) return [];
  // Bun's sql tag does not expand JS arrays into Postgres array literals —
  // manually serialise to `{uuid,uuid,...}` form. Same pattern as
  // `notebooks.ts` toPgUuidArray.
  const idArray = `{${params.ids.join(",")}}`;
  const rows = await sql<DbRow[]>`
    SELECT id, short_id, notebook_id, filename, mime_type, size_bytes, kind, created_by, created_at
    FROM notebooks.attachments
    WHERE id = ANY(${idArray}::uuid[])
  `;
  return rows.map(mapRow);
};

export const remove = async (params: { id: string }): Promise<void> => {
  await sql`DELETE FROM notebooks.attachments WHERE id = ${params.id}`;
};

/** Cheap COUNT — used by the sidebar to gate the "Attachments" link. */
export const count = async (params: { notebookId: string }): Promise<number> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM notebooks.attachments WHERE notebook_id = ${params.notebookId}
  `;
  return row?.count ?? 0;
};

/**
 * Paginated + filterable list — drives the overview page. Search is a
 * case-insensitive substring match against `filename` (KISS — mime_type
 * is internal noise that wouldn't help users find a file by name).
 */
export const searchPaginated = async (params: {
  notebookId: string;
  search?: string;
  pagination: { limit: number; offset: number };
}): Promise<{ items: Attachment[]; total: number }> => {
  const q = params.search?.trim().toLowerCase();
  const pattern = q && q.length > 0 ? `%${q}%` : null;

  const rows = await sql<DbRow[]>`
    SELECT id, short_id, notebook_id, filename, mime_type, size_bytes, kind, created_by, created_at
    FROM notebooks.attachments
    WHERE notebook_id = ${params.notebookId}
      AND (${pattern}::text IS NULL OR LOWER(filename) LIKE ${pattern})
    ORDER BY created_at DESC
    LIMIT ${params.pagination.limit}
    OFFSET ${params.pagination.offset}
  `;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM notebooks.attachments
    WHERE notebook_id = ${params.notebookId}
      AND (${pattern}::text IS NULL OR LOWER(filename) LIKE ${pattern})
  `;

  return { items: rows.map(mapRow), total: countRow?.count ?? 0 };
};

// =============================================================================
// Markdown helpers (used by editor / detail panel / read-mode renderer)
// =============================================================================

const ATTACHMENT_REF_REGEX = /attachment:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/** Extract every unique attachment id referenced from a markdown body. */
export const extractIds = (md: string | null): string[] => {
  if (!md) return [];
  const ids = new Set<string>();
  for (const match of md.matchAll(ATTACHMENT_REF_REGEX)) ids.add(match[1]!.toLowerCase());
  return Array.from(ids);
};

/**
 * Count notes within a notebook that reference a given attachment id —
 * served from the `notebooks.note_attachments` index table (O(log N)
 * lookup instead of a `LIKE '%...'%` content_md scan). The index is kept
 * in sync via the per-save `reindexAttachmentRefs` and the periodic
 * scheduler reindex.
 */
export const usageCount = async (params: { notebookId: string; attachmentId: string }): Promise<number> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM notebooks.note_attachments
    WHERE notebook_id = ${params.notebookId}
      AND attachment_id = ${params.attachmentId}
  `;
  return row?.count ?? 0;
};

/** Reindex which attachment ids the given note references. Mirrors
 *  `reindexLinks` / `reindexTags` shape for the unified `reindexNoteRefs`
 *  orchestrator. Drops rows that point at attachments which have been
 *  deleted in the meantime (FK CASCADE handles that, but we ANTI JOIN
 *  upfront to avoid inserting them). */
export const reindexAttachmentRefs = async (params: { noteId: string; notebookId: string; contentMd: string | null }): Promise<void> => {
  const ids = extractIds(params.contentMd);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM notebooks.note_attachments WHERE note_id = ${params.noteId}`;
    if (ids.length === 0) return;
    // Filter to attachments that actually exist + belong to the same
    // notebook — defensive against cross-notebook copy/paste of an
    // `attachment://` URL whose blob isn't visible from here.
    const idArray = `{${ids.join(",")}}`;
    const valid = await tx<{ id: string }[]>`
      SELECT id FROM notebooks.attachments
      WHERE notebook_id = ${params.notebookId}
        AND id = ANY(${idArray}::uuid[])
    `;
    if (valid.length === 0) return;
    await tx`
      INSERT INTO notebooks.note_attachments ${tx(valid.map((row) => ({ note_id: params.noteId, notebook_id: params.notebookId, attachment_id: row.id })))}
      ON CONFLICT DO NOTHING
    `;
  });
};

// =============================================================================
// HTML post-processor — analogous to `transformNoteLinks`. Run AFTER
// `markdown.render(...)` to swap `attachment://<id>` references for real
// download URLs and render non-image links as file pills.
// =============================================================================

const buildContentUrl = (notebookId: string, id: string) =>
  `/api/notebooks/${notebookId}/attachments/${id}/content`;

export const transformAttachments = (html: string, params: { notebookId: string; idToFilename?: Map<string, string> }): string => {
  const { notebookId, idToFilename } = params;

  // 1) <img src="attachment://<id>"> → rewrite src to API content URL
  let out = html.replace(/(<img[^>]*\bsrc=")attachment:\/\/([0-9a-f-]{36})("[^>]*>)/gi, (_m, head: string, id: string, tail: string) => {
    return `${head}${buildContentUrl(notebookId, id.toLowerCase())}${tail}`;
  });

  // 2) <a href="attachment://<id>">label</a> → render as file pill
  out = out.replace(
    /<a[^>]*\bhref="attachment:\/\/([0-9a-f-]{36})"[^>]*>([^<]*)<\/a>/gi,
    (_m, id: string, label: string) => {
      const filename = idToFilename?.get(id.toLowerCase()) ?? label;
      const icon = fileIcons.getFileIcon({ name: filename, type: "file" });
      const href = buildContentUrl(notebookId, id.toLowerCase());
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="cm-attachment-pill inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 no-underline" title="${escapeHtml(filename)}"><i class="ti ${icon} text-xs"></i><span>${escapeHtml(label)}</span></a>`;
    },
  );

  return out;
};
