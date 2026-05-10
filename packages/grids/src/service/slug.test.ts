import { test, expect, describe } from "bun:test";
import { insertWithSlug, SLUG_REGEX } from "./slug";

// =============================================================================
// insertWithSlug — pure with an injected insert function, so we can
// drive every branch (immediate success, retry on slug-index unique
// violation, retry-budget exhaustion, non-slug error pass-through) by
// scripting the insert. No DB, no crypto stubs.
// =============================================================================

const slugUniqueViolation = (constraintName: string) => {
  const e = new Error("duplicate key value violates unique constraint") as Error & {
    code: string;
    constraint_name: string;
  };
  e.code = "23505";
  e.constraint_name = constraintName;
  return e;
};

describe("insertWithSlug", () => {
  test("returns the row from the first candidate when there's no collision", async () => {
    const seenSlugs: string[] = [];
    const row = await insertWithSlug(
      async (slug) => {
        seenSlugs.push(slug);
        return { slug };
      },
      "idx_grids_bases_slug",
    );
    expect(row.slug).toMatch(SLUG_REGEX);
    expect(seenSlugs).toHaveLength(1);
  });

  test("retries on slug-index unique violation and returns the first row that lands", async () => {
    let attempt = 0;
    const seenSlugs: string[] = [];
    const row = await insertWithSlug(
      async (slug) => {
        seenSlugs.push(slug);
        attempt++;
        if (attempt <= 2) throw slugUniqueViolation("idx_grids_bases_slug");
        return { slug, attempt };
      },
      "idx_grids_bases_slug",
    );
    expect(attempt).toBe(3);
    expect(seenSlugs).toHaveLength(3);
    // Each retry produces a fresh candidate (not memoised).
    expect(new Set(seenSlugs).size).toBe(3);
  });

  test("throws after the 10-attempt budget when every insert collides", async () => {
    let attempt = 0;
    const promise = insertWithSlug(
      async () => {
        attempt++;
        throw slugUniqueViolation("idx_grids_bases_slug");
      },
      "idx_grids_bases_slug",
    );
    await expect(promise).rejects.toThrow(/10 collisions/);
    expect(attempt).toBe(10);
  });

  test("rethrows non-slug unique violations immediately (e.g. PK collision)", async () => {
    let attempt = 0;
    const promise = insertWithSlug(
      async () => {
        attempt++;
        throw slugUniqueViolation("bases_pkey");
      },
      "idx_grids_bases_slug",
    );
    await expect(promise).rejects.toMatchObject({ code: "23505", constraint_name: "bases_pkey" });
    // No retry — it's not the slug index.
    expect(attempt).toBe(1);
  });

  test("rethrows non-23505 errors immediately (e.g. FK violation)", async () => {
    let attempt = 0;
    const promise = insertWithSlug(
      async () => {
        attempt++;
        const e = new Error("FK violation") as Error & { code: string };
        e.code = "23503";
        throw e;
      },
      "idx_grids_bases_slug",
    );
    await expect(promise).rejects.toMatchObject({ code: "23503" });
    expect(attempt).toBe(1);
  });
});
