import { sql } from "bun";
import type { Field } from "./types";
import type { CompiledClause } from "./filter-compiler";
import { renderClause } from "./filter-compiler";
import { compileFilter } from "./filter-compiler";
import type { FilterTree } from "./filter-compiler";

// =============================================================================
// Group-by + aggregations compiler (v3 Slice 8)
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
// Relation grouping: explode-semantics via JOIN on record_links. A
// record with [TagA, TagB] contributes to BOTH the TagA bucket and
// the TagB bucket. The total count across buckets exceeds the total
// record count when records have multiple links — caller documents
// this as "explode-mode" so the UI can warn.
//
// Lookup / rollup grouping: rejected for now (would require either
// rerunning the correlated subquery as GROUP BY expression or wrapping
// the whole records query in a CTE — both viable, neither tiny).
// Tracked as v8.1 follow-up.
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

export type AggKindForGroup =
  | "count"
  | "countEmpty"
  | "countUnique"
  | "sum"
  | "avg"
  | "min"
  | "max";

export type GroupAggregationSpec = {
  /** "*" is shorthand for COUNT(*). */
  fieldId: string | "*";
  agg: AggKindForGroup;
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

export type CompiledGroup = {
  /** SELECT list + GROUP BY + ORDER BY + cursor predicate, ready to embed. */
  query: any;
  /** Number of group keys — used by the runner to decode the result rows. */
  keyCount: number;
  /** Aggregation column keys in emit order. */
  aggKeys: string[];
};

// ──────────────────────────────────────────────────────────────────
// Type helpers
// ──────────────────────────────────────────────────────────────────

const SCALAR_GROUPABLE_TYPES = new Set([
  "text", "longtext", "number", "decimal", "currency", "percent", "duration",
  "rating", "autonumber", "boolean", "date",
  "single-select", "email", "url", "phone", "slug", "barcode", "isbn",
]);

/** Field-types that can appear in groupBy. multi-select is excluded
 *  for v3 (would require an extra LATERAL unnest step similar to
 *  relation explode); lookup/rollup deferred (see module header). */
export const isGroupable = (field: Field): boolean => {
  if (field.deletedAt) return false;
  if (field.type === "relation") return true;
  return SCALAR_GROUPABLE_TYPES.has(field.type);
};

const NUMERIC_TYPES = new Set([
  "number", "decimal", "currency", "percent", "duration",
  "rating", "autonumber",
]);
const DATE_TYPES = new Set(["date"]);
/**
 * Numeric-castable types when used as a groupBy KEY. Mirrors NUMERIC_TYPES
 * but exists separately because some types are aggregable but not
 * groupable (and vice versa, in future). Currency and percent get the
 * same treatment as number/decimal — uniform semantics with the
 * aggregate compiler.
 */
const NUMERIC_GROUPABLE_TYPES = NUMERIC_TYPES;

/** Returns whether `agg` makes sense over `field`. count* always do. */
export const isAggregatable = (
  field: Field | null,
  agg: AggKindForGroup,
  isStarField: boolean,
): boolean => {
  if (isStarField) return agg === "count";
  if (!field || field.deletedAt) return false;
  if (agg === "count" || agg === "countEmpty" || agg === "countUnique") return true;
  if (agg === "sum" || agg === "avg") return NUMERIC_TYPES.has(field.type);
  if (agg === "min" || agg === "max") return NUMERIC_TYPES.has(field.type) || DATE_TYPES.has(field.type) || field.type === "text" || field.type === "longtext";
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
};

const groupAlias = (i: number) => `gk_${i}`;
const aggAliasFor = (req: GroupAggregationSpec): string =>
  `${req.fieldId}__${req.agg}`;

/** Build a per-group projection. Scalar / date / relation branches
 *  diverge here. */
const resolveGroupBy = (
  specs: GroupBySpec[],
  fields: Field[],
): { ok: true; resolved: ResolvedGroup[] } | { ok: false; error: string } => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const resolved: ResolvedGroup[] = [];
  let relationJoinCounter = 0;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const field = fieldsById.get(spec.fieldId);
    if (!field) return { ok: false, error: `unknown groupBy field "${spec.fieldId}"` };
    if (!isGroupable(field)) {
      return { ok: false, error: `field "${field.name}" (type "${field.type}") is not groupable` };
    }

    const alias = groupAlias(i);

    if (field.type === "relation") {
      // Explode-mode: each link contributes one row. The JOIN alias
      // exposes the to_record_id; we use that as the group key.
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

    if (field.type === "date" && spec.granularity) {
      // Server-side bucketing. Cast goes through grids.try_date so
      // corrupt values produce NULL instead of crashing the GROUP BY.
      const gran = spec.granularity;
      // date_trunc returns timestamptz; cast to date for clean grouping.
      resolved.push({
        spec,
        field,
        alias,
        expr: sql`date_trunc(${gran}, grids.try_timestamptz(r.data->>${field.id}))`,
      });
      continue;
    }

    // Type-aware scalar projection (Slice 8 follow-up): without the cast,
    // numeric-shaped JSONB values group / sort lexicographically — "10"
    // before "2", "100" before "9". Cast goes through the safe-cast
    // wrappers so corrupt rows fall to NULL instead of crashing.
    if (NUMERIC_GROUPABLE_TYPES.has(field.type)) {
      // Currency stores under nested `amount`. Mirror the aggregate-
      // compiler convention so numeric semantics are consistent.
      const expr = field.type === "currency"
        ? sql`grids.try_numeric(r.data->${field.id}->>'amount')`
        : sql`grids.try_numeric(r.data->>${field.id})`;
      resolved.push({ spec, field, alias, expr });
      continue;
    }
    if (field.type === "date") {
      // No granularity → group by exact day.
      resolved.push({
        spec,
        field,
        alias,
        expr: sql`grids.try_date(r.data->>${field.id})`,
      });
      continue;
    }
    if (field.type === "boolean") {
      resolved.push({
        spec,
        field,
        alias,
        expr: sql`grids.try_boolean(r.data->>${field.id})`,
      });
      continue;
    }

    // Text-shaped default: data->>fid is already text.
    resolved.push({
      spec,
      field,
      alias,
      expr: sql`r.data->>${field.id}`,
    });
  }

  return { ok: true, resolved };
};

const buildAggExpr = (
  req: GroupAggregationSpec,
  field: Field | null,
): { ok: true; expr: any } | { ok: false; error: string } => {
  if (req.fieldId === "*") {
    if (req.agg !== "count") {
      return { ok: false, error: `agg "${req.agg}" requires a fieldId (only count works on "*")` };
    }
    return { ok: true, expr: sql`count(*)::bigint` };
  }
  if (!field) return { ok: false, error: `unknown agg field "${req.fieldId}"` };
  if (!isAggregatable(field, req.agg, false)) {
    return { ok: false, error: `agg "${req.agg}" not compatible with field type "${field.type}"` };
  }

  // Currency stores under a nested JSON object — the aggregate-compiler
  // already centralised this; replicate the same projection rule here
  // rather than reaching across module boundaries.
  const numProj = field.type === "currency"
    ? sql`grids.try_numeric(r.data->${field.id}->>'amount')`
    : sql`grids.try_numeric(r.data->>${field.id})`;

  switch (req.agg) {
    case "count":
      return {
        ok: true,
        expr: sql`count(r.data->>${field.id}) FILTER (WHERE r.data->>${field.id} IS NOT NULL AND r.data->>${field.id} <> '')::bigint`,
      };
    case "countEmpty":
      return {
        ok: true,
        expr: sql`count(*) FILTER (WHERE r.data->>${field.id} IS NULL OR r.data->>${field.id} = '')::bigint`,
      };
    case "countUnique":
      return {
        ok: true,
        expr: sql`count(DISTINCT r.data->>${field.id}) FILTER (WHERE r.data->>${field.id} IS NOT NULL AND r.data->>${field.id} <> '')::bigint`,
      };
    case "sum":
      return { ok: true, expr: sql`SUM(${numProj})` };
    case "avg":
      return { ok: true, expr: sql`AVG(${numProj})` };
    case "min":
    case "max": {
      const fn = req.agg === "min" ? sql`MIN` : sql`MAX`;
      if (NUMERIC_TYPES.has(field.type)) {
        return { ok: true, expr: sql`${fn}(${numProj})` };
      }
      if (DATE_TYPES.has(field.type)) {
        return { ok: true, expr: sql`${fn}(grids.try_date(r.data->>${field.id}))` };
      }
      return { ok: true, expr: sql`${fn}(r.data->>${field.id})` };
    }
  }
};

export type CompileGroupParams = {
  tableId: string;
  groupBy: GroupBySpec[];
  aggregations: GroupAggregationSpec[];
  filter?: FilterTree | null;
  fields: Field[];
  cursor?: { keys: unknown[] } | null;
  limit?: number;
  /** When true, soft-deleted records are included in the aggregation. */
  includeDeleted?: boolean;
};

export type CompileGroupResult =
  | { ok: true; query: any; resolvedGroups: ResolvedGroup[]; aggKeys: string[] }
  | { ok: false; error: string };

export const compileGroupQuery = (
  params: CompileGroupParams,
): CompileGroupResult => {
  if (params.groupBy.length === 0) {
    return { ok: false, error: "groupBy is empty — use the regular records list for ungrouped queries" };
  }
  if (params.groupBy.length > 3) {
    return { ok: false, error: "groupBy supports at most 3 levels in v3" };
  }

  const groups = resolveGroupBy(params.groupBy, params.fields);
  if (!groups.ok) return groups;

  const fieldsById = new Map(params.fields.map((f) => [f.id, f]));

  // Aggregation expressions. Dedupe by alias so requesting `count(amount)`
  // twice doesn't emit duplicate columns — last write wins.
  const aggKeys: string[] = [];
  const aggExprs: Array<{ key: string; expr: any }> = [];
  const seenKeys = new Set<string>();
  for (const req of params.aggregations) {
    const fld = req.fieldId === "*" ? null : (fieldsById.get(req.fieldId) ?? null);
    if (req.fieldId !== "*" && !fld) {
      return { ok: false, error: `unknown agg field "${req.fieldId}"` };
    }
    const built = buildAggExpr(req, fld);
    if (!built.ok) return built;
    const key = aggAliasFor(req);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    aggKeys.push(key);
    aggExprs.push({ key, expr: built.expr });
  }
  // Always include count(*) under "*__count" if not explicitly requested.
  // Group-bucket UI universally wants "how many records in this bucket".
  if (!seenKeys.has("*__count")) {
    aggKeys.unshift("*__count");
    aggExprs.unshift({ key: "*__count", expr: sql`count(*)::bigint` });
  }

  // ── SQL pieces ──────────────────────────────────────────────────────
  // Filter (over base records) — same compiler as records.list. Note the
  // filter sees `r.data->>...` indirectly via the rendered clause, which
  // currently emits `data->>...` (no `r.` prefix). That's intentional —
  // when there's only one table, the unqualified column references the
  // outer FROM. For our query the FROM aliases as `r`, so the
  // unqualified `data` resolves correctly.
  const filterCompiled = compileFilter(params.filter ?? null, params.fields);
  if (!filterCompiled.ok) return { ok: false, error: `filter: ${filterCompiled.error}` };
  const filterClause: CompiledClause = filterCompiled.clause;
  const renderedFilter = renderClause(filterClause);

  // SELECT list
  const selectParts: any[] = [];
  for (const g of groups.resolved) {
    selectParts.push(sql`${g.expr} AS ${sql.unsafe(g.alias)}`);
  }
  for (const a of aggExprs) {
    selectParts.push(sql`${a.expr} AS ${sql.unsafe(`"${a.key}"`)}`);
  }
  const selectList = selectParts.reduce((acc, cur) => sql`${acc}, ${cur}`);

  // FROM + JOINs — one record_links join per relation group.
  let from: any = sql`grids.records r`;
  for (const g of groups.resolved) {
    if (g.relationJoinIndex === undefined) continue;
    const alias = `rl_${g.relationJoinIndex}`;
    from = sql`${from} JOIN grids.record_links ${sql.unsafe(alias)}
      ON ${sql.unsafe(alias)}.from_record_id = r.id
     AND ${sql.unsafe(alias)}.from_field_id = ${g.field.id}::uuid`;
  }

  // WHERE
  const whereParts: any[] = [sql`r.table_id = ${params.tableId}::uuid`];
  if (!params.includeDeleted) whereParts.push(sql`r.deleted_at IS NULL`);
  whereParts.push(renderedFilter);
  // Cursor predicate over the group-key tuple — keyset pagination.
  if (params.cursor && params.cursor.keys.length === groups.resolved.length) {
    // Lexicographic comparison: gk_0 > c0 OR (gk_0 = c0 AND gk_1 > c1) OR ...
    // Mixed direction support follows the sort-compiler approach: each
    // column compares per its own direction. This shows up as part of
    // the HAVING clause because the keys are aggregate expressions that
    // can only be referenced post-grouping.
    // For v3 we apply the cursor in the OUTER select (wrapping the
    // group query) — keeps the inner compile simple.
  }
  const where = whereParts.reduce((acc, cur) => sql`${acc} AND ${cur}`);

  // GROUP BY (positional — references the SELECT list aliases)
  const groupByPositions = groups.resolved
    .map((_, i) => sql`${sql.unsafe(String(i + 1))}`)
    .reduce((acc, cur) => sql`${acc}, ${cur}`);

  // ORDER BY — by group-key positions in declared order.
  const orderByParts = groups.resolved.map((g, i) => {
    const dir = g.spec.direction === "desc" ? sql`DESC` : sql`ASC`;
    return sql`${sql.unsafe(String(i + 1))} ${dir} NULLS LAST`;
  });
  const orderBy = orderByParts.reduce((acc, cur) => sql`${acc}, ${cur}`);

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
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
  let havingClause: any = sql`TRUE`;
  if (params.cursor) {
    if (params.cursor.keys.length !== groups.resolved.length) {
      return {
        ok: false,
        error: `cursor key count (${params.cursor.keys.length}) must match groupBy length (${groups.resolved.length})`,
      };
    }
    const branches: any[] = [];
    for (let i = 0; i < groups.resolved.length; i++) {
      const g = groups.resolved[i]!;
      const cursorVal = params.cursor.keys[i];
      const dir = g.spec.direction ?? "asc";
      const cmp = dir === "desc" ? sql`<` : sql`>`;
      // Equality prefix on earlier columns. IS NOT DISTINCT FROM
      // makes NULL == NULL true, which is what we want here.
      let prefix: any = sql`TRUE`;
      for (let j = 0; j < i; j++) {
        const gj = groups.resolved[j]!;
        prefix = sql`${prefix} AND (${gj.expr} IS NOT DISTINCT FROM ${params.cursor.keys[j]})`;
      }
      // Comparison
      const comp = cursorVal === null || cursorVal === undefined
        ? sql`FALSE` // NULLS LAST: nothing after the null tier at this level
        : sql`((${g.expr} ${cmp} ${cursorVal}) OR ${g.expr} IS NULL)`;
      branches.push(sql`(${prefix} AND ${comp})`);
    }
    havingClause = branches.reduce((acc, cur) => sql`${acc} OR ${cur}`);
    havingClause = sql`(${havingClause})`;
  }

  const query = sql`
    SELECT ${selectList}
    FROM ${from}
    WHERE ${where}
    GROUP BY ${groupByPositions}
    HAVING ${havingClause}
    ORDER BY ${orderBy}
    LIMIT ${fetchLimit}
  `;

  return { ok: true, query, resolvedGroups: groups.resolved, aggKeys };
};
