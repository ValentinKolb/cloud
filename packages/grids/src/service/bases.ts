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

// ──────────────────────────────────────────────────────────────────
// Admin views (platform-admin only — bypasses per-base ACLs)
// ──────────────────────────────────────────────────────────────────

export type AdminListItem = Base & {
  tableCount: number;
  recordCount: number;
  accessCount: number;
};

const escapeLikePattern = (s: string): string => s.replace(/([\\%_])/g, "\\$1");

export const adminList = async (params: {
  pagination?: { perPage?: number; offset?: number };
  filter?: { query?: string };
}): Promise<{ items: AdminListItem[]; total: number; page: number; perPage: number }> => {
  const perPage = Math.min(Math.max(params.pagination?.perPage ?? 100, 1), 500);
  const offset = Math.max(params.pagination?.offset ?? 0, 0);
  const page = Math.floor(offset / perPage) + 1;
  const query = params.filter?.query?.trim().toLowerCase();

  const conditions: any[] = [sql`TRUE`];
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    conditions.push(sql`(LOWER(b.name) LIKE ${pattern} ESCAPE '\\' OR LOWER(COALESCE(b.description, '')) LIKE ${pattern} ESCAPE '\\')`);
  }
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  const [countRow] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM grids.bases b WHERE ${where}
  `;

  const rows = await sql<DbRow[]>`
    SELECT
      b.id, b.name, b.description, b.created_by, b.created_at, b.updated_at,
      (SELECT COUNT(*)::int FROM grids.tables WHERE base_id = b.id) AS table_count,
      (SELECT COUNT(*)::int FROM grids.records r JOIN grids.tables t ON t.id = r.table_id WHERE t.base_id = b.id AND r.deleted_at IS NULL) AS record_count,
      (SELECT COUNT(*)::int FROM grids.base_access WHERE base_id = b.id) AS access_count
    FROM grids.bases b
    WHERE ${where}
    ORDER BY b.created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return {
    items: rows.map((row) => ({
      ...mapRow(row),
      tableCount: row.table_count as number,
      recordCount: row.record_count as number,
      accessCount: row.access_count as number,
    })),
    total: countRow?.total ?? 0,
    page,
    perPage,
  };
};

export const adminSummary = async (params: {
  filter?: { query?: string };
}): Promise<{ totalBases: number; totalTables: number; totalRecords: number; orphanedBases: number }> => {
  const query = params.filter?.query?.trim().toLowerCase();
  const conditions: any[] = [sql`TRUE`];
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    conditions.push(sql`(LOWER(b.name) LIKE ${pattern} ESCAPE '\\' OR LOWER(COALESCE(b.description, '')) LIKE ${pattern} ESCAPE '\\')`);
  }
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  const [row] = await sql<DbRow[]>`
    SELECT
      (SELECT COUNT(*)::int FROM grids.bases b WHERE ${where}) AS total_bases,
      (SELECT COUNT(*)::int FROM grids.tables t JOIN grids.bases b ON b.id = t.base_id WHERE ${where}) AS total_tables,
      (SELECT COUNT(*)::int FROM grids.records r JOIN grids.tables t ON t.id = r.table_id JOIN grids.bases b ON b.id = t.base_id WHERE r.deleted_at IS NULL AND ${where}) AS total_records,
      (SELECT COUNT(*)::int FROM grids.bases b WHERE NOT EXISTS (SELECT 1 FROM grids.base_access WHERE base_id = b.id) AND ${where}) AS orphaned_bases
  `;
  return {
    totalBases: (row?.total_bases as number) ?? 0,
    totalTables: (row?.total_tables as number) ?? 0,
    totalRecords: (row?.total_records as number) ?? 0,
    orphanedBases: (row?.orphaned_bases as number) ?? 0,
  };
};
