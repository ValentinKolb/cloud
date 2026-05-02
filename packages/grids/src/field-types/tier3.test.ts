import { test, expect } from "bun:test";
import {
  barcodeHandler,
  isbnHandler,
  locationHandler,
  colorHandler,
  richTextHandler,
  jsonHandler,
  signatureHandler,
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

// ── location ──────────────────────────────────────────────────────
test("location: valid lat/lng", () => {
  expect(locationHandler.validate({ lat: 48.4, lng: 9.99, label: "Ulm" }, {}, false)).toEqual({
    ok: true,
    value: { lat: 48.4, lng: 9.99, label: "Ulm" },
  });
});
test("location: rejects out-of-range", () => {
  expect(locationHandler.validate({ lat: 91, lng: 0 }, {}, false).ok).toBe(false);
  expect(locationHandler.validate({ lat: 0, lng: 181 }, {}, false).ok).toBe(false);
});

// ── color ─────────────────────────────────────────────────────────
test("color: short hex expands to long", () => {
  expect(colorHandler.validate("#abc", {}, false)).toEqual({ ok: true, value: "#aabbcc" });
});
test("color: long hex passes", () => {
  expect(colorHandler.validate("#3B82F6", {}, false)).toEqual({ ok: true, value: "#3b82f6" });
});
test("color: rejects garbage", () => {
  for (const bad of ["red", "rgb(0,0,0)", "#1234", "#xyz123"]) {
    expect(colorHandler.validate(bad, {}, false).ok).toBe(false);
  }
});

// ── rich-text ─────────────────────────────────────────────────────
test("rich-text: passes markdown source through", () => {
  expect(richTextHandler.validate("# Hello\n\n**world**", {}, false)).toEqual({
    ok: true,
    value: "# Hello\n\n**world**",
  });
});
test("rich-text: respects maxLength", () => {
  expect(richTextHandler.validate("a".repeat(101), { maxLength: 100 }, false).ok).toBe(false);
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

// ── signature ─────────────────────────────────────────────────────
test("signature: accepts image data URL", () => {
  const dataUrl = "data:image/png;base64,iVBOR";
  expect(signatureHandler.validate(dataUrl, {}, false)).toEqual({ ok: true, value: dataUrl });
});
test("signature: rejects non-image scheme", () => {
  expect(signatureHandler.validate("not a data url", {}, false).ok).toBe(false);
  expect(signatureHandler.validate("data:text/plain;base64,...", {}, false).ok).toBe(false);
});
