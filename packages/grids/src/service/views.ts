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
 * Lists views visible to a user on a table: shared views (owner_user_id
 * NULL) plus the user's personal views. Same-table read-permission is
 * checked at the route layer.
 */
export const listForTable = async (params: {
  tableId: string;
  userId: string | null;
}): Promise<View[]> => {
  const rows = await sql<DbRow[]>`
    SELECT id, table_id, name, config, owner_user_id, position, created_at, updated_at
    FROM grids.views
    WHERE table_id = ${params.tableId}::uuid
      AND (owner_user_id IS NULL OR owner_user_id = ${params.userId}::uuid)
    ORDER BY position, created_at
  `;
  return rows.map(mapRow);
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
