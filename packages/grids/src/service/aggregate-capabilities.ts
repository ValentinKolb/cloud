import { scalarSqlTypeForField, storageOf } from "./field-storage";
import type { FormulaSqlType } from "./formula-sql-compiler";
import type { Field } from "./types";

export type AggregateKind = "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max" | "median" | "earliest" | "latest";

const COUNT_AGGS: ReadonlySet<AggregateKind> = new Set(["count", "countEmpty", "countUnique"]);
const NUMERIC_AGGS: ReadonlySet<AggregateKind> = new Set(["sum", "avg", "median"]);
const MIN_MAX_AGGS: ReadonlySet<AggregateKind> = new Set(["min", "max"]);
const DATE_EDGE_AGGS: ReadonlySet<AggregateKind> = new Set(["earliest", "latest"]);

const GROUP_AGGREGATE_KINDS: ReadonlySet<AggregateKind> = new Set([
  "count",
  "countEmpty",
  "countUnique",
  "sum",
  "avg",
  "min",
  "max",
  "median",
  "earliest",
  "latest",
]);

export const isAggregateKind = (agg: string): agg is AggregateKind => GROUP_AGGREGATE_KINDS.has(agg as AggregateKind);

export const aggregateOutputKey = (fieldId: string | "*", agg: string): string => `${fieldId}__${agg}`;

export const aggregateOutputKeyFor = (aggregation: { fieldId?: string | "*"; id?: string; agg: string; kind?: string }): string =>
  aggregateOutputKey(aggregation.kind === "formula" ? aggregation.id! : aggregation.fieldId!, aggregation.agg);

export const isFieldAggregatable = (field: Field | null, agg: AggregateKind, isStarField = false): boolean => {
  if (isStarField) return agg === "count";
  if (!field || field.deletedAt) return false;
  if (COUNT_AGGS.has(agg)) return true;

  const kind = storageOf(field).kind;
  const sqlType = scalarSqlTypeForField(field);
  if (kind === "system" && sqlType === "text") return false;
  if (NUMERIC_AGGS.has(agg)) return kind === "numeric";
  if (MIN_MAX_AGGS.has(agg)) return sqlType === "numeric" || sqlType === "date" || sqlType === "datetime" || sqlType === "text";
  if (DATE_EDGE_AGGS.has(agg)) return sqlType === "date" || sqlType === "datetime";
  return false;
};

export const isFormulaAggregatable = (type: FormulaSqlType, agg: AggregateKind): boolean => {
  if (COUNT_AGGS.has(agg)) return true;
  if (NUMERIC_AGGS.has(agg)) return type === "numeric";
  if (MIN_MAX_AGGS.has(agg)) return type === "numeric" || type === "date" || type === "datetime" || type === "text";
  if (DATE_EDGE_AGGS.has(agg)) return type === "date" || type === "datetime";
  return false;
};

export const aggregateSqlTypeForField = (field: Field | null, agg: AggregateKind, isStarField = false): FormulaSqlType => {
  if (isStarField || COUNT_AGGS.has(agg) || NUMERIC_AGGS.has(agg)) return "numeric";
  if (!field) return "unknown";

  if (DATE_EDGE_AGGS.has(agg)) {
    const sqlType = scalarSqlTypeForField(field);
    return sqlType === "date" || sqlType === "datetime" ? sqlType : "unknown";
  }

  return scalarSqlTypeForField(field);
};

export const aggregateSqlTypeForFormula = (type: FormulaSqlType, agg: AggregateKind): FormulaSqlType =>
  COUNT_AGGS.has(agg) || NUMERIC_AGGS.has(agg) ? "numeric" : type;
