import { sql } from "bun";
import type { DateContext } from "@valentinkolb/stdlib";
import { type ProjectionKind, storageOf } from "./field-storage";
import {
  compileFormulaAstToSql,
  compileFormulaPredicateAstToSql,
  type FormulaSqlExpression,
  type FormulaSqlType,
} from "./formula-sql-compiler";
import type { FilterTree } from "./filter-compiler";
import { compileFilter, renderClause } from "./filter-compiler";
import type { Field } from "./types";
import type { Expr } from "../formula/types";

// =============================================================================
// Group-by + aggregations compiler
// =============================================================================
// Classic SQL semantics — when groupBy is set, the result is one row
// per (groupBy-key) tuple containing the requested aggregations. No
// sub-records are returned (that's the user's intentional model:
// "summary view" replaces the rows view, it doesn't decorate it).
//
// Multi-level grouping: composite key, max 3 levels. Flat result
// (no GROUPING SETS subtotals — those are a future extension).
//
// Date granularity: server-side via `date_trunc(<gran>, value)`. The
// granularity is part of the group key, so buckets match the values
// the UI shows in the header column.
//
// Relation and select grouping use explode-semantics. A record
// with [TagA, TagB] contributes to BOTH buckets. The total count across
// buckets can exceed the total record count — caller documents this as
// "explode-mode" so the UI can warn.
//
// Lookup / rollup grouping: rejected for now (would require either
// rerunning the correlated subquery as GROUP BY expression or wrapping
// the whole records query in a CTE — both viable, neither tiny).
// Keep disabled until we have a concrete product need.
//
// Cursor pagination: keyset on the group-key tuple. Same shape as
// the records-list cursor (sortValues + id), except `id` is unused
// (group rows have no id; the tuple itself is the unique identifier).

export type GroupBySpec = {
  fieldId: string;
  direction?: "asc" | "desc";
  /** Date-field grouping bucket. Backend: `date_trunc(<gran>, …)`. */
  granularity?: "day" | "week" | "month" | "quarter" | "year";
};

type AggKindForGroup = "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max";

export type GroupAggregationSpec =
  | {
      /** "*" is shorthand for COUNT(*). */
      fieldId: string | "*";
      agg: AggKindForGroup;
    }
  | {
      kind: "formula";
      /** Stable result key prefix. Query DSL uses the aggregate alias here. */
      id: string;
      expression: Expr;
      agg: AggKindForGroup;
    };

export type GroupSortSpec = {
  fieldId: string | "*";
  agg: AggKindForGroup;
  direction?: "asc" | "desc";
};

export type GroupHavingRef = GroupAggregationSpec & {
  ref: string;
};

export type GroupBucket = {
  /** Tuple of group keys, parallel to the GroupBySpec[] order. Values are
   *  the raw projected SQL values (string for text/select, number for
   *  numeric, ISO string for dates, UUID string for relation explode). */
  keys: unknown[];
  /** Aggregation results keyed `${fieldId}__${agg}` (or `*__count` for
   *  COUNT(*)). Values are JS numbers for numeric aggs, raw text for
   *  text aggs, null when no rows in the bucket. */
  values: Record<string, unknown>;
};

// ──────────────────────────────────────────────────────────────────
// Type helpers — every capability check + SQL projection goes through
// the storage descriptor (field-storage.ts) so this compiler stops
// re-spelling rules already encoded once. The descriptor knows that
// numeric/percent/duration cast through try_numeric,
// and that system fields are real columns not JSONB. Touching the
// descriptor adds the new shape in one place instead of n compilers.
// ──────────────────────────────────────────────────────────────────

/** Projection kinds whose SQL value is numeric-shaped. sum/avg work
 *  over these; min/max work over these plus date / datetime / text. */
const NUMERIC_KINDS: ReadonlySet<ProjectionKind> = new Set(["numeric"]);
const DATE_KINDS: ReadonlySet<ProjectionKind> = new Set(["date", "datetime"]);

/** Field-types that can appear in groupBy.
 *
 *  Routes through the descriptor's `groupable` flag, so adding a new
 *  field type only requires registering it in field-storage.ts. */
export const isGroupable = (field: Field): boolean => {
  if (field.deletedAt) return false;
  return storageOf(field).groupable;
};

/** Returns whether `agg` makes sense over `field`. count* always do for
 *  any non-deleted field. Routes the type→aggregate compatibility through
 *  the descriptor's projection kind; previously this had its own
 *  NUMERIC_TYPES set that could drift from the aggregate-compiler's. */
export const isAggregatable = (field: Field | null, agg: AggKindForGroup, isStarField: boolean): boolean => {
  if (isStarField) return agg === "count";
  if (!field || field.deletedAt) return false;
  if (agg === "count" || agg === "countEmpty" || agg === "countUnique") return true;
  const kind = storageOf(field).kind;
  if (agg === "sum" || agg === "avg") return NUMERIC_KINDS.has(kind);
  if (agg === "min" || agg === "max") {
    return NUMERIC_KINDS.has(kind) || DATE_KINDS.has(kind) || kind === "text";
  }
  return false;
};

// ──────────────────────────────────────────────────────────────────
// Compiler
// ──────────────────────────────────────────────────────────────────

type ResolvedGroup = {
  spec: GroupBySpec;
  field: Field;
  /** Alias used in SELECT / GROUP BY / ORDER BY. */
  alias: string;
  /** SQL fragment that produces the group-key value. Embedded as a
   *  bare expression (no AS-alias) so it can be reused in GROUP BY. */
  expr: any;
  /** Whether this group requires joining `record_links` (relation field).
   *  When set, the join alias is `rl_<index>`. */
  relationJoinIndex?: number;
  /** Whether this group explodes a select JSONB array via a
   *  LATERAL join. When set, the join alias is `ms_<index>`. */
  selectJoinIndex?: number;
};

const groupAlias = (i: number) => `gk_${i}`;
// Formula aggregate ids become SQL identifiers after appending "__<agg>".
// Keep the id short enough for PostgreSQL's 63-byte identifier limit even
// with the longest supported suffix: "__countUnique".
const FORMULA_AGG_ID = /^[A-Za-z_][A-Za-z0-9_]{0,49}$/;
const isFormulaAggregation = (req: GroupAggregationSpec): req is Extract<GroupAggregationSpec, { kind: "formula" }> =>
  "kind" in req && req.kind === "formula";

const aggAliasFor = (req: GroupAggregationSpec): string => `${isFormulaAggregation(req) ? req.id : req.fieldId}__${req.agg}`;

/** Build a per-group projection. Scalar / date / relation branches
 *  diverge here. */
const resolveGroupBy = (
  specs: GroupBySpec[],
  fields: Field[],
  timeZone = "UTC",
): { ok: true; resolved: ResolvedGroup[] } | { ok: false; error: string } => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const resolved: ResolvedGroup[] = [];
  let relationJoinCounter = 0;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const field = fieldsById.get(spec.fieldId);
    if (!field) return { ok: false, error: "unknown group-by field" };
    if (!isGroupable(field)) {
      return { ok: false, error: `field "${field.name}" (type "${field.type}") is not groupable` };
    }

    // Granularity is a date-only feature. Silently ignoring it on a
    // numeric/text/select field would let saved views carry meaningless
    // query state that confuses future readers and never has any
    // observable effect on the bucket keys.
    if (spec.granularity && field.type !== "date") {
      return {
        ok: false,
        error: `granularity "${spec.granularity}" is only valid on date fields, not "${field.type}"`,
      };
    }

    const alias = groupAlias(i);

    const desc = storageOf(field);

    if (desc.kind === "relationLink") {
      // Explode-mode: each link contributes one row. The JOIN alias
      // exposes the to_record_id; we use that as the group key. The
      // descriptor reports relation as groupable but with project=null;
      // we provide the SQL fragment ourselves since it depends on a
      // JOIN that doesn't exist in any other compiler path.
      const jIdx = relationJoinCounter++;
      resolved.push({
        spec,
        field,
        alias,
        expr: sql`rl_${sql.unsafe(String(jIdx))}.to_record_id::text`,
        relationJoinIndex: jIdx,
      });
      continue;
    }

    if (desc.kind === "jsonbArray") {
      const jIdx = relationJoinCounter++;
      resolved.push({
        spec,
        field,
        alias,
        expr: sql`ms_${sql.unsafe(String(jIdx))}.value`,
        selectJoinIndex: jIdx,
      });
      continue;
    }

    if (field.type === "date" && spec.granularity) {
      // Server-side bucketing. Date-time fields are stored as UTC
      // instants and bucketed in the user's/app's configured timezone.
      // Date-only fields stay pure calendar values.
      const gran = spec.granularity;
      const expr = (field.config as { includeTime?: boolean }).includeTime
        ? sql`grids.try_timestamptz(r.data->>${field.id}) AT TIME ZONE ${timeZone}`
        : sql`grids.try_iso_date(r.data->>${field.id})::timestamp`;
      resolved.push({
        spec,
        field,
        alias,
        expr: sql`date_trunc(${gran}, ${expr})::date`,
      });
      continue;
    }

    // Every other groupable type routes through the descriptor: number
    // uses try_numeric, date uses try_iso_date, boolean uses try_boolean,
    // and text/select/system fields get their native shape.
    const projected = desc.project(field, "r");
    if (!projected) {
      // Defensive: descriptor reported groupable but no projection.
      // Currently unreachable — every groupable kind has a project()
      // implementation — but keeping this branch keeps the compiler
      // honest if a future descriptor adds groupable=true without
      // project=non-null.
      return {
        ok: false,
        error: `field "${field.name}" (type "${field.type}") has no group projection`,
      };
    }
    resolved.push({ spec, field, alias, expr: projected as any });
  }

  return { ok: true, resolved };
};

const isFormulaAggregatable = (type: FormulaSqlType, agg: AggKindForGroup): boolean => {
  if (agg === "count" || agg === "countEmpty" || agg === "countUnique") return true;
  if (agg === "sum" || agg === "avg") return type === "numeric";
  if (agg === "min" || agg === "max") return type === "numeric" || type === "date" || type === "datetime" || type === "text";
  return false;
};

const buildFormulaAggExpr = (
  req: Extract<GroupAggregationSpec, { kind: "formula" }>,
  fields: Field[],
  dateConfig?: DateContext,
): { ok: true; expr: any; type: FormulaSqlType } | { ok: false; error: string } => {
  const compiled = compileFormulaAstToSql(req.expression, { fields, recordAlias: "r", dateConfig });
  if (!compiled.ok) return { ok: false, error: `formula aggregate "${req.id}": ${compiled.error}` };
  if (!isFormulaAggregatable(compiled.expression.type, req.agg)) {
    return { ok: false, error: `agg "${req.agg}" not compatible with formula type "${compiled.expression.type}"` };
  }

  const expr = compiled.expression.sql;
  switch (req.agg) {
    case "count":
      return { ok: true, expr: sql`count(${expr}) FILTER (WHERE ${expr} IS NOT NULL AND (${expr})::text <> '')::bigint`, type: "numeric" };
    case "countEmpty":
      return { ok: true, expr: sql`count(*) FILTER (WHERE ${expr} IS NULL OR (${expr})::text = '')::bigint`, type: "numeric" };
    case "countUnique":
      return {
        ok: true,
        expr: sql`count(DISTINCT ${expr}) FILTER (WHERE ${expr} IS NOT NULL AND (${expr})::text <> '')::bigint`,
        type: "numeric",
      };
    case "sum":
      return { ok: true, expr: sql`SUM((${expr})::numeric)`, type: "numeric" };
    case "avg":
      return { ok: true, expr: sql`AVG((${expr})::numeric)`, type: "numeric" };
    case "min":
      return { ok: true, expr: sql`MIN(${expr})`, type: compiled.expression.type };
    case "max":
      return { ok: true, expr: sql`MAX(${expr})`, type: compiled.expression.type };
  }
};

const buildAggExpr = (
  req: GroupAggregationSpec,
  field: Field | null,
  fields: Field[],
  dateConfig?: DateContext,
): { ok: true; expr: any; type: FormulaSqlType } | { ok: false; error: string } => {
  if (isFormulaAggregation(req)) return buildFormulaAggExpr(req, fields, dateConfig);
  if (req.fieldId === "*") {
    if (req.agg !== "count") {
      return { ok: false, error: `agg "${req.agg}" requires a fieldId (only count works on "*")` };
    }
    return { ok: true, expr: sql`count(*)::bigint`, type: "numeric" };
  }
  if (!field) return { ok: false, error: "unknown aggregate field" };
  if (!isAggregatable(field, req.agg, false)) {
    return { ok: false, error: `agg "${req.agg}" not compatible with field type "${field.type}"` };
  }

  // Typed projection from the storage descriptor: numerics cast through
  // try_numeric, dates through try_date, system columns reference the
  // column directly.
  // count* still operate on the raw "is this slot populated" text
  // because we want to count rows where the user wrote ANYTHING (even
  // an unparseable number), not rows where the typed projection
  // happens to be non-null.
  const desc = storageOf(field);
  const typedProj = desc.project(field, "r") as any;
  // Existence-shaped reference used by count*. For JSONB-backed kinds
  // we read the raw text; for system kinds we use the column itself
  // (no '' check — columns are typed, "" is meaningless).
  const existsRef = desc.kind === "system" ? typedProj : sql`r.data->>${field.id}`;
  const isSystem = desc.kind === "system";

  switch (req.agg) {
    case "count":
      return {
        ok: true,
        expr: isSystem
          ? sql`count(${existsRef}) FILTER (WHERE ${existsRef} IS NOT NULL)::bigint`
          : sql`count(${existsRef}) FILTER (WHERE ${existsRef} IS NOT NULL AND ${existsRef} <> '')::bigint`,
        type: "numeric",
      };
    case "countEmpty":
      return {
        ok: true,
        expr: isSystem
          ? sql`count(*) FILTER (WHERE ${existsRef} IS NULL)::bigint`
          : sql`count(*) FILTER (WHERE ${existsRef} IS NULL OR ${existsRef} = '')::bigint`,
        type: "numeric",
      };
    case "countUnique":
      return {
        ok: true,
        expr: isSystem
          ? sql`count(DISTINCT ${existsRef}) FILTER (WHERE ${existsRef} IS NOT NULL)::bigint`
          : sql`count(DISTINCT ${existsRef}) FILTER (WHERE ${existsRef} IS NOT NULL AND ${existsRef} <> '')::bigint`,
        type: "numeric",
      };
    case "sum":
      return { ok: true, expr: sql`SUM(${typedProj})`, type: "numeric" };
    case "avg":
      return { ok: true, expr: sql`AVG(${typedProj})`, type: "numeric" };
    case "min":
    case "max": {
      const fn = req.agg === "min" ? sql`MIN` : sql`MAX`;
      // min/max routes through the typed projection for every
      // kind. For text fields the descriptor projection IS `data->>id`
      // so min/max gives lexicographic order on raw text — identical
      // to what the old hard-coded fallback emitted.
      return { ok: true, expr: sql`${fn}(${typedProj})`, type: formulaTypeForAggregate(req, field) };
    }
  }
};

type ResolvedAggregations = {
  aggKeys: string[];
  aggExprs: Array<{ key: string; expr: any; type: FormulaSqlType }>;
  seenKeys: Set<string>;
};

const formulaTypeForAggregate = (req: GroupAggregationSpec, field: Field | null): FormulaSqlType => {
  if (isFormulaAggregation(req)) return "unknown";
  if (req.fieldId === "*" || req.agg === "count" || req.agg === "countEmpty" || req.agg === "countUnique") return "numeric";
  if (req.agg === "sum" || req.agg === "avg") return "numeric";
  if (!field) return "unknown";
  const desc = storageOf(field);
  if (desc.kind === "numeric") return "numeric";
  if (desc.kind === "date") return (field.config as { includeTime?: boolean }).includeTime ? "datetime" : "date";
  if (desc.kind === "datetime" || desc.kind === "system") return "datetime";
  if (desc.kind === "text") return "text";
  if (desc.kind === "boolean") return "boolean";
  return "unknown";
};

const resolveAggregations = (
  aggregations: GroupAggregationSpec[],
  fieldsById: Map<string, Field>,
  fields: Field[],
  dateConfig?: DateContext,
): { ok: true; resolved: ResolvedAggregations } | { ok: false; error: string } => {
  const aggKeys: string[] = [];
  const aggExprs: Array<{ key: string; expr: any; type: FormulaSqlType }> = [];
  const seenKeys = new Set<string>();

  for (const req of aggregations) {
    if (isFormulaAggregation(req) && !FORMULA_AGG_ID.test(req.id)) {
      return { ok: false, error: `invalid formula aggregate id "${req.id}"` };
    }

    const field = isFormulaAggregation(req) || req.fieldId === "*" ? null : (fieldsById.get(req.fieldId) ?? null);
    if (!isFormulaAggregation(req) && req.fieldId !== "*" && !field) return { ok: false, error: "unknown aggregate field" };

    const built = buildAggExpr(req, field, fields, dateConfig);
    if (!built.ok) return built;

    const key = aggAliasFor(req);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    aggKeys.push(key);
    aggExprs.push({ key, expr: built.expr, type: built.type });
  }

  if (!seenKeys.has("*__count")) {
    seenKeys.add("*__count");
    aggKeys.unshift("*__count");
    aggExprs.unshift({ key: "*__count", expr: sql`count(*)::bigint`, type: "numeric" });
  }

  return { ok: true, resolved: { aggKeys, aggExprs, seenKeys } };
};

const validateGroupSort = (groupSort: GroupSortSpec[], seenAggKeys: Set<string>): { ok: true } | { ok: false; error: string } => {
  for (const sort of groupSort) {
    const key = aggAliasFor(sort);
    if (!seenAggKeys.has(key)) return { ok: false, error: `groupSort references missing aggregate "${key}"` };
    if (sort.fieldId === "*" && sort.agg !== "count") {
      return { ok: false, error: `groupSort agg "${sort.agg}" requires a fieldId (only count works on "*")` };
    }
  }
  return { ok: true };
};

const buildHavingRefResolver = (
  refs: GroupHavingRef[] | undefined,
  aggExprs: Array<{ key: string; expr: any; type: FormulaSqlType }>,
  fieldsById: Map<string, Field>,
): ((ref: string) => FormulaSqlExpression | null) => {
  const byKey = new Map(aggExprs.map((item) => [item.key, item]));
  const byRef = new Map<string, FormulaSqlExpression>();
  for (const item of refs ?? []) {
    const key = aggAliasFor(item);
    const resolved = byKey.get(key);
    if (!resolved) continue;
    byRef.set(item.ref, {
      sql: resolved.expr,
      type:
        resolved.type === "unknown" && !isFormulaAggregation(item)
          ? formulaTypeForAggregate(item, item.fieldId === "*" ? null : (fieldsById.get(item.fieldId) ?? null))
          : resolved.type,
    });
  }
  return (ref) => byRef.get(ref) ?? null;
};

const buildUserHavingClause = (
  having: Expr | undefined,
  refs: GroupHavingRef[] | undefined,
  aggExprs: Array<{ key: string; expr: any; type: FormulaSqlType }>,
  fieldsById: Map<string, Field>,
): { ok: true; clause: any } | { ok: false; error: string } => {
  if (!having) return { ok: true, clause: sql`TRUE` };
  const compiled = compileFormulaPredicateAstToSql(having, {
    fields: [],
    resolveField: buildHavingRefResolver(refs, aggExprs, fieldsById),
  });
  if (!compiled.ok) return { ok: false, error: `having: ${compiled.error}` };
  return { ok: true, clause: compiled.expression.sql };
};

const joinSql = (parts: any[]): any => parts.reduce((acc, cur) => sql`${acc}, ${cur}`);

const buildSelectList = (groups: ResolvedGroup[], aggExprs: Array<{ key: string; expr: any; type: FormulaSqlType }>): any => {
  const selectParts = [
    ...groups.map((g) => sql`${g.expr} AS ${sql.unsafe(g.alias)}`),
    ...aggExprs.map((a) => sql`${a.expr} AS ${sql.unsafe(`"${a.key}"`)}`),
  ];
  return joinSql(selectParts);
};

const buildFromClause = (groups: ResolvedGroup[], baseRecords?: any): any => {
  let from: any = sql`${baseRecords ?? sql`grids.records r`}
    JOIN grids.tables _t ON _t.id = r.table_id AND _t.deleted_at IS NULL
    JOIN grids.bases _b ON _b.id = _t.base_id AND _b.deleted_at IS NULL`;

  for (const g of groups) {
    if (g.relationJoinIndex === undefined) continue;
    const alias = `rl_${g.relationJoinIndex}`;
    from = sql`${from} JOIN grids.record_links ${sql.unsafe(alias)}
      ON ${sql.unsafe(alias)}.from_record_id = r.id
     AND ${sql.unsafe(alias)}.from_field_id = ${g.field.id}::uuid`;
  }

  for (const g of groups) {
    if (g.selectJoinIndex === undefined) continue;
    const alias = `ms_${g.selectJoinIndex}`;
    from = sql`${from} CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(r.data->${g.field.id}) = 'array'
        THEN r.data->${g.field.id}
        ELSE '[]'::jsonb
      END
    ) AS ${sql.unsafe(alias)}(value)`;
  }

  return from;
};

const buildWhereClause = (params: CompileGroupParams): { ok: true; where: any } | { ok: false; error: string } => {
  const filterCompiled = compileFilter(params.filter ?? null, params.fields, { timeZone: params.timeZone });
  if (!filterCompiled.ok) return { ok: false, error: `filter: ${filterCompiled.error}` };

  const whereParts: any[] = [sql`r.table_id = ${params.tableId}::uuid`];
  if (params.deletedOnly) whereParts.push(sql`r.deleted_at IS NOT NULL`);
  else if (!params.includeDeleted) whereParts.push(sql`r.deleted_at IS NULL`);
  whereParts.push(renderClause(filterCompiled.clause));
  if (params.searchClause) whereParts.push(params.searchClause);
  if (params.extraWhere) whereParts.push(params.extraWhere);

  return { ok: true, where: whereParts.reduce((acc, cur) => sql`${acc} AND ${cur}`) };
};

const groupOrderPart = (g: ResolvedGroup, index: number, reverse: boolean): any => {
  const desc = g.spec.direction === "desc";
  const dir = reverse ? (desc ? sql`ASC` : sql`DESC`) : desc ? sql`DESC` : sql`ASC`;
  const nulls = reverse ? sql`NULLS FIRST` : sql`NULLS LAST`;
  return sql`${sql.unsafe(String(index + 1))} ${dir} ${nulls}`;
};

const aggregateOrderPart = (sort: GroupSortSpec, reverse: boolean): any => {
  const asc = sort.direction === "asc";
  const dir = reverse ? (asc ? sql`DESC` : sql`ASC`) : asc ? sql`ASC` : sql`DESC`;
  const nulls = reverse ? sql`NULLS FIRST` : sql`NULLS LAST`;
  return sql`${sql.unsafe(`"${aggAliasFor(sort)}"`)} ${dir} ${nulls}`;
};

const buildOrderBy = (groups: ResolvedGroup[], groupSort: GroupSortSpec[], reverse = false): any => {
  const parts = [
    ...groupSort.map((sort) => aggregateOrderPart(sort, reverse)),
    ...groups.map((group, index) => groupOrderPart(group, index, reverse)),
  ];
  return joinSql(parts);
};

const buildCursorHavingClause = (
  cursor: CompileGroupParams["cursor"],
  groups: ResolvedGroup[],
): { ok: true; havingClause: any } | { ok: false; error: string } => {
  if (!cursor) return { ok: true, havingClause: sql`TRUE` };
  if (cursor.keys.length !== groups.length) {
    return {
      ok: false,
      error: `cursor key count (${cursor.keys.length}) must match groupBy length (${groups.length})`,
    };
  }

  const branches: any[] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const cursorVal = cursor.keys[i];
    const cmp = (group.spec.direction ?? "asc") === "desc" ? sql`<` : sql`>`;
    let prefix: any = sql`TRUE`;

    for (let j = 0; j < i; j++) {
      const previousGroup = groups[j]!;
      prefix = sql`${prefix} AND (${previousGroup.expr} IS NOT DISTINCT FROM ${cursor.keys[j]})`;
    }

    const comp =
      cursorVal === null || cursorVal === undefined ? sql`FALSE` : sql`((${group.expr} ${cmp} ${cursorVal}) OR ${group.expr} IS NULL)`;
    branches.push(sql`(${prefix} AND ${comp})`);
  }

  const havingClause = branches.reduce((acc, cur) => sql`${acc} OR ${cur}`);
  return { ok: true, havingClause: sql`(${havingClause})` };
};

type CompileGroupParams = {
  tableId: string;
  groupBy: GroupBySpec[];
  aggregations: GroupAggregationSpec[];
  groupSort?: GroupSortSpec[];
  having?: Expr;
  havingRefs?: GroupHavingRef[];
  filter?: FilterTree | null;
  searchClause?: any;
  extraWhere?: any;
  fields: Field[];
  cursor?: { keys: unknown[] } | null;
  limit?: number;
  offset?: number;
  /** When true, returns the last N buckets by the requested group order. */
  fromEnd?: boolean;
  /** When true, soft-deleted records are included in the aggregation. */
  includeDeleted?: boolean;
  /** When true, only soft-deleted records are included. */
  deletedOnly?: boolean;
  /** Preview-only: aggregate over a bounded matching-record sample. */
  baseRecordLimit?: number;
  timeZone?: string;
  dateConfig?: DateContext;
};

type CompileGroupResult =
  | { ok: true; query: any; resolvedGroups: ResolvedGroup[]; aggKeys: string[]; cursorable: boolean }
  | { ok: false; error: string };

export const compileGroupQuery = (params: CompileGroupParams): CompileGroupResult => {
  if (params.groupBy.length === 0) {
    return { ok: false, error: "groupBy is empty — use the regular records list for ungrouped queries" };
  }
  if (params.groupBy.length > 3) {
    return { ok: false, error: "groupBy supports at most 3 levels" };
  }

  const groups = resolveGroupBy(params.groupBy, params.fields, params.timeZone ?? "UTC");
  if (!groups.ok) return groups;

  const fieldsById = new Map(params.fields.map((f) => [f.id, f]));
  const groupSort = params.groupSort ?? [];
  if (params.cursor && groupSort.length > 0) {
    return {
      ok: false,
      error: "cursor pagination is not supported for aggregate-sorted groups",
    };
  }
  if (params.cursor && params.fromEnd) {
    return {
      ok: false,
      error: "cursor pagination is not supported for tail-window grouped queries",
    };
  }
  if ((params.offset ?? 0) > 0 && params.cursor) {
    return {
      ok: false,
      error: "offset pagination is not supported together with grouped cursors",
    };
  }
  if ((params.offset ?? 0) > 0 && params.fromEnd) {
    return {
      ok: false,
      error: "offset pagination is not supported for tail-window grouped queries",
    };
  }

  const aggregations = resolveAggregations(params.aggregations, fieldsById, params.fields, params.dateConfig);
  if (!aggregations.ok) return aggregations;

  const sortCheck = validateGroupSort(groupSort, aggregations.resolved.seenKeys);
  if (!sortCheck.ok) return sortCheck;
  const userHaving = buildUserHavingClause(params.having, params.havingRefs, aggregations.resolved.aggExprs, fieldsById);
  if (!userHaving.ok) return userHaving;

  // ── SQL pieces ──────────────────────────────────────────────────────
  // Filter (over base records) — same compiler as records.list. Note the
  // filter sees `r.data->>...` indirectly via the rendered clause, which
  // currently emits `data->>...` (no `r.` prefix). That's intentional —
  // when there's only one table, the unqualified column references the
  // outer FROM. For our query the FROM aliases as `r`, so the
  // unqualified `data` resolves correctly.
  const where = buildWhereClause(params);
  if (!where.ok) return where;

  const baseRecordLimit = params.baseRecordLimit === undefined ? null : Math.min(Math.max(params.baseRecordLimit, 1), 50_000);
  const baseRecords = baseRecordLimit
    ? sql`(
        SELECT r.*
        FROM grids.records r
        WHERE ${where.where}
        ORDER BY r.id ASC
        LIMIT ${baseRecordLimit}
      ) r`
    : undefined;
  const outerWhere = baseRecordLimit ? sql`TRUE` : where.where;

  const selectList = buildSelectList(groups.resolved, aggregations.resolved.aggExprs);
  const from = buildFromClause(groups.resolved, baseRecords);

  // GROUP BY (positional — references the SELECT list aliases)
  const groupByPositions = joinSql(groups.resolved.map((_, i) => sql`${sql.unsafe(String(i + 1))}`));
  const orderBy = buildOrderBy(groups.resolved, groupSort);
  const reverseOrderBy = buildOrderBy(groups.resolved, groupSort, true);

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
  const offset = Math.min(Math.max(params.offset ?? 0, 0), 10_000);
  // We over-fetch by 1 so the caller can detect hasMore.
  const fetchLimit = limit + 1;

  // Cursor predicate as a HAVING clause. Group keys are GROUP BY
  // expressions, not aggregates and not row columns; HAVING is the only
  // place they're referenceable post-aggregation. (Don't expect this to
  // make group queries cheap — Postgres still has to scan + group the
  // qualifying base rows. Keyset just narrows the visible page.)
  //
  // NULLS LAST semantics: nulls sort to the end in both asc and desc
  // because we explicitly emit `NULLS LAST` in ORDER BY. Cursor logic:
  //   cursor key non-null + asc:  (col > cursor) OR col IS NULL
  //   cursor key non-null + desc: (col < cursor) OR col IS NULL
  //   cursor key null            :  FALSE — nothing comes after the
  //                                 trailing-null tier at this level.
  const having = buildCursorHavingClause(params.cursor, groups.resolved);
  if (!having.ok) return having;
  const havingClause = sql`(${having.havingClause}) AND (${userHaving.clause})`;

  const groupedQuery = sql`
    SELECT ${selectList}
    FROM ${from}
    WHERE ${outerWhere}
    GROUP BY ${groupByPositions}
    HAVING ${havingClause}
  `;

  const query = params.fromEnd
    ? sql`
        SELECT *
        FROM (
          SELECT *
          FROM (${groupedQuery}) grouped_tail
          ORDER BY ${reverseOrderBy}
          LIMIT ${fetchLimit}
        ) grouped_tail_window
        ORDER BY ${orderBy}
      `
    : sql`
        SELECT *
        FROM (${groupedQuery}) grouped
        ORDER BY ${orderBy}
        LIMIT ${fetchLimit}
        OFFSET ${offset}
      `;

  return {
    ok: true,
    query,
    resolvedGroups: groups.resolved,
    aggKeys: aggregations.resolved.aggKeys,
    cursorable: groupSort.length === 0 && offset === 0,
  };
};
