import { test, expect, describe } from "bun:test";
import { insertWithShortId, SHORT_ID_REGEX } from "./short-id";

// =============================================================================
// insertWithShortId — pure with an injected insert function, so we can
// drive every branch (immediate success, retry on shortId-index unique
// violation, retry-budget exhaustion, non-shortId error pass-through) by
// scripting the insert. No DB, no crypto stubs.
// =============================================================================

const shortIdUniqueViolation = (constraintName: string) => {
  const e = new Error("duplicate key value violates unique constraint") as Error & {
    code: string;
    constraint_name: string;
  };
  e.code = "23505";
  e.constraint_name = constraintName;
  return e;
};

describe("insertWithShortId", () => {
  test("returns the row from the first candidate when there's no collision", async () => {
    const seenSlugs: string[] = [];
    const row = await insertWithShortId(
      async (shortId) => {
        seenSlugs.push(shortId);
        return { shortId };
      },
      "idx_grids_bases_shortId",
    );
    expect(row.shortId).toMatch(SHORT_ID_REGEX);
    expect(seenSlugs).toHaveLength(1);
  });

  test("retries on shortId-index unique violation and returns the first row that lands", async () => {
    let attempt = 0;
    const seenSlugs: string[] = [];
    const row = await insertWithShortId(
      async (shortId) => {
        seenSlugs.push(shortId);
        attempt++;
        if (attempt <= 2) throw shortIdUniqueViolation("idx_grids_bases_shortId");
        return { shortId, attempt };
      },
      "idx_grids_bases_shortId",
    );
    expect(attempt).toBe(3);
    expect(seenSlugs).toHaveLength(3);
    // Each retry produces a fresh candidate (not memoised).
    expect(new Set(seenSlugs).size).toBe(3);
  });

  test("throws after the 10-attempt budget when every insert collides", async () => {
    let attempt = 0;
    const promise = insertWithShortId(
      async () => {
        attempt++;
        throw shortIdUniqueViolation("idx_grids_bases_shortId");
      },
      "idx_grids_bases_shortId",
    );
    await expect(promise).rejects.toThrow(/10 collisions/);
    expect(attempt).toBe(10);
  });

  test("rethrows non-shortId unique violations immediately (e.g. PK collision)", async () => {
    let attempt = 0;
    const promise = insertWithShortId(
      async () => {
        attempt++;
        throw shortIdUniqueViolation("bases_pkey");
      },
      "idx_grids_bases_shortId",
    );
    await expect(promise).rejects.toMatchObject({ code: "23505", constraint_name: "bases_pkey" });
    // No retry — it's not the shortId index.
    expect(attempt).toBe(1);
  });

  test("rethrows non-23505 errors immediately (e.g. FK violation)", async () => {
    let attempt = 0;
    const promise = insertWithShortId(
      async () => {
        attempt++;
        const e = new Error("FK violation") as Error & { code: string };
        e.code = "23503";
        throw e;
      },
      "idx_grids_bases_shortId",
    );
    await expect(promise).rejects.toMatchObject({ code: "23503" });
    expect(attempt).toBe(1);
  });
});
