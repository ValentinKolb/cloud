import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logAudit } from "./audit";
import { parseJsonbRow } from "./jsonb";
import { requireTableAlive } from "./parent-checks";
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
import {
  compileGroupQuery,
  type GroupBucket,
  type GroupBySpec,
  type GroupAggregationSpec,
} from "./group-compiler";
import {
  enrichRecordsWithFormulas,
  hydrateRelationsFromLinks,
  validateRelationTargets,
  writeRecordLinks,
} from "./relations";
import { nextAutonumberValue } from "./field-indexes";
import {
  applyComputedProjections,
  buildComputedProjections,
} from "./computed-projections";
import type { Field, GridRecord } from "./types";

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): GridRecord => ({
  id: row.id as string,
  tableId: row.table_id as string,
  data: parseJsonbRow<Record<string, unknown>>(row.data, {}),
  version: row.version as number,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdBy: (row.created_by as string | null) ?? null,
  updatedBy: (row.updated_by as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

/**
 * Splits a validated payload into (a) JSONB-storable scalar/array data
 * and (b) the relation-link map keyed by fieldId. Relation values stop
 * landing in `records.data` in v3 — they live exclusively in
 * `grids.record_links`. The read path hydrates them back into
 * `record.data[fieldId]` so consumers don't notice.
 *
 * Accepted shapes for a relation value: array of UUIDs (cardinality:multiple),
 * single UUID string (cardinality:single), or null/empty (no links).
 */
const splitRelationsFromData = (
  data: Record<string, unknown>,
  fields: Field[],
): { data: Record<string, unknown>; relations: Map<string, string[]> } => {
  const relationFieldIds = new Set(
    fields.filter((f) => f.type === "relation" && !f.deletedAt).map((f) => f.id),
  );
  const out: Record<string, unknown> = {};
  const relations = new Map<string, string[]>();
  for (const [k, v] of Object.entries(data)) {
    if (relationFieldIds.has(k)) {
      const ids = Array.isArray(v)
        ? (v as unknown[]).filter((x): x is string => typeof x === "string")
        : typeof v === "string"
        ? [v]
        : [];
      relations.set(k, ids);
    } else {
      out[k] = v;
    }
  }
  return { data: out, relations };
};

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
      // v3: per-field Postgres sequence. nextval() is atomic so two
      // concurrent inserts always get distinct numbers — replaces the
      // previous MAX+1 race. Sequences are created lazily on first use.
      out[field.id] = await nextAutonumberValue(field.id);
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

  // v3 Slice 4: lookup / rollup values are computed in the main query
  // as correlated subqueries over record_links instead of a JS-side
  // batch-fetch pass. Single source of truth, single round-trip.
  const computed = buildComputedProjections(fields);
  const projectionFragments = computed.length > 0
    ? computed
        .map((p) => sql`, ${p.fragment}`)
        .reduce((acc, cur) => sql`${acc}${cur}`)
    : sql``;

  const rows = await sql<DbRow[]>`
    SELECT r.*${projectionFragments}
    FROM grids.records r
    WHERE ${where}
    ORDER BY ${orderBy} LIMIT ${limit + 1}
  `;
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(mapRow);

  // Hydrate relation fields from record_links (v3 source of truth) so
  // the UI sees the link arrays. Lookup/rollup values are already in
  // the row via the projection — applyComputedProjections lifts them
  // into record.data[fieldId] alongside the JSONB-derived columns.
  await hydrateRelationsFromLinks(items, fields);
  const recordsById = new Map(items.map((r) => [r.id, r]));
  applyComputedProjections(rows.slice(0, limit) as Array<Record<string, unknown>>, recordsById, computed);

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = items[items.length - 1]!;
    const sortValues = projections.map((p) => last.data[p.fieldId] ?? null);
    nextCursor = encodeCursor({ sortValues, id: last.id });
  }
  // Formulas still run in JS — they reference computed and base values
  // alike, and the formula engine is not SQL-projectable yet.
  enrichRecordsWithFormulas(items, fields);
  return ok({ items, nextCursor });
};

/**
 * Group-by + aggregations endpoint — classic SQL GROUP BY semantics.
 * Returns one row per (groupBy-key) tuple with the configured
 * aggregations attached. Cursor pagination on the group-key tuple.
 *
 * v3 Slice 8. See group-compiler.ts for the SQL emission rules.
 */
export const group = async (params: {
  tableId: string;
  groupBy: GroupBySpec[];
  aggregations: GroupAggregationSpec[];
  filter?: FilterTree | null;
  cursor?: string | null;
  limit?: number;
  includeDeleted?: boolean;
}): Promise<Result<{ buckets: GroupBucket[]; nextCursor: string | null; explode: boolean }>> => {
  const fields = await listFields(params.tableId);

  // Cursor: keys-only (group rows have no id; the tuple itself is unique).
  let cursorKeys: { keys: unknown[] } | null = null;
  if (params.cursor) {
    try {
      const parsed = JSON.parse(params.cursor) as { k?: unknown[] };
      if (!Array.isArray(parsed.k)) return fail(err.badInput("invalid cursor"));
      cursorKeys = { keys: parsed.k };
    } catch {
      return fail(err.badInput("invalid cursor"));
    }
  }

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
  const compiled = compileGroupQuery({
    tableId: params.tableId,
    groupBy: params.groupBy,
    aggregations: params.aggregations,
    filter: params.filter,
    fields,
    cursor: cursorKeys,
    limit,
    includeDeleted: params.includeDeleted,
  });
  if (!compiled.ok) return fail(err.badInput(compiled.error));

  const rows = await sql<DbRow[]>`${compiled.query}`;
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);

  const buckets: GroupBucket[] = visible.map((row) => {
    const keys = compiled.resolvedGroups.map((_, i) => {
      const raw = row[`gk_${i}`];
      // Date keys come back as JS Date — normalize to ISO string for
      // a stable JSON envelope. Bigints (count-likes) become numbers.
      if (raw instanceof Date) return raw.toISOString();
      if (typeof raw === "bigint") return Number(raw);
      return raw ?? null;
    });
    const values: Record<string, unknown> = {};
    for (const k of compiled.aggKeys) {
      const raw = row[k];
      if (raw === null || raw === undefined) {
        values[k] = null;
        continue;
      }
      // Aggregate columns are numeric or text. Normalize bigints/strings
      // to numbers when the column was a count-like; leave others raw.
      if (typeof raw === "bigint") values[k] = Number(raw);
      else if (typeof raw === "string" && k.endsWith("__count")) values[k] = Number(raw);
      else if (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw)) values[k] = Number(raw);
      else values[k] = raw;
    }
    return { keys, values };
  });

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = buckets[buckets.length - 1]!;
    nextCursor = JSON.stringify({ k: last.keys });
  }
  // Explode-mode: at least one groupBy dimension is a relation field.
  // The `*__count` aggregate then counts (record × link) pairs rather
  // than records, which the UI should surface as a hint.
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const explode = params.groupBy.some((g) => fieldsById.get(g.fieldId)?.type === "relation");
  return ok({ buckets, nextCursor, explode });
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

  // Aggregate query: a single SELECT with all expressions side-by-side,
  // assembled into a JSON object so the result row has one column we can
  // index by `<fieldId>__<agg>`. The `${col.key}::text` cast is what
  // unblocks Postgres from "could not determine data type of parameter" —
  // jsonb_build_object's variadic-any signature otherwise leaves the key
  // parameter untyped at parse time.
  const jsonPairs = aggCompiled.columns
    .map((col) => sql`${col.key}::text, ${col.expr}`)
    .reduce((acc, cur) => sql`${acc}, ${cur}`);

  const rows = await sql<{ result: Record<string, unknown> }[]>`
    SELECT jsonb_build_object(${jsonPairs}) AS result
    FROM grids.records
    WHERE table_id = ${params.tableId}::uuid
      AND deleted_at IS NULL
      AND ${filterClause}
  `;
  return ok(parseJsonbRow<Record<string, unknown>>(rows[0]?.result, {}));
};

/**
 * Reads a single record. Live-parent invariant: parent table AND base
 * must be alive. Also enforces `r.deleted_at IS NULL` (a trashed record
 * never resolves through this path; trash listings are explicit).
 */
export const get = async (tableId: string, recordId: string): Promise<GridRecord | null> => {
  const fields = await listFields(tableId);
  const computed = buildComputedProjections(fields);
  const projectionFragments = computed.length > 0
    ? computed
        .map((p) => sql`, ${p.fragment}`)
        .reduce((acc, cur) => sql`${acc}${cur}`)
    : sql``;

  const [row] = await sql<DbRow[]>`
    SELECT r.*${projectionFragments}
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE r.id = ${recordId}::uuid
      AND r.table_id = ${tableId}::uuid
      AND r.deleted_at IS NULL
  `;
  if (!row) return null;
  const record = mapRow(row);
  // Hydrate relation fields + lookup/rollup projections so the response
  // mirrors the list-path shape exactly.
  await hydrateRelationsFromLinks([record], fields);
  applyComputedProjections(
    [row as Record<string, unknown>],
    new Map([[record.id, record]]),
    computed,
  );
  enrichRecordsWithFormulas([record], fields);
  return record;
};

export const create = async (
  tableId: string,
  payload: Record<string, unknown>,
  actorId: string | null,
  opts: { bypassDirectInsertCheck?: boolean } = {},
): Promise<Result<GridRecord>> => {
  // Per-table QoL gate: a "submission inbox" table can mark
  // disable_direct_insert=true so records only flow in via a form.
  // The form-submit handler explicitly opts out of this check
  // (bypassDirectInsertCheck=true). Direct API + records-grid inserts
  // don't pass the flag and so get rejected here.
  if (!opts.bypassDirectInsertCheck) {
    const [row] = await sql<{ disable_direct_insert: boolean }[]>`
      SELECT disable_direct_insert FROM grids.tables WHERE id = ${tableId}::uuid AND deleted_at IS NULL
    `;
    if (row?.disable_direct_insert) {
      return fail(
        err.forbidden(
          "Direct insert is disabled for this table; records can only be added via a form.",
        ),
      );
    }
  }

  const validated = await validateForCreate(tableId, payload);
  if (!validated.ok) return validated;

  const fields = await listFields(tableId);
  // v3: relation values DON'T go into the JSONB blob. Split them out
  // before INSERT, write them to record_links after the record exists
  // (FK requires the records row to be present first).
  const split = splitRelationsFromData(validated.data, fields);

  // Pre-flight: every relation-target must exist in the configured
  // target table. Without this we'd write the records row, then the
  // record_links INSERT would fail on FK and leave an orphan record.
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  for (const [fieldId, toIds] of split.relations) {
    const f = fieldsById.get(fieldId);
    const targetTableId = (f?.config as { targetTableId?: string } | undefined)?.targetTableId;
    if (!targetTableId) continue; // Slice 1 allows incomplete relation config; nothing to validate against
    const check = await validateRelationTargets(targetTableId, toIds);
    if (!check.ok) {
      return fail(err.badInput(
        `field "${f?.name}": missing target records ${check.missing.join(", ")}`,
      ));
    }
  }

  const id = Bun.randomUUIDv7();
  const [row] = await sql<DbRow[]>`
    INSERT INTO grids.records (id, table_id, data, version, created_by, updated_by)
    VALUES (
      ${id}::uuid,
      ${tableId}::uuid,
      ${split.data}::jsonb,
      1,
      ${actorId}::uuid,
      ${actorId}::uuid
    )
    RETURNING *
  `;
  if (!row) return fail(err.internal("insert failed"));

  // Write each relation field's link list. Empty list = no links (the
  // helper does nothing in that case but the round-trip is preserved
  // for diff/audit consistency).
  for (const [fieldId, toIds] of split.relations) {
    await writeRecordLinks(id, fieldId, toIds);
  }

  const record = mapRow(row);
  // Hydrate so the returned record carries the relation arrays the
  // caller just sent — keeps the API contract stable.
  await hydrateRelationsFromLinks([record], fields);

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

  const fields = await listFields(tableId);
  const split = splitRelationsFromData(validated.data, fields);

  // Pre-flight relation-target existence check (same reasoning as create).
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  for (const [fieldId, toIds] of split.relations) {
    const f = fieldsById.get(fieldId);
    const targetTableId = (f?.config as { targetTableId?: string } | undefined)?.targetTableId;
    if (!targetTableId) continue;
    const check = await validateRelationTargets(targetTableId, toIds);
    if (!check.ok) {
      return fail(err.badInput(
        `field "${f?.name}": missing target records ${check.missing.join(", ")}`,
      ));
    }
  }

  // Merge: existing JSONB data + only the validated NON-RELATION fields.
  // Relations are managed exclusively via record_links — they MUST NOT
  // re-enter the JSONB blob (otherwise the hydration step on read
  // would have to special-case "JSONB takes precedence" semantics).
  const merged = { ...existing.data, ...split.data };
  // Drop any zombie relation keys that may still live in the existing
  // JSONB from pre-v3 writes.
  const relationFieldIds = new Set(
    fields.filter((f) => f.type === "relation" && !f.deletedAt).map((f) => f.id),
  );
  for (const k of Object.keys(merged)) {
    if (relationFieldIds.has(k)) delete merged[k];
  }
  // Strip nulls so JSONB doesn't carry zombie keys for cleared fields.
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) delete merged[k];
  }

  const [row] = await sql<DbRow[]>`
    UPDATE grids.records
    SET data = ${merged}::jsonb,
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

  // Apply the relation diffs AFTER the version bump succeeded, so a
  // concurrent-modify error doesn't leave links in an inconsistent state.
  for (const [fieldId, toIds] of split.relations) {
    await writeRecordLinks(recordId, fieldId, toIds);
  }

  const record = mapRow(row);
  await hydrateRelationsFromLinks([record], fields);

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
  // Top-down restore: the parent table + base must be alive. Refusing
  // the restore here is more honest than UPDATEing a record that the
  // user can't read afterward (live-parent invariant).
  const parentAlive = await requireTableAlive(tableId);
  if (!parentAlive.ok) return parentAlive;

  const result = await sql`
    UPDATE grids.records SET deleted_at = NULL, updated_by = ${actorId}::uuid, updated_at = now()
    WHERE id = ${recordId}::uuid AND table_id = ${tableId}::uuid AND deleted_at IS NOT NULL
  `;
  if (result.count === 0) return fail(err.notFound("Record"));
  await logAudit({ tableId, recordId, userId: actorId, action: "restored" });
  return ok();
};
