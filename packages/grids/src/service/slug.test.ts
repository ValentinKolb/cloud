import { test, expect, describe } from "bun:test";
import { generateUniqueSlug } from "./slug";

// =============================================================================
// generateUniqueSlug — pure with an injected check predicate, so we can
// drive every branch (immediate hit, retry, retry-budget exhaustion) by
// scripting the check function. No DB, no crypto stubs.
// =============================================================================

describe("generateUniqueSlug", () => {
  test("returns the first candidate when the scope is empty", async () => {
    const slug = await generateUniqueSlug(async () => false);
    // 5 chars, alphanumeric (matches readableId(5) charset).
    expect(slug).toMatch(/^[A-Za-z0-9]{5}$/);
  });

  test("retries on collision and returns the first non-colliding candidate", async () => {
    let calls = 0;
    const slug = await generateUniqueSlug(async () => {
      calls++;
      // First two attempts: collision; third: free.
      return calls <= 2;
    });
    expect(calls).toBe(3);
    expect(slug).toMatch(/^[A-Za-z0-9]{5}$/);
  });

  test("throws after the 10-attempt budget when scope is saturated", async () => {
    let calls = 0;
    const promise = generateUniqueSlug(async () => {
      calls++;
      return true; // every candidate "taken" — forces budget exhaustion
    });
    await expect(promise).rejects.toThrow(/10 attempts/);
    expect(calls).toBe(10);
  });

  test("each retry produces a new candidate (not memoised)", async () => {
    const seen = new Set<string>();
    let calls = 0;
    await generateUniqueSlug(async (slug) => {
      seen.add(slug);
      calls++;
      // Free on the 4th try so we get 4 distinct candidates recorded.
      return calls < 4;
    });
    // Collision probability for 4 random base62-ish 5-char strings is
    // microscopic (62^5 = 916M); we treat repeats as a regression.
    expect(seen.size).toBe(4);
  });
});
