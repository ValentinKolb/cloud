import { sql } from "bun";
import type { Field } from "./types";
import { storageOf } from "./field-storage";

export type AggKind =
  | "count"
  | "countEmpty"
  | "countUnique"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "median"
  | "earliest"
  | "latest";

/** "*" is a virtual field id meaning "the row itself". Only `count` is
 *  defined for it (`COUNT(*)`); any other agg returns a compile error. */
export type AggregateRequest = { fieldId: string | "*"; agg: AggKind };
export type AggregateColumn = {
  /** Result key: `${fieldId}__${agg}` — stable for the renderer to extract. */
  key: string;
  /** SELECT-list fragment, ready to be embedded in the SELECT clause. */
  expr: any;
};

// Numeric-castable types. v3 (Slice 7) extends the set with currency,
// percent, and duration — they were silently rejected before despite
// having well-defined numeric aggregation semantics.
//
// Currency is decimal-backed (just a number) with a display-only
// symbol in field config — see currencyHandler. SQL projection
// matches decimal exactly, no nested JSON path. Every numeric type
// goes through the same `try_numeric(data->>id)` pipeline.
const NUMERIC_TYPES = new Set([
  "number", "decimal", "rating", "autonumber", "percent", "duration", "currency",
]);
const DATE_TYPES = new Set(["date"]);

/** SQL fragment that extracts a numeric value for the given field.
 *  Delegates to the shared storage descriptor; corrupt JSONB
 *  resolves to NULL via try_numeric, so aggregates don't crash. */
const numericProjection = (field: Field): any => {
  const expr = storageOf(field).project(field, "r");
  return expr ?? sql`NULL::numeric`;
};

const isCompatible = (agg: AggKind, type: string): boolean => {
  // Relation values live in record_links, NOT in JSONB. Aggregating
  // relation fields via `data->>fieldId` returns 0 / "empty" silently
  // (chunk 3 critical). Reject every agg kind on relation fields here;
  // grouped relation queries (one bucket per linked record) keep
  // working because they go through the group-compiler's record_links
  // join, not this aggregate path.
  if (type === "relation") return false;
  // Computed fields (formula/lookup/rollup) are projected post-query;
  // they're not in JSONB during aggregate compilation. Aggregating
  // would silently see NULL for every row.
  if (type === "formula" || type === "lookup" || type === "rollup") return false;
  switch (agg) {
    case "count":
    case "countEmpty":
    case "countUnique":
      return true;
    case "sum":
    case "avg":
    case "median":
      return NUMERIC_TYPES.has(type);
    case "min":
    case "max":
      return NUMERIC_TYPES.has(type) || DATE_TYPES.has(type) || type === "text" || type === "longtext";
    case "earliest":
    case "latest":
      return DATE_TYPES.has(type);
  }
};

export type CompileAggResult =
  | { ok: true; columns: AggregateColumn[] }
  | { ok: false; error: string };

/**
 * Builds a SELECT-list of aggregate expressions over the records table's
 * JSONB column. Caller composes them with the same WHERE clause used for
 * the records list, so footer aggregates respect filter/permission scope.
 *
 * Storage notes: we cast text→numeric/date once per row at aggregate time.
 * For hot footer aggregates the field can be opt-in indexed (`indexed=true`)
 * so Postgres uses the expression index for these casts.
 */
export const compileAggregates = (
  requests: AggregateRequest[],
  fields: Field[],
): CompileAggResult => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const columns: AggregateColumn[] = [];
  // Reject duplicate (fieldId, agg) requests instead of silently
  // emitting two SELECT columns with the same JSONB key (the second
  // wins in jsonb_build_object). Group-compiler already dedupes by
  // alias; aggregate-compiler now matches that behaviour.
  const seen = new Set<string>();

  for (const req of requests) {
    const dupKey = `${req.fieldId}__${req.agg}`;
    if (seen.has(dupKey)) {
      return { ok: false, error: `duplicate aggregate "${req.agg}" on the same field` };
    }
    seen.add(dupKey);
    // "*" — virtual "the row" field. Only count is defined (COUNT(*)).
    // The footer renders this under the leftmost column, Airtable-style.
    if (req.fieldId === "*") {
      if (req.agg !== "count") {
        return { ok: false, error: `agg "${req.agg}" requires a field; only count works on "*"` };
      }
      columns.push({ key: "*__count", expr: sql`COUNT(*)` });
      continue;
    }

    const field = fieldsById.get(req.fieldId);
    if (!field) return { ok: false, error: `unknown field "${req.fieldId}"` };
    if (field.deletedAt) return { ok: false, error: `field "${field.name}" is deleted` };
    if (!isCompatible(req.agg, field.type)) {
      return { ok: false, error: `agg "${req.agg}" not compatible with field type "${field.type}"` };
    }

    const key = `${field.id}__${req.agg}`;
    const fieldId = field.id;
    let expr: any;

    switch (req.agg) {
      case "count":
        // Count of non-null values.
        expr = sql`COUNT(data->>${fieldId}) FILTER (WHERE data->>${fieldId} IS NOT NULL AND data->>${fieldId} <> '')`;
        break;
      case "countEmpty":
        expr = sql`COUNT(*) FILTER (WHERE data->>${fieldId} IS NULL OR data->>${fieldId} = '')`;
        break;
      case "countUnique":
        expr = sql`COUNT(DISTINCT data->>${fieldId}) FILTER (WHERE data->>${fieldId} IS NOT NULL AND data->>${fieldId} <> '')`;
        break;
      case "sum":
        expr = sql`SUM(${numericProjection(field)})`;
        break;
      case "avg":
        expr = sql`AVG(${numericProjection(field)})`;
        break;
      case "median":
        // PERCENTILE_CONT(0.5) — Postgres returns the linear-interpolated
        // 50th percentile, which is the median.
        expr = sql`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${numericProjection(field)})`;
        break;
      case "min":
      case "max": {
        const fn = req.agg === "min" ? sql`MIN` : sql`MAX`;
        if (NUMERIC_TYPES.has(field.type)) {
          expr = sql`${fn}(${numericProjection(field)})`;
        } else if (DATE_TYPES.has(field.type)) {
          // Safe-cast: corrupt date data → NULL → ignored by MIN/MAX,
          // not a query crash.
          expr = sql`${fn}(grids.try_date(data->>${fieldId}))`;
        } else {
          expr = sql`${fn}(data->>${fieldId})`;
        }
        break;
      }
      case "earliest":
      case "latest": {
        const fn = req.agg === "earliest" ? sql`MIN` : sql`MAX`;
        expr = sql`${fn}(grids.try_timestamptz(data->>${fieldId}))`;
        break;
      }
    }

    // Wrap in `AS "<key>"` so the result row can index by key. Bun's sql
    // doesn't expose an aliasing helper, so we use a string identifier
    // built from fieldId + agg — both validated server-side, no injection.
    columns.push({ key, expr });
  }

  return { ok: true, columns };
};
