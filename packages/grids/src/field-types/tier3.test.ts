import { test, expect } from "bun:test";
import {
  barcodeHandler,
  isbnHandler,
  jsonHandler,
} from "./tier3";

// ── barcode ───────────────────────────────────────────────────────
test("barcode: any-format accepts arbitrary string", () => {
  expect(barcodeHandler.validate("anything", {}, false).ok).toBe(true);
});
test("barcode: ean13 enforces 13 digits", () => {
  expect(barcodeHandler.validate("4006381333931", { format: "ean13" }, false).ok).toBe(true);
  expect(barcodeHandler.validate("123", { format: "ean13" }, false).ok).toBe(false);
});

// ── isbn ──────────────────────────────────────────────────────────
test("isbn-13 valid + dashes stripped", () => {
  // Real ISBN-13: 978-3-16-148410-0
  expect(isbnHandler.validate("978-3-16-148410-0", {}, false)).toEqual({
    ok: true,
    value: "9783161484100",
  });
});
test("isbn-10 with X check digit", () => {
  // Real ISBN-10: 0-306-40615-2
  expect(isbnHandler.validate("0306406152", {}, false).ok).toBe(true);
});
test("isbn rejects bad checksum", () => {
  expect(isbnHandler.validate("9783161484101", {}, false).ok).toBe(false);
});
test("isbn rejects wrong length", () => {
  expect(isbnHandler.validate("12345", {}, false).ok).toBe(false);
});

// ── json ──────────────────────────────────────────────────────────
test("json: parses valid JSON string", () => {
  expect(jsonHandler.validate('{"a":1}', {}, false)).toEqual({ ok: true, value: { a: 1 } });
});
test("json: passes already-parsed object", () => {
  expect(jsonHandler.validate({ x: [1, 2] }, {}, false)).toEqual({ ok: true, value: { x: [1, 2] } });
});
test("json: rejects malformed string", () => {
  expect(jsonHandler.validate("{not json", {}, false).ok).toBe(false);
});
