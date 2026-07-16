import { describe, expect, test } from "bun:test";
import type { DslQueryExecuteResponse } from "../contracts";
import { collectGqlResultPages } from "./views-gql-support";

const page = (values: number[], nextCursor: string | null, start = 0): Extract<DslQueryExecuteResponse, { ok: true }> => ({
  ok: true,
  mode: "rows",
  columns: [{ key: "value", label: "Value", type: "number", sqlType: "numeric" }],
  rows: values.map((value) => ({ values: { value } })),
  limit: values.length,
  truncated: nextCursor !== null,
  page: { size: values.length, start, returned: values.length, nextCursor },
});

describe("collectGqlResultPages", () => {
  test("collects pages in order and preserves the initial result offset", async () => {
    const requested: Array<[string | undefined, number]> = [];
    const result = await collectGqlResultPages(
      async (cursor, pageSize) => {
        requested.push([cursor, pageSize]);
        return cursor ? page([3, 4], null, 12) : page([1, 2], "next", 10);
      },
      { maxRows: 10, pageSize: 2 },
    );

    expect(requested).toEqual([
      [undefined, 2],
      ["next", 2],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.values.value)).toEqual([1, 2, 3, 4]);
    expect(result.page).toEqual({ size: 4, start: 10, returned: 4, nextCursor: null });
    expect(result.truncated).toBe(false);
  });

  test("stops at the client cap and returns the continuation cursor", async () => {
    const requestedPageSizes: number[] = [];
    const result = await collectGqlResultPages(
      async (cursor, pageSize) => {
        requestedPageSizes.push(pageSize);
        return cursor ? page([3], "third", 2) : page([1, 2], "second");
      },
      { maxRows: 3, pageSize: 2 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.values.value)).toEqual([1, 2, 3]);
    expect(result.page?.nextCursor).toBe("third");
    expect(result.truncated).toBe(true);
    expect(requestedPageSizes).toEqual([2, 1]);
  });

  test("returns diagnostics without requesting another page", async () => {
    const diagnostic = { ok: false as const, diagnostics: [{ message: "invalid query" }] };
    expect(await collectGqlResultPages(async () => diagnostic, { maxRows: 10, pageSize: 2 })).toEqual(diagnostic);
  });

  test("rejects a non-advancing cursor", async () => {
    await expect(collectGqlResultPages(async () => page([1], "same"), { cursor: "same", maxRows: 10, pageSize: 2 })).rejects.toThrow(
      "GQL pagination returned the same cursor twice.",
    );
  });

  test("rejects a server page that exceeds the requested safety bound", async () => {
    await expect(
      collectGqlResultPages(async () => page([1, 2], null), {
        maxRows: 1,
        pageSize: 100,
      }),
    ).rejects.toThrow("GQL pagination returned more rows than requested.");
  });

  test("rejects a continuation cursor without row progress", async () => {
    await expect(
      collectGqlResultPages(async () => page([], "next"), {
        maxRows: 10,
        pageSize: 100,
      }),
    ).rejects.toThrow("GQL pagination returned a continuation cursor without rows.");
  });
});
