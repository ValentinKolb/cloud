import { sql } from "bun";
import { logger } from "@valentinkolb/cloud/services";

const log = logger("notebooks:links");

// ==========================
// Renderer post-process
// ==========================

/**
 * Markdown-body scheme for internal note references:
 *
 *   [Some Title](note://k2s8s6)
 *
 * `marked` renders that as a plain `<a href="note://k2s8s6">`. The
 * post-processor below detects the scheme and rewrites it into a
 * navigable URL plus a pill-style `<a class="note-link">`. The
 * `noteShortIdToHref` map is built upstream (in the page handler) by
 * resolving every referenced short-id to a `(notebookShortId, noteShortId)`
 * pair — that lookup is one batched SQL query, not a per-link N+1.
 *
 * Anchored on the `note://` href so non-note `<a>` tags pass through.
 * Tolerant of attribute order: `marked` always emits `<a href="...">`
 * first but other content-source pipelines may inject classes or `target`
 * before `href`. We anchor on `href="note://<id>"` and re-emit the full
 * tag from scratch.
 */
const NOTE_LINK_HTML_REGEX = /<a\s[^>]*\bhref="note:\/\/([0-9a-zA-Z]{6})"[^>]*>([\s\S]*?)<\/a>/g;
const MARKED_NOTE_LINK_HTML_REGEX =
  /<span class="md-link-widget[^"]*">\s*<span class="md-link-label[^"]*">\[([\s\S]*?)\]<\/span>\s*<a\s[^>]*\bhref="note:\/\/([0-9a-zA-Z]{6})"[^>]*>[\s\S]*?<\/a>\s*<\/span>/g;

const NOTE_PILL_CLASS =
  "cm-note-link note-link inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 no-underline hover:bg-blue-100 dark:hover:bg-blue-900/50 align-baseline font-medium";

const renderNotePill = (href: string, label: string): string =>
  `<a class="${NOTE_PILL_CLASS}" href="${href}">` +
  `<i class="ti ti-connection text-xs"></i>` +
  `<span>${label}</span>` +
  `</a>`;

const renderBrokenNotePill = (shortId: string, label: string): string =>
  `<a class="cm-note-link note-link note-link-broken inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 no-underline align-baseline font-medium" title="Note ${shortId} not found">` +
  `<i class="ti ti-link-off text-xs"></i>` +
  `<span>${label}</span>` +
  `</a>`;

/**
 * Rewrites `<a href="note://<shortId>">` into a navigable pill-style
 * link. `noteShortIdToHref` carries the resolved URL for every short-id
 * — when a short-id isn't in the map (deleted note, cross-notebook
 * reference the caller couldn't resolve), the link is rendered with a
 * "broken" red style so the user spots dangling references at a glance.
 *
 * Run this AFTER `markdown.render(...)`. The map is computed once per
 * page render (see `[id]/page.tsx`) and lives only as long as the
 * SSR call.
 */
export const transformNoteLinks = (
  html: string,
  params: { noteShortIdToHref: Map<string, string> },
): string =>
  html
    .replace(MARKED_NOTE_LINK_HTML_REGEX, (_match, label: string, shortId: string) => {
      const href = params.noteShortIdToHref.get(shortId);
      return href ? renderNotePill(href, label) : renderBrokenNotePill(shortId, label);
    })
    .replace(NOTE_LINK_HTML_REGEX, (_match, shortId: string, label: string) => {
      const href = params.noteShortIdToHref.get(shortId);
      return href ? renderNotePill(href, label) : renderBrokenNotePill(shortId, label);
    });

// ==========================
// Types
// ==========================

export type NoteLink = {
  sourceNoteId: string;
  targetNoteId: string;
};

export type Backlink = {
  noteId: string;
  noteShortId: string;
  title: string;
  notebookId: string;
  notebookShortId: string;
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
 * Matches internal note references of the form `note://<shortId>`
 * inside a markdown body. Short-ids are 6-char base62.
 */
export const NOTE_LINK_REGEX = /note:\/\/([0-9a-zA-Z]{6})/g;

/**
 * Pull every distinct referenced-note short-id out of a markdown body.
 * Returns the short-id form (deduped); the caller resolves to UUIDs
 * before persisting into `note_links` (see `reindexLinks` below).
 */
export const extractNoteLinks = (contentMd: string | null): string[] => {
  if (!contentMd) return [];
  const ids = new Set<string>();
  for (const match of contentMd.matchAll(NOTE_LINK_REGEX)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
};

// ==========================
// Index maintenance
// ==========================

/**
 * Replace the outgoing links for a single source note.
 *
 * Body refs come in as `note://<shortId>` — we resolve those short-ids
 * to canonical UUIDs against `notebooks.notes` and persist UUIDs in
 * `note_links` (which has UUID FKs both directions). Stale or
 * cross-notebook short-ids that don't resolve are silently dropped.
 * Self-links are filtered both in JS and in the SQL `<>` guard.
 */
export const reindexLinks = async (sourceNoteId: string, contentMd: string | null): Promise<void> => {
  const targetShortIds = extractNoteLinks(contentMd);

  await sql`
    DELETE FROM notebooks.note_links
    WHERE source_note_id = ${sourceNoteId}::uuid
  `;

  if (targetShortIds.length === 0) return;

  const arr = `{${targetShortIds.join(",")}}`;
  await sql`
    INSERT INTO notebooks.note_links (source_note_id, target_note_id)
    SELECT ${sourceNoteId}::uuid, n.id
    FROM notebooks.notes n
    WHERE n.short_id = ANY(${arr}::text[])
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

type BacklinkRow = {
  note_id: string;
  note_short_id: string;
  title: string;
  notebook_id: string;
  notebook_short_id: string;
  notebook_name: string;
  updated_at: Date;
};

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
    ? await sql<BacklinkRow[]>`
        SELECT DISTINCT
          src.id AS note_id,
          src.short_id AS note_short_id,
          src.title,
          src.notebook_id,
          nb.short_id AS notebook_short_id,
          nb.name AS notebook_name,
          src.updated_at
        FROM notebooks.note_links nl
        JOIN notebooks.notes src ON src.id = nl.source_note_id
        JOIN notebooks.notebooks nb ON nb.id = src.notebook_id
        WHERE nl.target_note_id = ${noteId}::uuid
        ORDER BY src.updated_at DESC
      `
    : await sql<BacklinkRow[]>`
        SELECT DISTINCT
          src.id AS note_id,
          src.short_id AS note_short_id,
          src.title,
          src.notebook_id,
          nb.short_id AS notebook_short_id,
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
    noteShortId: r.note_short_id,
    title: r.title,
    notebookId: r.notebook_id,
    notebookShortId: r.notebook_short_id,
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
