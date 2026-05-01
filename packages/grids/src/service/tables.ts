import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";
import type { Table, CreateTableInput, UpdateTableInput } from "./types";

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): Table => ({
  id: row.id as string,
  baseId: row.base_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  primaryFieldId: (row.primary_field_id as string | null) ?? null,
  position: row.position as number,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

export const listByBase = async (baseId: string): Promise<Table[]> => {
  const rows = await sql<DbRow[]>`
    SELECT id, base_id, name, description, primary_field_id, position, created_at, updated_at
    FROM grids.tables WHERE base_id = ${baseId}::uuid
    ORDER BY position, created_at
  `;
  return rows.map(mapRow);
};

export const get = async (id: string): Promise<Table | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, base_id, name, description, primary_field_id, position, created_at, updated_at
    FROM grids.tables WHERE id = ${id}::uuid
  `;
  return row ? mapRow(row) : null;
};

export const create = async (input: CreateTableInput, actorId: string | null): Promise<Result<Table>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));

  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.tables (base_id, name, description, position)
    VALUES (
      ${input.baseId}::uuid,
      ${name},
      ${input.description ?? null},
      COALESCE((SELECT MAX(position) + 1 FROM grids.tables WHERE base_id = ${input.baseId}::uuid), 0)
    )
    RETURNING id, base_id, name, description, primary_field_id, position, created_at, updated_at
  `;
  if (!row) return fail(err.internal("insert failed"));
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
    primaryFieldId:
      input.primaryFieldId !== undefined ? input.primaryFieldId : existing.primaryFieldId,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.tables
    SET name = ${next.name},
        description = ${next.description},
        primary_field_id = ${next.primaryFieldId}::uuid,
        updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, base_id, name, description, primary_field_id, position, created_at, updated_at
  `;
  if (!row) return fail(err.internal("update failed"));
  const table = mapRow(row);

  const diff: Record<string, { old: unknown; new: unknown }> = {};
  if (next.name !== existing.name) diff.name = { old: existing.name, new: next.name };
  if (next.description !== existing.description) {
    diff.description = { old: existing.description, new: next.description };
  }
  if (next.primaryFieldId !== existing.primaryFieldId) {
    diff.primaryFieldId = { old: existing.primaryFieldId, new: next.primaryFieldId };
  }
  if (Object.keys(diff).length > 0) {
    await logAudit({ baseId: table.baseId, tableId: id, userId: actorId, action: "updated", diff });
  }

  return ok(table);
};

export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("Table"));
  await sql`DELETE FROM grids.tables WHERE id = ${id}::uuid`;
  await logAudit({ baseId: existing.baseId, tableId: id, userId: actorId, action: "deleted" });
  return ok();
};
