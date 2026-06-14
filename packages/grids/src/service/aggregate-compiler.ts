import { sql } from "bun";
import { type AggregateKind, aggregateOutputKey, isFieldAggregatable } from "./aggregate-capabilities";
import { storageOf } from "./field-storage";
import type { Field } from "./types";

export type AggKind = AggregateKind;

/** "*" is a virtual field id meaning "the row itself". Only `count` is
 *  defined for it (`COUNT(*)`); any other agg returns a compile error. */
export type AggregateRequest = { fieldId: string | "*"; agg: AggKind };
type AggregateColumn = {
  /** Result key: `${fieldId}__${agg}` — stable for the renderer to extract. */
  key: string;
  /** SELECT-list fragment, ready to be embedded in the SELECT clause. */
  expr: any;
};

/** SQL fragment that extracts a numeric value for the given field.
 *  Delegates to the shared storage descriptor; corrupt JSONB
 *  resolves to NULL via try_numeric, so aggregates don't crash. */
const numericProjection = (field: Field): any => {
  const expr = storageOf(field).project(field, "r");
  return expr ?? sql`NULL::numeric`;
};

const dateProjection = (field: Field): any => storageOf(field).project(field, "r") ?? sql`NULL::date`;

const existsProjection = (field: Field): { ref: any; system: boolean } => {
  const storage = storageOf(field);
  if (storage.kind === "system") return { ref: storage.project(field, "r"), system: true };
  return { ref: sql`r.data->>${field.id}`, system: false };
};

type CompileAggResult = { ok: true; columns: AggregateColumn[] } | { ok: false; error: string };

/**
 * Builds a SELECT-list of aggregate expressions over the records table's
 * JSONB column. Caller composes them with the same WHERE clause used for
 * the records list, so footer aggregates respect filter/permission scope.
 *
 * Storage notes: we cast text→numeric/date once per row at aggregate time.
 * For hot footer aggregates the field can be opt-in indexed (`indexed=true`)
 * so Postgres uses the expression index for these casts.
 */
export const compileAggregates = (requests: AggregateRequest[], fields: Field[]): CompileAggResult => {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const columns: AggregateColumn[] = [];
  // Reject duplicate (fieldId, agg) requests instead of silently
  // emitting two SELECT columns with the same JSONB key (the second
  // wins in jsonb_build_object). Group-compiler already dedupes by
  // alias; aggregate-compiler now matches that behaviour.
  const seen = new Set<string>();

  for (const req of requests) {
    const dupKey = aggregateOutputKey(req.fieldId, req.agg);
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
      columns.push({ key: aggregateOutputKey("*", "count"), expr: sql`COUNT(*)` });
      continue;
    }

    const field = fieldsById.get(req.fieldId);
    if (!field) return { ok: false, error: "unknown field" };
    if (field.deletedAt) return { ok: false, error: `field "${field.name}" is deleted` };
    if (!isFieldAggregatable(field, req.agg)) {
      return { ok: false, error: `agg "${req.agg}" not compatible with field type "${field.type}"` };
    }

    const key = aggregateOutputKey(field.id, req.agg);
    const storage = storageOf(field);
    const exists = existsProjection(field);
    let expr: any;

    switch (req.agg) {
      case "count":
        // Count of non-null values.
        expr = exists.system
          ? sql`COUNT(${exists.ref}) FILTER (WHERE ${exists.ref} IS NOT NULL)`
          : sql`COUNT(${exists.ref}) FILTER (WHERE ${exists.ref} IS NOT NULL AND ${exists.ref} <> '')`;
        break;
      case "countEmpty":
        expr = exists.system
          ? sql`COUNT(*) FILTER (WHERE ${exists.ref} IS NULL)`
          : sql`COUNT(*) FILTER (WHERE ${exists.ref} IS NULL OR ${exists.ref} = '')`;
        break;
      case "countUnique":
        expr = exists.system
          ? sql`COUNT(DISTINCT ${exists.ref}) FILTER (WHERE ${exists.ref} IS NOT NULL)`
          : sql`COUNT(DISTINCT ${exists.ref}) FILTER (WHERE ${exists.ref} IS NOT NULL AND ${exists.ref} <> '')`;
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
        if (storage.kind === "numeric") {
          expr = sql`${fn}(${numericProjection(field)})`;
        } else if (storage.kind === "date" || storage.kind === "datetime") {
          // Safe-cast: corrupt ISO date data → NULL → ignored by MIN/MAX,
          // not a query crash.
          expr = sql`${fn}(${dateProjection(field)})`;
        } else {
          expr = sql`${fn}(${exists.ref})`;
        }
        break;
      }
      case "earliest":
      case "latest": {
        const fn = req.agg === "earliest" ? sql`MIN` : sql`MAX`;
        expr = sql`${fn}(${dateProjection(field)})`;
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
