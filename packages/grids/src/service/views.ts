import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";
import { insertWithSlug } from "./slug";
import { ViewQuerySchema, type View, type ViewQuery, type ColumnSpec, type FormatSpec } from "../contracts";

type DbRow = Record<string, unknown>;

// View / ViewQuery / ColumnSpec / FormatSpec definitions live in contracts.ts —
// re-export so consumers can keep importing them from the service layer.
export type { View, ViewQuery, ColumnSpec, FormatSpec };

/**
 * Reads a stored view row and validates the JSONB query blob against
 * ViewQuerySchema. If the stored blob fails validation (e.g. references
 * deleted fields, schema-drifted shape from before v3), we coerce to an
 * empty query rather than throwing — better than the whole listing
 * crashing because one corrupt view exists. The user can re-edit the
 * view to fix it.
 */
const mapRow = (row: DbRow): View => {
  const rawQuery = parseJsonbRow<unknown>(row.query, {});
  const parsed = ViewQuerySchema.safeParse(rawQuery);
  return {
    id: row.id as string,
    slug: row.slug as string,
    tableId: row.table_id as string,
    name: row.name as string,
    query: parsed.success ? parsed.data : {},
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    position: row.position as number,
    deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
};

/**
 * Look up a view by (tableId, slug). Used at the SSR-route boundary
 * to resolve the `?view=<slug>` URL param to a UUID. Returns null for
 * soft-deleted views AND for views whose parent table or base is
 * trashed (live-parent invariant).
 */
export const getBySlug = async (tableId: string, slug: string): Promise<View | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT v.*
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE v.table_id = ${tableId}::uuid AND v.slug = ${slug} AND v.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

/**
 * Tolerant lookup — accepts either UUID or slug. Same length-based
 * heuristic as `bases.getByIdOrSlug` / `tables.getByIdOrSlug`.
 */
export const getByIdOrSlug = async (tableId: string, idOrSlug: string): Promise<View | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const v = await get(idOrSlug);
    // Scope-check: a leaked UUID from another table must not resolve here.
    return v && v.tableId === tableId ? v : null;
  }
  return getBySlug(tableId, idOrSlug);
};

/**
 * Lists views visible to a user on a table. Visibility rules:
 *   1. Shared views (owner_user_id NULL) and the user's own personal
 *      views are visible by default.
 *   2. View-level ACL grants OVERRIDE that default — an explicit
 *      level=read on someone else's personal view makes it visible to
 *      the grantee, and an explicit level=none on a shared view hides
 *      it from the denied user.
 *
 * Most-specific-wins: a view-level grant for this user (or any of their
 *   groups) supersedes the default-visibility check. If the highest
 *   matching grant is `none`, the view is hidden even if it would
 *   otherwise be a default-shared view.
 */
export const listForTable = async (params: {
  tableId: string;
  userId: string | null;
  userGroups?: string[];
}): Promise<View[]> => {
  // Defensive encoding: bun.sql may surface an empty uuid[] column as the
  // string "{}" instead of [], and admin users with no group memberships
  // hit exactly that path. toPgUuidArray normalizes both shapes.
  const groups = toPgUuidArray(params.userGroups);

  // Most-specific-wins per principal tier (user > group > authenticated >
  // public). Within a tier: any deny wins over any read — needed because
  // (a) `grantAccess` inserts a fresh auth.access row per POST so duplicate
  // principal rows are possible, and (b) a user can be in multiple groups
  // that disagree. Per-tier rule: NULL if no rows, 0 if any deny, else
  // MAX(positive rank).
  const rows = await sql<(DbRow & {
    user_rank: number | null;
    group_rank: number | null;
    auth_rank: number | null;
    public_rank: number | null;
  })[]>`
    SELECT v.id, v.slug, v.table_id, v.name, v.query, v.owner_user_id, v.position, v.deleted_at, v.created_at, v.updated_at,
      (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN NULL
          WHEN bool_or(a.permission = 'none') THEN 0
          ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
        END
        FROM grids.view_access va JOIN auth.access a ON a.id = va.access_id
        WHERE va.view_id = v.id AND a.user_id = ${params.userId}::uuid
      ) AS user_rank,
      (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN NULL
          WHEN bool_or(a.permission = 'none') THEN 0
          ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
        END
        FROM grids.view_access va JOIN auth.access a ON a.id = va.access_id
        WHERE va.view_id = v.id AND a.group_id = ANY(${groups}::uuid[])
      ) AS group_rank,
      (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN NULL
          WHEN bool_or(a.permission = 'none') THEN 0
          ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
        END
        FROM grids.view_access va JOIN auth.access a ON a.id = va.access_id
        WHERE va.view_id = v.id
          AND a.authenticated_only = TRUE
          AND ${params.userId}::uuid IS NOT NULL
      ) AS auth_rank,
      (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN NULL
          WHEN bool_or(a.permission = 'none') THEN 0
          ELSE MAX(CASE a.permission WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3 END)
        END
        FROM grids.view_access va JOIN auth.access a ON a.id = va.access_id
        WHERE va.view_id = v.id
          AND a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = FALSE
      ) AS public_rank
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE v.table_id = ${params.tableId}::uuid AND v.deleted_at IS NULL
    ORDER BY v.position, v.created_at
  `;

  return rows
    .filter((row) =>
      isVisibleByAclTiers(
        { userRank: row.user_rank, groupRank: row.group_rank, authRank: row.auth_rank, publicRank: row.public_rank },
        { ownerUserId: row.owner_user_id as string | null, viewerUserId: params.userId },
      ),
    )
    .map(mapRow);
};

// ──────────────────────────────────────────────────────────────────
// Pure ACL tier resolution (testable)
// ──────────────────────────────────────────────────────────────────

export type TierRanks = {
  /** Highest matching rank from direct user grants, or 0 if any user-deny exists, or null when no user rows match. */
  userRank: number | null;
  groupRank: number | null;
  authRank: number | null;
  publicRank: number | null;
};

/**
 * Walks ACL specificity tiers top-down (user > group > authenticated >
 * public). The first tier with any matching grant decides. If that tier's
 * rank is >= 1 (read/write/admin), the view is visible; rank 0 (deny)
 * hides it. If no tier matched, falls back to default visibility (shared
 * view or own personal view). Pure logic — no DB.
 */
export const isVisibleByAclTiers = (
  ranks: TierRanks,
  defaults: { ownerUserId: string | null; viewerUserId: string | null },
): boolean => {
  const winning =
    ranks.userRank ?? ranks.groupRank ?? ranks.authRank ?? ranks.publicRank;
  if (winning !== null && winning !== undefined) return winning >= 1;
  return defaults.ownerUserId === null || defaults.ownerUserId === defaults.viewerUserId;
};

export const get = async (
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<View | null> => {
  // SELECT v.* — slug must be in the projection or mapRow throws (see
  // Wave 1.1's slug invariant). Live-parent invariant: parent table +
  // base must be alive; trashed views require explicit `includeDeleted`.
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT v.*
        FROM grids.views v
        JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE v.id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT v.*
        FROM grids.views v
        JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE v.id = ${id}::uuid AND v.deleted_at IS NULL
      `;
  return row ? mapRow(row) : null;
};

export type CreateViewServiceInput = {
  tableId: string;
  name: string;
  /** Canonical query — undefined means "empty preset" (just a named view
   *  with no filter/sort/etc, useful as a starting point in the UI). */
  query?: ViewQuery;
  ownerUserId?: string | null;
};

export const create = async (
  input: CreateViewServiceInput,
  actorId: string | null,
): Promise<Result<View>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));

  // Re-validate the query at the service boundary even though the API
  // layer already did. Defensive: the service is also called by SSR and
  // future imports — every entry path validates.
  const queryParsed = ViewQuerySchema.safeParse(input.query ?? {});
  if (!queryParsed.success) {
    return fail(err.badInput(`invalid view query: ${queryParsed.error.message}`));
  }

  const row = await insertWithSlug<DbRow>(async (slug) => {
    const [r] = await sql<DbRow[]>`
      INSERT INTO grids.views (slug, table_id, name, query, owner_user_id, position)
      VALUES (
        ${slug},
        ${input.tableId}::uuid,
        ${name},
        ${queryParsed.data}::jsonb,
        ${input.ownerUserId ?? null}::uuid,
        COALESCE((SELECT MAX(position) + 1 FROM grids.views WHERE table_id = ${input.tableId}::uuid), 0)
      )
      RETURNING id, slug, table_id, name, query, owner_user_id, position, deleted_at, created_at, updated_at
    `;
    if (!r) throw new Error("insert returned no row");
    return r;
  }, "idx_grids_views_slug");
  const view = mapRow(row);
  await logAudit({ tableId: input.tableId, userId: actorId, action: "created", diff: { view: { old: null, new: { id: view.id, name: view.name } } } });
  return ok(view);
};

export type UpdateViewServiceInput = {
  name?: string;
  query?: ViewQuery;
  position?: number;
  /** Shared toggle: true → ownerUserId becomes null (anyone can read);
   *  false → ownerUserId becomes `actorId` (the editor takes ownership). */
  shared?: boolean;
};

export const update = async (
  id: string,
  input: UpdateViewServiceInput,
  actorId: string | null,
): Promise<Result<View>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("View"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));

  const ownerUserId =
    input.shared === undefined
      ? existing.ownerUserId
      : input.shared
      ? null
      : actorId;

  let nextQuery: ViewQuery = existing.query;
  if (input.query !== undefined) {
    const queryParsed = ViewQuerySchema.safeParse(input.query);
    if (!queryParsed.success) {
      return fail(err.badInput(`invalid view query: ${queryParsed.error.message}`));
    }
    nextQuery = queryParsed.data;
  }

  const next = {
    name: name ?? existing.name,
    query: nextQuery,
    position: input.position ?? existing.position,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.views
    SET name = ${next.name},
        query = ${next.query}::jsonb,
        position = ${next.position},
        owner_user_id = ${ownerUserId}::uuid,
        updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING id, slug, table_id, name, query, owner_user_id, position, deleted_at, created_at, updated_at
  `;
  if (!row) return fail(err.internal("update failed"));
  const view = mapRow(row);
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "updated", diff: { view: { old: existing.name, new: view.name } } });
  return ok(view);
};

/**
 * Soft-deletes the view. Hard purge happens via maintenance job after
 * the grace period; the row stays restorable until then.
 */
export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("View"));
  await sql`UPDATE grids.views SET deleted_at = now() WHERE id = ${id}::uuid AND deleted_at IS NULL`;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "deleted" });
  return ok();
};

export const restore = async (id: string, actorId: string | null): Promise<Result<View>> => {
  const existing = await get(id, { includeDeleted: true });
  if (!existing) return fail(err.notFound("View"));
  if (existing.deletedAt === null) return ok(existing);
  const [row] = await sql<DbRow[]>`
    UPDATE grids.views SET deleted_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, slug, table_id, name, query, owner_user_id, position, deleted_at, created_at, updated_at
  `;
  if (!row) return fail(err.internal("restore failed"));
  const view = mapRow(row);
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "restored" });
  return ok(view);
};
