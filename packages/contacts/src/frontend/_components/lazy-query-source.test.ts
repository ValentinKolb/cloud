import { describe, expect, test } from "bun:test";
import { currentDebouncedSourceValue, currentSourceValue } from "./lazy-query-source";

describe("lazy Contacts query source guards", () => {
  test("exposes data only for the exact current source", () => {
    const result = { source: "book-a:query", value: ["contact-a"] };

    expect(currentSourceValue("book-a:query", result)).toEqual(["contact-a"]);
    expect(currentSourceValue("book-b:query", result)).toBeUndefined();
  });

  test("does not treat missing data as current", () => {
    expect(currentSourceValue("book-a", undefined)).toBeUndefined();
  });

  test("hides committed results while a different debounced draft is pending", () => {
    const result = { source: "book-a:old", value: ["old-contact"] };

    expect(currentDebouncedSourceValue("new", "old", "book-a:old", result)).toBeUndefined();
    expect(currentDebouncedSourceValue("old", "old", "book-a:old", result)).toEqual(["old-contact"]);
  });
});
