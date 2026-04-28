import { sql } from "bun";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import {
  type AccessEntry,
  type PermissionLevel,
  type Principal,
  type ResourceAccessAdapter,
  createAccess,
  deleteAccess,
  resolveDisplayNames,
  getEffectivePermission,
} from "@valentinkolb/cloud/server";

// ==========================
// Space Access Adapter
// ==========================

type DbSpaceAccess = {
  access_id: string;
  user_id: string | null;
  group_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date;
};

/**
 * List all access entries for a space with resolved display names.
 */
export const listSpaceAccess = async (spaceId: string): Promise<AccessEntry[]> => {
  const rows = await sql<DbSpaceAccess[]>`
    SELECT
      a.id as access_id,
      a.user_id,
      a.group_id,
      a.authenticated_only,
      a.permission,
      a.created_at
    FROM spaces.space_access sa
    JOIN auth.access a ON sa.access_id = a.id
    WHERE sa.space_id = ${spaceId}::uuid
    ORDER BY
      CASE
        WHEN a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = false THEN 4
        WHEN a.authenticated_only THEN 3
        WHEN a.group_id IS NOT NULL THEN 2
        ELSE 1
      END,
      a.created_at
  `;

  const entries: AccessEntry[] = rows.map((row) => ({
    id: row.access_id,
    principal: row.user_id
      ? { type: "user" as const, userId: row.user_id }
      : row.group_id
        ? { type: "group" as const, groupId: row.group_id }
        : row.authenticated_only
          ? { type: "authenticated" as const }
          : { type: "public" as const },
    permission: row.permission,
    createdAt: row.created_at.toISOString(),
  }));

  return resolveDisplayNames(entries);
};

/**
 * Add an access entry to a space.
 */
export const addSpaceAccess = async (spaceId: string, accessId: string): Promise<Result<void>> => {
  try {
    await sql`
      INSERT INTO spaces.space_access (space_id, access_id)
      VALUES (${spaceId}::uuid, ${accessId}::uuid)
    `;
    return ok();
  } catch (e: unknown) {
    const error = e as { code?: string };
    if (error.code === "23505") {
      // unique_violation
      return fail(err.conflict("Access entry"));
    }
    if (error.code === "23503") {
      // foreign_key_violation
      return fail(err.notFound("Space or access entry"));
    }
    throw e;
  }
};

/**
 * Remove an access entry from a space.
 * Also deletes the auth.access entry (CASCADE will handle junction).
 */
export const removeSpaceAccess = async (spaceId: string, accessId: string): Promise<Result<void>> => {
  // First verify it belongs to this space
  const [exists] = await sql<{ access_id: string }[]>`
    SELECT access_id FROM spaces.space_access
    WHERE space_id = ${spaceId}::uuid AND access_id = ${accessId}::uuid
  `;

  if (!exists) {
    return fail(err.notFound("Access entry for this space"));
  }

  // Delete the auth.access entry (CASCADE will remove junction row)
  return deleteAccess({ id: accessId });
};

/**
 * Count access entries for a space.
 */
export const countSpaceAccess = async (spaceId: string): Promise<number> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count
    FROM spaces.space_access
    WHERE space_id = ${spaceId}::uuid
  `;
  return row?.count ?? 0;
};

/**
 * Read guard information needed for safe access updates/removals.
 */
export const getSpaceAccessGuard = async (params: {
  spaceId: string;
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
    FROM spaces.space_access sa
    JOIN auth.access a ON sa.access_id = a.id
    WHERE sa.space_id = ${params.spaceId}::uuid
  `;

  return {
    total: row?.total ?? 0,
    otherAdmins: row?.other_admins ?? 0,
    currentPermission: row?.current_permission ?? null,
  };
};

/**
 * Get the effective permission level for a user on a space.
 */
export const getSpacePermission = async (params: {
  spaceId: string;
  userId: string | null;
  userGroups: string[];
}): Promise<PermissionLevel> => {
  const { spaceId, userId, userGroups } = params;

  // Get all access IDs for this space
  const accessRows = await sql<{ access_id: string }[]>`
    SELECT access_id FROM spaces.space_access
    WHERE space_id = ${spaceId}::uuid
  `;

  const accessIds = accessRows.map((r) => r.access_id);

  return getEffectivePermission({ accessIds, userId, userGroups });
};

/**
 * Create a new access entry and add it to a space.
 * Combined operation for convenience.
 */
export const grantSpaceAccess = async (params: {
  spaceId: string;
  principal: Principal;
  permission: PermissionLevel;
}): Promise<Result<AccessEntry>> => {
  const { spaceId, principal, permission } = params;

  // Check for duplicate principal on this space
  const existing = await listSpaceAccess(spaceId);
  const duplicate = existing.find((e) => {
    if (principal.type === "public" && e.principal.type === "public") return true;
    if (principal.type === "authenticated" && e.principal.type === "authenticated") return true;
    if (principal.type === "user" && e.principal.type === "user" && principal.userId === e.principal.userId) return true;
    if (principal.type === "group" && e.principal.type === "group" && principal.groupId === e.principal.groupId) return true;
    return false;
  });

  if (duplicate) {
    return fail({
      code: "CONFLICT",
      message: "This principal already has access to this space",
      status: 409,
    });
  }

  // Create access entry
  const createResult = await createAccess({ principal, permission });
  if (!createResult.ok) return createResult;

  // Link to space
  const linkResult = await addSpaceAccess(spaceId, createResult.data.id);
  if (!linkResult.ok) {
    // Cleanup: delete the orphaned access entry
    await deleteAccess({ id: createResult.data.id });
    return linkResult;
  }

  // Return the created entry with display name
  const entries = await listSpaceAccess(spaceId);
  const created = entries.find((e) => e.id === createResult.data.id);

  if (!created) {
    return fail(err.internal("Failed to retrieve created access entry"));
  }

  return ok(created);
};

/**
 * ResourceAccessAdapter implementation for spaces.
 */
export const spaceAccessAdapter: ResourceAccessAdapter = {
  list: listSpaceAccess,
  add: addSpaceAccess,
  remove: removeSpaceAccess,
  count: countSpaceAccess,
};
