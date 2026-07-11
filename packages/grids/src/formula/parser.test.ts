import { expect, test } from "bun:test";
import { collectFieldRefs, parseFormula } from "./parser";

test("parses literal", () => {
  const r = parseFormula("42");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ast).toEqual({ kind: "literal", value: 42 });
});

test("parses string literal", () => {
  const r = parseFormula("'hello'");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ast).toEqual({ kind: "literal", value: "hello" });
});

test("parses quoted field name references", () => {
  const r = parseFormula('"Unit price" * Quantity');
  expect(r.ok).toBe(true);
  if (r.ok && r.ast.kind === "binop") {
    expect(r.ast.left).toEqual({ kind: "field", fieldId: "Unit price" });
    expect(r.ast.right).toEqual({ kind: "field", fieldId: "Quantity" });
  }
});

test("parses field reference", () => {
  const r = parseFormula("{fld_x}");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ast).toEqual({ kind: "field", fieldId: "fld_x" });
});

test("scoped field references are opt-in for GQL expressions", () => {
  expect(parseFormula("customer.name").ok).toBe(false);

  const bare = parseFormula("customer.name", { scopedRefs: true });
  expect(bare.ok).toBe(true);
  if (bare.ok) expect(bare.ast).toEqual({ kind: "field", fieldId: "customer.name" });

  const quoted = parseFormula('customer."Full name"', { scopedRefs: true });
  expect(quoted.ok).toBe(true);
  if (quoted.ok) expect(quoted.ast).toEqual({ kind: "field", fieldId: 'customer."Full name"' });

  const braced = parseFormula("customer.{fld_x}", { scopedRefs: true });
  expect(braced.ok).toBe(true);
  if (braced.ok) expect(braced.ast).toEqual({ kind: "field", fieldId: "customer.{fld_x}" });
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
  const r = parseFormula("CONCAT('foo', ' ', {fld_y})");
  expect(r.ok).toBe(true);
  if (r.ok && r.ast.kind === "call") {
    expect(r.ast.fn).toBe("CONCAT");
    expect(r.ast.args).toHaveLength(3);
  }
});

test("accepts optional leading equals for spreadsheet-style authoring", () => {
  const r = parseFormula("=SUM(#price, 2)");
  expect(r.ok).toBe(true);
  if (r.ok && r.ast.kind === "call") {
    expect(r.ast.fn).toBe("SUM");
    expect(r.ast.args[0]).toEqual({ kind: "field", fieldId: "price" });
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

test("parses bare identifiers as field name references", () => {
  const r = parseFormula("foo");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ast).toEqual({ kind: "field", fieldId: "foo" });
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

// ── Legacy #slug field-reference syntax ──────────────────────────
//
// `#slug` remains supported for stored formula compatibility. The tokenizer scans
// alphanumerics and underscores until the first non-slug char, so the slug binding
// stops cleanly at operators, parens, commas, and whitespace — i.e.
// every legal next token after a field reference.

test("parses #slug field reference", () => {
  const r = parseFormula("#abc12");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.ast).toEqual({ kind: "field", fieldId: "abc12" });
});

test("#slug accepts underscores and stops at operators", () => {
  const r = parseFormula("#abc_12*2");
  expect(r.ok).toBe(true);
  if (r.ok && r.ast.kind === "binop") {
    expect(r.ast.left).toEqual({ kind: "field", fieldId: "abc_12" });
    expect(r.ast.right).toEqual({ kind: "literal", value: 2 });
  }
});

test("#slug does not absorb hyphens because they are subtraction operators", () => {
  const r = parseFormula("#a-#b");
  expect(r.ok).toBe(true);
  if (r.ok && r.ast.kind === "binop") {
    expect(r.ast.op).toBe("-");
    expect(r.ast.left).toEqual({ kind: "field", fieldId: "a" });
    expect(r.ast.right).toEqual({ kind: "field", fieldId: "b" });
  }
});

test("rejects bare # (no slug body)", () => {
  expect(parseFormula("#").ok).toBe(false);
  expect(parseFormula("# + 1").ok).toBe(false);
});

test("collectFieldRefs picks up #slug refs alongside {uuid}", () => {
  const r = parseFormula("IF(#price > 0, #price * 1.19, {fb1})");
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect([...collectFieldRefs(r.ast)].sort()).toEqual(["fb1", "price"]);
  }
});

test("rejects invalid braced field references", () => {
  expect(parseFormula("{ }").ok).toBe(false);
  expect(parseFormula("{field with spaces}").ok).toBe(false);
  expect(parseFormula(`{${"x".repeat(81)}}`).ok).toBe(false);
});

// ── Whitespace insensitivity ─────────────────────────────────────
//
// Regression guard for the `#x *1.19` vs `#x * 1.19` report — both
// must tokenise identically. We compare ASTs to lock down the
// tokeniser's whitespace-skipping behaviour around every operator
// position (after the slug, before & after the binary op).

test.each([
  "#x*1.19",
  "#x *1.19",
  "#x* 1.19",
  "#x * 1.19",
  "#x  *  1.19",
  "\t#x\n*\r1.19",
])("whitespace-variant '%s' produces the same AST", (src) => {
  const r = parseFormula(src);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.ast).toEqual({
      kind: "binop",
      op: "*",
      left: { kind: "field", fieldId: "x" },
      right: { kind: "literal", value: 1.19 },
    });
  }
});
