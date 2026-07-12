import { expect, test } from "bun:test";
import { AGGREGATE_KINDS } from "./aggregate-catalog";
import { RecordQuerySchema } from "./contracts";
import { AGGREGATE_FUNCTIONS } from "./query-dsl/intelligence-grammar";
import { parseGridsQueryDsl } from "./query-dsl/parser";

test("aggregate capabilities stay aligned across contracts, GQL, and intelligence", () => {
  expect(AGGREGATE_FUNCTIONS).toEqual(AGGREGATE_KINDS);

  for (const agg of AGGREGATE_KINDS) {
    expect(
      RecordQuerySchema.safeParse({
        aggregations: [{ fieldId: "00000000-0000-4000-8000-000000000001", agg }],
        groupSort: [{ fieldId: "00000000-0000-4000-8000-000000000001", agg }],
      }).success,
      agg,
    ).toBe(true);
    expect(parseGridsQueryDsl(`aggregate ${agg}(Amount) as result`).ok, agg).toBe(true);
  }

  expect(
    RecordQuerySchema.safeParse({
      aggregations: [{ fieldId: "00000000-0000-4000-8000-000000000001", agg: "unknown" }],
    }).success,
  ).toBe(false);
  expect(parseGridsQueryDsl("aggregate unknown(Amount) as result").ok).toBe(false);
});
