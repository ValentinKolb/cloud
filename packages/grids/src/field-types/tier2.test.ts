import { test, expect } from "bun:test";
import {
  emailHandler,
  urlHandler,
  phoneHandler,
  currencyHandler,
  percentHandler,
  durationHandler,
  slugHandler,
} from "./tier2";

// ── email ─────────────────────────────────────────────────────────
test("email: accepts valid + lowercases", () => {
  expect(emailHandler.validate("Foo@Bar.com", {}, false)).toEqual({ ok: true, value: "foo@bar.com" });
});
test("email: rejects malformed", () => {
  for (const bad of ["foo", "foo@", "@bar.com", "foo bar@x.com", "foo@bar"]) {
    expect(emailHandler.validate(bad, {}, false).ok).toBe(false);
  }
});
test("email: required rejects empty", () => {
  expect(emailHandler.validate("", {}, true).ok).toBe(false);
});

// ── url ───────────────────────────────────────────────────────────
test("url: accepts http/https", () => {
  expect(urlHandler.validate("https://x.com/path?q=1", {}, false).ok).toBe(true);
  expect(urlHandler.validate("http://localhost", {}, false).ok).toBe(true);
});
test("url: rejects non-http schemes and garbage", () => {
  for (const bad of ["mailto:x@y.com", "file:///etc/passwd", "not a url", "ftp://x"]) {
    expect(urlHandler.validate(bad, {}, false).ok).toBe(false);
  }
});

// ── phone ─────────────────────────────────────────────────────────
test("phone: accepts international + lazy formats", () => {
  for (const ok of ["+49 (151) 555 12 34", "555-1234", "+1 408 555 1234"]) {
    expect(phoneHandler.validate(ok, {}, false).ok).toBe(true);
  }
});
test("phone: rejects too short / non-digits", () => {
  expect(phoneHandler.validate("123", {}, false).ok).toBe(false);
  expect(phoneHandler.validate("abcdefg", {}, false).ok).toBe(false);
});

// ── currency ──────────────────────────────────────────────────────
// Currency is now decimal-backed: the value is just a number string
// (like decimal), and the display symbol lives in field config. The
// handler accepts numbers, decimal strings, legacy `{amount, currency}`
// objects (drops the currency portion), and the old "12.34 EUR" combined
// string (drops the suffix). Output is always a Decimal-fixed string.
test("currency: number → decimal string at default scale", () => {
  expect(currencyHandler.validate(42, {}, false)).toEqual({
    ok: true,
    value: "42.00",
  });
});
test("currency: decimal string → fixed to scale", () => {
  expect(currencyHandler.validate("12.5", {}, false)).toEqual({
    ok: true,
    value: "12.50",
  });
});
test("currency: legacy {amount, currency} object keeps only the amount", () => {
  expect(
    currencyHandler.validate({ amount: "12.50", currency: "EUR" }, {}, false),
  ).toEqual({ ok: true, value: "12.50" });
});
test("currency: legacy '12.34 EUR' string drops the suffix", () => {
  expect(currencyHandler.validate("12.34 EUR", {}, false)).toEqual({
    ok: true,
    value: "12.34",
  });
});
test("currency: rejects non-decimal input", () => {
  expect(currencyHandler.validate("not a number", {}, false).ok).toBe(false);
});

// ── percent ───────────────────────────────────────────────────────
test("percent: 0..100 default range", () => {
  expect(percentHandler.validate(50, {}, false)).toEqual({ ok: true, value: 50 });
  expect(percentHandler.validate(101, {}, false).ok).toBe(false);
  expect(percentHandler.validate(-1, {}, false).ok).toBe(false);
});
test("percent: fraction range 0..1", () => {
  expect(percentHandler.validate(0.5, { range: "fraction" }, false)).toEqual({ ok: true, value: 0.5 });
  expect(percentHandler.validate(2, { range: "fraction" }, false).ok).toBe(false);
});

// ── duration ──────────────────────────────────────────────────────
test("duration: plain seconds", () => {
  expect(durationHandler.validate(3600, {}, false)).toEqual({ ok: true, value: 3600 });
  expect(durationHandler.validate("3600", {}, false)).toEqual({ ok: true, value: 3600 });
});
test("duration: HH:MM:SS", () => {
  expect(durationHandler.validate("1:30:00", {}, false)).toEqual({ ok: true, value: 5400 });
  expect(durationHandler.validate("0:45:30", {}, false)).toEqual({ ok: true, value: 2730 });
});
test("duration: MM:SS", () => {
  expect(durationHandler.validate("5:30", {}, false)).toEqual({ ok: true, value: 330 });
});
test("duration: rejects negatives", () => {
  expect(durationHandler.validate(-1, {}, false).ok).toBe(false);
});

// ── slug ──────────────────────────────────────────────────────────
test("slug: accepts lowercase-with-hyphens", () => {
  expect(slugHandler.validate("hello-world", {}, false)).toEqual({ ok: true, value: "hello-world" });
});
test("slug: rejects spaces / uppercase / specials", () => {
  for (const bad of ["Hello World", "hello!", "-leading", "trailing-", "-onlyhyphen-", "Üpper"]) {
    expect(slugHandler.validate(bad, {}, false).ok).toBe(false);
  }
});
test("slug: respects maxLength", () => {
  expect(slugHandler.validate("a".repeat(101), { maxLength: 100 }, false).ok).toBe(false);
});
