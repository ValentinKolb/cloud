import { test, expect } from "bun:test";
import { dateHandler } from "./date";

test("date: accepts YYYY-MM-DD as-is", () => {
  expect(dateHandler.validate("2026-05-02", {}, false)).toEqual({ ok: true, value: "2026-05-02" });
});

test("date: truncates ISO datetime to date when includeTime=false", () => {
  expect(dateHandler.validate("2026-05-02T10:00:00Z", {}, false)).toEqual({
    ok: true,
    value: "2026-05-02",
  });
});

test("date: keeps the supplied calendar date when includeTime=false", () => {
  expect(dateHandler.validate("2026-05-02T23:00:00-02:00", {}, false)).toEqual({
    ok: true,
    value: "2026-05-02",
  });
});

test("datetime: stores local wall time without timezone conversion", () => {
  const result = dateHandler.validate("2026-05-02T12:00", { includeTime: true }, false);
  expect(result).toEqual({ ok: true, value: "2026-05-02T12:00" });
});

test("datetime: rejects timezone offsets to avoid hidden shifts", () => {
  expect(dateHandler.validate("2026-05-02T12:00:00+02:00", { includeTime: true }, false).ok).toBe(false);
});

test("date: rejects garbage strings", () => {
  expect(dateHandler.validate("not a date", {}, false).ok).toBe(false);
  expect(dateHandler.validate("2026-13-99", {}, false).ok).toBe(false);
});

test("date: required rejects null/empty", () => {
  expect(dateHandler.validate(null, {}, true).ok).toBe(false);
  expect(dateHandler.validate("", {}, true).ok).toBe(false);
});

test("date: enforces min/max", () => {
  expect(dateHandler.validate("2025-01-01", { min: "2026-01-01" }, false).ok).toBe(false);
  expect(dateHandler.validate("2027-01-01", { max: "2026-12-31" }, false).ok).toBe(false);
  expect(dateHandler.validate("2026-06-15", { min: "2026-01-01", max: "2026-12-31" }, false)).toEqual({
    ok: true,
    value: "2026-06-15",
  });
});

test("date: rejects invalid min/max in field config (don't silently skip)", () => {
  expect(dateHandler.validate("2026-01-01", { min: "not a date" }, false).ok).toBe(false);
  expect(dateHandler.validate("2026-01-01", { max: "garbage" }, false).ok).toBe(false);
});
