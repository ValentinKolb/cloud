import { sql } from "bun";
import { type PermissionLevel, hasPermission } from "@valentinkolb/cloud/server";
import type { MutationResult } from "@valentinkolb/cloud/contracts";
import type {
  CreateExpedition,
  Expedition,
  UpdateExpedition,
} from "@/contracts";
import { grantExpeditionAccess, getExpeditionPermission } from "./access";

// Re-export so siblings (`./waypoints.ts`, the API layer) can import from a
// single place without reaching into the cloud-lib internals.
export type { MutationResult };

/**
 * Expedition (= the tenancy entity) CRUD + admin queries.
 *
 * The shape of these functions mirrors `spaces.ts` and `notebooks.ts` — this
 * is the canonical pattern for any tenant-with-items app:
 *   list / get / create / update / remove
 *   listAdmin / adminSummary  (admin-only views)
 *   canAccess / getPermission (access control)
 *
 * SQL is written by hand with Bun's `sql` template — no ORM. Each query
 * returns `DbExpedition` rows that we map into the public `Expedition`
 * contract via `mapExpedition`. Aggregates (`total_waypoints`, `done_waypoints`)
 * are computed inline so listing N expeditions stays a single roundtrip.
 */

type DbExpedition = {
  id: string;
  title: string;
  description: string | null;
  icon: string;
  completed_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  total_waypoints: number;
  done_waypoints: number;
};

/** DB row → public contract. Single source of truth for shape conversion. */
const mapExpedition = (row: DbExpedition): Expedition => ({
  id: row.id,
  title: row.title,
  description: row.description,
  icon: row.icon,
  completedAt: row.completed_at?.toISOString() ?? null,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  totalWaypoints: row.total_waypoints,
  doneWaypoints: row.done_waypoints,
});

/** Inline subquery for waypoint aggregates — kept here so list/get share it. */
const WAYPOINT_AGG_SQL = sql`
  COALESCE((SELECT COUNT(*)::int FROM expeditions.waypoints w WHERE w.expedition_id = e.id), 0) AS total_waypoints,
  COALESCE((SELECT COUNT(*)::int FROM expeditions.waypoints w WHERE w.expedition_id = e.id AND w.done_at IS NOT NULL), 0) AS done_waypoints
`;

/** Postgres `uuid[]` literal helper for `ANY(...)` filters. */
const toPgUuidArray = (values: string[] | null | undefined): string => {
  if (!Array.isArray(values) || values.length === 0) return "{}";
  return `{${values.join(",")}}`;
};

// ── Access checks ───────────────────────────────────────────────────────────

/** Resolve a user's permission level (0-arg shorthand → "none" if no grant). */
export const getPermission = (params: {
  expeditionId: string;
  userId: string | null;
  userGroups: string[];
}): Promise<PermissionLevel> => getExpeditionPermission(params);

/** Convenience for handlers that just want a yes/no answer. */
export const canAccess = async (params: {
  expeditionId: string;
  userId: string | null;
  userGroups: string[];
  requiredLevel?: PermissionLevel;
}): Promise<boolean> => {
  const permission = await getExpeditionPermission(params);
  if (permission === "none") return false;
  return hasPermission(permission, params.requiredLevel ?? "read");
};

// ── List / Get ──────────────────────────────────────────────────────────────

/**
 * All expeditions a user can see — direct grants, group inheritance,
 * authenticated, and public. `DISTINCT` because a user may match multiple
 * grants (e.g. direct + group) for the same expedition.
 */
export const list = async (params: {
  userId: string | null;
  groups: string[];
}): Promise<Expedition[]> => {
  const { userId, groups } = params;
  const rows = await sql<DbExpedition[]>`
    SELECT DISTINCT
      e.id, e.title, e.description, e.icon, e.completed_at,
      e.created_by, e.created_at, e.updated_at,
      ${WAYPOINT_AGG_SQL}
    FROM expeditions.expeditions e
    LEFT JOIN expeditions.expedition_access ea ON e.id = ea.expedition_id
    LEFT JOIN auth.access a ON ea.access_id = a.id
    WHERE
      a.user_id = ${userId}::uuid
      OR a.group_id = ANY(${toPgUuidArray(groups)}::uuid[])
      OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
      OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = false)
    ORDER BY e.completed_at NULLS FIRST, e.updated_at DESC
  `;
  return rows.map(mapExpedition);
};

export const get = async (params: { id: string }): Promise<Expedition | null> => {
  const [row] = await sql<DbExpedition[]>`
    SELECT
      e.id, e.title, e.description, e.icon, e.completed_at,
      e.created_by, e.created_at, e.updated_at,
      ${WAYPOINT_AGG_SQL}
    FROM expeditions.expeditions e
    WHERE e.id = ${params.id}::uuid
  `;
  return row ? mapExpedition(row) : null;
};

// ── Create / Update / Delete ────────────────────────────────────────────────

/**
 * Create a new expedition. Side-effects:
 *   1. INSERT the expedition.
 *   2. Grant the creator `admin` access (so they can edit / delete it).
 *
 * If step 2 fails (extremely unlikely — same DB, same transaction concept),
 * the caller has an orphaned expedition with no admin. We accept that
 * tradeoff for code simplicity; in production you'd wrap this in a tx.
 */
export const create = async (params: {
  data: CreateExpedition;
  creatorId: string;
}): Promise<MutationResult<Expedition>> => {
  const { data, creatorId } = params;

  const [row] = await sql<DbExpedition[]>`
    INSERT INTO expeditions.expeditions (title, description, icon, created_by)
    VALUES (
      ${data.title},
      ${data.description ?? null},
      ${data.icon ?? "ti ti-map-2"},
      ${creatorId}::uuid
    )
    RETURNING
      id, title, description, icon, completed_at, created_by, created_at, updated_at,
      0::int AS total_waypoints, 0::int AS done_waypoints
  `;
  if (!row) return { ok: false, error: "Failed to create expedition", status: 500 };

  // Auto-grant admin access to the creator so they can immediately edit.
  await grantExpeditionAccess({
    expeditionId: row.id,
    principal: { type: "user", userId: creatorId },
    permission: "admin",
  });

  return { ok: true, data: mapExpedition(row) };
};

export const update = async (params: {
  id: string;
  data: UpdateExpedition;
}): Promise<MutationResult<Expedition>> => {
  const existing = await get({ id: params.id });
  if (!existing) return { ok: false, error: "Expedition not found", status: 404 };

  const title = params.data.title ?? existing.title;
  // `description` can be explicitly set to null (to clear it) — undefined means "leave alone".
  const description = params.data.description === undefined ? existing.description : params.data.description;
  const icon = params.data.icon ?? existing.icon;

  const [row] = await sql<DbExpedition[]>`
    UPDATE expeditions.expeditions
    SET title = ${title}, description = ${description}, icon = ${icon}, updated_at = now()
    WHERE id = ${params.id}::uuid
    RETURNING
      id, title, description, icon, completed_at, created_by, created_at, updated_at,
      ${WAYPOINT_AGG_SQL}
  `;
  if (!row) return { ok: false, error: "Failed to update expedition", status: 500 };
  return { ok: true, data: mapExpedition(row) };
};

export const remove = async (params: { id: string }): Promise<MutationResult<void>> => {
  const result = await sql`
    DELETE FROM expeditions.expeditions WHERE id = ${params.id}::uuid
  `;
  if (result.count === 0) return { ok: false, error: "Expedition not found", status: 404 };
  return { ok: true, data: undefined };
};

// ── Admin queries ───────────────────────────────────────────────────────────
// Exposed at /admin/expeditions — bypasses access control (admin sees all)
// but still applies the search filter.

export type ExpeditionAdminListItem = Expedition & {
  /** Number of access entries — orphaned expeditions have 0 (only creator-admin). */
  permissionCount: number;
};

export const listAdmin = async (params: {
  search?: string;
  pagination: { limit: number; offset: number };
}): Promise<{ items: ExpeditionAdminListItem[]; total: number }> => {
  const query = params.search?.trim().toLowerCase();
  const pattern = query && query.length > 0 ? `%${query}%` : null;

  const rows = await sql<(DbExpedition & { permission_count: number })[]>`
    SELECT
      e.id, e.title, e.description, e.icon, e.completed_at,
      e.created_by, e.created_at, e.updated_at,
      ${WAYPOINT_AGG_SQL},
      COALESCE((
        SELECT COUNT(*)::int FROM expeditions.expedition_access ea WHERE ea.expedition_id = e.id
      ), 0) AS permission_count
    FROM expeditions.expeditions e
    WHERE (${pattern}::text IS NULL OR LOWER(e.title) LIKE ${pattern})
    ORDER BY LOWER(e.title) ASC, e.created_at ASC
    LIMIT ${params.pagination.limit}
    OFFSET ${params.pagination.offset}
  `;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM expeditions.expeditions e
    WHERE (${pattern}::text IS NULL OR LOWER(e.title) LIKE ${pattern})
  `;

  return {
    items: rows.map((r) => ({ ...mapExpedition(r), permissionCount: r.permission_count })),
    total: countRow?.count ?? 0,
  };
};

/**
 * One-shot SQL aggregation for the admin summary cards. We don't compute
 * these in JS because we want totals across the whole filtered set, not
 * just the visible page.
 */
export const adminSummary = async (params: { search?: string }): Promise<{
  total: number;
  completed: number;
  orphaned: number;
}> => {
  const query = params.search?.trim().toLowerCase();
  const pattern = query && query.length > 0 ? `%${query}%` : null;

  const [row] = await sql<{ total: number; completed: number; orphaned: number }[]>`
    WITH filtered AS (
      SELECT
        e.id, e.completed_at,
        (SELECT COUNT(*)::int FROM expeditions.expedition_access ea WHERE ea.expedition_id = e.id) AS permission_count
      FROM expeditions.expeditions e
      WHERE (${pattern}::text IS NULL OR LOWER(e.title) LIKE ${pattern})
    )
    SELECT
      COUNT(*)::int                                          AS total,
      COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int  AS completed,
      COUNT(*) FILTER (WHERE permission_count = 0)::int      AS orphaned
    FROM filtered
  `;
  return {
    total: row?.total ?? 0,
    completed: row?.completed ?? 0,
    orphaned: row?.orphaned ?? 0,
  };
};
