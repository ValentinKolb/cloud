import { expect, test } from "bun:test";
import { selectHandler } from "./select";

const opts = {
  options: [
    { id: "open", label: "Open", description: "Ready to start" },
    { id: "done", label: "Done" },
    { id: "blocked", label: "Blocked" },
  ],
};

test("select: accepts one known option id in single mode", () => {
  expect(selectHandler.validate(["open"], opts, false)).toEqual({ ok: true, value: ["open"] });
});

test("select: rejects unknown option id", () => {
  expect(selectHandler.validate(["nope"], opts, false).ok).toBe(false);
});

test("select: required rejects null/empty", () => {
  expect(selectHandler.validate(null, opts, true).ok).toBe(false);
  expect(selectHandler.validate([], opts, true).ok).toBe(false);
});

test("select: rejects scalar input", () => {
  expect(selectHandler.validate("open", opts, false).ok).toBe(false);
});

test("select: single mode rejects more than one option", () => {
  expect(selectHandler.validate(["open", "done"], opts, false).ok).toBe(false);
});

test("select: multi mode accepts several known ids", () => {
  expect(selectHandler.validate(["open", "done"], { ...opts, multiple: true }, false)).toEqual({
    ok: true,
    value: ["open", "done"],
  });
});

test("select: deduplicates", () => {
  const result = selectHandler.validate(["open", "done", "open"], { ...opts, multiple: true }, false);
  expect(result.ok).toBe(true);
  expect(result.ok && result.value).toEqual(["open", "done"]);
});

test("select: enforces min/max selected", () => {
  const cfg = { ...opts, multiple: true, minSelected: 2 };
  expect(selectHandler.validate(["open"], cfg, false).ok).toBe(false);
  expect(selectHandler.validate(["open", "done"], cfg, false).ok).toBe(true);

  const cfg2 = { ...opts, multiple: true, maxSelected: 1 };
  expect(selectHandler.validate(["open", "done"], cfg2, false).ok).toBe(false);
});

test("select: empty array collapses to null when not required", () => {
  expect(selectHandler.validate([], opts, false)).toEqual({ ok: true, value: null });
});
