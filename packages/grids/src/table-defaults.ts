import type { AggregationSpec } from "./contracts";
import type { Field } from "./service/types";

const SUM_TYPES = new Set(["number", "duration"]);

export const defaultTableAggregations = (fields: Field[]): AggregationSpec[] => [
  { fieldId: "*", agg: "count", label: "records" },
  ...fields
    .filter((f) => !f.deletedAt)
    .flatMap((f): AggregationSpec[] => {
      if (SUM_TYPES.has(f.type)) return [{ fieldId: f.id, agg: "sum" }];
      if (f.type === "percent") return [{ fieldId: f.id, agg: "avg" }];
      if (f.type === "date") return [{ fieldId: f.id, agg: "latest" }];
      return [];
    }),
];

