import { test, expect } from "bun:test";
import { decimalHandler } from "./decimal";

const cfg2 = { precision: 10, scale: 2 };

test("decimal: canonicalizes to fixed scale", () => {
  expect(decimalHandler.validate("123.4", cfg2, false)).toEqual({ ok: true, value: "123.40" });
  expect(decimalHandler.validate("123", cfg2, false)).toEqual({ ok: true, value: "123.00" });
  expect(decimalHandler.validate(123.45, cfg2, false)).toEqual({ ok: true, value: "123.45" });
});

test("decimal: rejects too many decimal places", () => {
  expect(decimalHandler.validate("123.456", cfg2, false).ok).toBe(false);
});

test("decimal: rejects exceeding precision", () => {
  expect(decimalHandler.validate("12345678901.23", cfg2, false).ok).toBe(false);
});

test("decimal: enforces min/max as strings", () => {
  expect(decimalHandler.validate("5.00", { ...cfg2, min: "10" }, false).ok).toBe(false);
  expect(decimalHandler.validate("20.00", { ...cfg2, max: "10" }, false).ok).toBe(false);
  expect(decimalHandler.validate("10.00", { ...cfg2, min: "0", max: "100" }, false)).toEqual({
    ok: true,
    value: "10.00",
  });
});

test("decimal: required rejects null/empty", () => {
  expect(decimalHandler.validate(null, cfg2, true).ok).toBe(false);
  expect(decimalHandler.validate("", cfg2, true).ok).toBe(false);
});

test("decimal: rejects non-numeric strings", () => {
  expect(decimalHandler.validate("abc", cfg2, false).ok).toBe(false);
});

test("decimal: rejects scale > precision in config", () => {
  expect(decimalHandler.validate("1.0", { precision: 2, scale: 5 }, false).ok).toBe(false);
});

test("decimal: preserves precision (no float drift)", () => {
  // 0.1 + 0.2 in JS = 0.30000000000000004; decimal.js should preserve string input.
  expect(decimalHandler.validate("0.30", cfg2, false)).toEqual({ ok: true, value: "0.30" });
});
