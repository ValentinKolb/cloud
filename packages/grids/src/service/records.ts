import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";
import { listByTable as listFields } from "./fields";
import { getHandler } from "../field-types";
import { compileFilter, renderClause, type FilterTree } from "./filter-compiler";
import {
  compileSort,
  encodeCursor,
  decodeCursor,
  type SortSpec,
} from "./sort-compiler";
import { compileAggregates, type AggregateRequest } from "./aggregate-compiler";
import type { GridRecord } from "./types";

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): GridRecord => ({
  id: row.id as string,
  tableId: row.table_id as string,
  data: (row.data as Record<string, unknown>) ?? {},
  version: row.version as number,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdBy: (row.created_by as string | null) ?? null,
  updatedBy: (row.updated_by as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

/**
 * Create-path validation: every user-writable field is materialized using
 * either the provided value or the field's default. Required-checks apply.
 * Autonumber fields receive a sequence value derived from the existing rows.
 */
const validateForCreate = async (
  tableId: string,
  payload: Record<string, unknown>,
): Promise<Result<Record<string, unknown>>> => {
  const fields = await listFields(tableId);
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const key of Object.keys(payload)) {
    if (!fieldsById.has(key)) return fail(err.badInput(`unknown field "${key}"`));
  }

  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === "autonumber") {
      const [row] = await sql<DbRow[]>`
        SELECT COALESCE(MAX((data->>${field.id})::bigint), 0) + 1 AS next
        FROM grids.records WHERE table_id = ${tableId}::uuid
      `;
      out[field.id] = Number(row?.next ?? 1);
      continue;
    }
    const handler = getHandler(field.type);
    if (!handler || !handler.userInput) continue;

    const provided = Object.prototype.hasOwnProperty.call(payload, field.id);
    const raw = provided ? payload[field.id] : field.defaultValue;
    const result = handler.validate(raw, field.config, field.required);
    if (!result.ok) return fail(err.badInput(`field "${field.name}": ${result.error}`));
    if (result.value !== null && result.value !== undefined) {
      out[field.id] = result.value;
    }
  }
  return ok(out);
};

/**
 * Update-path validation: ONLY the fields present in the payload are validated.
 * Omitted fields are left to the merge step in `update()` to preserve existing
 * values. Explicit `null` is a clear-the-field intent and must round-trip.
 */
const validateForUpdate = async (
  tableId: string,
  payload: Record<string, unknown>,
): Promise<Result<Record<string, unknown>>> => {
  const fields = await listFields(tableId);
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const key of Object.keys(payload)) {
    if (!fieldsById.has(key)) return fail(err.badInput(`unknown field "${key}"`));
  }

  const out: Record<string, unknown> = {};
  for (const [fieldId, raw] of Object.entries(payload)) {
    const field = fieldsById.get(fieldId)!;
    const handler = getHandler(field.type);
    if (!handler || !handler.userInput) {
      return fail(err.badInput(`field "${field.name}" is not user-writable`));
    }
    const result = handler.validate(raw, field.config, field.required);
    if (!result.ok) return fail(err.badInput(`field "${field.name}": ${result.error}`));
    out[fieldId] = result.value;
  }
  return ok(out);
};

export const list = async (params: {
  tableId: string;
  cursor?: string | null;
  limit?: number;
  includeDeleted?: boolean;
  filter?: FilterTree | null;
  sort?: SortSpec[];
}): Promise<Result<{ items: GridRecord[]; nextCursor: string | null }>> => {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const fields = await listFields(params.tableId);

  // Filter compilation
  const filterCompiled = compileFilter(params.filter ?? null, fields);
  if (!filterCompiled.ok) return fail(err.badInput(`filter: ${filterCompiled.error}`));
  const filterClause = renderClause(filterCompiled.clause);

  // Sort compilation (with cursor decoding when present)
  const decodedCursor = params.cursor ? decodeCursor(params.cursor) : null;
  if (params.cursor && !decodedCursor) {
    return fail(err.badInput("invalid cursor"));
  }
  const sortCompiled = compileSort(params.sort ?? [], fields, decodedCursor);
  if (!sortCompiled.ok) return fail(err.badInput(`sort: ${sortCompiled.error}`));
  const { orderBy, cursorWhere, projections } = sortCompiled.result;

  const conditions: any[] = [sql`table_id = ${params.tableId}::uuid`];
  if (!params.includeDeleted) conditions.push(sql`deleted_at IS NULL`);
  conditions.push(filterClause);
  if (cursorWhere) conditions.push(cursorWhere);
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  const rows = await sql<DbRow[]>`
    SELECT * FROM grids.records WHERE ${where}
    ORDER BY ${orderBy} LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(mapRow);

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = items[items.length - 1]!;
    const sortValues = projections.map((p) => last.data[p.fieldId] ?? null);
    nextCursor = encodeCursor({ sortValues, id: last.id });
  }
  return ok({ items, nextCursor });
};

export const aggregate = async (params: {
  tableId: string;
  filter?: FilterTree | null;
  requests: AggregateRequest[];
}): Promise<Result<Record<string, unknown>>> => {
  const fields = await listFields(params.tableId);

  const filterCompiled = compileFilter(params.filter ?? null, fields);
  if (!filterCompiled.ok) return fail(err.badInput(`filter: ${filterCompiled.error}`));
  const filterClause = renderClause(filterCompiled.clause);

  const aggCompiled = compileAggregates(params.requests, fields);
  if (!aggCompiled.ok) return fail(err.badInput(`aggregate: ${aggCompiled.error}`));

  if (aggCompiled.columns.length === 0) return ok({});

  // Aggregate query: a single SELECT with all expressions side-by-side.
  // We assemble the SELECT list as a comma-separated reduce, then alias by
  // pushing each expr into a separate sub-fragment that names the column
  // via JSON construction (sidestepping bun.sql's missing identifier helper).
  const jsonPairs = aggCompiled.columns
    .map((col) => sql`${col.key}, ${col.expr}`)
    .reduce((acc, cur) => sql`${acc}, ${cur}`);

  const rows = await sql<{ result: Record<string, unknown> }[]>`
    SELECT jsonb_build_object(${jsonPairs}) AS result
    FROM grids.records
    WHERE table_id = ${params.tableId}::uuid
      AND deleted_at IS NULL
      AND ${filterClause}
  `;
  return ok((rows[0]?.result as Record<string, unknown>) ?? {});
};

export const get = async (tableId: string, recordId: string): Promise<GridRecord | null> => {
  const [row] = await sql<DbRow[]>`
    SELECT * FROM grids.records
    WHERE id = ${recordId}::uuid AND table_id = ${tableId}::uuid
  `;
  return row ? mapRow(row) : null;
};

export const create = async (
  tableId: string,
  payload: Record<string, unknown>,
  actorId: string | null,
): Promise<Result<GridRecord>> => {
  const validated = await validateForCreate(tableId, payload);
  if (!validated.ok) return validated;

  const id = Bun.randomUUIDv7();
  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.records (id, table_id, data, version, created_by, updated_by)
    VALUES (
      ${id}::uuid,
      ${tableId}::uuid,
      ${JSON.stringify(validated.data)}::jsonb,
      1,
      ${actorId}::uuid,
      ${actorId}::uuid
    )
    RETURNING *
  `;
  if (!row) return fail(err.internal("insert failed"));
  const record = mapRow(row);
  await logAudit({
    tableId,
    recordId: record.id,
    userId: actorId,
    action: "created",
    diff: Object.fromEntries(
      Object.entries(validated.data).map(([k, v]) => [k, { old: null, new: v }]),
    ),
  });
  return ok(record);
};

export const update = async (
  tableId: string,
  recordId: string,
  payload: Record<string, unknown>,
  actorId: string | null,
  ifMatchVersion?: number,
): Promise<Result<GridRecord>> => {
  const existing = await get(tableId, recordId);
  if (!existing || existing.deletedAt) return fail(err.notFound("Record"));
  if (ifMatchVersion !== undefined && ifMatchVersion !== existing.version) {
    return fail(err.conflict("Record version mismatch"));
  }

  const validated = await validateForUpdate(tableId, payload);
  if (!validated.ok) return validated;

  // Merge: existing data + only the validated fields. Explicit-null in payload
  // means "clear this field" — preserved through the merge as null.
  const merged = { ...existing.data, ...validated.data };
  // Strip nulls so JSONB doesn't carry zombie keys for cleared fields.
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) delete merged[k];
  }

  const [row] = await sql<DbRow[]>`
    UPDATE grids.records
    SET data = ${JSON.stringify(merged)}::jsonb,
        version = version + 1,
        updated_by = ${actorId}::uuid,
        updated_at = now()
    WHERE id = ${recordId}::uuid
      AND table_id = ${tableId}::uuid
      AND deleted_at IS NULL
      AND version = ${existing.version}
    RETURNING *
  `;
  if (!row) return fail(err.conflict("Record was modified concurrently"));
  const record = mapRow(row);

  const diff: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of Object.keys(validated.data)) {
    const oldVal = existing.data[key] ?? null;
    const newVal = validated.data[key] ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }
  if (Object.keys(diff).length > 0) {
    await logAudit({ tableId, recordId, userId: actorId, action: "updated", diff });
  }
  return ok(record);
};

export const softDelete = async (
  tableId: string,
  recordId: string,
  actorId: string | null,
): Promise<Result<void>> => {
  const result = await sql`
    UPDATE grids.records SET deleted_at = now(), updated_by = ${actorId}::uuid
    WHERE id = ${recordId}::uuid AND table_id = ${tableId}::uuid AND deleted_at IS NULL
  `;
  if (result.count === 0) return fail(err.notFound("Record"));
  await logAudit({ tableId, recordId, userId: actorId, action: "deleted" });
  return ok();
};

export const restore = async (
  tableId: string,
  recordId: string,
  actorId: string | null,
): Promise<Result<void>> => {
  const result = await sql`
    UPDATE grids.records SET deleted_at = NULL, updated_by = ${actorId}::uuid, updated_at = now()
    WHERE id = ${recordId}::uuid AND table_id = ${tableId}::uuid AND deleted_at IS NOT NULL
  `;
  if (result.count === 0) return fail(err.notFound("Record"));
  await logAudit({ tableId, recordId, userId: actorId, action: "restored" });
  return ok();
};
