import { sql } from "bun";
import type { Field } from "./types";

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

export type AggregateRequest = { fieldId: string; agg: AggKind };
export type AggregateColumn = {
  /** Result key: `${fieldId}__${agg}` — stable for the renderer to extract. */
  key: string;
  /** SELECT-list fragment, ready to be embedded in the SELECT clause. */
  expr: any;
};

const NUMERIC_TYPES = new Set(["number", "decimal", "rating", "autonumber"]);
const DATE_TYPES = new Set(["date"]);

const isCompatible = (agg: AggKind, type: string): boolean => {
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

  for (const req of requests) {
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
        expr = sql`SUM((data->>${fieldId})::numeric)`;
        break;
      case "avg":
        expr = sql`AVG((data->>${fieldId})::numeric)`;
        break;
      case "median":
        // PERCENTILE_CONT(0.5) — Postgres returns the linear-interpolated
        // 50th percentile, which is the median.
        expr = sql`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (data->>${fieldId})::numeric)`;
        break;
      case "min":
      case "max": {
        const fn = req.agg === "min" ? sql`MIN` : sql`MAX`;
        if (NUMERIC_TYPES.has(field.type)) {
          expr = sql`${fn}((data->>${fieldId})::numeric)`;
        } else if (DATE_TYPES.has(field.type)) {
          expr = sql`${fn}((data->>${fieldId})::date)`;
        } else {
          expr = sql`${fn}(data->>${fieldId})`;
        }
        break;
      }
      case "earliest":
      case "latest": {
        const fn = req.agg === "earliest" ? sql`MIN` : sql`MAX`;
        expr = sql`${fn}((data->>${fieldId})::timestamptz)`;
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
