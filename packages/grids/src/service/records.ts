import { err, fail, ok, type DateContext, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { getHandler } from "../field-types";
import { defaultTableAggregations } from "../table-defaults";
import { type AggregateRequest, compileAggregates } from "./aggregate-compiler";
import { logAudit } from "./audit";
import { applyComputedProjections, buildComputedProjections } from "./computed-projections";
import { nextAutonumberValue } from "./field-indexes";
import { listByTable as listFields, materializeFieldDefault } from "./fields";
import { compileFilter, type FilterTree, renderClause } from "./filter-compiler";
import { compileGroupQuery, type GroupAggregationSpec, type GroupBucket, type GroupBySpec, type GroupSortSpec } from "./group-compiler";
import { parseJsonbRow } from "./jsonb";
import { requireTableAlive } from "./parent-checks";
import { type GridsRecordEvent, publishRecordEvent } from "./record-events";
import {
  attachRelationExpansion,
  type ExpansionViewer,
  enrichRecordsWithComputedColumns,
  enrichRecordsWithFormulas,
  hydrateRelationsFromLinks,
  validateRelationTargets,
  writeRecordLinks,
} from "./relations";
import { compileSearchClause, type SearchSpec } from "./search";
import { compileSort, decodeCursor, type SortSpec } from "./sort-compiler";
import type { Field, GridRecord, RecordList } from "./types";
import type { ComputedColumnSpec } from "../contracts";

type DbRow = Record<string, unknown>;

const recordVersionConflict = () => ({
  code: "CONFLICT" as const,
  status: 409 as const,
  message: "This record changed since you opened it. Another user or tab may have edited it in the meantime. Reload and try again.",
});

const defaultListAggregates = (fields: Field[]): AggregateRequest[] =>
  defaultTableAggregations(fields).map((a) => ({ fieldId: a.fieldId, agg: a.agg }));

const formatFieldValidationError = (fieldName: string, validationError: string): string =>
  validationError === "required" ? `Field "${fieldName}" is required` : `Field "${fieldName}": ${validationError}`;

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

const baseIdForTable = async (tableId: string): Promise<string | null> => {
  const [row] = await sql<{ base_id: string }[]>`
    SELECT base_id FROM grids.tables WHERE id = ${tableId}::uuid AND deleted_at IS NULL
  `;
  return row?.base_id ?? null;
};

const emitRecordEvent = async (event: Omit<GridsRecordEvent, "v" | "occurredAt">): Promise<void> => {
  const payload: GridsRecordEvent = { v: 1, occurredAt: new Date().toISOString(), ...event };
  await publishRecordEvent(payload);
};

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
  const relationFieldIds = new Set(fields.filter((f) => f.type === "relation" && !f.deletedAt).map((f) => f.id));
  const out: Record<string, unknown> = {};
  const relations = new Map<string, string[]>();
  for (const [k, v] of Object.entries(data)) {
    if (relationFieldIds.has(k)) {
      const ids = Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
      relations.set(k, ids);
    } else {
      out[k] = v;
    }
  }
  return { data: out, relations };
};

/**
 * Pre-flight relation-target existence, batched per targetTableId. The
 * naive shape (one validateRelationTargets call per relation field)
 * makes N round-trips when N fields point at the same target table; the
 * batched shape collapses to one call per distinct target table. The FK
 * inside the write transaction is the actual safety net — this just
 * gives a clean 400 with a useful "missing target records" message
 * instead of letting a 23503 leak through.
 */
const preflightRelationTargets = async (
  relations: Map<string, string[]>, // fieldId -> toIds
  fieldsById: Map<string, Field>,
): Promise<Result<void>> => {
  // Group all (fieldId, toIds) by their relation field's targetTableId.
  // Track which fields contributed to each group so we can attribute
  // missing-target errors back to the right field name in the message.
  const groups = new Map<string, { ids: Set<string>; fieldNames: string[] }>();
  for (const [fieldId, toIds] of relations) {
    const f = fieldsById.get(fieldId);
    const targetTableId = (f?.config as { targetTableId?: string } | undefined)?.targetTableId;
    if (!targetTableId) continue;
    const g = groups.get(targetTableId) ?? { ids: new Set<string>(), fieldNames: [] };
    for (const id of toIds) g.ids.add(id);
    if (toIds.length > 0 && f) g.fieldNames.push(f.name);
    groups.set(targetTableId, g);
  }

  for (const [targetTableId, group] of groups) {
    const ids = [...group.ids];
    if (ids.length === 0) continue;
    const check = await validateRelationTargets(targetTableId, ids);
    if (!check.ok) {
      const fieldNamePart =
        group.fieldNames.length === 1 ? `field "${group.fieldNames[0]}"` : `fields [${group.fieldNames.map((n) => `"${n}"`).join(", ")}]`;
      const noun = check.missing.length === 1 ? "record" : "records";
      return fail(err.badInput(`${fieldNamePart}: linked ${noun} no longer exists`));
    }
  }
  return ok();
};

/**
 * Create-path validation: every user-writable field is materialized using
 * either the provided value or the field's default. Required-checks apply.
 * Autonumber fields receive a sequence value derived from the existing rows.
 */
const validateForCreate = async (
  tableId: string,
  payload: Record<string, unknown>,
  options: { dateConfig?: DateContext } = {},
): Promise<Result<Record<string, unknown>>> => {
  const fields = await listFields(tableId);
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const key of Object.keys(payload)) {
    if (!fieldsById.has(key)) return fail(err.badInput("unknown field"));
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
    const raw = provided ? payload[field.id] : materializeFieldDefault(field, { dateConfig: options.dateConfig });
    const result = handler.validate(raw, field.config, field.required);
    if (!result.ok) return fail(err.badInput(formatFieldValidationError(field.name, result.error)));
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
const validateForUpdate = async (tableId: string, payload: Record<string, unknown>): Promise<Result<Record<string, unknown>>> => {
  const fields = await listFields(tableId);
  const fieldsById = new Map(fields.map((f) => [f.id, f]));

  for (const key of Object.keys(payload)) {
    if (!fieldsById.has(key)) return fail(err.badInput("unknown field"));
  }

  const out: Record<string, unknown> = {};
  for (const [fieldId, raw] of Object.entries(payload)) {
    const field = fieldsById.get(fieldId)!;
    const handler = getHandler(field.type);
    if (!handler || !handler.userInput) {
      return fail(err.badInput(`field "${field.name}" is not user-writable`));
    }
    const result = handler.validate(raw, field.config, field.required);
    if (!result.ok) return fail(err.badInput(formatFieldValidationError(field.name, result.error)));
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
  search?: SearchSpec | null;
  sort?: SortSpec[];
  /**
   * When true, populate each returned record's `expanded` field with
   * the presentable-field subset of every record it links to via
   * relation cells. One extra page-level batch (`O(target-tables)`
   * roundtrips) — never N+1. Default false for backwards compat: old
   * callers that don't know about expansion get the original shape.
   */
  includeRelations?: boolean;
  deletedOnly?: boolean;
  /**
   * Viewer for per-target-table permission gating on expansion. When
   * set together with `includeRelations: true`, relation links to
   * records in tables the viewer can't read are NOT expanded — the
   * renderer falls back to a neutral placeholder. Omit to expand unfiltered
   * (the call site has already gated access).
   */
  viewer?: ExpansionViewer;
  includeAggregates?: boolean;
  dateConfig?: DateContext;
  computedColumns?: ComputedColumnSpec[];
}): Promise<Result<RecordList>> => {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const fields = await listFields(params.tableId);

  // Filter compilation
  const filterCompiled = compileFilter(params.filter ?? null, fields, { timeZone: params.dateConfig?.timeZone });
  if (!filterCompiled.ok) return fail(err.badInput(`filter: ${filterCompiled.error}`));
  const filterClause = renderClause(filterCompiled.clause);
  const searchCompiled = await compileSearchClause({
    search: params.search ?? null,
    fields,
    alias: "r",
    viewer: params.viewer,
  });
  const searchClause = searchCompiled.clause;

  // Sort compilation (with cursor decoding when present). Cursor length
  // is validated against the active sort spec — a stale cursor from a
  // different sort length now returns 400 instead of misaligning page 2.
  const expectedCursorLength = params.sort?.length ?? 0;
  const decodedCursor = params.cursor ? decodeCursor(params.cursor, expectedCursorLength) : null;
  if (params.cursor && !decodedCursor) {
    return fail(err.badInput("invalid cursor"));
  }
  const sortCompiled = compileSort(params.sort ?? [], fields, decodedCursor);
  if (!sortCompiled.ok) return fail(err.badInput(`sort: ${sortCompiled.error}`));
  const { orderBy, cursorWhere, cursorSelect, encodeCursorFromRow } = sortCompiled.result;

  // table_id / deleted_at must be qualified — both `r.records`,
  // `t.tables`, and `b.bases` (joined for live-parent) carry these
  // column names. An unqualified ref raises 42702 (chunk: 1.2 JOIN
  // regression).
  const conditions: any[] = [sql`r.table_id = ${params.tableId}::uuid`];
  if (params.deletedOnly) conditions.push(sql`r.deleted_at IS NOT NULL`);
  else if (!params.includeDeleted) conditions.push(sql`r.deleted_at IS NULL`);
  conditions.push(filterClause);
  conditions.push(searchClause);
  if (cursorWhere) conditions.push(cursorWhere);
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  // v3 Slice 4: lookup / rollup values are computed in the main query
  // as correlated subqueries over record_links instead of a JS-side
  // batch-fetch pass. Single source of truth, single round-trip.
  const computed = await buildComputedProjections(fields);
  const projectionFragments =
    computed.length > 0 ? computed.map((p) => sql`, ${p.fragment}`).reduce((acc, cur) => sql`${acc}${cur}`) : sql``;

  // Live-parent JOIN: records of a trashed table or base never list,
  // even when the caller passes a leaked tableId UUID. The filter's
  // predicate still pins r.table_id = ${tableId}, so the JOIN's table
  // row is uniquely identified — Postgres treats this as a cheap
  // semi-join.
  const rows = await sql<DbRow[]>`
    SELECT r.*${projectionFragments}${cursorSelect}
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
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
    // Cursor encodes from the SQL `__sort_<i>` aliases (null-safe via
    // try_*) instead of `record.data[fieldId]` (raw JSONB) — so corrupt
    // values produce NULL in the cursor instead of crashing page 2.
    const lastRow = rows[limit - 1] as Record<string, unknown>;
    nextCursor = encodeCursorFromRow(lastRow);
  }
  // Formulas still run in JS — they reference computed and base values
  // alike, and the formula engine is not SQL-projectable yet.
  enrichRecordsWithFormulas(items, fields, { dateConfig: params.dateConfig });
  enrichRecordsWithComputedColumns(items, fields, params.computedColumns, { dateConfig: params.dateConfig });

  // Optional relation expansion. Runs AFTER hydrateRelationsFromLinks
  // because it reads `record.data[fieldId]` to figure out which UUIDs
  // each record actually references. Mutates the records in place.
  // When a viewer is supplied, target tables the viewer can't read
  // are skipped — the renderer falls back to a neutral placeholder.
  if (params.includeRelations) {
    await attachRelationExpansion(items, fields, params.viewer);
  }

  const aggregatesResult = params.includeAggregates
    ? await aggregate({
        tableId: params.tableId,
        filter: params.filter ?? null,
        search: params.search ?? null,
        includeDeleted: params.includeDeleted,
        deletedOnly: params.deletedOnly,
        requests: defaultListAggregates(fields),
        viewer: params.viewer,
        dateConfig: params.dateConfig,
      })
    : ok<Record<string, unknown>>({});
  if (!aggregatesResult.ok) return aggregatesResult;

  // Echo fields back in the response — list is the table-page entry
  // point and consumers (records page, dashboard view widget,
  // DatabaseTable) always need them to render. Saves a roundtrip vs
  // calling listFields separately.
  return ok({ items, fields, nextCursor, aggregates: aggregatesResult.data });
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
  groupSort?: GroupSortSpec[];
  filter?: FilterTree | null;
  search?: SearchSpec | null;
  cursor?: string | null;
  limit?: number;
  fromEnd?: boolean;
  includeDeleted?: boolean;
  deletedOnly?: boolean;
  viewer?: ExpansionViewer;
  dateConfig?: DateContext;
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
  const searchCompiled = await compileSearchClause({
    search: params.search ?? null,
    fields,
    alias: "r",
    viewer: params.viewer,
  });
  const searchClause = searchCompiled.clause;
  const compiled = compileGroupQuery({
    tableId: params.tableId,
    groupBy: params.groupBy,
    aggregations: params.aggregations,
    groupSort: params.groupSort,
    filter: params.filter,
    searchClause,
    fields,
    cursor: cursorKeys,
    limit,
    fromEnd: params.fromEnd,
    includeDeleted: params.includeDeleted,
    deletedOnly: params.deletedOnly,
    timeZone: params.dateConfig?.timeZone,
  });
  if (!compiled.ok) return fail(err.badInput(compiled.error));

  const rows = await sql<DbRow[]>`${compiled.query}`;
  const hasMore = rows.length > limit;
  const visible = params.fromEnd && hasMore ? rows.slice(-limit) : rows.slice(0, limit);

  const buckets: GroupBucket[] = visible.map((row) => {
    const keys = compiled.resolvedGroups.map((group, i) => {
      const raw = row[`gk_${i}`];
      // Date keys come back as JS Date — normalize to ISO string for
      // a stable JSON envelope. Bigints (count-likes) become numbers.
      if (raw instanceof Date) return group.spec.granularity ? raw.toISOString().slice(0, 10) : raw.toISOString();
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
  if (hasMore && compiled.cursorable && !params.fromEnd) {
    const last = buckets[buckets.length - 1]!;
    nextCursor = JSON.stringify({ k: last.keys });
  }
  // Explode-mode: at least one groupBy dimension is a relation or
  // select field. The `*__count` aggregate then counts
  // (record × linked/selected value) pairs rather than unique records,
  // which the UI should surface as a hint.
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const explode = params.groupBy.some((g) => {
    const type = fieldsById.get(g.fieldId)?.type;
    return type === "relation" || type === "select";
  });
  return ok({ buckets, nextCursor, explode });
};

export const aggregate = async (params: {
  tableId: string;
  filter?: FilterTree | null;
  search?: SearchSpec | null;
  requests: AggregateRequest[];
  includeDeleted?: boolean;
  deletedOnly?: boolean;
  viewer?: ExpansionViewer;
  dateConfig?: DateContext;
}): Promise<Result<Record<string, unknown>>> => {
  const fields = await listFields(params.tableId);

  const filterCompiled = compileFilter(params.filter ?? null, fields, { timeZone: params.dateConfig?.timeZone });
  if (!filterCompiled.ok) return fail(err.badInput(`filter: ${filterCompiled.error}`));
  const filterClause = renderClause(filterCompiled.clause);
  const searchCompiled = await compileSearchClause({
    search: params.search ?? null,
    fields,
    alias: "r",
    viewer: params.viewer,
  });
  const searchClause = searchCompiled.clause;

  const aggCompiled = compileAggregates(params.requests, fields);
  if (!aggCompiled.ok) return fail(err.badInput(`aggregate: ${aggCompiled.error}`));

  if (aggCompiled.columns.length === 0) return ok({});

  // Aggregate query: a single SELECT with all expressions side-by-side,
  // assembled into a JSON object so the result row has one column we can
  // index by `<fieldId>__<agg>`. The `${col.key}::text` cast is what
  // unblocks Postgres from "could not determine data type of parameter" —
  // jsonb_build_object's variadic-any signature otherwise leaves the key
  // parameter untyped at parse time.
  const jsonPairs = aggCompiled.columns.map((col) => sql`${col.key}::text, ${col.expr}`).reduce((acc, cur) => sql`${acc}, ${cur}`);

  // Live-parent JOIN — see records.list comment for rationale.
  const rows = await sql<{ result: Record<string, unknown> }[]>`
    SELECT jsonb_build_object(${jsonPairs}) AS result
    FROM grids.records r
    JOIN grids.tables t ON t.id = r.table_id AND t.deleted_at IS NULL
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE r.table_id = ${params.tableId}::uuid
      AND ${params.deletedOnly ? sql`r.deleted_at IS NOT NULL` : params.includeDeleted ? sql`TRUE` : sql`r.deleted_at IS NULL`}
      AND ${filterClause}
      AND ${searchClause}
  `;
  return ok(parseJsonbRow<Record<string, unknown>>(rows[0]?.result, {}));
};

/**
 * Reads a single record. Live-parent invariant: parent table AND base
 * must be alive. Also enforces `r.deleted_at IS NULL` (a trashed record
 * never resolves through this path; trash listings are explicit).
 */
export const get = async (
  tableId: string,
  recordId: string,
  opts: { includeRelations?: boolean; viewer?: ExpansionViewer; dateConfig?: DateContext } = {},
): Promise<GridRecord | null> => {
  const fields = await listFields(tableId);
  const computed = await buildComputedProjections(fields);
  const projectionFragments =
    computed.length > 0 ? computed.map((p) => sql`, ${p.fragment}`).reduce((acc, cur) => sql`${acc}${cur}`) : sql``;

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
  applyComputedProjections([row as Record<string, unknown>], new Map([[record.id, record]]), computed);
  enrichRecordsWithFormulas([record], fields, { dateConfig: opts.dateConfig });
  if (opts.includeRelations) {
    await attachRelationExpansion([record], fields, opts.viewer);
  }
  return record;
};

export const create = async (
  tableId: string,
  payload: Record<string, unknown>,
  actorId: string | null,
  opts: {
    bypassDirectInsertCheck?: boolean;
    includeRelations?: boolean;
    viewer?: ExpansionViewer;
    dateConfig?: DateContext;
  } = {},
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
      return fail(err.forbidden("Direct insert is disabled for this table; records can only be added via a form."));
    }
  }

  const validated = await validateForCreate(tableId, payload, { dateConfig: opts.dateConfig });
  if (!validated.ok) return validated;

  const fields = await listFields(tableId);
  // v3: relation values DON'T go into the JSONB blob. Split them out
  // before INSERT, write them to record_links after the record exists
  // (FK requires the records row to be present first).
  const split = splitRelationsFromData(validated.data, fields);

  // Pre-flight: every relation-target must exist in the configured
  // target table. Batched per target table so 50 relation fields pointing
  // at <5 distinct tables make 5 round-trips, not 50. This sits OUTSIDE
  // the transaction; the inner FK is the actual safety net — the
  // preflight just gives a friendlier "missing target" 400 instead of
  // the FK failure message.
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const preflight = await preflightRelationTargets(split.relations, fieldsById);
  if (!preflight.ok) return preflight;

  // ATOMIC: record-row INSERT + per-field record_links writes + audit
  // run in one transaction. A FK race (target deleted between preflight
  // and link write) or a transient DB hiccup either commits the whole
  // record or none of it — no orphan records, no half-written links.
  const id = Bun.randomUUIDv7();
  const row = await sql.begin(async (tx) => {
    const [r] = await tx<DbRow[]>`
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
    if (!r) throw new Error("insert returned no row");

    // Write each relation field's link list. Empty list = no links (the
    // helper does nothing in that case but the round-trip is preserved
    // for diff/audit consistency).
    for (const [fieldId, toIds] of split.relations) {
      await writeRecordLinks(id, fieldId, toIds, tx);
    }

    await logAudit(
      {
        tableId,
        recordId: id,
        userId: actorId,
        action: "created",
        diff: Object.fromEntries(Object.entries(validated.data).map(([k, v]) => [k, { old: null, new: v }])),
      },
      tx,
    );
    return r;
  });

  const record = mapRow(row);
  // Hydrate so the returned record carries the relation arrays the
  // caller just sent — keeps the API contract stable.
  await hydrateRelationsFromLinks([record], fields);
  enrichRecordsWithFormulas([record], fields, { dateConfig: opts.dateConfig });
  if (opts.includeRelations) {
    await attachRelationExpansion([record], fields, opts.viewer);
  }
  const baseId = await baseIdForTable(tableId);
  if (baseId) {
    await emitRecordEvent({
      type: "record.created",
      baseId,
      tableId,
      recordId: record.id,
      version: record.version,
      changedFieldIds: Object.keys(validated.data),
      actorId,
    });
  }
  return ok(record);
};

export const update = async (
  tableId: string,
  recordId: string,
  payload: Record<string, unknown>,
  actorId: string | null,
  ifMatchVersion?: number,
  opts: { includeRelations?: boolean; viewer?: ExpansionViewer; dateConfig?: DateContext } = {},
): Promise<Result<GridRecord>> => {
  const existing = await get(tableId, recordId);
  if (!existing || existing.deletedAt) return fail(err.notFound("Record"));
  if (ifMatchVersion !== undefined && ifMatchVersion !== existing.version) {
    return fail(recordVersionConflict());
  }

  const validated = await validateForUpdate(tableId, payload);
  if (!validated.ok) return validated;

  const fields = await listFields(tableId);
  const split = splitRelationsFromData(validated.data, fields);

  // Pre-flight relation-target existence check (same reasoning as create).
  // Batched per target table; runs outside the write transaction.
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const preflight = await preflightRelationTargets(split.relations, fieldsById);
  if (!preflight.ok) return preflight;

  // Merge: existing JSONB data + only the validated NON-RELATION fields.
  // Relations are managed exclusively via record_links — they MUST NOT
  // re-enter the JSONB blob (otherwise the hydration step on read
  // would have to special-case "JSONB takes precedence" semantics).
  const merged = { ...existing.data, ...split.data };
  // Drop any zombie relation keys that may still live in the existing
  // JSONB from pre-v3 writes.
  const relationFieldIds = new Set(fields.filter((f) => f.type === "relation" && !f.deletedAt).map((f) => f.id));
  for (const k of Object.keys(merged)) {
    if (relationFieldIds.has(k)) delete merged[k];
  }
  // Strip nulls so JSONB doesn't carry zombie keys for cleared fields.
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) delete merged[k];
  }

  // Build the diff up front so we can pass it into the transaction.
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of Object.keys(validated.data)) {
    const oldVal = existing.data[key] ?? null;
    const newVal = validated.data[key] ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal, new: newVal };
    }
  }

  // ATOMIC: row UPDATE + relation link writes + audit in one transaction.
  // The version-check WHERE clause still gives us the optimistic-lock
  // semantics; if it fires, no link writes happen.
  const txResult = await sql
    .begin(async (tx) => {
      const [r] = await tx<DbRow[]>`
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
      if (!r) {
        // Trigger rollback by throwing a sentinel; caller catches it and
        // converts to err.conflict. (`fail(...)` from inside a tx would
        // commit because bun.sql treats only thrown errors as rollback.)
        const e = new Error("VERSION_CONFLICT");
        (e as Error & { __versionConflict: true }).__versionConflict = true;
        throw e;
      }

      for (const [fieldId, toIds] of split.relations) {
        await writeRecordLinks(recordId, fieldId, toIds, tx);
      }

      if (Object.keys(diff).length > 0) {
        await logAudit({ tableId, recordId, userId: actorId, action: "updated", diff }, tx);
      }
      return r;
    })
    .catch((e: unknown) => {
      if ((e as { __versionConflict?: true })?.__versionConflict) return null;
      throw e;
    });
  if (!txResult) return fail(recordVersionConflict());

  const record = mapRow(txResult);
  await hydrateRelationsFromLinks([record], fields);
  enrichRecordsWithFormulas([record], fields, { dateConfig: opts.dateConfig });
  if (opts.includeRelations) {
    await attachRelationExpansion([record], fields, opts.viewer);
  }
  const baseId = await baseIdForTable(tableId);
  if (baseId) {
    await emitRecordEvent({
      type: "record.updated",
      baseId,
      tableId,
      recordId: record.id,
      version: record.version,
      changedFieldIds: Object.keys(diff),
      actorId,
    });
  }
  return ok(record);
};

export const softDelete = async (tableId: string, recordId: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await get(tableId, recordId);
  const deleted = await sql.begin(async (tx) => {
    const result = await tx`
      UPDATE grids.records
      SET deleted_at = now(), updated_by = ${actorId}::uuid, updated_at = now()
      WHERE id = ${recordId}::uuid AND table_id = ${tableId}::uuid AND deleted_at IS NULL
    `;
    if (result.count === 0) return false;
    await logAudit({ tableId, recordId, userId: actorId, action: "deleted" }, tx);
    return true;
  });
  if (!deleted) return fail(err.notFound("Record"));
  const baseId = await baseIdForTable(tableId);
  if (baseId) {
    await emitRecordEvent({
      type: "record.deleted",
      baseId,
      tableId,
      recordId,
      version: existing?.version ?? null,
      changedFieldIds: existing ? Object.keys(existing.data) : [],
      actorId,
    });
  }
  return ok();
};

export const restore = async (tableId: string, recordId: string, actorId: string | null): Promise<Result<void>> => {
  // Top-down restore: the parent table + base must be alive. Refusing
  // the restore here is more honest than UPDATEing a record that the
  // user can't read afterward (live-parent invariant).
  const parentAlive = await requireTableAlive(tableId);
  if (!parentAlive.ok) return parentAlive;

  const restored = await sql.begin(async (tx) => {
    const result = await tx`
      UPDATE grids.records
      SET deleted_at = NULL, updated_by = ${actorId}::uuid, updated_at = now()
      WHERE id = ${recordId}::uuid AND table_id = ${tableId}::uuid AND deleted_at IS NOT NULL
    `;
    if (result.count === 0) return false;
    await logAudit({ tableId, recordId, userId: actorId, action: "restored" }, tx);
    return true;
  });
  if (!restored) return fail(err.notFound("Record"));
  const baseId = await baseIdForTable(tableId);
  if (baseId) {
    await emitRecordEvent({
      type: "record.restored",
      baseId,
      tableId,
      recordId,
      version: null,
      changedFieldIds: [],
      actorId,
    });
  }
  return ok();
};
