import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";
import { insertWithSlug } from "./slug";
import type { Table, CreateTableInput, UpdateTableInput } from "./types";

type DbRow = Record<string, unknown>;

const COLS = sql`id, slug, base_id, name, description, position, disable_direct_insert, deleted_at, created_at, updated_at`;

const mapRow = (row: DbRow): Table => ({
  id: row.id as string,
  slug: row.slug as string,
  baseId: row.base_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  position: row.position as number,
  disableDirectInsert: (row.disable_direct_insert as boolean | null) ?? false,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

/**
 * Lists active tables of a base. Pass `includeDeleted` to include
 * trashed tables (used by the trash UI).
 */
export const listByBase = async (
  baseId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Table[]> => {
  const rows = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT ${COLS}
        FROM grids.tables WHERE base_id = ${baseId}::uuid
        ORDER BY position, created_at
      `
    : await sql<DbRow[]>`
        SELECT ${COLS}
        FROM grids.tables WHERE base_id = ${baseId}::uuid AND deleted_at IS NULL
        ORDER BY position, created_at
      `;
  return rows.map(mapRow);
};

/**
 * Soft-deleted tables for a base, newest-deletion first. Used by
 * the base-settings trash view to surface restorable resources.
 */
export const listTrashedByBase = async (baseId: string): Promise<Table[]> => {
  const rows = await sql<DbRow[]>`
    SELECT ${COLS}
    FROM grids.tables
    WHERE base_id = ${baseId}::uuid AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `;
  return rows.map(mapRow);
};

export const get = async (
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Table | null> => {
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT ${COLS} FROM grids.tables WHERE id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT ${COLS} FROM grids.tables WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;
  return row ? mapRow(row) : null;
};

/**
 * Look up a table by (baseId, slug). Used at the SSR-route boundary
 * to resolve URL slugs to UUIDs. Returns null for soft-deleted tables.
 */
export const getBySlug = async (baseId: string, slug: string): Promise<Table | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT ${COLS}
    FROM grids.tables
    WHERE base_id = ${baseId}::uuid AND slug = ${slug} AND deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

/**
 * Tolerant lookup. Accepts either a UUID (36 chars) or a slug (5 chars).
 * Mirrors `bases.getByIdOrSlug` — see the rationale there.
 */
export const getByIdOrSlug = async (baseId: string, idOrSlug: string): Promise<Table | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const t = await get(idOrSlug);
    // Verify base scope so a leaked UUID can't address a table from another base.
    return t && t.baseId === baseId ? t : null;
  }
  return getBySlug(baseId, idOrSlug);
};

export const create = async (input: CreateTableInput, actorId: string | null): Promise<Result<Table>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));

  const row = await insertWithSlug<DbRow>(async (slug) => {
    const [r] = await sql<DbRow[]>`
      INSERT INTO grids.tables (slug, base_id, name, description, position)
      VALUES (
        ${slug},
        ${input.baseId}::uuid,
        ${name},
        ${input.description ?? null},
        COALESCE((SELECT MAX(position) + 1 FROM grids.tables WHERE base_id = ${input.baseId}::uuid AND deleted_at IS NULL), 0)
      )
      RETURNING ${COLS}
    `;
    if (!r) throw new Error("insert returned no row");
    return r;
  }, "idx_grids_tables_slug");
  const table = mapRow(row);
  await logAudit({ baseId: input.baseId, tableId: table.id, userId: actorId, action: "created" });
  return ok(table);
};

export const update = async (id: string, input: UpdateTableInput, actorId: string | null): Promise<Result<Table>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Table"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));

  const next = {
    name: name ?? existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    disableDirectInsert:
      input.disableDirectInsert !== undefined ? input.disableDirectInsert : existing.disableDirectInsert,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.tables
    SET name = ${next.name},
        description = ${next.description},
        disable_direct_insert = ${next.disableDirectInsert},
        updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING ${COLS}
  `;
  if (!row) return fail(err.internal("update failed"));
  const table = mapRow(row);

  const diff: Record<string, { old: unknown; new: unknown }> = {};
  if (next.name !== existing.name) diff.name = { old: existing.name, new: next.name };
  if (next.description !== existing.description) {
    diff.description = { old: existing.description, new: next.description };
  }
  if (next.disableDirectInsert !== existing.disableDirectInsert) {
    diff.disableDirectInsert = { old: existing.disableDirectInsert, new: next.disableDirectInsert };
  }
  if (Object.keys(diff).length > 0) {
    await logAudit({ baseId: table.baseId, tableId: id, userId: actorId, action: "updated", diff });
  }

  return ok(table);
};

/**
 * Soft-deletes the table. The row stays in the DB; child entities
 * (fields/records/views/forms) are *not* automatically tombstoned —
 * they simply become unreachable through the API while the parent
 * table is hidden. Restore brings them all back. Hard purge happens
 * after the grace period via the maintenance job.
 */
export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Table"));
  await sql`UPDATE grids.tables SET deleted_at = now() WHERE id = ${id}::uuid AND deleted_at IS NULL`;
  await logAudit({ baseId: existing.baseId, tableId: id, userId: actorId, action: "deleted" });
  return ok();
};

export const restore = async (id: string, actorId: string | null): Promise<Result<Table>> => {
  const existing = await get(id, { includeDeleted: true });
  if (!existing) return fail(err.notFound("Table"));
  if (existing.deletedAt === null) return ok(existing);
  const [row] = await sql<DbRow[]>`
    UPDATE grids.tables SET deleted_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING ${COLS}
  `;
  if (!row) return fail(err.internal("restore failed"));
  const table = mapRow(row);
  await logAudit({ baseId: existing.baseId, tableId: id, userId: actorId, action: "restored" });
  return ok(table);
};
