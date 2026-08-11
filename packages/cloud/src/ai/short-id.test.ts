import { describe, expect, test } from "bun:test";
import { AI_SHORT_ID_PATTERN, createAiShortId } from "./short-id";

describe("AI short IDs", () => {
  test("creates compact readable identifiers", () => {
    const ids = Array.from({ length: 100 }, createAiShortId);

    expect(ids.every((id) => AI_SHORT_ID_PATTERN.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.join("")).not.toMatch(/[01IOlo]/);
  });
});
