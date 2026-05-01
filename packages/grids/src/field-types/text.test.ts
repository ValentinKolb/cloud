import { test, expect } from "bun:test";
import { textHandler, longtextHandler } from "./text";

test("text: trims and rejects empty as null", () => {
  expect(textHandler.validate("  hello  ", {}, false)).toEqual({ ok: true, value: "hello" });
  expect(textHandler.validate("   ", {}, false)).toEqual({ ok: true, value: null });
});

test("text: required rejects null/empty/whitespace-only", () => {
  expect(textHandler.validate(null, {}, true).ok).toBe(false);
  expect(textHandler.validate("", {}, true).ok).toBe(false);
  expect(textHandler.validate("   ", {}, true).ok).toBe(false);
});

test("text: enforces minLength/maxLength", () => {
  expect(textHandler.validate("hi", { minLength: 3 }, false).ok).toBe(false);
  expect(textHandler.validate("hello there", { maxLength: 5 }, false).ok).toBe(false);
  expect(textHandler.validate("hi", { minLength: 1, maxLength: 10 }, false)).toEqual({ ok: true, value: "hi" });
});

test("text: regex matching", () => {
  const cfg = { regex: "^[A-Z]{3}$" };
  expect(textHandler.validate("ABC", cfg, false)).toEqual({ ok: true, value: "ABC" });
  expect(textHandler.validate("abc", cfg, false).ok).toBe(false);
});

test("text: rejects invalid regex in field config", () => {
  expect(textHandler.validate("anything", { regex: "(unclosed" }, false).ok).toBe(false);
});

test("text: rejects non-string input", () => {
  expect(textHandler.validate(42, {}, false).ok).toBe(false);
  expect(textHandler.validate({ a: 1 }, {}, false).ok).toBe(false);
});

test("longtext: preserves leading/trailing whitespace", () => {
  expect(longtextHandler.validate("  hello\nworld  ", {}, false)).toEqual({
    ok: true,
    value: "  hello\nworld  ",
  });
});

test("longtext: empty string still rejected as null when not required", () => {
  expect(longtextHandler.validate("", {}, false)).toEqual({ ok: true, value: null });
});
