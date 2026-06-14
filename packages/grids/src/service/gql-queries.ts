import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { GqlQuery } from "../contracts";
import { canonicalizeDslQuery } from "../query-dsl/canonical";
import { parseGridsQueryDsl } from "../query-dsl/parser";
import { normalizeRefKey } from "../ref-syntax";
import { logAudit } from "./audit";
import { buildBaseGqlResolverContext } from "./gql-resolver-context";
import { emitMetadataEvent } from "./metadata-events";
import { insertWithShortId } from "./short-id";

type DbRow = Record<string, unknown>;

export type { GqlQuery };

const mapRow = (row: DbRow): GqlQuery => ({
  id: row.id as string,
  shortId: row.short_id as string,
  baseId: row.base_id as string,
  tableId: row.table_id as string,
  name: row.name as string,
  icon: (row.icon as string | null) ?? null,
  source: row.source as string,
  ownerUserId: (row.owner_user_id as string | null) ?? null,
  position: row.position as number,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

type CanonicalSource = {
  source: string;
  tableId: string;
};

const canonicalizeSourceForBase = async (baseId: string, tableId: string, source: string): Promise<Result<CanonicalSource>> => {
  if (source.length === 0) return fail(err.badInput("query source required"));
  if (source.length > 20_000) return fail(err.badInput("query source is too long"));
  const parsed = parseGridsQueryDsl(source);
  if (!parsed.ok) return fail(err.badInput(parsed.diagnostics[0]?.message ?? "invalid GQL source"));
  const context = await buildBaseGqlResolverContext({ baseId, currentTableId: tableId, ast: parsed.ast });
  const canonical = canonicalizeDslQuery(parsed.ast, context);
  if (!canonical.ok) return fail(err.badInput(canonical.diagnostics[0]?.message ?? "invalid GQL source"));
  if (canonical.plan.tableId !== tableId) return fail(err.badInput("query root table does not match source"));
  return ok({ source: canonical.source, tableId: canonical.plan.tableId });
};

const validateRootTable = async (baseId: string, tableId: string): Promise<Result<void>> => {
  const [row] = await sql<{ id: string }[]>`
    SELECT t.id::text AS id
    FROM grids.tables t
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE t.id = ${tableId}::uuid
      AND t.base_id = ${baseId}::uuid
      AND t.deleted_at IS NULL
  `;
  return row ? ok() : fail(err.badInput("query root table is not available in this base"));
};

const ensureUniqueGqlQueryName = async (baseId: string, name: string, exceptQueryId: string | null = null): Promise<Result<void>> => {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM grids.gql_queries
    WHERE base_id = ${baseId}::uuid
      AND deleted_at IS NULL
      AND lower(trim(name)) = ${normalizeRefKey(name)}
      AND (${exceptQueryId}::uuid IS NULL OR id <> ${exceptQueryId}::uuid)
  `;
  return (row?.count ?? 0) === 0 ? ok() : fail(err.conflict("query name must be unique within this grid"));
};

export const listForBase = async (params: { baseId: string; userId: string | null; includePrivate?: boolean }): Promise<GqlQuery[]> => {
  const rows = await sql<DbRow[]>`
    SELECT q.*
    FROM grids.gql_queries q
    JOIN grids.bases b ON b.id = q.base_id AND b.deleted_at IS NULL
    JOIN grids.tables t ON t.id = q.table_id AND t.deleted_at IS NULL
    WHERE q.base_id = ${params.baseId}::uuid
      AND q.deleted_at IS NULL
      AND (${params.includePrivate ?? false}::boolean OR q.owner_user_id IS NULL OR q.owner_user_id = ${params.userId}::uuid)
    ORDER BY q.position, q.created_at
  `;
  return rows.map(mapRow);
};

export const get = async (id: string, opts: { includeDeleted?: boolean } = {}): Promise<GqlQuery | null> => {
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT q.*
        FROM grids.gql_queries q
        JOIN grids.bases b ON b.id = q.base_id AND b.deleted_at IS NULL
        JOIN grids.tables t ON t.id = q.table_id AND t.deleted_at IS NULL
        WHERE q.id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT q.*
        FROM grids.gql_queries q
        JOIN grids.bases b ON b.id = q.base_id AND b.deleted_at IS NULL
        JOIN grids.tables t ON t.id = q.table_id AND t.deleted_at IS NULL
        WHERE q.id = ${id}::uuid AND q.deleted_at IS NULL
      `;
  return row ? mapRow(row) : null;
};

export const getByShortId = async (baseId: string, shortId: string): Promise<GqlQuery | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT q.*
    FROM grids.gql_queries q
    JOIN grids.bases b ON b.id = q.base_id AND b.deleted_at IS NULL
    JOIN grids.tables t ON t.id = q.table_id AND t.deleted_at IS NULL
    WHERE q.base_id = ${baseId}::uuid AND q.short_id = ${shortId} AND q.deleted_at IS NULL
  `;
  return row ? mapRow(row) : null;
};

export const getByIdOrShortId = async (baseId: string, idOrSlug: string): Promise<GqlQuery | null> => {
  if (idOrSlug.length === 36 && idOrSlug.includes("-")) {
    const query = await get(idOrSlug);
    return query && query.baseId === baseId ? query : null;
  }
  return getByShortId(baseId, idOrSlug);
};

export type CreateGqlQueryServiceInput = {
  baseId: string;
  tableId: string;
  name: string;
  icon?: string | null;
  source: string;
  ownerUserId?: string | null;
};

export const create = async (input: CreateGqlQueryServiceInput, actorId: string | null): Promise<Result<GqlQuery>> => {
  const name = input.name.trim();
  if (name.length === 0) return fail(err.badInput("name required"));
  const uniqueName = await ensureUniqueGqlQueryName(input.baseId, name);
  if (!uniqueName.ok) return uniqueName;
  const source = input.source.trim();
  const tableValid = await validateRootTable(input.baseId, input.tableId);
  if (!tableValid.ok) return tableValid;
  const canonical = await canonicalizeSourceForBase(input.baseId, input.tableId, source);
  if (!canonical.ok) return canonical;

  const row = await insertWithShortId<DbRow>(async (shortId) => {
    const [r] = await sql<DbRow[]>`
      INSERT INTO grids.gql_queries (short_id, base_id, table_id, name, icon, source, owner_user_id, position)
      VALUES (
        ${shortId},
        ${input.baseId}::uuid,
        ${input.tableId}::uuid,
        ${name},
        ${input.icon ?? null},
        ${canonical.data.source},
        ${input.ownerUserId ?? null}::uuid,
        COALESCE((SELECT MAX(position) + 1 FROM grids.gql_queries WHERE base_id = ${input.baseId}::uuid), 0)
      )
      RETURNING id, short_id, base_id, table_id, name, icon, source, owner_user_id, position, deleted_at, created_at, updated_at
    `;
    if (!r) throw new Error("insert returned no row");
    return r;
  }, "idx_grids_gql_queries_short_id");
  const query = mapRow(row);
  await logAudit({
    baseId: input.baseId,
    tableId: input.tableId,
    userId: actorId,
    action: "created",
    diff: { gqlQuery: { old: null, new: { id: query.id, name: query.name } } },
  });
  await emitMetadataEvent({
    type: "gqlQuery.created",
    baseId: input.baseId,
    resource: { kind: "gqlQuery", id: query.id, tableId: input.tableId },
    actorId,
  });
  return ok(query);
};

export type UpdateGqlQueryServiceInput = {
  tableId?: string;
  name?: string;
  icon?: string | null;
  source?: string;
  position?: number;
  shared?: boolean;
};

export const update = async (id: string, input: UpdateGqlQueryServiceInput, actorId: string | null): Promise<Result<GqlQuery>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("GQL query"));
  if ((input.source === undefined) !== (input.tableId === undefined)) {
    return fail(err.badInput("query source and root table must be updated together"));
  }

  const name = input.name?.trim();
  if (name !== undefined && name.length === 0) return fail(err.badInput("name cannot be empty"));
  const uniqueName = await ensureUniqueGqlQueryName(existing.baseId, name ?? existing.name, existing.id);
  if (!uniqueName.ok) return uniqueName;

  const source = input.source?.trim();
  const tableId = input.tableId ?? existing.tableId;
  let canonical: CanonicalSource | null = null;
  if (input.tableId !== undefined) {
    const tableValid = await validateRootTable(existing.baseId, input.tableId);
    if (!tableValid.ok) return tableValid;
    if (source === undefined) return fail(err.badInput("query source required"));
    const canonicalResult = await canonicalizeSourceForBase(existing.baseId, input.tableId, source);
    if (!canonicalResult.ok) return canonicalResult;
    canonical = canonicalResult.data;
  }
  const ownerUserId = input.shared === undefined ? existing.ownerUserId : input.shared ? null : actorId;

  const next = {
    tableId,
    name: name ?? existing.name,
    icon: input.icon !== undefined ? input.icon : existing.icon,
    source: canonical?.source ?? existing.source,
    position: input.position ?? existing.position,
  };

  const [row] = await sql<DbRow[]>`
    UPDATE grids.gql_queries
    SET table_id = ${next.tableId}::uuid,
        name = ${next.name},
        icon = ${next.icon},
        source = ${next.source},
        position = ${next.position},
        owner_user_id = ${ownerUserId}::uuid,
        updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING id, short_id, base_id, table_id, name, icon, source, owner_user_id, position, deleted_at, created_at, updated_at
  `;
  if (!row) return fail(err.internal("update failed"));
  const query = mapRow(row);
  await logAudit({
    baseId: existing.baseId,
    tableId: query.tableId,
    userId: actorId,
    action: "updated",
    diff: { gqlQuery: { old: existing.name, new: query.name } },
  });
  await emitMetadataEvent({
    type: "gqlQuery.updated",
    baseId: existing.baseId,
    resource: { kind: "gqlQuery", id: query.id, tableId: query.tableId },
    actorId,
  });
  return ok(query);
};

export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(id);
  if (!existing) return fail(err.notFound("GQL query"));
  await sql`UPDATE grids.gql_queries SET deleted_at = now() WHERE id = ${id}::uuid AND deleted_at IS NULL`;
  await logAudit({ baseId: existing.baseId, tableId: existing.tableId, userId: actorId, action: "deleted" });
  await emitMetadataEvent({
    type: "gqlQuery.deleted",
    baseId: existing.baseId,
    resource: { kind: "gqlQuery", id, tableId: existing.tableId },
    actorId,
  });
  return ok();
};

export const restore = async (id: string, actorId: string | null): Promise<Result<GqlQuery>> => {
  const existing = await get(id, { includeDeleted: true });
  if (!existing) return fail(err.notFound("GQL query"));
  if (existing.deletedAt === null) return ok(existing);
  const uniqueName = await ensureUniqueGqlQueryName(existing.baseId, existing.name, existing.id);
  if (!uniqueName.ok) return uniqueName;
  const [row] = await sql<DbRow[]>`
    UPDATE grids.gql_queries SET deleted_at = NULL, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING id, short_id, base_id, table_id, name, icon, source, owner_user_id, position, deleted_at, created_at, updated_at
  `;
  if (!row) return fail(err.internal("restore failed"));
  const query = mapRow(row);
  await logAudit({ baseId: existing.baseId, tableId: existing.tableId, userId: actorId, action: "restored" });
  await emitMetadataEvent({
    type: "gqlQuery.restored",
    baseId: existing.baseId,
    resource: { kind: "gqlQuery", id, tableId: existing.tableId },
    actorId,
  });
  return ok(query);
};
