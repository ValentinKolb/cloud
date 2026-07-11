export type AggKindUI = "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max";

export type AggregationRow = {
  /** "*" is shorthand for COUNT(*) — count of records in the bucket. */
  fieldId: string | "*";
  agg: AggKindUI;
  /** Optional column header override. When set, the GroupedTable header
   *  uses this verbatim instead of `<agg> <fieldName>`. Letting users
   *  pick "Revenue" instead of "sum price" is a small but valuable
   *  ergonomics win. */
  label?: string;
};

export const isAggregationRowComplete = (row: AggregationRow): boolean => Boolean(row.fieldId && row.agg);
