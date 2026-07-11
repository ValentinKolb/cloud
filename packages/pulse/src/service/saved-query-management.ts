import { err, fail, ok, type Result } from "@valentinkolb/cloud/server";
import { sql } from "bun";
import type { PulseSavedQuery } from "../contracts";
import { compilePulseQueryText } from "../query-dsl";
import { requireBaseAccess, requireBaseActive, type UserScope } from "./access-control";
import { iso } from "./telemetry-values";

type SavedQueryRow = {
  id: string;
  base_id: string;
  name: string;
  description: string | null;
  query: string;
  created_at: Date | string;
  updated_at: Date | string;
};

const mapSavedQuery = (row: SavedQueryRow): PulseSavedQuery => ({
  id: row.id,
  baseId: row.base_id,
  name: row.name,
  description: row.description,
  query: row.query,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

export const listSavedQueries = async (baseId: string, user: UserScope): Promise<Result<PulseSavedQuery[]>> => {
  const access = await requireBaseAccess(baseId, user, "read");
  if (!access.ok) return fail(access.error);
  const rows = await sql<SavedQueryRow[]>`
    SELECT id, base_id, name, description, query, created_at, updated_at
    FROM pulse.saved_queries
    WHERE base_id = ${baseId}::uuid
    ORDER BY updated_at DESC, name ASC
    LIMIT 100
  `;
  return ok(rows.map(mapSavedQuery));
};

export const createSavedQuery = async (params: {
  baseId: string;
  user: UserScope;
  name: string;
  description?: string | null;
  query: string;
}): Promise<Result<PulseSavedQuery>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);
  const name = params.name.trim();
  const query = params.query.trim();
  if (!name) return fail(err.badInput("Query name is required"));
  if (!query) return fail(err.badInput("Query is required"));
  const compiled = compilePulseQueryText(params.baseId, query);
  if (!compiled.ok) return fail(compiled.error);
  const [row] = await sql<SavedQueryRow[]>`
    INSERT INTO pulse.saved_queries (base_id, name, description, query, created_by)
    VALUES (${params.baseId}::uuid, ${name}, ${params.description?.trim() || null}, ${query}, ${params.user.id}::uuid)
    RETURNING id, base_id, name, description, query, created_at, updated_at
  `;
  if (!row) return fail(err.internal("Failed to save query"));
  return ok(mapSavedQuery(row));
};

export const deleteSavedQuery = async (params: { baseId: string; queryId: string; user: UserScope }): Promise<Result<void>> => {
  const access = await requireBaseAccess(params.baseId, params.user, "write");
  if (!access.ok) return fail(access.error);
  const active = await requireBaseActive(params.baseId);
  if (!active.ok) return fail(active.error);
  const deleted = await sql`
    DELETE FROM pulse.saved_queries
    WHERE base_id = ${params.baseId}::uuid
      AND id = ${params.queryId}::uuid
  `;
  if (deleted.count === 0) return fail(err.notFound("Saved query"));
  return ok();
};
