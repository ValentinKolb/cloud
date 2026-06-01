import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";
import { emitMetadataEvent } from "./metadata-events";
import { insertWithShortId } from "./short-id";
import { FieldColumnSpecSchema } from "../contracts";
import type { Table, CreateTableInput, UpdateTableInput } from "./types";

type DbRow = Record<string, unknown>;

const COLS = sql`id, short_id, base_id, name, description, icon, columns, position, disable_direct_insert, deleted_at, created_at, updated_at`;

const parseColumns = (raw: unknown) => {
  const parsed = FieldColumnSpecSchema.array().safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
};

const mapRow = (row: DbRow): Table => ({
  id: row.id as string,
  shortId: row.short_id as string,
  baseId: row.base_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  icon: (row.icon as string | null) ?? null,
  columns: parseColumns(row.columns),
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
  // Live-parent invariant: tables of a trashed base never list (the trash
  // flow operates top-down — restore the base first to access its tables).
  // SELECT t.* (not the bare COLS list) — both `tables.id` and `bases.id`
  // exist after the JOIN, so unqualified column names raise 42702. mapRow
  // picks the columns it cares about by name; extras are ignored.
  const rows = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT t.*
        FROM grids.tables t
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE t.base_id = ${baseId}::uuid
        ORDER BY t.position, t.created_at
      `
    : await sql<DbRow[]>`
        SELECT t.*
        FROM grids.tables t
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE t.base_id = ${baseId}::uuid AND t.deleted_at IS NULL
        ORDER BY t.position, t.created_at
      `;
  return rows.map(mapRow);
};

/**
 * Soft-deleted tables for a base, newest-deletion first. Used by
 * the base-settings trash view to surface restorable resources. Returns
 * empty if the parent base itself is trashed (top-down restore: act on
 * the base first).
 */
export const listTrashedByBase = async (baseId: string): Promise<Table[]> => {
  // SELECT t.* (not bare COLS) — see listByBase for rationale: both
  // `tables.id` and `bases.id` exist after the JOIN, so unqualified
  // column names in the projection raise 42702.
  const rows = await sql<DbRow[]>`
    SELECT t.*
    FROM grids.tables t
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE t.base_id = ${baseId}::uuid AND t.deleted_at IS NOT NULL
    ORDER BY t.deleted_at DESC
  `;
  return rows.map(mapRow);
};

/**
 * Reads a single table. Live-parent invariant: the parent base must be
 * alive (b.deleted_at IS NULL); a leaked UUID under a trashed base never
 * resolves outside the trash flow. Pass `includeDeleted: true` to allow
 * trashed *table* rows (used by the trash listing's restore path); the
 * parent base must still be alive — restore is top-down only.
 */
export const get = async (
  id: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Table | null> => {
  // SELECT t.* — see listByBase. Bare COLS would be ambiguous after
  // the JOIN to grids.bases (both carry `id`).
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT t.*
        FROM grids.tables t
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE t.id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT t.*
        FROM grids.tables t
        JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
        WHERE t.id = ${id}::uuid AND t.deleted_at IS NULL
      `;
  return row ? mapRow(row) : null;
};

/**
 * Look up a table by (baseId, slug). Used at the SSR-route boundary
 * to resolve URL slugs to UUIDs. Returns null for soft-deleted tables
 * AND for any table whose parent base is trashed (live-parent invariant).
 */
export const getByShortId = async (baseId: string, shortId: string): Promise<Table | null> => {
  // SELECT t.* — see listByBase for rationale.
  const [row] = await sql<DbRow[]>`
    SELECT t.*
    FROM grids.tables t
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE t.base_id = ${baseId}::uuid AND t.short_id = ${shortId} AND t.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

/**
 * Tolerant lookup. Accepts either a UUID (36 chars) or a slug (5 chars).
 * Mirrors `bases.getByIdOrShortId` — see the rationale there.
 */
export const getByIdOrShortId = async (baseId: string, idOrSlug: string): Promise<Table | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const t = await get(idOrSlug);
    // Verify base scope so a leaked UUID can't address a table from another base.
    return t && t.baseId === baseId ? t : null;
  }
  return getByShortId(baseId, idOrSlug);
};

export const create = async (input: CreateTableInput, actorId: string | null): Promise<Result<Table>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));
  const columnsParsed = FieldColumnSpecSchema.array().safeParse(input.columns ?? []);
  if (!columnsParsed.success) return fail(err.badInput("invalid table columns"));

  const row = await insertWithShortId<DbRow>(async (shortId) => {
    const [r] = await sql<DbRow[]>`
      INSERT INTO grids.tables (short_id, base_id, name, description, icon, columns, position)
      VALUES (
        ${shortId},
        ${input.baseId}::uuid,
        ${name},
        ${input.description ?? null},
        ${input.icon ?? null},
        ${columnsParsed.data}::jsonb,
        COALESCE((SELECT MAX(position) + 1 FROM grids.tables WHERE base_id = ${input.baseId}::uuid AND deleted_at IS NULL), 0)
      )
      RETURNING ${COLS}
    `;
    if (!r) throw new Error("insert returned no row");
    return r;
  }, "idx_grids_tables_short_id");
  const table = mapRow(row);
  await logAudit({ baseId: input.baseId, tableId: table.id, userId: actorId, action: "created" });
  await emitMetadataEvent({
    type: "table.created",
    baseId: input.baseId,
    resource: { kind: "table", id: table.id, tableId: table.id },
    actorId,
  });
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
    icon: input.icon !== undefined ? input.icon : existing.icon,
    columns: input.columns !== undefined ? input.columns : existing.columns,
    disableDirectInsert:
      input.disableDirectInsert !== undefined ? input.disableDirectInsert : existing.disableDirectInsert,
  };
  const columnsParsed = FieldColumnSpecSchema.array().safeParse(next.columns);
  if (!columnsParsed.success) return fail(err.badInput("invalid table columns"));

  const [row] = await sql<DbRow[]>`
    UPDATE grids.tables
    SET name = ${next.name},
        description = ${next.description},
        icon = ${next.icon},
        columns = ${columnsParsed.data}::jsonb,
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
  if (next.icon !== existing.icon) diff.icon = { old: existing.icon, new: next.icon };
  if (JSON.stringify(columnsParsed.data) !== JSON.stringify(existing.columns)) {
    diff.columns = { old: existing.columns, new: columnsParsed.data };
  }
  if (next.disableDirectInsert !== existing.disableDirectInsert) {
    diff.disableDirectInsert = { old: existing.disableDirectInsert, new: next.disableDirectInsert };
  }
  if (Object.keys(diff).length > 0) {
    await logAudit({ baseId: table.baseId, tableId: id, userId: actorId, action: "updated", diff });
    await emitMetadataEvent({
      type: "table.updated",
      baseId: table.baseId,
      resource: { kind: "table", id, tableId: id },
      actorId,
    });
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
  await emitMetadataEvent({
    type: "table.deleted",
    baseId: existing.baseId,
    resource: { kind: "table", id, tableId: id },
    actorId,
  });
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
  await emitMetadataEvent({
    type: "table.restored",
    baseId: existing.baseId,
    resource: { kind: "table", id, tableId: id },
    actorId,
  });
  return ok(table);
};
