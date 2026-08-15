import { describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { insertWithShortId, insertWithShortIdForDb, SHORT_ID_LENGTH, SHORT_ID_REGEX } from "./short-id";

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
    const row = await insertWithShortId(async (shortId) => {
      seenSlugs.push(shortId);
      return { shortId };
    }, "idx_grids_bases_short_id");
    expect(row.shortId).toMatch(SHORT_ID_REGEX);
    expect(row.shortId).toHaveLength(SHORT_ID_LENGTH);
    expect(seenSlugs).toHaveLength(1);
  });

  test("retries on shortId-index unique violation and returns the first row that lands", async () => {
    let attempt = 0;
    const seenSlugs: string[] = [];
    const row = await insertWithShortId(async (shortId) => {
      seenSlugs.push(shortId);
      attempt++;
      if (attempt <= 2) throw shortIdUniqueViolation("idx_grids_bases_short_id");
      return { shortId, attempt };
    }, "idx_grids_bases_short_id");
    expect(attempt).toBe(3);
    expect(row.attempt).toBe(3);
    expect(seenSlugs).toHaveLength(3);
    // Each retry produces a fresh candidate (not memoised).
    expect(new Set(seenSlugs).size).toBe(3);
  });

  test("throws after the 10-attempt budget when every insert collides", async () => {
    let attempt = 0;
    const promise = insertWithShortId(async () => {
      attempt++;
      throw shortIdUniqueViolation("idx_grids_bases_short_id");
    }, "idx_grids_bases_short_id");
    await expect(promise).rejects.toThrow(/10 collisions/);
    expect(attempt).toBe(10);
  });

  test("rethrows non-shortId unique violations immediately (e.g. PK collision)", async () => {
    let attempt = 0;
    const promise = insertWithShortId(async () => {
      attempt++;
      throw shortIdUniqueViolation("bases_pkey");
    }, "idx_grids_bases_short_id");
    await expect(promise).rejects.toMatchObject({ code: "23505", constraint_name: "bases_pkey" });
    // No retry — it's not the shortId index.
    expect(attempt).toBe(1);
  });

  test("rethrows non-23505 errors immediately (e.g. FK violation)", async () => {
    let attempt = 0;
    const promise = insertWithShortId(async () => {
      attempt++;
      const e = new Error("FK violation") as Error & { code: string };
      e.code = "23503";
      throw e;
    }, "idx_grids_bases_short_id");
    await expect(promise).rejects.toMatchObject({ code: "23503" });
    expect(attempt).toBe(1);
  });

  test("isolates each retry in a savepoint when called inside a transaction", async () => {
    let attempts = 0;
    let savepoints = 0;
    const transaction = {
      savepoint: async <T>(write: (attempt: SQL) => Promise<T>): Promise<T> => {
        savepoints++;
        return write({} as SQL);
      },
    } as SQL & { savepoint: <T>(write: (attempt: SQL) => Promise<T>) => Promise<T> };

    const row = await insertWithShortIdForDb(transaction, "idx_grids_records_short_id", async (_db, shortId) => {
      attempts++;
      if (attempts === 1) throw shortIdUniqueViolation("idx_grids_records_short_id");
      return { shortId };
    });

    expect(row.shortId).toMatch(SHORT_ID_REGEX);
    expect(attempts).toBe(2);
    expect(savepoints).toBe(2);
  });
});
