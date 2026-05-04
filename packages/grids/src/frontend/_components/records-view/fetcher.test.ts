import { test, expect, describe } from "bun:test";
import { TableQueryError } from "./fetcher";

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
