import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { normalizedSql } from "../sql-test-utils";
import { compileDslKeyset } from "./keyset-compiler";

describe("compileDslKeyset", () => {
  test("compiles a typed lexicographic cursor with deterministic null ordering", () => {
    const compiled = compileDslKeyset(
      [
        { expression: sql`score`, type: "numeric", direction: "desc", nullsFirst: false },
        { expression: sql`id`, type: "uuid", direction: "asc" },
      ],
      ["12.5", "11111111-1111-4111-8111-111111111111"],
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(normalizedSql(compiled.orderBy)).toContain("score DESC NULLS LAST, id ASC NULLS LAST");
    const predicate = normalizedSql(compiled.where);
    expect(predicate).toContain("score <");
    expect(predicate).toContain("score IS NULL");
    expect(predicate).toContain("score IS NOT DISTINCT FROM");
    expect(compiled.valuesFromRow({ __gql_cursor_0: "9", __gql_cursor_1: "22222222-2222-4222-8222-222222222222" })).toEqual([
      "9",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  test("continues after a null only when nulls are first", () => {
    const first = compileDslKeyset([{ expression: sql`name`, type: "text", direction: "asc", nullsFirst: true }], [null]);
    expect(first.ok).toBe(true);
    if (first.ok) expect(normalizedSql(first.where)).toContain("name IS NOT NULL");

    const last = compileDslKeyset([{ expression: sql`name`, type: "text", direction: "asc", nullsFirst: false }], [null]);
    expect(last.ok).toBe(true);
    if (last.ok) expect(normalizedSql(last.where)).toContain("FALSE");
  });

  test("rejects malformed, incomplete, and non-orderable cursor values", () => {
    expect(compileDslKeyset([{ expression: sql`id`, type: "uuid", direction: "asc" }], ["not-a-uuid"])).toEqual({
      ok: false,
      error: "cursor values do not match this query ordering",
    });
    expect(compileDslKeyset([{ expression: sql`id`, type: "uuid", direction: "asc" }], [])).toEqual({
      ok: false,
      error: "cursor values do not match this query ordering",
    });
    expect(compileDslKeyset([{ expression: sql`payload`, type: "unknown", direction: "asc" }], null)).toEqual({
      ok: false,
      error: "query sort contains a value that cannot be cursor-paginated",
    });
  });
});
