import { test, expect } from "bun:test";
import { numberHandler } from "./number";

test("number: accepts numeric input and string-of-number", () => {
  expect(numberHandler.validate(42, {}, false)).toEqual({ ok: true, value: 42 });
  expect(numberHandler.validate("42", {}, false)).toEqual({ ok: true, value: 42 });
  expect(numberHandler.validate("3.14", {}, false)).toEqual({ ok: true, value: 3.14 });
});

test("number: empty/null collapse to null when not required", () => {
  expect(numberHandler.validate(null, {}, false)).toEqual({ ok: true, value: null });
  expect(numberHandler.validate("", {}, false)).toEqual({ ok: true, value: null });
});

test("number: required rejects null/empty", () => {
  expect(numberHandler.validate(null, {}, true).ok).toBe(false);
  expect(numberHandler.validate("", {}, true).ok).toBe(false);
});

test("number: rejects non-finite (Infinity, NaN)", () => {
  expect(numberHandler.validate(Number.POSITIVE_INFINITY, {}, false).ok).toBe(false);
  expect(numberHandler.validate(NaN, {}, false).ok).toBe(false);
  expect(numberHandler.validate("not-a-number", {}, false).ok).toBe(false);
});

test("number: enforces min/max", () => {
  expect(numberHandler.validate(5, { min: 10 }, false).ok).toBe(false);
  expect(numberHandler.validate(20, { max: 10 }, false).ok).toBe(false);
  expect(numberHandler.validate(5, { min: 0, max: 10 }, false)).toEqual({ ok: true, value: 5 });
});

test("number: integerOnly rejects floats", () => {
  expect(numberHandler.validate(3.14, { integerOnly: true }, false).ok).toBe(false);
  expect(numberHandler.validate(3, { integerOnly: true }, false)).toEqual({ ok: true, value: 3 });
});
