import { test, expect, describe } from "bun:test";
import { parseJsonbRow } from "./jsonb";

// =============================================================================
// parseJsonbRow — defensive helper around bun.sql's inconsistent JSONB
// return shape. Sometimes objects/arrays come back parsed, sometimes they
// arrive as raw JSON strings, and scalars (e.g. a JSONB string column
// with value "hello") arrive already-coerced. The helper must round-trip
// all three variants without ever dropping data or throwing.
// =============================================================================

describe("parseJsonbRow", () => {
  test("null → fallback", () => {
    expect(parseJsonbRow<number>(null, 42)).toBe(42);
  });

  test("undefined → fallback", () => {
    expect(parseJsonbRow<string>(undefined, "x")).toBe("x");
  });

  test("already-parsed object passes through", () => {
    const obj = { a: 1, b: "two" };
    expect(parseJsonbRow<typeof obj>(obj, {} as typeof obj)).toBe(obj);
  });

  test("already-parsed array passes through", () => {
    const arr = [1, 2, 3];
    expect(parseJsonbRow<number[]>(arr, [])).toBe(arr);
  });

  test("JSON-encoded object string is parsed", () => {
    expect(parseJsonbRow<Record<string, unknown>>('{"a":1}', {})).toEqual({ a: 1 });
  });

  test("JSON-encoded array string is parsed", () => {
    expect(parseJsonbRow<number[]>("[1,2,3]", [])).toEqual([1, 2, 3]);
  });

  test('JSON-encoded string literal ("hello") is unwrapped', () => {
    // Starts with `"` → looks like JSON → JSON.parse('"hello"') = "hello".
    expect(parseJsonbRow<string>('"hello"', "")).toBe("hello");
  });

  test("JSON literals true / false / null are parsed", () => {
    expect(parseJsonbRow<boolean>("true", false)).toBe(true);
    expect(parseJsonbRow<boolean>("false", true)).toBe(false);
    // `null` parses to JS null, but the helper has its own null-check first;
    // a string "null" hits the JSON path.
    expect(parseJsonbRow<unknown>("null", "fallback")).toBeNull();
  });

  test("JSON-encoded number string parses to number", () => {
    expect(parseJsonbRow<number>("42", 0)).toBe(42);
    expect(parseJsonbRow<number>("-3.14", 0)).toBe(-3.14);
    // ".5" leads with a dot — looksLikeJson says yes, but JSON.parse
    // rejects (spec requires a digit before the dot). The helper's
    // try/catch catches that and returns the original string unchanged.
    expect(parseJsonbRow<unknown>(".5", null)).toBe(".5");
  });

  test("plain scalar string (already-parsed JSONB scalar) passes through", () => {
    // bun.sql sometimes hands back the raw string for a JSONB column whose
    // value is a string. The helper must NOT try to JSON.parse "hello"
    // (which would throw and lose the value).
    expect(parseJsonbRow<string>("hello", "")).toBe("hello");
  });

  test("looks-like-JSON but invalid → falls back to the original string", () => {
    // Starts with `{` → looksLikeJson true, but JSON.parse fails. The
    // helper returns the original (no throw, no data loss).
    expect(parseJsonbRow<string>("{not json", "fallback")).toBe("{not json");
  });

  test("empty string passes through (looksLikeJson is false on empty)", () => {
    expect(parseJsonbRow<string>("", "fb")).toBe("");
  });

  test("non-string non-object input passes through as-is", () => {
    // Defensive against a future bun.sql update returning numbers for
    // numeric JSONB; the helper should pass them straight through.
    expect(parseJsonbRow<number>(42 as unknown, 0)).toBe(42);
    expect(parseJsonbRow<boolean>(true as unknown, false)).toBe(true);
  });
});
