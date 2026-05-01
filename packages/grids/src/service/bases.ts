import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";
import { grantAccess } from "./access";
import type { Base, CreateBaseInput, UpdateBaseInput } from "./types";

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): Base => ({
  id: row.id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  createdBy: (row.created_by as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

export const list = async (): Promise<Base[]> => {
  const rows = await sql<DbRow[]>`
    SELECT id, name, description, created_by, created_at, updated_at
    FROM grids.bases
    ORDER BY created_at DESC
  `;
  return rows.map(mapRow);
};

export const get = async (id: string): Promise<Base | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT id, name, description, created_by, created_at, updated_at
    FROM grids.bases WHERE id = ${id}::uuid
  `;
  return row ? mapRow(row) : null;
};

export const create = async (input: CreateBaseInput, actorId: string | null): Promise<Result<Base>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));

  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.bases (name, description, created_by)
    VALUES (${name}, ${input.description ?? null}, ${actorId}::uuid)
    RETURNING id, name, description, created_by, created_at, updated_at
  `;
  if (!row) return fail(err.internal("insert failed"));
  const base = mapRow(row);

  // Auto-grant admin to the creator so they can immediately use the new base.
  // Without this, no ACL row exists and the resolver returns "none" — the
  // creator would lock themselves out at the moment of creation.
  if (actorId) {
    const granted = await grantAccess({
      resourceType: "base",
      resourceId: base.id,
      principal: { type: "user", userId: actorId },
      permission: "admin",
    });
    if (!granted.ok) return fail(granted.error);
  }

  await logAudit({ baseId: base.id, userId: actorId, action: "created" });
  return ok(base);
};

export const update = async (id: string, input: UpdateBaseInput, actorId: string | null): Promise<Result<Base>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("base"));

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));

  const next = {
    name: name ?? existing.name,
    description: input.description !== undefined ? input.description : existing.description,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.bases
    SET name = ${next.name}, description = ${next.description}, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, name, description, created_by, created_at, updated_at
  `;
  if (!row) return fail(err.internal("update failed"));
  const base = mapRow(row);

  const diff: Record<string, { old: unknown; new: unknown }> = {};
  if (next.name !== existing.name) diff.name = { old: existing.name, new: next.name };
  if (next.description !== existing.description) {
    diff.description = { old: existing.description, new: next.description };
  }
  if (Object.keys(diff).length > 0) {
    await logAudit({ baseId: id, userId: actorId, action: "updated", diff });
  }

  return ok(base);
};

export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const result = await sql`DELETE FROM grids.bases WHERE id = ${id}::uuid`;
  if (result.count === 0) return fail(err.notFound("base"));
  await logAudit({ baseId: id, userId: actorId, action: "deleted" });
  return ok();
};
