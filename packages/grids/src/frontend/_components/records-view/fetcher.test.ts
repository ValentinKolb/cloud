import { test, expect, describe } from "bun:test";
import { TableQueryBodySchema } from "../../../contracts";
import { buildTableQueryBody, TableQueryError } from "./fetcher";

// fetchTableQuery itself is thin glue over apiClient + fetch — it's
// exercised end-to-end by RecordsView in browser tests. Unit-testing
// it would require mocking the Hono RPC client, which buys little
// for ~15 LOC of code. We at least lock the exported error class
// so the contract with consumers stays stable.

describe("TableQueryError", () => {
  test("captures status + message", () => {
    const e = new TableQueryError(403, "forbidden");
    expect(e.status).toBe(403);
    expect(e.message).toBe("forbidden");
    expect(e.name).toBe("TableQueryError");
  });

  test("is an Error instance — try/catch and instanceof both work", () => {
    const e = new TableQueryError(500, "boom");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(TableQueryError);
  });
});

describe("TableQueryBodySchema", () => {
  test("accepts canonical GQL source without a RecordQuery body", () => {
    expect(
      TableQueryBodySchema.safeParse({
        source: "from table {11111111-1111-4111-8111-111111111111}",
      }).success,
    ).toBe(true);
  });

  test("requires either source or query", () => {
    expect(TableQueryBodySchema.safeParse({ cursor: "next" }).success).toBe(false);
  });
});

describe("buildTableQueryBody", () => {
  test("sends canonical GQL source for records reads", () => {
    const body = buildTableQueryBody({
      tableId: "11111111-1111-4111-8111-111111111111",
      viewId: "44444444-4444-4444-8444-444444444444",
      query: { sort: [{ fieldId: "22222222-2222-4222-8222-222222222222", direction: "asc" }] },
      cursor: "next",
      filePreviewFieldIds: ["33333333-3333-4333-8333-333333333333"],
    });

    expect(body).toMatchObject({
      source: "from table {11111111-1111-4111-8111-111111111111}\nsort {22222222-2222-4222-8222-222222222222} asc",
      viewId: "44444444-4444-4444-8444-444444444444",
      query: { sort: [{ fieldId: "22222222-2222-4222-8222-222222222222", direction: "asc" }] },
      cursor: "next",
      filePreviewFieldIds: ["33333333-3333-4333-8333-333333333333"],
    });
  });

  test("rejects table footer aggregations instead of falling back to RecordQuery", () => {
    expect(() =>
      buildTableQueryBody({
        tableId: "11111111-1111-4111-8111-111111111111",
        query: { aggregations: [{ fieldId: "*", agg: "count" }] },
        cursor: null,
      }),
    ).toThrow("table footer aggregations are not part of row GQL source");
  });
});
