import { describe, expect, test } from "bun:test";
import {
  MAX_FILTER_DEPTH,
  MAX_QUERY_AGGREGATIONS,
  MAX_QUERY_COLUMNS,
  MAX_QUERY_SORTS,
  RecordQuerySchema,
  type FilterTree,
} from "./contracts";

const fieldId = "11111111-1111-4111-8111-111111111111";

describe("RecordQuery bounds", () => {
  test("rejects filter trees beyond the supported depth before recursive parsing", () => {
    let filter: FilterTree = { fieldId, op: "equals", value: "value" };
    for (let depth = 0; depth < MAX_FILTER_DEPTH; depth += 1) filter = { op: "AND", filters: [filter] };
    const parsed = RecordQuerySchema.safeParse({ filter });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe("filter is too large or deeply nested");
  });

  test("caps SQL-shaping query arrays", () => {
    expect(
      RecordQuerySchema.safeParse({
        sort: Array.from({ length: MAX_QUERY_SORTS + 1 }, () => ({ fieldId, direction: "asc" })),
      }).success,
    ).toBe(false);
    expect(
      RecordQuerySchema.safeParse({
        aggregations: Array.from({ length: MAX_QUERY_AGGREGATIONS + 1 }, () => ({ fieldId: "*", agg: "count" })),
      }).success,
    ).toBe(false);
    expect(
      RecordQuerySchema.safeParse({
        columns: Array.from({ length: MAX_QUERY_COLUMNS + 1 }, () => ({ fieldId })),
      }).success,
    ).toBe(false);
  });
});
