import { test, expect } from "bun:test";
import { parseFormula } from "./parser";
import { evaluate, renderResult } from "./evaluator";

const run = (src: string, fields: Record<string, unknown> = {}): unknown => {
  const r = parseFormula(src);
  if (!r.ok) throw new Error(r.error);
  return evaluate(r.ast, { fields });
};

// ── Math ────────────────────────────────────────────────────────
test("arithmetic: 1 + 2 * 3 = 7", () => {
  expect(run("1 + 2 * 3")).toBe(7);
});
test("subtract + unary minus", () => {
  expect(run("5 - -3")).toBe(8);
});
test("division by zero → DIV_ZERO error", () => {
  const v = run("1 / 0");
  expect(renderResult(v)).toBe("#DIV_ZERO");
});

// ── Null propagation ──────────────────────────────────────────────
test("any null operand → null in arithmetic", () => {
  expect(run("{a} + 1", { a: null })).toBeNull();
  expect(run("1 + {a}", { a: null })).toBeNull();
});
test("equality treats null = null as true", () => {
  expect(run("{a} = {b}", { a: null, b: null })).toBe(true);
  expect(run("{a} = 0", { a: null })).toBe(false);
});

// ── Comparison ────────────────────────────────────────────────────
test("number comparison", () => {
  expect(run("3 > 2")).toBe(true);
  expect(run("2 >= 2")).toBe(true);
});

// ── Logic ────────────────────────────────────────────────────────
test("logical AND short-circuits on falsy left", () => {
  expect(run("false && {x}", { x: 1 })).toBe(false);
});
test("logical OR short-circuits on truthy left", () => {
  expect(run("true || {x}", { x: 1 })).toBe(true);
});

// ── Functions: math ───────────────────────────────────────────────
test("ABS", () => {
  expect(run("ABS(-5)")).toBe(5);
});
test("ROUND with places", () => {
  expect(run("ROUND(3.14159, 2)")).toBe(3.14);
});
test("MIN / MAX", () => {
  expect(run("MIN(3, 1, 2)")).toBe(1);
  expect(run("MAX(3, 1, 2)")).toBe(3);
});

// ── Functions: text ──────────────────────────────────────────────
test("CONCAT", () => {
  expect(run('CONCAT("foo", " ", "bar")')).toBe("foo bar");
});
test("LEN / LOWER / UPPER / TRIM", () => {
  expect(run('LEN("hello")')).toBe(5);
  expect(run('LOWER("HELLO")')).toBe("hello");
  expect(run('UPPER("hello")')).toBe("HELLO");
  expect(run('TRIM("  spaced  ")')).toBe("spaced");
});

// ── Functions: logic ─────────────────────────────────────────────
test("IF returns then-branch when truthy", () => {
  expect(run('IF(true, "yes", "no")')).toBe("yes");
  expect(run('IF(false, "yes", "no")')).toBe("no");
});
test("ISBLANK", () => {
  expect(run("ISBLANK({x})", { x: null })).toBe(true);
  expect(run("ISBLANK({x})", { x: "" })).toBe(true);
  expect(run('ISBLANK({x})', { x: "set" })).toBe(false);
});

// ── Functions: date ──────────────────────────────────────────────
test("YEAR / MONTH / DAY", () => {
  expect(run('YEAR("2026-05-02")')).toBe(2026);
  expect(run('MONTH("2026-05-02")')).toBe(5);
  expect(run('DAY("2026-05-02")')).toBe(2);
});
test("DATEADD days", () => {
  expect(run('DATEADD("2026-05-02", 7, "days")')).toBe("2026-05-09");
});
test("DATEDIFF days", () => {
  expect(run('DATEDIFF("2026-05-02", "2026-05-09", "days")')).toBe(7);
});

// ── Field references ─────────────────────────────────────────────
test("price * quantity", () => {
  expect(run("{price} * {quantity}", { price: 9.99, quantity: 3 })).toBeCloseTo(29.97);
});

// ── Render ────────────────────────────────────────────────────────
test("renderResult passes literals through, errors as #CODE", () => {
  expect(renderResult(42)).toBe(42);
  expect(renderResult("hello")).toBe("hello");
  expect(renderResult(null)).toBeNull();
  expect(renderResult(run("1/0"))).toBe("#DIV_ZERO");
});
