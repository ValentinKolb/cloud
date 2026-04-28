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

/**
 * Access-control adapter for expeditions.
 *
 * The platform stores all permission grants in `auth.access` (one row per
 * principal+permission). Each app keeps its own junction table linking
 * resources to those grants. This file is the adapter glue that the cloud
 * lib's `PermissionEditor`, `getEffectivePermission` etc. plug into.
 *
 * Member resolution follows the same rules as spaces / notebooks:
 *   - direct user grant
 *   - group grant (inherited by every group member)
 *   - "authenticated" → any signed-in user
 *   - "public"        → anyone (incl. anonymous)
 */

type DbExpeditionAccess = {
  access_id: string;
  user_id: string | null;
  group_id: string | null;
  authenticated_only: boolean;
  permission: PermissionLevel;
  created_at: Date;
};

/** All access entries for a given expedition (admin UI / settings dialog). */
export const listExpeditionAccess = async (expeditionId: string): Promise<AccessEntry[]> => {
  const rows = await sql<DbExpeditionAccess[]>`
    SELECT
      a.id AS access_id,
      a.user_id,
      a.group_id,
      a.authenticated_only,
      a.permission,
      a.created_at
    FROM expeditions.expedition_access ea
    JOIN auth.access a ON ea.access_id = a.id
    WHERE ea.expedition_id = ${expeditionId}::uuid
    ORDER BY
      -- Stable order: users → groups → authenticated → public, by creation.
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

  // Resolve UUIDs → human display names so the editor can show them.
  return resolveDisplayNames(entries);
};

/** Link an existing `auth.access` row to an expedition. */
export const addExpeditionAccess = async (
  expeditionId: string,
  accessId: string,
): Promise<Result<void>> => {
  try {
    await sql`
      INSERT INTO expeditions.expedition_access (expedition_id, access_id)
      VALUES (${expeditionId}::uuid, ${accessId}::uuid)
    `;
    return ok();
  } catch (e: unknown) {
    const error = e as { code?: string };
    if (error.code === "23505") return fail(err.conflict("Access entry"));
    if (error.code === "23503") return fail(err.notFound("Expedition or access entry"));
    throw e;
  }
};

/**
 * Remove an access entry from an expedition.
 *
 * We delete the underlying `auth.access` row — the junction cascades. This
 * matches spaces / notebooks (one `auth.access` per resource grant; never
 * shared across resources).
 */
export const removeExpeditionAccess = async (
  expeditionId: string,
  accessId: string,
): Promise<Result<void>> => {
  const [exists] = await sql<{ access_id: string }[]>`
    SELECT access_id FROM expeditions.expedition_access
    WHERE expedition_id = ${expeditionId}::uuid AND access_id = ${accessId}::uuid
  `;
  if (!exists) return fail(err.notFound("Access entry for this expedition"));
  return deleteAccess({ id: accessId });
};

/** Used by the admin summary card. */
export const countExpeditionAccess = async (expeditionId: string): Promise<number> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM expeditions.expedition_access
    WHERE expedition_id = ${expeditionId}::uuid
  `;
  return row?.count ?? 0;
};

/**
 * Resolve a user's effective permission on an expedition. Returns "none" if
 * they have no grant — combined direct + group + authenticated + public.
 */
export const getExpeditionPermission = async (params: {
  expeditionId: string;
  userId: string | null;
  userGroups: string[];
}): Promise<PermissionLevel> => {
  const accessRows = await sql<{ access_id: string }[]>`
    SELECT access_id FROM expeditions.expedition_access
    WHERE expedition_id = ${params.expeditionId}::uuid
  `;
  return getEffectivePermission({
    accessIds: accessRows.map((r) => r.access_id),
    userId: params.userId,
    userGroups: params.userGroups,
  });
};

/**
 * Convenience: create a new `auth.access` row and link it in one go.
 *
 * Used both by the public API (`POST /:id/access`) and internally during
 * expedition creation to grant the creator admin access.
 */
export const grantExpeditionAccess = async (params: {
  expeditionId: string;
  principal: Principal;
  permission: PermissionLevel;
}): Promise<Result<AccessEntry>> => {
  const { expeditionId, principal, permission } = params;

  // Reject duplicates — `auth.access` allows multiple rows per principal but
  // we want at most one per (resource, principal) pair so the editor stays sane.
  const existing = await listExpeditionAccess(expeditionId);
  const duplicate = existing.find((e) => {
    if (principal.type === "public" && e.principal.type === "public") return true;
    if (principal.type === "authenticated" && e.principal.type === "authenticated") return true;
    if (principal.type === "user" && e.principal.type === "user")
      return principal.userId === e.principal.userId;
    if (principal.type === "group" && e.principal.type === "group")
      return principal.groupId === e.principal.groupId;
    return false;
  });
  if (duplicate) {
    return fail({
      code: "CONFLICT",
      message: "This principal already has access to this expedition",
      status: 409,
    });
  }

  const created = await createAccess({ principal, permission });
  if (!created.ok) return created;

  const linked = await addExpeditionAccess(expeditionId, created.data.id);
  if (!linked.ok) {
    // Roll back the orphaned access row so we don't leak grants.
    await deleteAccess({ id: created.data.id });
    return linked;
  }

  // Re-list so the entry comes back with displayName populated.
  const all = await listExpeditionAccess(expeditionId);
  const found = all.find((e) => e.id === created.data.id);
  if (!found) return fail(err.internal("Failed to retrieve created access entry"));
  return ok(found);
};

/** Adapter for the cloud lib's generic access utilities. */
export const expeditionAccessAdapter: ResourceAccessAdapter = {
  list: listExpeditionAccess,
  add: addExpeditionAccess,
  remove: removeExpeditionAccess,
  count: countExpeditionAccess,
};
