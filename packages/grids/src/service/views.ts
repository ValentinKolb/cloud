import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";

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

export type ViewConfig = {
  filter?: unknown;
  sort?: Array<{ fieldId: string; direction: "asc" | "desc"; nullsFirst?: boolean }>;
  visibleFields?: string[];
  fieldOrder?: string[];
  fieldWidths?: Record<string, number>;
  groupBy?: string | null;
  rowHeight?: "compact" | "default" | "tall";
};

const mapRow = (row: DbRow): View => ({
  id: row.id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  config: (row.config as ViewConfig) ?? {},
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
  const userGroups = params.userGroups ?? [];
  const groups = userGroups.length > 0 ? `{${userGroups.join(",")}}` : "{}";

  // Pull views + each view's effective view-level grant for this user via
  // one query. The subquery returns the highest matching grant rank
  // (none=0, read=1, write=2, admin=3) or NULL when no grant exists.
  const rows = await sql<(DbRow & { effective_rank: number | null })[]>`
    SELECT v.id, v.table_id, v.name, v.config, v.owner_user_id, v.position, v.created_at, v.updated_at,
      (
        SELECT MAX(CASE a.permission
          WHEN 'none' THEN 0 WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'admin' THEN 3
        END)
        FROM grids.view_access va
        JOIN auth.access a ON a.id = va.access_id
        WHERE va.view_id = v.id
          AND (
            a.user_id = ${params.userId}::uuid
            OR a.group_id = ANY(${groups}::uuid[])
            OR (a.authenticated_only = TRUE AND ${params.userId}::uuid IS NOT NULL)
            OR (a.user_id IS NULL AND a.group_id IS NULL AND a.authenticated_only = FALSE)
          )
      ) AS effective_rank
    FROM grids.views v
    WHERE v.table_id = ${params.tableId}::uuid
    ORDER BY v.position, v.created_at
  `;

  return rows
    .filter((row) => {
      const rank = row.effective_rank;
      // Explicit grant present: include iff >= read (rank 1).
      if (rank !== null) return rank >= 1;
      // No view-level grant: fall back to default visibility.
      const ownerId = row.owner_user_id as string | null;
      return ownerId === null || ownerId === params.userId;
    })
    .map(mapRow);
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
      ${JSON.stringify(input.config ?? {})}::jsonb,
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
        config = ${JSON.stringify(next.config)}::jsonb,
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
