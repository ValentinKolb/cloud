import { sql } from "bun";
import * as Y from "yjs";
import type { MutationResult } from "@valentinkolb/cloud/contracts";
import type { PaginationParams } from "@valentinkolb/cloud/contracts";
import { reindexNoteRefsSafe } from "./note-refs";
import { parseStreamCursor } from "./yjs-sync";
import { generateUniqueShortId, isShortId } from "../lib/short-id";

// ==========================
// Types
// ==========================

export type Note = {
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

export type NoteWithContent = Note & {
  /** Yjs snapshot as base64 (null if no content yet) */
  yjsSnapshot: string | null;
};

export type NoteTreeNode = Note & {
  children: NoteTreeNode[];
};

export type CreateNote = {
  notebookId: string;
  parentId?: string;
  title: string;
  position?: number;
};

export type UpdateNote = {
  title?: string;
  parentId?: string | null;
  position?: number;
};

export type NoteVersion = {
  id: string;
  noteId: string;
  title: string | null;
  createdBy: string | null;
  createdAt: string;
};

type DbNote = {
  id: string;
  short_id: string;
  notebook_id: string;
  parent_id: string | null;
  title: string;
  position: number;
  yjs_snapshot: Buffer | null;
  yjs_stream_ms?: number | null;
  yjs_stream_seq?: number | null;
  yjs_snapshot_at: Date | null;
  content_md: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  has_children?: boolean;
  locked_at: Date | null;
};

type DbYjsState = {
  yjs_snapshot: Buffer | null;
  yjs_stream_ms: number | null;
  yjs_stream_seq: number | null;
};

type DbNoteVersion = {
  id: string;
  note_id: string;
  title: string | null;
  created_by: string | null;
  created_at: Date;
};

const VERSION_MIN_INTERVAL = "5 minutes";

// ==========================
// Helpers
// ==========================

/**
 * Converts one note row into the base note DTO used by list/get endpoints.
 */
const mapToNote = (row: DbNote): Note => ({
  id: row.id,
  shortId: row.short_id,
  notebookId: row.notebook_id,
  parentId: row.parent_id,
  title: row.title,
  position: row.position,
  hasChildren: row.has_children ?? false,
  yjsSnapshotAt: row.yjs_snapshot_at?.toISOString() ?? null,
  contentMd: row.content_md ?? null,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  lockedAt: row.locked_at?.toISOString() ?? null,
});

/**
 * Extends `mapToNote` by serializing the optional Yjs snapshot buffer as base64.
 */
const mapToNoteWithContent = (row: DbNote): NoteWithContent => ({
  ...mapToNote(row),
  yjsSnapshot: row.yjs_snapshot ? row.yjs_snapshot.toString("base64") : null,
});

/**
 * Converts one version row into the lightweight note-version DTO for history views.
 */
const mapToNoteVersion = (row: DbNoteVersion): NoteVersion => ({
  id: row.id,
  noteId: row.note_id,
  title: row.title,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const compareTreeNodes = (left: NoteTreeNode, right: NoteTreeNode): number => {
  const leftTitle = left.title.trim().toLocaleLowerCase();
  const rightTitle = right.title.trim().toLocaleLowerCase();
  if (leftTitle !== rightTitle) return leftTitle.localeCompare(rightTitle);
  return left.id.localeCompare(right.id);
};

const sortTreeNodes = (nodes: NoteTreeNode[]): void => {
  nodes.sort(compareTreeNodes);
  for (const node of nodes) {
    if (node.children.length > 0) sortTreeNodes(node.children);
  }
};

// ==========================
// Lock Helpers
// ==========================

/**
 * Check if a note is locked.
 */
export const isLocked = async (params: { id: string }): Promise<boolean> => {
  const [row] = await sql<{ locked_at: Date | null }[]>`
    SELECT locked_at FROM notebooks.notes WHERE id = ${params.id}::uuid
  `;
  return row != null && row.locked_at !== null;
};

/**
 * Lock a note permanently. Once locked, the note cannot be edited or restored.
 */
export const lock = async (params: { id: string }): Promise<MutationResult<Note>> => {
  const { id } = params;

  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Note not found", status: 404 };
  }

  if (existing.lockedAt) {
    return { ok: false, error: "Note is already locked", status: 400 };
  }

  const [row] = await sql<DbNote[]>`
    UPDATE notebooks.notes
    SET locked_at = now(), updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, short_id, notebook_id, parent_id, title, position,
              yjs_snapshot_at, content_md, created_by, created_at, updated_at, locked_at
  `;

  if (!row) {
    return { ok: false, error: "Failed to lock note", status: 500 };
  }

  return {
    ok: true,
    data: mapToNote({ ...row, has_children: existing.hasChildren }),
  };
};

// ==========================
// Service
// ==========================

/**
 * Recent notes accessible to a user, joined with their parent notebook's
 * icon. Used by the dashboard widget. Limited to a small N — a peek, not
 * a full list. Same access semantics as `notebooks.list`.
 */
export type RecentNote = {
  id: string;
  shortId: string;
  notebookId: string;
  notebookShortId: string;
  title: string;
  updatedAt: string;
  notebookIcon: string | null;
  notebookName: string;
};

export const recentForUser = async (params: {
  userId: string;
  groups: string[];
  limit: number;
}): Promise<RecentNote[]> => {
  const groupsArr = `{${params.groups.map((g) => `"${g}"`).join(",")}}`;
  const rows = await sql<{
    id: string;
    short_id: string;
    notebook_id: string;
    notebook_short_id: string;
    title: string;
    updated_at: string;
    notebook_icon: string | null;
    notebook_name: string;
  }[]>`
    SELECT
      nt.id, nt.short_id, nt.notebook_id, nt.title, nt.updated_at,
      nb.short_id AS notebook_short_id, nb.icon AS notebook_icon, nb.name AS notebook_name
    FROM notebooks.notes nt
    JOIN notebooks.notebooks nb ON nb.id = nt.notebook_id
    WHERE EXISTS (
      SELECT 1
      FROM notebooks.notebook_access na
      JOIN auth.access a ON a.id = na.access_id
      WHERE na.notebook_id = nt.notebook_id
        AND (
          a.user_id = ${params.userId}::uuid
          OR a.group_id = ANY(${groupsArr}::uuid[])
          OR a.authenticated_only = true
          OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = false)
        )
    )
    ORDER BY nt.updated_at DESC
    LIMIT ${params.limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    shortId: r.short_id,
    notebookId: r.notebook_id,
    notebookShortId: r.notebook_short_id,
    title: r.title,
    updatedAt: r.updated_at,
    notebookIcon: r.notebook_icon,
    notebookName: r.notebook_name,
  }));
};

/**
 * List all notes in a notebook (flat list with hasChildren flag).
 */
export const list = async (params: { notebookId: string }): Promise<Note[]> => {
  const rows = await sql<DbNote[]>`
    SELECT
      n.id, n.short_id, n.notebook_id, n.parent_id, n.title, n.position,
      n.yjs_snapshot_at, n.content_md, n.created_by, n.created_at, n.updated_at, n.locked_at,
      EXISTS(SELECT 1 FROM notebooks.notes c WHERE c.parent_id = n.id) as has_children
    FROM notebooks.notes n
    WHERE n.notebook_id = ${params.notebookId}::uuid
    ORDER BY n.parent_id NULLS FIRST, n.position, n.title
  `;

  return rows.map(mapToNote);
};

/**
 * List notes with SQL-side filtering and pagination.
 */
export const listPaged = async (params: {
  notebookId: string;
  query?: string;
  parentId?: string | null;
  pagination?: { limit: number; offset: number };
}): Promise<{ items: Note[]; total: number }> => {
  const query = params.query?.trim();
  const pattern = query && query.length > 0 ? `%${query}%` : null;
  const parentId = params.parentId;
  const parentCondition =
    parentId === undefined
      ? sql`true`
      : parentId === null
        ? sql`n.parent_id IS NULL`
        : sql`n.parent_id = ${parentId}::uuid`;

  const rows =
    params.pagination === undefined
      ? await sql<DbNote[]>`
          SELECT
            n.id, n.short_id, n.notebook_id, n.parent_id, n.title, n.position,
            n.yjs_snapshot_at, n.content_md, n.created_by, n.created_at, n.updated_at, n.locked_at,
            EXISTS(SELECT 1 FROM notebooks.notes c WHERE c.parent_id = n.id) as has_children
          FROM notebooks.notes n
          WHERE n.notebook_id = ${params.notebookId}::uuid
            AND ${parentCondition}
            AND (
              ${pattern}::text IS NULL
              OR n.title ILIKE ${pattern}
              OR COALESCE(n.content_md, '') ILIKE ${pattern}
            )
          ORDER BY
            CASE WHEN ${pattern}::text IS NULL THEN 0 WHEN n.title ILIKE ${pattern} THEN 0 ELSE 1 END,
            n.position ASC,
            n.updated_at DESC
        `
      : await sql<DbNote[]>`
          SELECT
            n.id, n.short_id, n.notebook_id, n.parent_id, n.title, n.position,
            n.yjs_snapshot_at, n.content_md, n.created_by, n.created_at, n.updated_at, n.locked_at,
            EXISTS(SELECT 1 FROM notebooks.notes c WHERE c.parent_id = n.id) as has_children
          FROM notebooks.notes n
          WHERE n.notebook_id = ${params.notebookId}::uuid
            AND ${parentCondition}
            AND (
              ${pattern}::text IS NULL
              OR n.title ILIKE ${pattern}
              OR COALESCE(n.content_md, '') ILIKE ${pattern}
            )
          ORDER BY
            CASE WHEN ${pattern}::text IS NULL THEN 0 WHEN n.title ILIKE ${pattern} THEN 0 ELSE 1 END,
            n.position ASC,
            n.updated_at DESC
          LIMIT ${params.pagination.limit}
          OFFSET ${params.pagination.offset}
        `;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM notebooks.notes n
    WHERE n.notebook_id = ${params.notebookId}::uuid
      AND ${parentCondition}
      AND (
        ${pattern}::text IS NULL
        OR n.title ILIKE ${pattern}
        OR COALESCE(n.content_md, '') ILIKE ${pattern}
      )
  `;

  return {
    items: rows.map(mapToNote),
    total: countRow?.count ?? 0,
  };
};

/**
 * Build the complete note tree for a notebook.
 */
export const getTree = async (params: { notebookId: string }): Promise<NoteTreeNode[]> => {
  const notes = await list(params);

  const nodeMap = new Map<string, NoteTreeNode>();
  const roots: NoteTreeNode[] = [];

  // Create nodes
  for (const note of notes) {
    nodeMap.set(note.id, { ...note, children: [] });
  }

  // Build tree
  for (const note of notes) {
    const node = nodeMap.get(note.id)!;
    if (note.parentId && nodeMap.has(note.parentId)) {
      nodeMap.get(note.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortTreeNodes(roots);

  return roots;
};

/**
 * Get a note by ID.
 */
export const get = async (params: { id: string }): Promise<Note | null> => {
  const [row] = await sql<DbNote[]>`
    SELECT
      n.id, n.short_id, n.notebook_id, n.parent_id, n.title, n.position,
      n.yjs_snapshot_at, n.content_md, n.created_by, n.created_at, n.updated_at, n.locked_at,
      EXISTS(SELECT 1 FROM notebooks.notes c WHERE c.parent_id = n.id) as has_children
    FROM notebooks.notes n
    WHERE n.id = ${params.id}::uuid
  `;

  return row ? mapToNote(row) : null;
};

/**
 * Resolve a note by either UUID or short-id. Format-detection branches
 * keep each query on a single-column index — see `notebooks.getByIdOrShortId`
 * for the same pattern. Used at the page-handler boundary so URLs +
 * markdown `note://` schemes can carry short-ids while service
 * internals stay UUID-driven.
 */
export const getByIdOrShortId = async (params: { idOrShortId: string }): Promise<Note | null> => {
  const v = params.idOrShortId;
  if (isShortId(v)) {
    const [row] = await sql<DbNote[]>`
      SELECT
        n.id, n.short_id, n.notebook_id, n.parent_id, n.title, n.position,
        n.yjs_snapshot_at, n.content_md, n.created_by, n.created_at, n.updated_at, n.locked_at,
        EXISTS(SELECT 1 FROM notebooks.notes c WHERE c.parent_id = n.id) as has_children
      FROM notebooks.notes n
      WHERE n.short_id = ${v}
    `;
    return row ? mapToNote(row) : null;
  }
  return get({ id: v });
};

/**
 * Get a note with its Yjs content.
 */
export const getWithContent = async (params: { id: string }): Promise<NoteWithContent | null> => {
  const [row] = await sql<DbNote[]>`
    SELECT
      n.id, n.short_id, n.notebook_id, n.parent_id, n.title, n.position,
      n.yjs_snapshot, n.yjs_snapshot_at, n.content_md, n.created_by, n.created_at, n.updated_at, n.locked_at,
      EXISTS(SELECT 1 FROM notebooks.notes c WHERE c.parent_id = n.id) as has_children
    FROM notebooks.notes n
    WHERE n.id = ${params.id}::uuid
  `;

  return row ? mapToNoteWithContent(row) : null;
};

/** `getWithContent` variant that accepts a UUID OR a short-id. Same
 *  branching trick as `getByIdOrShortId` so each query stays on its
 *  single-column index. */
export const getWithContentByIdOrShortId = async (params: { idOrShortId: string }): Promise<NoteWithContent | null> => {
  const v = params.idOrShortId;
  if (isShortId(v)) {
    const [row] = await sql<DbNote[]>`
      SELECT
        n.id, n.short_id, n.notebook_id, n.parent_id, n.title, n.position,
        n.yjs_snapshot, n.yjs_snapshot_at, n.content_md, n.created_by, n.created_at, n.updated_at, n.locked_at,
        EXISTS(SELECT 1 FROM notebooks.notes c WHERE c.parent_id = n.id) as has_children
      FROM notebooks.notes n
      WHERE n.short_id = ${v}
    `;
    return row ? mapToNoteWithContent(row) : null;
  }
  return getWithContent({ id: v });
};

/**
 * Create a new note.
 */
export const create = async (params: { data: CreateNote; creatorId: string | null }): Promise<MutationResult<Note>> => {
  const { data, creatorId } = params;

  // Get next position if not provided
  let position = data.position;
  if (position === undefined) {
    const [maxPos] = await sql<{ max: number | null }[]>`
      SELECT MAX(position) as max
      FROM notebooks.notes
      WHERE notebook_id = ${data.notebookId}::uuid
        AND ${data.parentId ? sql`parent_id = ${data.parentId}::uuid` : sql`parent_id IS NULL`}
    `;
    position = (maxPos?.max ?? -1) + 1;
  }

  try {
    const shortId = await generateUniqueShortId("note");
    const [row] = await sql<DbNote[]>`
      INSERT INTO notebooks.notes (short_id, notebook_id, parent_id, title, position, created_by)
      VALUES (
        ${shortId},
        ${data.notebookId}::uuid,
        ${data.parentId ?? null}::uuid,
        ${data.title},
        ${position},
        ${creatorId}::uuid
      )
      RETURNING id, short_id, notebook_id, parent_id, title, position,
                yjs_snapshot_at, content_md, created_by, created_at, updated_at
    `;

    if (!row) {
      return { ok: false, error: "Failed to create note", status: 500 };
    }

    return { ok: true, data: mapToNote({ ...row, has_children: false }) };
  } catch (e: unknown) {
    const error = e as { code?: string };
    if (error.code === "23503") {
      return {
        ok: false,
        error: "Notebook or parent note not found",
        status: 404,
      };
    }
    throw e;
  }
};

/**
 * Update a note.
 */
export const update = async (params: { id: string; data: UpdateNote }): Promise<MutationResult<Note>> => {
  const { id, data } = params;

  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Note not found", status: 404 };
  }

  // Check if note is locked
  if (existing.lockedAt) {
    return { ok: false, error: "Cannot modify locked note", status: 403 };
  }

  const title = data.title ?? existing.title;
  const parentId = data.parentId === undefined ? existing.parentId : data.parentId;
  const position = data.position ?? existing.position;

  // Prevent moving note to be its own descendant
  if (parentId !== existing.parentId && parentId !== null) {
    const isDescendant = await checkIsDescendant(id, parentId);
    if (isDescendant) {
      return {
        ok: false,
        error: "Cannot move note to be a child of itself",
        status: 400,
      };
    }
  }

  const [row] = await sql<DbNote[]>`
    UPDATE notebooks.notes
    SET title = ${title},
        parent_id = ${parentId}::uuid, position = ${position}, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, notebook_id, parent_id, title, position,
              yjs_snapshot_at, content_md, created_by, created_at, updated_at
  `;

  if (!row) {
    return { ok: false, error: "Failed to update note", status: 500 };
  }

  // Get hasChildren for the updated note
  const note = await get({ id });
  return { ok: true, data: note! };
};

/**
 * Check if a note is a descendant of another note.
 */
const checkIsDescendant = async (ancestorId: string, descendantId: string): Promise<boolean> => {
  const [result] = await sql<{ is_descendant: boolean }[]>`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM notebooks.notes WHERE id = ${descendantId}::uuid
      UNION ALL
      SELECT n.id, n.parent_id FROM notebooks.notes n
      INNER JOIN ancestors a ON n.id = a.parent_id
    )
    SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = ${ancestorId}::uuid) as is_descendant
  `;
  return result?.is_descendant ?? false;
};

/**
 * Delete a note and all its children.
 */
export const remove = async (params: { id: string }): Promise<MutationResult<void>> => {
  const result = await sql`
    DELETE FROM notebooks.notes
    WHERE id = ${params.id}::uuid
  `;

  if (result.count === 0) {
    return { ok: false, error: "Note not found", status: 404 };
  }

  return { ok: true, data: undefined };
};

/**
 * Move a note to a new position.
 */
export const move = async (params: { id: string; parentId: string | null; position: number }): Promise<MutationResult<Note>> => {
  return update({
    id: params.id,
    data: { parentId: params.parentId, position: params.position },
  });
};

/**
 * Save a note's Yjs state and markdown content.
 * Optionally creates a version entry (skipped if content_md is unchanged).
 */
export const save = async (params: {
  noteId: string;
  yjsState: Uint8Array;
  contentMd?: string;
  createdBy: string | null;
  createVersion?: boolean;
  streamCursor?: string | null;
  requestedAt?: number;
}): Promise<MutationResult<void>> => {
  const { noteId, yjsState, contentMd, createdBy, createVersion = false, streamCursor = null, requestedAt } = params;

  // Check if note is locked
  const locked = await isLocked({ id: noteId });
  if (locked) {
    return { ok: false, error: "Cannot modify locked note", status: 403 };
  }

  const yjsBuffer = Buffer.from(yjsState);

  const parsedCursor = parseStreamCursor(streamCursor);
  const requestedAtSeconds = (requestedAt ?? Date.now()) / 1000;

  const result = parsedCursor
    ? await sql`
        UPDATE notebooks.notes
        SET yjs_snapshot = ${yjsBuffer},
            yjs_stream_ms = ${parsedCursor.ms},
            yjs_stream_seq = ${parsedCursor.seq},
            yjs_snapshot_at = now(),
            content_md = ${contentMd ?? null},
            updated_at = now()
        WHERE id = ${noteId}::uuid
          AND locked_at IS NULL
          AND (
            (yjs_stream_ms IS NULL AND updated_at <= to_timestamp(${requestedAtSeconds}))
            OR yjs_stream_ms < ${parsedCursor.ms}
            OR (yjs_stream_ms = ${parsedCursor.ms} AND COALESCE(yjs_stream_seq, -1) < ${parsedCursor.seq})
          )
      `
    : await sql`
        UPDATE notebooks.notes
        SET yjs_snapshot = ${yjsBuffer},
            yjs_snapshot_at = now(),
            content_md = ${contentMd ?? null},
            updated_at = now()
        WHERE id = ${noteId}::uuid
          AND locked_at IS NULL
      `;

  if (result.count === 0) {
    const [status] = await sql<{ exists: boolean; locked: boolean }[]>`
      SELECT
        EXISTS(SELECT 1 FROM notebooks.notes WHERE id = ${noteId}::uuid) AS exists,
        EXISTS(SELECT 1 FROM notebooks.notes WHERE id = ${noteId}::uuid AND locked_at IS NOT NULL) AS locked
    `;
    if (!status?.exists) {
      return { ok: false, error: "Note not found", status: 404 };
    }
    if (status.locked) {
      return { ok: false, error: "Cannot modify locked note", status: 403 };
    }
    // A newer cursor was already persisted by another node.
    return { ok: true, data: undefined };
  }

  // Optionally create a version entry.
  // This decision is global and DB-backed, so it works consistently across nodes.
  if (createVersion) {
    const insertedVersion = await sql`
      WITH latest AS (
        SELECT content_md, created_at
        FROM notebooks.note_versions
        WHERE note_id = ${noteId}::uuid
        ORDER BY created_at DESC
        LIMIT 1
      )
      INSERT INTO notebooks.note_versions (note_id, yjs_snapshot, content_md, title, created_by)
      SELECT ${noteId}::uuid, ${yjsBuffer}, ${contentMd ?? null}, n.title, ${createdBy}::uuid
      FROM notebooks.notes n
      WHERE n.id = ${noteId}::uuid
        AND (
          NOT EXISTS (SELECT 1 FROM latest)
          OR (
            (SELECT content_md FROM latest) IS DISTINCT FROM ${contentMd ?? null}
            AND (SELECT created_at FROM latest) <= now() - ${VERSION_MIN_INTERVAL}::interval
          )
        )
    `;
    if (insertedVersion.count > 0) {
      // Compact old versions using retention policy:
      // - Keep all versions from last 24 hours
      // - Keep max 1 per hour for days 1-7
      // - Keep max 1 per day for days 7-30
      // - Keep max 1 per week for older
      // - Never exceed 100 total versions
      await sql`
        DELETE FROM notebooks.note_versions
        WHERE note_id = ${noteId}::uuid
          AND id NOT IN (
            SELECT id FROM (
              -- All versions from last 24 hours
              SELECT id, created_at, 1 as priority
              FROM notebooks.note_versions
              WHERE note_id = ${noteId}::uuid
                AND created_at > now() - interval '24 hours'

              UNION ALL

              -- 1 per hour for days 1-7 (newest per hour)
              (SELECT DISTINCT ON (date_trunc('hour', created_at))
                id, created_at, 2 as priority
              FROM notebooks.note_versions
              WHERE note_id = ${noteId}::uuid
                AND created_at <= now() - interval '24 hours'
                AND created_at > now() - interval '7 days'
              ORDER BY date_trunc('hour', created_at), created_at DESC)

              UNION ALL

              -- 1 per day for days 7-30 (newest per day)
              (SELECT DISTINCT ON (date_trunc('day', created_at))
                id, created_at, 3 as priority
              FROM notebooks.note_versions
              WHERE note_id = ${noteId}::uuid
                AND created_at <= now() - interval '7 days'
                AND created_at > now() - interval '30 days'
              ORDER BY date_trunc('day', created_at), created_at DESC)

              UNION ALL

              -- 1 per week for older than 30 days (newest per week)
              (SELECT DISTINCT ON (date_trunc('week', created_at))
                id, created_at, 4 as priority
              FROM notebooks.note_versions
              WHERE note_id = ${noteId}::uuid
                AND created_at <= now() - interval '30 days'
              ORDER BY date_trunc('week', created_at), created_at DESC)
            ) AS kept
            ORDER BY priority, created_at DESC
            LIMIT 100
          )
      `;
    }
  }

  // Refresh the three note-ref indexes (links, tags, attachments) after
  // every successful content write. Cheap and best-effort — a failure
  // here never aborts the save (the periodic scheduler reconciles drift).
  const [refRow] = await sql<{ notebook_id: string }[]>`
    SELECT notebook_id FROM notebooks.notes WHERE id = ${noteId}::uuid
  `;
  if (refRow) {
    await reindexNoteRefsSafe({ noteId, notebookId: refRow.notebook_id, contentMd: contentMd ?? null });
  }

  return { ok: true, data: undefined };
};

/**
 * Get the stored Yjs state for a note.
 */
export const getYjsStateWithCursor = async (params: {
  noteId: string;
}): Promise<{ yjsState: Uint8Array | null; streamCursor: string | null } | null> => {
  const [row] = await sql<DbYjsState[]>`
    SELECT yjs_snapshot, yjs_stream_ms, yjs_stream_seq
    FROM notebooks.notes
    WHERE id = ${params.noteId}::uuid
  `;
  if (!row) return null;
  return {
    yjsState: row.yjs_snapshot ? new Uint8Array(row.yjs_snapshot) : null,
    streamCursor:
      row.yjs_stream_ms !== null && row.yjs_stream_seq !== null
        ? `${row.yjs_stream_ms}-${row.yjs_stream_seq}`
        : null,
  };
};

/**
 * List versions of a note with pagination.
 */
export const listVersions = async (params: {
  noteId: string;
  pagination: PaginationParams;
}): Promise<{ versions: NoteVersion[]; total: number }> => {
  const { noteId, pagination } = params;
  const { offset, perPage } = pagination;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count
    FROM notebooks.note_versions
    WHERE note_id = ${noteId}::uuid
  `;

  const rows = await sql<DbNoteVersion[]>`
    SELECT id, note_id, title, created_by, created_at
    FROM notebooks.note_versions
    WHERE note_id = ${noteId}::uuid
    ORDER BY created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return {
    versions: rows.map(mapToNoteVersion),
    total: countRow?.count ?? 0,
  };
};

/**
 * Get a specific version's snapshot. Scoped by `noteId` so a versionId leaked
 * from another note can't be fetched through any caller-readable note.
 */
export const getVersionSnapshot = async (params: { noteId: string; versionId: string }): Promise<Uint8Array | null> => {
  const [row] = await sql<{ yjs_snapshot: Buffer }[]>`
    SELECT yjs_snapshot FROM notebooks.note_versions
    WHERE id = ${params.versionId}::uuid AND note_id = ${params.noteId}::uuid
  `;

  return row ? new Uint8Array(row.yjs_snapshot) : null;
};

/**
 * Restore a note from a Yjs snapshot (base64).
 * Intended for restoring into a newly created empty note.
 */
export const restoreFromSnapshot = async (params: {
  noteId: string;
  yjsSnapshot: string; // base64
  createdBy: string | null;
}): Promise<MutationResult<Note>> => {
  const { noteId, yjsSnapshot, createdBy } = params;

  const existing = await getWithContent({ id: noteId });
  if (!existing) {
    return { ok: false, error: "Note not found", status: 404 };
  }

  // Check if note is locked
  if (existing.lockedAt) {
    return { ok: false, error: "Cannot restore locked note", status: 403 };
  }

  const currentContent = existing.contentMd ?? "";
  let hasContent = currentContent.trim().length > 0;
  if (!hasContent && existing.yjsSnapshot) {
    const currentDoc = new Y.Doc();
    try {
      Y.applyUpdate(currentDoc, Buffer.from(existing.yjsSnapshot, "base64"));
      hasContent = currentDoc.getText("codemirror").toString().trim().length > 0;
    } catch {
      hasContent = true;
    } finally {
      currentDoc.destroy();
    }
  }
  if (hasContent) {
    return {
      ok: false,
      error: "Restore only supports new empty notes. Create a new note and restore there.",
      status: 400,
    };
  }

  // Decode new snapshot and extract markdown for note row + version history.
  const snapshotBuffer = Buffer.from(yjsSnapshot, "base64");
  const restoreStreamMs = Date.now();
  // Keep restore cursor dominant even on same-ms collisions with stream entries.
  const restoreStreamSeq = Number.MAX_SAFE_INTEGER;
  let restoredContentMd: string | null = null;
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(snapshotBuffer));
    restoredContentMd = doc.getText("codemirror").toString();
    doc.destroy();
  } catch {
    restoredContentMd = null;
  }

  const result = await sql`
    UPDATE notebooks.notes
    SET yjs_snapshot = ${snapshotBuffer},
        yjs_stream_ms = ${restoreStreamMs},
        yjs_stream_seq = ${restoreStreamSeq},
        yjs_snapshot_at = now(),
        content_md = ${restoredContentMd},
        updated_at = now()
    WHERE id = ${noteId}::uuid
  `;

  if (result.count === 0) {
    return { ok: false, error: "Failed to restore snapshot", status: 500 };
  }

  // Record the restored state as a fresh version entry so restore actions
  // appear explicitly in version history.
  await sql`
    INSERT INTO notebooks.note_versions (note_id, yjs_snapshot, content_md, title, created_by)
    VALUES (${noteId}::uuid, ${snapshotBuffer}, ${restoredContentMd}, ${existing.title}, ${createdBy}::uuid)
  `;

  // Restored content can carry a different set of refs (links, tags,
  // attachments) than was previously indexed — refresh all three.
  await reindexNoteRefsSafe({ noteId, notebookId: existing.notebookId, contentMd: restoredContentMd });

  const updated = await get({ id: noteId });
  return { ok: true, data: updated! };
};

/**
 * Get a version's snapshot with content_md. Scoped by `noteId` (see
 * `getVersionSnapshot`).
 */
export const getVersionWithContent = async (params: {
  noteId: string;
  versionId: string;
}): Promise<{ yjsSnapshot: Uint8Array; contentMd: string | null } | null> => {
  const [row] = await sql<{ yjs_snapshot: Buffer; content_md: string | null }[]>`
    SELECT yjs_snapshot, content_md FROM notebooks.note_versions
    WHERE id = ${params.versionId}::uuid AND note_id = ${params.noteId}::uuid
  `;

  return row
    ? {
        yjsSnapshot: new Uint8Array(row.yjs_snapshot),
        contentMd: row.content_md,
      }
    : null;
};

/**
 * Search notes by title or content within a notebook with pagination.
 */
export const search = async (params: {
  notebookId: string;
  query: string;
  pagination: PaginationParams;
}): Promise<{ notes: Note[]; total: number }> => {
  const { notebookId, query, pagination } = params;
  const { offset, perPage } = pagination;
  const pattern = `%${query}%`;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count
    FROM notebooks.notes n
    WHERE n.notebook_id = ${notebookId}::uuid
      AND (n.title ILIKE ${pattern} OR n.content_md ILIKE ${pattern})
  `;

  const rows = await sql<DbNote[]>`
    SELECT
      n.id, n.short_id, n.notebook_id, n.parent_id, n.title, n.position,
      n.yjs_snapshot_at, n.content_md, n.created_by, n.created_at, n.updated_at, n.locked_at,
      EXISTS(SELECT 1 FROM notebooks.notes c WHERE c.parent_id = n.id) as has_children
    FROM notebooks.notes n
    WHERE n.notebook_id = ${notebookId}::uuid
      AND (n.title ILIKE ${pattern} OR n.content_md ILIKE ${pattern})
    ORDER BY
      CASE WHEN n.title ILIKE ${pattern} THEN 0 ELSE 1 END,
      n.updated_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return {
    notes: rows.map(mapToNote),
    total: countRow?.count ?? 0,
  };
};

/**
 * Copy a note to another notebook.
 */
export const copyToNotebook = async (params: {
  noteId: string;
  targetNotebookId: string;
  targetParentId?: string | null;
  creatorId: string | null;
}): Promise<MutationResult<Note>> => {
  const { noteId, targetNotebookId, targetParentId, creatorId } = params;

  const source = await getWithContent({ id: noteId });
  if (!source) {
    return { ok: false, error: "Source note not found", status: 404 };
  }

  // Create the copy
  const result = await create({
    data: {
      notebookId: targetNotebookId,
      parentId: targetParentId ?? undefined,
      title: source.title,
    },
    creatorId,
  });

  if (!result.ok) {
    return result;
  }

  // Copy the content if exists
  if (source.yjsSnapshot) {
    const snapshotBuffer = Buffer.from(source.yjsSnapshot, "base64");
    await sql`
      UPDATE notebooks.notes
      SET yjs_snapshot = ${snapshotBuffer}, yjs_snapshot_at = now(),
          content_md = ${source.contentMd ?? null}
      WHERE id = ${result.data.id}::uuid
    `;
    // The copy carries the source's refs (outgoing links + tags +
    // attachment URLs) — index them so the new note shows up where
    // appropriate. `targetNotebookId` is the destination notebook.
    await reindexNoteRefsSafe({
      noteId: result.data.id,
      notebookId: params.targetNotebookId,
      contentMd: source.contentMd ?? null,
    });
  }

  return result;
};
