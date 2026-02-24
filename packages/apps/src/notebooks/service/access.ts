import { sql } from "bun";
import { err, fail, ok, type Result } from "@valentinkolb/cloud/lib/server";
import {
  type AccessEntry,
  type PermissionLevel,
  type Principal,
  type ResourceAccessAdapter,
  createAccess,
  deleteAccess,
  resolveDisplayNames,
  getEffectivePermission,
} from "@valentinkolb/cloud/lib/server";

// ==========================
// Notebook Access Adapter
// ==========================

type DbNotebookAccess = {
  access_id: string;
  user_id: string | null;
  group_cn: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date;
};

/**
 * List all access entries for a notebook with resolved display names.
 */
export const listNotebookAccess = async (notebookId: string): Promise<AccessEntry[]> => {
  const rows = await sql<DbNotebookAccess[]>`
    SELECT
      a.id as access_id,
      a.user_id,
      a.group_cn,
      a.authenticated_only,
      a.permission,
      a.created_at
    FROM notebooks.notebook_access na
    JOIN auth.access a ON na.access_id = a.id
    WHERE na.notebook_id = ${notebookId}::uuid
    ORDER BY
      CASE
        WHEN a.user_id IS NULL AND a.group_cn IS NULL AND a.authenticated_only = false THEN 4
        WHEN a.authenticated_only THEN 3
        WHEN a.group_cn IS NOT NULL THEN 2
        ELSE 1
      END,
      a.created_at
  `;

  const entries: AccessEntry[] = rows.map((row) => ({
    id: row.access_id,
    principal: row.user_id
      ? { type: "user" as const, userId: row.user_id }
      : row.group_cn
        ? { type: "group" as const, groupCn: row.group_cn }
        : row.authenticated_only
          ? { type: "authenticated" as const }
          : { type: "public" as const },
    permission: row.permission,
    createdAt: row.created_at.toISOString(),
  }));

  return resolveDisplayNames(entries);
};

/**
 * Add an access entry to a notebook.
 */
export const addNotebookAccess = async (notebookId: string, accessId: string): Promise<Result<void>> => {
  try {
    await sql`
      INSERT INTO notebooks.notebook_access (notebook_id, access_id)
      VALUES (${notebookId}::uuid, ${accessId}::uuid)
    `;
    return ok();
  } catch (e: unknown) {
    const error = e as { code?: string };
    if (error.code === "23505") {
      return fail(err.conflict("Access entry"));
    }
    if (error.code === "23503") {
      return fail(err.notFound("Notebook or access entry"));
    }
    throw e;
  }
};

/**
 * Remove an access entry from a notebook.
 * Also deletes the auth.access entry (CASCADE will handle junction).
 */
export const removeNotebookAccess = async (notebookId: string, accessId: string): Promise<Result<void>> => {
  const [exists] = await sql<{ access_id: string }[]>`
    SELECT access_id FROM notebooks.notebook_access
    WHERE notebook_id = ${notebookId}::uuid AND access_id = ${accessId}::uuid
  `;

  if (!exists) {
    return fail(err.notFound("Access entry for this notebook"));
  }

  return deleteAccess({ id: accessId });
};

/**
 * Count access entries for a notebook.
 */
export const countNotebookAccess = async (notebookId: string): Promise<number> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count
    FROM notebooks.notebook_access
    WHERE notebook_id = ${notebookId}::uuid
  `;
  return row?.count ?? 0;
};

/**
 * Read guard information needed for safe access updates/removals.
 */
export const getNotebookAccessGuard = async (params: {
  notebookId: string;
  accessId: string;
}): Promise<{
  total: number;
  otherAdmins: number;
  currentPermission: PermissionLevel | null;
}> => {
  const [row] = await sql<
    {
      total: number;
      other_admins: number;
      current_permission: PermissionLevel | null;
    }[]
  >`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (
        WHERE a.permission = 'admin'::auth.permission_level
          AND a.id <> ${params.accessId}::uuid
      )::int as other_admins,
      MAX(CASE WHEN a.id = ${params.accessId}::uuid THEN a.permission END) as current_permission
    FROM notebooks.notebook_access na
    JOIN auth.access a ON na.access_id = a.id
    WHERE na.notebook_id = ${params.notebookId}::uuid
  `;

  return {
    total: row?.total ?? 0,
    otherAdmins: row?.other_admins ?? 0,
    currentPermission: row?.current_permission ?? null,
  };
};

/**
 * Get the effective permission level for a user on a notebook.
 */
export const getNotebookPermission = async (params: {
  notebookId: string;
  userId: string | null;
  userGroups: string[];
}): Promise<PermissionLevel> => {
  const { notebookId, userId, userGroups } = params;

  const accessRows = await sql<{ access_id: string }[]>`
    SELECT access_id FROM notebooks.notebook_access
    WHERE notebook_id = ${notebookId}::uuid
  `;

  const accessIds = accessRows.map((r) => r.access_id);

  return getEffectivePermission({ accessIds, userId, userGroups });
};

/**
 * Create a new access entry and add it to a notebook.
 */
export const grantNotebookAccess = async (params: {
  notebookId: string;
  principal: Principal;
  permission: PermissionLevel;
}): Promise<Result<AccessEntry>> => {
  const { notebookId, principal, permission } = params;

  // Check for duplicate principal
  const existing = await listNotebookAccess(notebookId);
  const duplicate = existing.find((e) => {
    if (principal.type === "public" && e.principal.type === "public") return true;
    if (principal.type === "authenticated" && e.principal.type === "authenticated") return true;
    if (principal.type === "user" && e.principal.type === "user" && principal.userId === e.principal.userId) return true;
    if (principal.type === "group" && e.principal.type === "group" && principal.groupCn === e.principal.groupCn) return true;
    return false;
  });

  if (duplicate) {
    return fail({
      code: "CONFLICT",
      message: "This principal already has access to this notebook",
      status: 409,
    });
  }

  const createResult = await createAccess({ principal, permission });
  if (!createResult.ok) return createResult;

  const linkResult = await addNotebookAccess(notebookId, createResult.data.id);
  if (!linkResult.ok) {
    await deleteAccess({ id: createResult.data.id });
    return linkResult;
  }

  const entries = await listNotebookAccess(notebookId);
  const created = entries.find((e) => e.id === createResult.data.id);

  if (!created) {
    return fail(err.internal("Failed to retrieve created access entry"));
  }

  return ok(created);
};

/**
 * ResourceAccessAdapter implementation for notebooks.
 */
export const notebookAccessAdapter: ResourceAccessAdapter = {
  list: listNotebookAccess,
  add: addNotebookAccess,
  remove: removeNotebookAccess,
  count: countNotebookAccess,
};
