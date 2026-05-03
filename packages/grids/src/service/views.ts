import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";

type DbRow = Record<string, unknown>;

/**
 * A saved view = filter + sort + visible-fields config bound to a table.
 * Stored in grids.views with the JSONB blob driving the records-list URL.
 */
export type View = {
  id: string;
  tableId: string;
  name: string;
  config: ViewConfig;
  ownerUserId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Per-column override for date/number formatting. Only the kind that
 * matches the field's actual type takes effect; the renderer ignores
 * mismatches (a `currency` format on a text field is a no-op).
 */
export type FormatSpec =
  | { kind: "date"; format: "iso" | "short" | "long" | "relative"; includeTime?: boolean }
  | { kind: "currency"; symbol?: string; precision?: number }
  | { kind: "decimal"; precision?: number; thousandsSeparator?: boolean }
  | { kind: "percent"; precision?: number };

/**
 * One rendered column in a view. Two kinds for v1:
 *  - `field`: a plain table field (re-uses `field.type` for rendering).
 *  - `join`:  a field on a related table reached via a relation-field
 *             path. `path` is the chain of relation field ids; v1
 *             enforces 1..2 hops in the UI. Server resolves the chain.
 *
 * Other kinds (`computed`, `aggregation`) come in later iterations.
 */
export type ViewColumn =
  | {
      kind: "field";
      fieldId: string;
      format?: FormatSpec;
    }
  | {
      kind: "join";
      path: string[];
      fieldId: string;
      label?: string;
      format?: FormatSpec;
    };

export type ViewConfig = {
  filter?: unknown;
  sort?: Array<{ fieldId: string; direction: "asc" | "desc"; nullsFirst?: boolean }>;
  /**
   * Ordered list of rendered columns. Combines visibility, ordering,
   * and per-column format in ONE structure.
   *
   *  - `undefined` (or missing): inherit table default — render every
   *    field where `!hideInTable`, sorted by `field.position`.
   *  - `[]`: render NO columns (intentional empty — useful as a
   *    "selected only id" view).
   *  - `[{kind:"field", fieldId}, …]`: render exactly these columns
   *    in this order, including fields that would otherwise be
   *    `hideInTable`.
   */
  columns?: ViewColumn[];
  /**
   * Hard cap on returned rows, applied AFTER filter+sort and BEFORE
   * pagination. `undefined` = unlimited (subject to cursor pagination
   * page size). When set, `record.list` returns at most `limit` rows
   * total across all pages — `nextCursor` becomes null once the
   * cursor would advance past the cap.
   */
  limit?: number;
};

const mapRow = (row: DbRow): View => ({
  id: row.id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  config: parseJsonbRow<ViewConfig>(row.config, {}),
  ownerUserId: (row.owner_user_id as string | null) ?? null,
  position: row.position as number,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

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
    SELECT v.id, v.table_id, v.name, v.config, v.owner_user_id, v.position, v.created_at, v.updated_at,
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
    WHERE v.table_id = ${params.tableId}::uuid
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

export const get = async (id: string): Promise<View | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, table_id, name, config, owner_user_id, position, created_at, updated_at
    FROM grids.views WHERE id = ${id}::uuid
  `;
  return row ? mapRow(row) : null;
};

export type CreateViewInput = {
  tableId: string;
  name: string;
  config?: ViewConfig;
  ownerUserId?: string | null;
};

export const create = async (input: CreateViewInput, actorId: string | null): Promise<Result<View>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));

  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.views (table_id, name, config, owner_user_id, position)
    VALUES (
      ${input.tableId}::uuid,
      ${name},
      ${input.config ?? {}}::jsonb,
      ${input.ownerUserId ?? null}::uuid,
      COALESCE((SELECT MAX(position) + 1 FROM grids.views WHERE table_id = ${input.tableId}::uuid), 0)
    )
    RETURNING id, table_id, name, config, owner_user_id, position, created_at, updated_at
  `;
  if (!row) return fail(err.internal("insert failed"));
  const view = mapRow(row);
  await logAudit({ tableId: input.tableId, userId: actorId, action: "created", diff: { view: { old: null, new: { id: view.id, name: view.name } } } });
  return ok(view);
};

export type UpdateViewInput = {
  name?: string;
  config?: ViewConfig;
  position?: number;
};

export const update = async (id: string, input: UpdateViewInput, actorId: string | null): Promise<Result<View>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("View"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));

  const next = {
    name: name ?? existing.name,
    config: input.config !== undefined ? input.config : existing.config,
    position: input.position ?? existing.position,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.views
    SET name = ${next.name},
        config = ${next.config}::jsonb,
        position = ${next.position},
        updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, table_id, name, config, owner_user_id, position, created_at, updated_at
  `;
  if (!row) return fail(err.internal("update failed"));
  const view = mapRow(row);
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "updated", diff: { view: { old: existing.name, new: view.name } } });
  return ok(view);
};

export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("View"));
  await sql`DELETE FROM grids.views WHERE id = ${id}::uuid`;
  await logAudit({ tableId: existing.tableId, userId: actorId, action: "deleted" });
  return ok();
};
