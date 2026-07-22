import { describe, expect, test } from "bun:test";
import { isUniqueViolation, toPgIntArray, toPgTextArray, toPgUuidArray } from "./postgres";

describe("Postgres array helpers", () => {
  test("serializes UUID arrays and treats non-arrays as empty arrays", () => {
    expect(toPgUuidArray(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"])).toBe(
      "{11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222}",
    );
    expect(toPgUuidArray([])).toBe("{}");
    expect(toPgUuidArray("{}" as unknown as string[])).toBe("{}");
  });

  test("serializes text arrays with escaping and treats non-arrays as empty arrays", () => {
    expect(toPgTextArray(["alpha", "has space", 'has "quote"', "has\\slash"])).toBe(
      '{"alpha","has space","has \\"quote\\"","has\\\\slash"}',
    );
    expect(toPgTextArray([])).toBe("{}");
    expect(toPgTextArray("{}" as unknown as string[])).toBe("{}");
  });

  test("serializes 32-bit integer arrays and rejects invalid values", () => {
    expect(toPgIntArray([0, 2, 2_147_483_647])).toBe("{0,2,2147483647}");
    expect(toPgIntArray([])).toBe("{}");
    expect(() => toPgIntArray([1.5])).toThrow("Postgres INT[] values must be 32-bit integers");
    expect(() => toPgIntArray([2_147_483_648])).toThrow("Postgres INT[] values must be 32-bit integers");
  });
});

describe("isUniqueViolation", () => {
  test("matches Bun SQL and postgres.js error shapes", () => {
    expect(isUniqueViolation({ errno: "23505", constraint: "live_name" }, "live_name")).toBe(true);
    expect(isUniqueViolation({ code: "23505", constraint_name: "live_name" }, "live_name")).toBe(true);
  });

  test("rejects different constraints and SQL states", () => {
    expect(isUniqueViolation({ errno: "23505", constraint: "other" }, "live_name")).toBe(false);
    expect(isUniqueViolation({ errno: "23503", constraint: "live_name" }, "live_name")).toBe(false);
  });
});
