import { sql } from "bun";
import * as Y from "yjs";
import type { MutationResult } from "@valentinkolb/cloud/contracts/shared";
import { hasPermission, type PermissionLevel } from "@valentinkolb/cloud/lib/server";
import { getNotebookPermission, grantNotebookAccess } from "./access";
import * as notes from "./notes";
import helloMd from "./hello.md" with { type: "text" };

// ==========================
// Types
// ==========================

export type Notebook = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
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
};

type DbNotebook = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
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
 * Escapes group CN values into a Postgres `text[]` literal for notebook access filters.
 */
const toPgTextArray = (values: string[]): string => `{${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")}}`;

/**
 * Converts one `notebooks.notebooks` row into the API-facing `Notebook` model.
 */
const mapToNotebook = (row: DbNotebook): Notebook => ({
  id: row.id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapToNotebookAdminItem = (row: DbNotebookAdmin): NotebookAdminListItem => ({
  ...mapToNotebook(row),
  permissionCount: row.permission_count,
});

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
export const list = async (params: { userId: string | null; groups: string[] }): Promise<Notebook[]> => {
  const { userId, groups } = params;

  const rows = await sql<DbNotebook[]>`
    SELECT DISTINCT n.id, n.name, n.description, n.icon, n.created_by, n.created_at, n.updated_at
    FROM notebooks.notebooks n
    LEFT JOIN notebooks.notebook_access na ON n.id = na.notebook_id
    LEFT JOIN auth.access a ON na.access_id = a.id
    WHERE
      a.user_id = ${userId}::uuid
      OR a.group_cn = ANY(${toPgTextArray(groups)}::text[])
      OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
      OR (a.user_id IS NULL AND a.group_cn IS NULL AND a.authenticated_only = false)
    ORDER BY n.name
  `;

  return rows.map(mapToNotebook);
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
      n.name,
      n.description,
      n.icon,
      n.created_by,
      n.created_at,
      n.updated_at,
      COUNT(na.access_id)::int AS permission_count
    FROM notebooks.notebooks n
    LEFT JOIN notebooks.notebook_access na ON na.notebook_id = n.id
    WHERE (
      ${pattern}::text IS NULL
      OR LOWER(n.name) LIKE ${pattern}
    )
    GROUP BY n.id, n.name, n.description, n.icon, n.created_by, n.created_at, n.updated_at
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
 * Get a notebook by ID.
 */
export const get = async (params: { id: string }): Promise<Notebook | null> => {
  const [row] = await sql<DbNotebook[]>`
    SELECT id, name, description, icon, created_by, created_at, updated_at
    FROM notebooks.notebooks
    WHERE id = ${params.id}::uuid
  `;
  return row ? mapToNotebook(row) : null;
};

/**
 * Create a new notebook.
 * Automatically grants admin access to the creator.
 */
export const create = async (params: { data: CreateNotebook; creatorId: string }): Promise<MutationResult<Notebook>> => {
  const { data, creatorId } = params;

  const [row] = await sql<DbNotebook[]>`
    INSERT INTO notebooks.notebooks (name, description, icon, created_by)
    VALUES (${data.name}, ${data.description ?? null}, ${data.icon ?? null}, ${creatorId}::uuid)
    RETURNING id, name, description, icon, created_by, created_at, updated_at
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

  // Create a welcome note with markdown content
  const noteResult = await notes.create({
    data: {
      notebookId: row.id,
      title: "Welcome",
    },
    creatorId,
  });

  if (noteResult.ok) {
    // Create a Yjs doc with the markdown content
    const doc = new Y.Doc();
    doc.getText("codemirror").insert(0, helloMd);
    const snapshot = Y.encodeStateAsUpdate(doc);
    doc.destroy();

    await notes.save({
      noteId: noteResult.data.id,
      yjsState: snapshot,
      contentMd: helloMd,
      createdBy: creatorId,
    });
  }

  return { ok: true, data: mapToNotebook(row) };
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

  const [row] = await sql<DbNotebook[]>`
    UPDATE notebooks.notebooks
    SET name = ${name}, description = ${description}, icon = ${icon}, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, name, description, icon, created_by, created_at, updated_at
  `;

  if (!row) {
    return { ok: false, error: "Failed to update notebook", status: 500 };
  }

  return { ok: true, data: mapToNotebook(row) };
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

  return { ok: true, data: undefined };
};
