import { sql } from "bun";
import type { Field } from "./types";
import type { CompiledClause } from "./filter-compiler";
import { renderClause } from "./filter-compiler";
import { compileFilter } from "./filter-compiler";
import type { FilterTree } from "./filter-compiler";
import { storageOf, type ProjectionKind } from "./field-storage";

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
// Type helpers — every capability check + SQL projection goes through
// the storage descriptor (field-storage.ts) so this compiler stops
// re-spelling rules already encoded once. The descriptor knows that
// currency stores under nested `amount`, that numeric/decimal/percent/
// duration/rating cast through try_numeric, and that system fields are
// real columns not JSONB. Touching the descriptor adds the new shape
// in one place instead of n compilers.
// ──────────────────────────────────────────────────────────────────

/** Projection kinds whose SQL value is numeric-shaped. sum/avg work
 *  over these; min/max work over these plus date / datetime / text. */
const NUMERIC_KINDS: ReadonlySet<ProjectionKind> = new Set([
  "numeric",
  "decimal",
]);
const DATE_KINDS: ReadonlySet<ProjectionKind> = new Set(["date", "datetime"]);

/** Field-types that can appear in groupBy. multi-select is excluded
 *  for v3 (would require an extra LATERAL unnest step similar to
 *  relation explode); lookup/rollup deferred (see module header).
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
export const isAggregatable = (
  field: Field | null,
  agg: AggKindForGroup,
  isStarField: boolean,
): boolean => {
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

    if (field.type === "date" && spec.granularity) {
      // Server-side bucketing. Cast goes through grids.try_timestamptz
      // so corrupt values produce NULL instead of crashing the GROUP BY.
      // Bypasses the descriptor's date projection because we want the
      // pre-truncation timestamptz so date_trunc handles week/quarter/
      // year correctly — date_trunc('quarter', date) doesn't exist.
      const gran = spec.granularity;
      resolved.push({
        spec,
        field,
        alias,
        expr: sql`date_trunc(${gran}, grids.try_timestamptz(r.data->>${field.id}))`,
      });
      continue;
    }

    // Every other groupable type routes through the descriptor — currency
    // gets its amount projection, numeric/date/boolean get their typed
    // casts, single-select/text/system fields get the right shape. Drops
    // the duplicated currency / NUMERIC_GROUPABLE_TYPES / date / boolean
    // branches that used to live here.
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

  // Typed projection from the storage descriptor — currency uses its
  // nested amount path, numerics cast through try_numeric, dates
  // through try_date, system columns reference the column directly.
  // count* still operate on the raw "is this slot populated" text
  // because we want to count rows where the user wrote ANYTHING (even
  // an unparseable number), not rows where the typed projection
  // happens to be non-null.
  const desc = storageOf(field);
  const typedProj = desc.project(field, "r") as any;
  // Existence-shaped reference used by count*. For JSONB-backed kinds
  // we read the raw text; for system kinds we use the column itself
  // (no '' check — columns are typed, "" is meaningless).
  const existsRef =
    desc.kind === "system"
      ? typedProj
      : sql`r.data->>${field.id}`;
  const isSystem = desc.kind === "system";

  switch (req.agg) {
    case "count":
      return {
        ok: true,
        expr: isSystem
          ? sql`count(${existsRef}) FILTER (WHERE ${existsRef} IS NOT NULL)::bigint`
          : sql`count(${existsRef}) FILTER (WHERE ${existsRef} IS NOT NULL AND ${existsRef} <> '')::bigint`,
      };
    case "countEmpty":
      return {
        ok: true,
        expr: isSystem
          ? sql`count(*) FILTER (WHERE ${existsRef} IS NULL)::bigint`
          : sql`count(*) FILTER (WHERE ${existsRef} IS NULL OR ${existsRef} = '')::bigint`,
      };
    case "countUnique":
      return {
        ok: true,
        expr: isSystem
          ? sql`count(DISTINCT ${existsRef}) FILTER (WHERE ${existsRef} IS NOT NULL)::bigint`
          : sql`count(DISTINCT ${existsRef}) FILTER (WHERE ${existsRef} IS NOT NULL AND ${existsRef} <> '')::bigint`,
      };
    case "sum":
      return { ok: true, expr: sql`SUM(${typedProj})` };
    case "avg":
      return { ok: true, expr: sql`AVG(${typedProj})` };
    case "min":
    case "max": {
      const fn = req.agg === "min" ? sql`MIN` : sql`MAX`;
      // min/max routes through the typed projection for every
      // kind. For text fields the descriptor projection IS `data->>id`
      // so min/max gives lexicographic order on raw text — identical
      // to what the old hard-coded fallback emitted.
      return { ok: true, expr: sql`${fn}(${typedProj})` };
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

  // FROM + JOINs — live-parent invariant (records of a trashed table or
  // base never group), then one record_links join per relation group.
  let from: any = sql`grids.records r
    JOIN grids.tables _t ON _t.id = r.table_id AND _t.deleted_at IS NULL
    JOIN grids.bases _b ON _b.id = _t.base_id AND _b.deleted_at IS NULL`;
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
  // Cursor predicate is applied in the HAVING clause below — group keys
  // are aggregate expressions and can't be referenced from WHERE before
  // grouping happens.
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
