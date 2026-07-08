import { describe, expect, test } from "bun:test";
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

  test('bare-literal strings ("42", "true", "null") pass through as strings', () => {
    // Chunk 3 review: previous behaviour parsed these as numbers/
    // booleans/null. That corrupts JSONB string scalars whose value
    // happens to be the text of a number/boolean. Document-shaped
    // call sites (record.data, *.config, audit.diff) never hold bare
    // literals at the top level, so the narrower "document only"
    // trigger is safe and removes the type-coercion footgun.
    expect(parseJsonbRow<string>("42", "")).toBe("42");
    expect(parseJsonbRow<string>("-3.14", "")).toBe("-3.14");
    expect(parseJsonbRow<string>("true", "")).toBe("true");
    expect(parseJsonbRow<string>("false", "")).toBe("false");
    expect(parseJsonbRow<string>("null", "")).toBe("null");
    expect(parseJsonbRow<string>(".5", "")).toBe(".5");
  });

  test("plain scalar string (already-parsed JSONB scalar) passes through", () => {
    // bun.sql sometimes hands back the raw string for a JSONB column whose
    // value is a string. The helper must NOT try to JSON.parse "hello"
    // (which would throw and lose the value).
    expect(parseJsonbRow<string>("hello", "")).toBe("hello");
  });

  test("looks-like-JSON-document but invalid → falls back", () => {
    // Starts with `{` → looksLikeJsonDocument true, but JSON.parse
    // fails. Document-shaped consumers expect an object/array; a
    // half-parsed string would be a worse surprise than the fallback.
    expect(parseJsonbRow<{ x: number }>("{not json", { x: 0 })).toEqual({ x: 0 });
  });

  test("empty string passes through", () => {
    expect(parseJsonbRow<string>("", "fb")).toBe("");
  });

  test("non-string non-object input passes through as-is", () => {
    // Defensive against a future bun.sql update returning numbers for
    // numeric JSONB; the helper should pass them straight through.
    expect(parseJsonbRow<number>(42 as unknown, 0)).toBe(42);
    expect(parseJsonbRow<boolean>(true as unknown, false)).toBe(true);
  });
});
