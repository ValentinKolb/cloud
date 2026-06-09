import { sql } from "bun";
import type { MutationResult } from "@valentinkolb/cloud/contracts";
import { hasPermission, type PermissionLevel } from "@valentinkolb/cloud/server";
import { getNotebookPermission, grantNotebookAccess } from "./access";
import * as notes from "./notes";
import { invalidated, notebookUpdated } from "./workspace-events";
import { generateUniqueShortId, isShortId } from "../lib/short-id";
import helloMd from "./hello.md" with { type: "text" };

// ==========================
// Types
// ==========================

export type Notebook = {
  id: string;
  shortId: string;
  name: string;
  description: string | null;
  icon: string | null;
  homepageNoteId: string | null;
  homepageNoteShortId: string | null;
  /** Per-notebook opt-in for the JS scripting feature. Default false.
   *  Only notebook admins can flip this; the editor consults this flag
   *  before evaluating any `\`\`\`script` blocks. */
  scriptsEnabled: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateNotebook = {
  name: string;
  description?: string;
  icon?: string;
};

export type UpdateNotebook = {
  name?: string;
  description?: string | null;
  icon?: string | null;
  homepageNoteId?: string | null;
  scriptsEnabled?: boolean;
};

type DbNotebook = {
  id: string;
  short_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  homepage_note_id: string | null;
  homepage_note_short_id: string | null;
  scripts_enabled: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

type DbNotebookAdmin = DbNotebook & {
  permission_count: number;
};

export type NotebookAdminListItem = Notebook & {
  permissionCount: number;
};

// ==========================
// Helpers
// ==========================

/**
 * Escapes group IDs into a Postgres `uuid[]` literal for notebook access filters.
 */
const toPgUuidArray = (values: string[] | null | undefined): string => {
  if (!Array.isArray(values) || values.length === 0) return "{}";
  return `{${values.join(",")}}`;
};

/**
 * Converts one `notebooks.notebooks` row into the API-facing `Notebook` model.
 */
const mapToNotebook = (row: DbNotebook): Notebook => ({
  id: row.id,
  shortId: row.short_id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  homepageNoteId: row.homepage_note_id,
  homepageNoteShortId: row.homepage_note_short_id,
  scriptsEnabled: row.scripts_enabled,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapToNotebookAdminItem = (row: DbNotebookAdmin): NotebookAdminListItem => ({
  ...mapToNotebook(row),
  permissionCount: row.permission_count,
});

const noteExistsInNotebook = async (noteId: string, notebookId: string): Promise<boolean> => {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM notebooks.notes
      WHERE id = ${noteId}::uuid
        AND notebook_id = ${notebookId}::uuid
    ) AS exists
  `;
  return row?.exists ?? false;
};

// ==========================
// Service
// ==========================

/**
 * Check if user has access to a notebook.
 */
export const canAccess = async (params: {
  notebookId: string;
  userId: string | null;
  userGroups: string[];
  requiredLevel?: PermissionLevel;
}): Promise<boolean> => {
  const { notebookId, userId, userGroups, requiredLevel = "read" } = params;
  const permission = await getNotebookPermission({ notebookId, userId, userGroups });
  return hasPermission(permission, requiredLevel);
};

/**
 * Get the effective permission level for a user on a notebook.
 */
export const getPermission = async (params: {
  notebookId: string;
  userId: string | null;
  userGroups: string[];
}): Promise<PermissionLevel> => {
  return getNotebookPermission(params);
};

/**
 * List all notebooks accessible to a user.
 */
export const list = async (params: {
  userId: string | null;
  groups: string[];
  query?: string;
  pagination?: { limit: number; offset: number };
}): Promise<{ items: Notebook[]; total: number }> => {
  const { userId } = params;
  const groups = params.groups ?? [];
  const query = params.query?.trim().toLowerCase();
  const pattern = query && query.length > 0 ? `%${query}%` : null;

  const rows =
    params.pagination === undefined
      ? await sql<DbNotebook[]>`
          SELECT
            n.id,
            n.short_id,
            n.name,
            n.description,
            n.icon,
            n.homepage_note_id,
            h.short_id AS homepage_note_short_id,
            n.scripts_enabled,
            n.created_by,
            n.created_at,
            n.updated_at
          FROM notebooks.notebooks n
          LEFT JOIN notebooks.notes h ON h.id = n.homepage_note_id
          WHERE EXISTS (
            SELECT 1
            FROM notebooks.notebook_access na
            JOIN auth.access a ON a.id = na.access_id
            WHERE na.notebook_id = n.id
              AND (
                a.user_id = ${userId}::uuid
                OR a.group_id = ANY(${toPgUuidArray(groups)}::uuid[])
                OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
                OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
              )
          )
            AND (
              ${pattern}::text IS NULL
              OR LOWER(n.name) LIKE ${pattern}
              OR LOWER(COALESCE(n.description, '')) LIKE ${pattern}
            )
          ORDER BY LOWER(n.name) ASC, n.created_at ASC
        `
      : await sql<DbNotebook[]>`
          SELECT
            n.id,
            n.short_id,
            n.name,
            n.description,
            n.icon,
            n.homepage_note_id,
            h.short_id AS homepage_note_short_id,
            n.scripts_enabled,
            n.created_by,
            n.created_at,
            n.updated_at
          FROM notebooks.notebooks n
          LEFT JOIN notebooks.notes h ON h.id = n.homepage_note_id
          WHERE EXISTS (
            SELECT 1
            FROM notebooks.notebook_access na
            JOIN auth.access a ON a.id = na.access_id
            WHERE na.notebook_id = n.id
              AND (
                a.user_id = ${userId}::uuid
                OR a.group_id = ANY(${toPgUuidArray(groups)}::uuid[])
                OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
                OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
              )
          )
            AND (
              ${pattern}::text IS NULL
              OR LOWER(n.name) LIKE ${pattern}
              OR LOWER(COALESCE(n.description, '')) LIKE ${pattern}
            )
          ORDER BY LOWER(n.name) ASC, n.created_at ASC
          LIMIT ${params.pagination.limit}
          OFFSET ${params.pagination.offset}
        `;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM notebooks.notebooks n
    WHERE EXISTS (
      SELECT 1
      FROM notebooks.notebook_access na
      JOIN auth.access a ON a.id = na.access_id
      WHERE na.notebook_id = n.id
        AND (
          a.user_id = ${userId}::uuid
          OR a.group_id = ANY(${toPgUuidArray(groups)}::uuid[])
          OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
          OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
        )
    )
      AND (
        ${pattern}::text IS NULL
        OR LOWER(n.name) LIKE ${pattern}
        OR LOWER(COALESCE(n.description, '')) LIKE ${pattern}
      )
  `;

  return {
    items: rows.map(mapToNotebook),
    total: countRow?.count ?? 0,
  };
};

/**
 * List all notebooks for admin pages with a permission-entry count.
 */
export const listAdmin = async (params: {
  search?: string;
  pagination: { limit: number; offset: number };
}): Promise<{ items: NotebookAdminListItem[]; total: number }> => {
  const query = params.search?.trim().toLowerCase();
  const pattern = query && query.length > 0 ? `%${query}%` : null;

  const rows = await sql<DbNotebookAdmin[]>`
    SELECT
      n.id,
      n.short_id,
      n.name,
      n.description,
      n.icon,
      n.homepage_note_id,
      h.short_id AS homepage_note_short_id,
      n.scripts_enabled,
      n.created_by,
      n.created_at,
      n.updated_at,
      COUNT(na.access_id)::int AS permission_count
    FROM notebooks.notebooks n
    LEFT JOIN notebooks.notebook_access na ON na.notebook_id = n.id
    LEFT JOIN notebooks.notes h ON h.id = n.homepage_note_id
    WHERE (
      ${pattern}::text IS NULL
      OR LOWER(n.name) LIKE ${pattern}
    )
    GROUP BY n.id, n.short_id, n.name, n.description, n.icon, n.homepage_note_id, h.short_id, n.scripts_enabled, n.created_by, n.created_at, n.updated_at
    ORDER BY LOWER(n.name) ASC, n.created_at ASC
    LIMIT ${params.pagination.limit}
    OFFSET ${params.pagination.offset}
  `;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM notebooks.notebooks n
    WHERE (
      ${pattern}::text IS NULL
      OR LOWER(n.name) LIKE ${pattern}
    )
  `;

  return {
    items: rows.map(mapToNotebookAdminItem),
    total: countRow?.count ?? 0,
  };
};

/**
 * Aggregated admin stats — single SQL roundtrip. Filtered by `search` so the
 * numbers match what the admin sees in the table. Counted in the DB, NOT in
 * the page-bound items array (which only sees the visible page).
 */
export const adminSummary = async (params: { search?: string }): Promise<{
  total: number;
  orphaned: number;
  totalPermissions: number;
}> => {
  const query = params.search?.trim().toLowerCase();
  const pattern = query && query.length > 0 ? `%${query}%` : null;

  const [row] = await sql<{ total: number; orphaned: number; total_permissions: number }[]>`
    WITH filtered AS (
      SELECT n.id, COUNT(na.access_id)::int AS permission_count
      FROM notebooks.notebooks n
      LEFT JOIN notebooks.notebook_access na ON na.notebook_id = n.id
      WHERE (${pattern}::text IS NULL OR LOWER(n.name) LIKE ${pattern})
      GROUP BY n.id
    )
    SELECT
      COUNT(*)::int                                             AS total,
      COUNT(*) FILTER (WHERE permission_count = 0)::int         AS orphaned,
      COALESCE(SUM(permission_count), 0)::int                   AS total_permissions
    FROM filtered
  `;
  return {
    total: row?.total ?? 0,
    orphaned: row?.orphaned ?? 0,
    totalPermissions: row?.total_permissions ?? 0,
  };
};

/**
 * Get a notebook by ID.
 */
export const get = async (params: { id: string }): Promise<Notebook | null> => {
  const [row] = await sql<DbNotebook[]>`
    SELECT
      n.id,
      n.short_id,
      n.name,
      n.description,
      n.icon,
      n.homepage_note_id,
      h.short_id AS homepage_note_short_id,
      n.scripts_enabled,
      n.created_by,
      n.created_at,
      n.updated_at
    FROM notebooks.notebooks n
    LEFT JOIN notebooks.notes h ON h.id = n.homepage_note_id
    WHERE n.id = ${params.id}::uuid
  `;
  return row ? mapToNotebook(row) : null;
};

/**
 * Resolve a notebook by either UUID or short-id. The format-detection
 * branch keeps each query on its own single-column index — no
 * `OR`-walk across two indexes. Used at the page-handler boundary so
 * URL routes can carry short-ids while the service layer below stays
 * UUID-driven.
 */
export const getByIdOrShortId = async (params: { idOrShortId: string }): Promise<Notebook | null> => {
  const v = params.idOrShortId;
  if (isShortId(v)) {
    const [row] = await sql<DbNotebook[]>`
      SELECT
        n.id,
        n.short_id,
        n.name,
        n.description,
        n.icon,
        n.homepage_note_id,
        h.short_id AS homepage_note_short_id,
        n.scripts_enabled,
        n.created_by,
        n.created_at,
        n.updated_at
      FROM notebooks.notebooks n
      LEFT JOIN notebooks.notes h ON h.id = n.homepage_note_id
      WHERE n.short_id = ${v}
    `;
    return row ? mapToNotebook(row) : null;
  }
  return get({ id: v });
};

/**
 * Create a new notebook.
 * Automatically grants admin access to the creator.
 */
export const create = async (params: {
  data: CreateNotebook;
  creatorId: string;
  seedWelcome?: boolean;
}): Promise<MutationResult<Notebook>> => {
  const { data, creatorId } = params;
  const seedWelcome = params.seedWelcome ?? true;

  const shortId = await generateUniqueShortId("notebook");
  const [row] = await sql<DbNotebook[]>`
    INSERT INTO notebooks.notebooks (short_id, name, description, icon, created_by)
    VALUES (${shortId}, ${data.name}, ${data.description ?? null}, ${data.icon ?? null}, ${creatorId}::uuid)
    RETURNING
      id,
      short_id,
      name,
      description,
      icon,
      homepage_note_id,
      NULL::text AS homepage_note_short_id,
      scripts_enabled,
      created_by,
      created_at,
      updated_at
  `;

  if (!row) {
    return { ok: false, error: "Failed to create notebook", status: 500 };
  }

  // Grant admin access to the creator
  await grantNotebookAccess({
    notebookId: row.id,
    principal: { type: "user", userId: creatorId },
    permission: "admin",
  });

  if (seedWelcome) {
    await notes.create({
      data: {
        notebookId: row.id,
        title: "Welcome",
        contentMd: helloMd,
      },
      creatorId,
    });
  }

  const notebook = mapToNotebook(row);
  await notebookUpdated(notebook);
  return { ok: true, data: notebook };
};

/**
 * Update a notebook.
 */
export const update = async (params: { id: string; data: UpdateNotebook }): Promise<MutationResult<Notebook>> => {
  const { id, data } = params;

  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Notebook not found", status: 404 };
  }

  const name = data.name ?? existing.name;
  const description = data.description === undefined ? existing.description : data.description;
  const icon = data.icon === undefined ? existing.icon : data.icon;
  const homepageNoteId = data.homepageNoteId === undefined ? existing.homepageNoteId : data.homepageNoteId;
  const scriptsEnabled = data.scriptsEnabled ?? existing.scriptsEnabled;

  if (homepageNoteId && !(await noteExistsInNotebook(homepageNoteId, id))) {
    return { ok: false, error: "Homepage note not found", status: 404 };
  }

  const [row] = await sql<DbNotebook[]>`
    UPDATE notebooks.notebooks
    SET name = ${name},
        description = ${description},
        icon = ${icon},
        homepage_note_id = ${homepageNoteId}::uuid,
        scripts_enabled = ${scriptsEnabled},
        updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING
      id,
      short_id,
      name,
      description,
      icon,
      homepage_note_id,
      NULL::text AS homepage_note_short_id,
      scripts_enabled,
      created_by,
      created_at,
      updated_at
  `;

  if (!row) {
    return { ok: false, error: "Failed to update notebook", status: 500 };
  }

  const notebook = (await get({ id: row.id })) ?? mapToNotebook(row);
  await notebookUpdated(notebook);
  return { ok: true, data: notebook };
};

/**
 * Delete a notebook.
 */
export const remove = async (params: { id: string }): Promise<MutationResult<void>> => {
  const result = await sql`
    DELETE FROM notebooks.notebooks
    WHERE id = ${params.id}::uuid
  `;

  if (result.count === 0) {
    return { ok: false, error: "Notebook not found", status: 404 };
  }

  await invalidated({ notebookId: params.id, reason: "bulk", scopes: ["notebook", "tree", "tags", "references", "permissions"] });
  return { ok: true, data: undefined };
};
