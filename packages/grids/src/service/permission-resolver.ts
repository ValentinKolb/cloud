import { sql } from "bun";
import type { PermissionLevel } from "@valentinkolb/cloud/server";

const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

const LEVEL_BY_RANK: PermissionLevel[] = ["none", "read", "write", "admin"];

export type ResourceType = "base" | "table" | "view";

export type Grant = {
  resourceType: ResourceType;
  resourceId: string;
  level: PermissionLevel;
};

export type ResolveTarget =
  | { baseId: string }
  | { baseId: string; tableId: string }
  | { baseId: string; tableId: string; viewId: string };

const highest = (levels: PermissionLevel[]): PermissionLevel => {
  if (levels.length === 0) return "none";
  let max = 0;
  for (const l of levels) {
    if (LEVEL_RANK[l] > max) max = LEVEL_RANK[l];
  }
  return LEVEL_BY_RANK[max]!;
};

/**
 * Most-specific-wins resolution: the closest level with any grant determines
 * the effective permission. A `none` grant at the most-specific level is
 * the explicit-deny semantic — it shadows parent grants. Multiple grants at
 * the same level (e.g. user-direct + group-membership) take the highest.
 *
 * View permission is capped at `read` by schema (write-side enforcement);
 * this resolver doesn't re-cap.
 */
export const resolveEffectivePermission = (grants: Grant[], target: ResolveTarget): PermissionLevel => {
  const baseGrants = grants.filter((g) => g.resourceType === "base" && g.resourceId === target.baseId);

  if ("viewId" in target) {
    const viewGrants = grants.filter((g) => g.resourceType === "view" && g.resourceId === target.viewId);
    if (viewGrants.length > 0) return highest(viewGrants.map((g) => g.level));
  }

  if ("tableId" in target) {
    const tableGrants = grants.filter((g) => g.resourceType === "table" && g.resourceId === target.tableId);
    if (tableGrants.length > 0) return highest(tableGrants.map((g) => g.level));
  }

  if (baseGrants.length > 0) return highest(baseGrants.map((g) => g.level));

  return "none";
};

/** Compares two levels via the rank order. */
export const hasAtLeast = (level: PermissionLevel, required: PermissionLevel): boolean =>
  LEVEL_RANK[level] >= LEVEL_RANK[required];

// ──────────────────────────────────────────────────────────────────
// DB-fetching half
// ──────────────────────────────────────────────────────────────────

type DbRow = Record<string, unknown>;

/**
 * Loads all grants reachable for this user across base / table / view ACLs
 * for the given target chain. One query, three UNION ALL legs — keeps the
 * permission lookup to a single round-trip even though the data spans three
 * junction tables.
 */
export const loadGrantsForUser = async (params: {
  userId: string | null;
  userGroups: string[];
  baseId: string;
  tableId?: string | null;
  viewId?: string | null;
}): Promise<Grant[]> => {
  const userId = params.userId;
  // toPgUuidArray accepts empty arrays as `{}`; we encode here directly.
  const groups = params.userGroups.length > 0 ? `{${params.userGroups.join(",")}}` : "{}";
  const tableId = params.tableId ?? null;
  const viewId = params.viewId ?? null;

  const rows = await sql<DbRow[]>`
    SELECT 'base'::text AS resource_type, ba.base_id AS resource_id, a.permission AS level
    FROM grids.base_access ba
    JOIN auth.access a ON a.id = ba.access_id
    WHERE ba.base_id = ${params.baseId}::uuid
      AND (
        a.user_id = ${userId}::uuid
        OR a.group_id = ANY(${groups}::uuid[])
        OR a.authenticated_only = TRUE
        OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = FALSE)
      )

    UNION ALL

    SELECT 'table'::text, ta.table_id, a.permission
    FROM grids.table_access ta
    JOIN auth.access a ON a.id = ta.access_id
    WHERE ta.table_id = ${tableId}::uuid
      AND (
        a.user_id = ${userId}::uuid
        OR a.group_id = ANY(${groups}::uuid[])
        OR a.authenticated_only = TRUE
        OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = FALSE)
      )

    UNION ALL

    SELECT 'view'::text, va.view_id, a.permission
    FROM grids.view_access va
    JOIN auth.access a ON a.id = va.access_id
    WHERE va.view_id = ${viewId}::uuid
      AND (
        a.user_id = ${userId}::uuid
        OR a.group_id = ANY(${groups}::uuid[])
        OR a.authenticated_only = TRUE
        OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = FALSE)
      )
  `;

  return rows.map((row) => ({
    resourceType: row.resource_type as ResourceType,
    resourceId: row.resource_id as string,
    level: row.level as PermissionLevel,
  }));
};
