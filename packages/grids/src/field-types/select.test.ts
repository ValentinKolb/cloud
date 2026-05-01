import { test, expect } from "bun:test";
import { singleSelectHandler, multiSelectHandler } from "./select";

const opts = {
  options: [
    { id: "open", label: "Open" },
    { id: "done", label: "Done" },
    { id: "blocked", label: "Blocked" },
  ],
};

test("single-select: accepts known option id", () => {
  expect(singleSelectHandler.validate("open", opts, false)).toEqual({ ok: true, value: "open" });
});

test("single-select: rejects unknown option id", () => {
  expect(singleSelectHandler.validate("nope", opts, false).ok).toBe(false);
});

test("single-select: required rejects null/empty", () => {
  expect(singleSelectHandler.validate(null, opts, true).ok).toBe(false);
  expect(singleSelectHandler.validate("", opts, true).ok).toBe(false);
});

test("single-select: rejects array input", () => {
  expect(singleSelectHandler.validate(["open"], opts, false).ok).toBe(false);
});

test("multi-select: accepts array of known ids", () => {
  expect(multiSelectHandler.validate(["open", "done"], opts, false)).toEqual({
    ok: true,
    value: ["open", "done"],
  });
});

test("multi-select: deduplicates", () => {
  const result = multiSelectHandler.validate(["open", "done", "open"], opts, false);
  expect(result.ok).toBe(true);
  expect(result.ok && result.value).toEqual(["open", "done"]);
});

test("multi-select: rejects unknown id in array", () => {
  expect(multiSelectHandler.validate(["open", "nope"], opts, false).ok).toBe(false);
});

test("multi-select: enforces min/max selected", () => {
  const cfg = { ...opts, minSelected: 2 };
  expect(multiSelectHandler.validate(["open"], cfg, false).ok).toBe(false);
  expect(multiSelectHandler.validate(["open", "done"], cfg, false).ok).toBe(true);

  const cfg2 = { ...opts, maxSelected: 1 };
  expect(multiSelectHandler.validate(["open", "done"], cfg2, false).ok).toBe(false);
});

test("multi-select: empty array collapses to null when not required", () => {
  expect(multiSelectHandler.validate([], opts, false)).toEqual({ ok: true, value: null });
});

test("multi-select: required rejects empty array", () => {
  expect(multiSelectHandler.validate([], opts, true).ok).toBe(false);
});
