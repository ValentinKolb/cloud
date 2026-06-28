import { describe, expect, test } from "bun:test";
import { toPgTextArray, toPgUuidArray } from "./postgres";

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
});
