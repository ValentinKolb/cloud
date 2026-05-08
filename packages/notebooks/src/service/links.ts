import { sql } from "bun";
import { logger } from "@valentinkolb/cloud/services";

const log = logger("notebooks:links");

// ==========================
// Renderer post-process
// ==========================

/**
 * Matches the platform link-renderer's wrapper for an internal note URL.
 * Mirrors the shape produced by `LINK_STYLES` in `@valentinkolb/cloud/shared`:
 *
 *   <span class="md-link-widget …"><span class="md-link-label …">[Title]</span><a href="/app/notebooks/<uuid>?note=<uuid>" target="_blank" …><i class="ti ti-arrow-up-right…"></i></a></span>
 *
 * Tightly anchored on `md-link-widget` and the note-URL shape so non-note
 * links pass through untouched.
 *
 * The captured `label` and `href` are already HTML-escaped by `marked` —
 * they go straight back into the replacement without further escaping.
 */
const NOTE_LINK_HTML_REGEX =
  /<span class="md-link-widget[^"]*"><span class="md-link-label[^"]*">\[([^\]]+)\]<\/span><a href="(\/app\/notebooks\/[0-9a-fA-F-]{36}\?note=[0-9a-fA-F-]{36})"[^>]*><i class="ti ti-arrow-up-right[^"]*"><\/i><\/a><\/span>/g;

/**
 * Rewrites the platform's `[Label] ↗` rendering into a pill-style note-link
 * (`<a class="note-link">`) for internal note URLs. Non-note links are
 * untouched. Run this AFTER `markdown.render(...)` in the page handler so
 * the cloud-lib renderer stays generic.
 */
export const transformNoteLinks = (html: string): string =>
  html.replace(
    NOTE_LINK_HTML_REGEX,
    (_, label, href) =>
      `<a class="note-link inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 no-underline hover:bg-blue-100 dark:hover:bg-blue-900/50" href="${href}">` +
      `<i class="ti ti-connection text-xs"></i>` +
      `<span>${label}</span>` +
      `</a>`,
  );

// ==========================
// Types
// ==========================

export type NoteLink = {
  sourceNoteId: string;
  targetNoteId: string;
};

export type Backlink = {
  noteId: string;
  title: string;
  notebookId: string;
  notebookName: string;
  updatedAt: string;
};

// Graph view payload — nodes + edges scoped to a single notebook. The shape
// is intentionally tight (only what the visualisation needs) so we can stream
// hundreds of notes without ballooning the SSR/JSON payload.
export type GraphNode = {
  id: string;
  shortId: string;
  title: string;
  /** Number of incoming links from inside this notebook — drives node size
   *  in the visualisation (more linked = bigger). */
  inDegree: number;
};

export type GraphEdge = {
  source: string;
  target: string;
};

export type NoteGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// ==========================
// Link extraction
// ==========================

/**
 * Matches internal note URLs of the form
 * `/app/notebooks/<notebookUuid>?note=<noteUuid>` inside markdown content.
 *
 * Hex chars are case-insensitive; uuids are normalised to lowercase by the
 * extractor before being persisted, so the canonical form in `note_links`
 * matches what `gen_random_uuid()` produces.
 */
export const NOTE_LINK_REGEX = /\/app\/notebooks\/([0-9a-fA-F-]{36})\?note=([0-9a-fA-F-]{36})/g;

/**
 * Pull every distinct target-note UUID out of a markdown body.
 *
 * Returns lowercase UUIDs to keep the persisted edge list canonical regardless
 * of how the link was typed/pasted.
 */
export const extractNoteLinks = (contentMd: string | null): string[] => {
  if (!contentMd) return [];
  const ids = new Set<string>();
  for (const match of contentMd.matchAll(NOTE_LINK_REGEX)) {
    if (match[2]) ids.add(match[2].toLowerCase());
  }
  return [...ids];
};

// ==========================
// Index maintenance
// ==========================

/**
 * Replace the outgoing links for a single source note.
 *
 * The `INSERT … SELECT FROM notebooks.notes` shape silently filters out
 * targets that don't exist (stale UUIDs in markdown after the target note
 * was deleted). Self-links are dropped both in JS and in the SQL `<>` guard.
 */
export const reindexLinks = async (sourceNoteId: string, contentMd: string | null): Promise<void> => {
  const targets = extractNoteLinks(contentMd).filter((id) => id !== sourceNoteId.toLowerCase());

  await sql`
    DELETE FROM notebooks.note_links
    WHERE source_note_id = ${sourceNoteId}::uuid
  `;

  if (targets.length === 0) return;

  const arr = `{${targets.join(",")}}`;
  await sql`
    INSERT INTO notebooks.note_links (source_note_id, target_note_id)
    SELECT ${sourceNoteId}::uuid, n.id
    FROM notebooks.notes n
    WHERE n.id = ANY(${arr}::uuid[])
      AND n.id <> ${sourceNoteId}::uuid
    ON CONFLICT DO NOTHING
  `;
};

/**
 * Best-effort wrapper used by save paths. An indexing failure must never
 * roll back the underlying save — we log and move on; the next save (or a
 * backfill) will reconcile.
 */
export const reindexLinksSafe = async (sourceNoteId: string, contentMd: string | null): Promise<void> => {
  try {
    await reindexLinks(sourceNoteId, contentMd);
  } catch (error) {
    log.warn("Failed to reindex note links", {
      sourceNoteId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ==========================
// Backlinks query
// ==========================

const toPgUuidArray = (values: string[]): string => `{${values.join(",")}}`;

/**
 * List notes that link to `noteId`, filtered by access on the *source*
 * notebook so a backlink only appears if the requester can read where it's
 * coming from.
 *
 * `bypassAccess: true` skips the access filter — used for global admins so
 * the backlinks panel reflects the full link graph for them.
 */
export const listBacklinks = async (params: {
  noteId: string;
  userId: string | null;
  userGroups: string[];
  bypassAccess?: boolean;
}): Promise<Backlink[]> => {
  const { noteId, userId, userGroups, bypassAccess = false } = params;

  const rows = bypassAccess
    ? await sql<{
        note_id: string;
        title: string;
        notebook_id: string;
        notebook_name: string;
        updated_at: Date;
      }[]>`
        SELECT DISTINCT
          src.id AS note_id,
          src.title,
          src.notebook_id,
          nb.name AS notebook_name,
          src.updated_at
        FROM notebooks.note_links nl
        JOIN notebooks.notes src ON src.id = nl.source_note_id
        JOIN notebooks.notebooks nb ON nb.id = src.notebook_id
        WHERE nl.target_note_id = ${noteId}::uuid
        ORDER BY src.updated_at DESC
      `
    : await sql<{
        note_id: string;
        title: string;
        notebook_id: string;
        notebook_name: string;
        updated_at: Date;
      }[]>`
        SELECT DISTINCT
          src.id AS note_id,
          src.title,
          src.notebook_id,
          nb.name AS notebook_name,
          src.updated_at
        FROM notebooks.note_links nl
        JOIN notebooks.notes src ON src.id = nl.source_note_id
        JOIN notebooks.notebooks nb ON nb.id = src.notebook_id
        WHERE nl.target_note_id = ${noteId}::uuid
          AND EXISTS (
            SELECT 1
            FROM notebooks.notebook_access na
            JOIN auth.access a ON a.id = na.access_id
            WHERE na.notebook_id = src.notebook_id
              AND (
                a.user_id = ${userId}::uuid
                OR a.group_id = ANY(${toPgUuidArray(userGroups)}::uuid[])
                OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
                OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = false)
              )
          )
        ORDER BY src.updated_at DESC
      `;

  return rows.map((r) => ({
    noteId: r.note_id,
    title: r.title,
    notebookId: r.notebook_id,
    notebookName: r.notebook_name,
    updatedAt: r.updated_at.toISOString(),
  }));
};

// ==========================
// Graph view
// ==========================

/**
 * Build the per-notebook link graph: every note in the notebook becomes a
 * node, every `note_links` row whose source AND target are both inside the
 * notebook becomes an edge.
 *
 * Edges that point outside the notebook (cross-notebook links) are
 * intentionally dropped from the graph payload — the visualisation is
 * scoped to one notebook at a time. Cross-notebook visualisation is a
 * separate (larger) feature.
 *
 * `inDegree` counts only *internal* incoming links so node size in the
 * graph reflects connectedness within the same notebook.
 *
 * Access control is performed at the route layer (the caller already
 * passed `checkNotebookAccess`); this function trusts that gate and does
 * not re-filter.
 */
export const buildNotebookGraph = async (params: { notebookId: string }): Promise<NoteGraph> => {
  const { notebookId } = params;

  const noteRows = await sql<{ id: string; short_id: string; title: string }[]>`
    SELECT id, short_id, title
    FROM notebooks.notes
    WHERE notebook_id = ${notebookId}::uuid
    ORDER BY created_at ASC
  `;

  const edgeRows = await sql<{ source_note_id: string; target_note_id: string }[]>`
    SELECT nl.source_note_id, nl.target_note_id
    FROM notebooks.note_links nl
    JOIN notebooks.notes src ON src.id = nl.source_note_id
    JOIN notebooks.notes tgt ON tgt.id = nl.target_note_id
    WHERE src.notebook_id = ${notebookId}::uuid
      AND tgt.notebook_id = ${notebookId}::uuid
  `;

  const inDegree = new Map<string, number>();
  for (const edge of edgeRows) {
    inDegree.set(edge.target_note_id, (inDegree.get(edge.target_note_id) ?? 0) + 1);
  }

  return {
    nodes: noteRows.map((n) => ({
      id: n.id,
      shortId: n.short_id,
      title: n.title,
      inDegree: inDegree.get(n.id) ?? 0,
    })),
    edges: edgeRows.map((e) => ({ source: e.source_note_id, target: e.target_note_id })),
  };
};
