import { describe, expect, test } from "bun:test";
import { cleanupPreparedUniqueIndex } from "./field-unique-index-lifecycle";

describe("prepared field unique-index cleanup", () => {
  test("surfaces cleanup failures as an explicit inconsistent state", async () => {
    const result = await cleanupPreparedUniqueIndex("019f0000-0000-7000-8000-000000000001", async () => {
      throw new Error("drop failed");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL");
      expect(result.error.message).toContain("database enforcement may not match field metadata");
    }
  });
});
