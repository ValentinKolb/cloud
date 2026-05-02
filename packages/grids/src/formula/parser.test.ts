import { test, expect } from "bun:test";
import { parseFormula, collectFieldRefs } from "./parser";

test("parses literal", () => {
  const r = parseFormula("42");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ast).toEqual({ kind: "literal", value: 42 });
});

test("parses string literal", () => {
  const r = parseFormula('"hello"');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ast).toEqual({ kind: "literal", value: "hello" });
});

test("parses field reference", () => {
  const r = parseFormula("{fld_x}");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ast).toEqual({ kind: "field", fieldId: "fld_x" });
});

test("operator precedence: * binds tighter than +", () => {
  const r = parseFormula("1 + 2 * 3");
  expect(r.ok).toBe(true);
  if (r.ok && r.ast.kind === "binop") {
    expect(r.ast.op).toBe("+");
    expect(r.ast.right.kind).toBe("binop");
    if (r.ast.right.kind === "binop") expect(r.ast.right.op).toBe("*");
  }
});

test("parens override precedence", () => {
  const r = parseFormula("(1 + 2) * 3");
  expect(r.ok).toBe(true);
  if (r.ok && r.ast.kind === "binop") {
    expect(r.ast.op).toBe("*");
    expect(r.ast.left.kind).toBe("binop");
  }
});

test("parses function call", () => {
  const r = parseFormula('CONCAT("foo", " ", {fld_y})');
  expect(r.ok).toBe(true);
  if (r.ok && r.ast.kind === "call") {
    expect(r.ast.fn).toBe("CONCAT");
    expect(r.ast.args).toHaveLength(3);
  }
});

test("parses unary minus", () => {
  const r = parseFormula("-{fld_x}");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ast.kind).toBe("unop");
});

test("rejects unclosed paren", () => {
  expect(parseFormula("(1 + 2").ok).toBe(false);
});

test("rejects unclosed string", () => {
  expect(parseFormula('"hello').ok).toBe(false);
});

test("rejects unclosed field reference", () => {
  expect(parseFormula("{fld_x").ok).toBe(false);
});

test("rejects bare identifier", () => {
  expect(parseFormula("foo").ok).toBe(false);
});

test("rejects trailing tokens", () => {
  expect(parseFormula("1 + 2 3").ok).toBe(false);
});

test("collectFieldRefs walks nested expression", () => {
  const r = parseFormula("IF({fld_a} > 0, {fld_b} * 2, {fld_c})");
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect([...collectFieldRefs(r.ast)].sort()).toEqual(["fld_a", "fld_b", "fld_c"]);
  }
});
