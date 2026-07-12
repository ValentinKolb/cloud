import { describe, expect, test } from "bun:test";
import { parseFormula } from "../formula/parser";
import { normalizedSql } from "../sql-test-utils";
import { compileGroupQuery, isAggregatable, isGroupable } from "./group-compiler";
import type { Field } from "./types";

const mkField = (id: string, type: string, name = id, extras: Partial<Field> = {}): Field => ({
  id,
  shortId: id,
  tableId: "00000000-0000-0000-0000-000000000000",
  name,
  description: null,
  type,
  config: {},
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...extras,
});

describe("isGroupable", () => {
  test("scalar text is groupable", () => {
    expect(isGroupable(mkField("x", "text"))).toBe(true);
  });
  test("relation is groupable (explode-mode)", () => {
    expect(isGroupable(mkField("x", "relation"))).toBe(true);
  });
  test("select is groupable with explode semantics", () => {
    expect(isGroupable(mkField("x", "select"))).toBe(true);
  });
  test("lookup / rollup deferred — not groupable yet", () => {
    expect(isGroupable(mkField("x", "lookup"))).toBe(false);
    expect(isGroupable(mkField("x", "rollup"))).toBe(false);
  });
  test("formula not groupable", () => {
    expect(isGroupable(mkField("x", "formula"))).toBe(false);
  });
  test("deleted field never groupable even if type would qualify", () => {
    expect(isGroupable(mkField("x", "text", "x", { deletedAt: "2026-01-01T00:00:00Z" }))).toBe(false);
  });
});

describe("isAggregatable", () => {
  const txt = mkField("x", "text");
  const num = mkField("x", "number");
  const dt = mkField("x", "date");
  test("count works on any field and on '*'", () => {
    expect(isAggregatable(txt, "count", false)).toBe(true);
    expect(isAggregatable(num, "count", false)).toBe(true);
    expect(isAggregatable(null, "count", true)).toBe(true);
  });
  test("sum/avg require numeric", () => {
    expect(isAggregatable(num, "sum", false)).toBe(true);
    expect(isAggregatable(txt, "sum", false)).toBe(false);
  });
  test("min/max accept numeric, date, text/longtext", () => {
    expect(isAggregatable(num, "min", false)).toBe(true);
    expect(isAggregatable(dt, "max", false)).toBe(true);
    expect(isAggregatable(txt, "max", false)).toBe(true);
  });
  test("'*' only with count", () => {
    expect(isAggregatable(null, "sum", true)).toBe(false);
  });
});

describe("compileGroupQuery — basic shape", () => {
  const tableId = "11111111-1111-1111-1111-111111111111";
  const author = mkField("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "text", "author");
  const amount = mkField("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "number", "amount");
  const fields = [author, amount];

  test("rejects empty groupBy", () => {
    const r = compileGroupQuery({
      tableId,
      groupBy: [],
      aggregations: [],
      fields,
    });
    expect(r.ok).toBe(false);
  });

  test("rejects more than 3 levels", () => {
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }, { fieldId: author.id }, { fieldId: author.id }, { fieldId: author.id }],
      aggregations: [],
      fields,
    });
    expect(r.ok).toBe(false);
  });

  test("rejects non-groupable field", () => {
    const formula = mkField("ffffffff-ffff-ffff-ffff-ffffffffffff", "formula");
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: formula.id }],
      aggregations: [],
      fields: [author, formula],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not groupable/);
  });

  test("compiles single-key + count + sum", () => {
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [
        { fieldId: "*", agg: "count" },
        { fieldId: amount.id, agg: "sum" },
      ],
      fields,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // count(*) is always emitted as the first aggregate; the explicit
      // request keeps it where the user put it instead of duplicating.
      expect(r.aggKeys).toContain("*__count");
      expect(r.aggKeys).toContain(`${amount.id}__sum`);
      expect(r.resolvedGroups).toHaveLength(1);
    }
  });

  test("compiles aggregate-sorted groups for Top-N views", () => {
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [
        { fieldId: "*", agg: "count" },
        { fieldId: amount.id, agg: "sum" },
      ],
      groupSort: [{ fieldId: amount.id, agg: "sum", direction: "desc" }],
      fields,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cursorable).toBe(false);
  });

  test("preserves explicit null ordering for group and aggregate sorts", () => {
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id, direction: "asc", nullsFirst: true }],
      aggregations: [{ fieldId: amount.id, agg: "sum" }],
      groupSort: [{ fieldId: amount.id, agg: "sum", direction: "desc", nullsFirst: true }],
      fields,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(normalizedSql(r.query)).toContain(`ORDER BY "${amount.id}__sum" DESC NULLS FIRST, 1 ASC NULLS FIRST`);
  });

  test("continues after a null cursor when group keys use nulls first", () => {
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: amount.id, direction: "asc", nullsFirst: true }],
      aggregations: [{ fieldId: "*", agg: "count" }],
      cursor: { keys: [null] },
      fields,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(normalizedSql(r.query)).toContain('WHERE ((TRUE AND "gk_0" IS NOT NULL))');
  });

  test("compiles having predicates over aggregate aliases", () => {
    const having = parseFormula("#revenue > 100 && #rows >= 2");
    expect(having.ok).toBe(true);
    if (!having.ok) return;

    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [
        { fieldId: "*", agg: "count" },
        { fieldId: amount.id, agg: "sum" },
      ],
      having: having.ast,
      havingRefs: [
        { ref: "rows", fieldId: "*", agg: "count" },
        { ref: "revenue", fieldId: amount.id, agg: "sum" },
      ],
      fields,
    });
    expect(r.ok).toBe(true);
  });

  test("compiles formula aggregate arguments and having over the formula alias", () => {
    const formula = parseFormula("{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb} * 1.19");
    const having = parseFormula("#gross > 100");
    expect(formula.ok).toBe(true);
    expect(having.ok).toBe(true);
    if (!formula.ok || !having.ok) return;

    const formulaAgg = {
      kind: "formula" as const,
      id: "gross",
      expression: formula.ast,
      agg: "sum" as const,
    };
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [formulaAgg],
      having: having.ast,
      havingRefs: [{ ...formulaAgg, ref: "gross" }],
      fields,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.aggKeys).toContain("gross__sum");
  });

  test("rejects incompatible formula aggregate arguments", () => {
    const formula = parseFormula("CONCAT({aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}, 'x')");
    expect(formula.ok).toBe(true);
    if (!formula.ok) return;

    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [
        {
          kind: "formula",
          id: "bad",
          expression: formula.ast,
          agg: "sum",
        },
      ],
      fields,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('not compatible with formula type "text"');
  });

  test("rejects unsafe formula aggregate ids before building SQL aliases", () => {
    const formula = parseFormula("{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb} * 1.19");
    expect(formula.ok).toBe(true);
    if (!formula.ok) return;

    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [
        {
          kind: "formula",
          id: 'bad"alias',
          expression: formula.ast,
          agg: "sum",
        },
      ],
      fields,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid formula aggregate id "bad"alias"');
  });

  test("rejects overlong formula aggregate ids before PostgreSQL can truncate aliases", () => {
    const formula = parseFormula("{bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb} * 1.19");
    expect(formula.ok).toBe(true);
    if (!formula.ok) return;

    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [
        {
          kind: "formula",
          id: "a".repeat(51),
          expression: formula.ast,
          agg: "countUnique",
        },
      ],
      fields,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(`invalid formula aggregate id "${"a".repeat(51)}"`);
  });

  test("rejects having predicates that reference missing aggregate aliases", () => {
    const having = parseFormula("#missing > 100");
    expect(having.ok).toBe(true);
    if (!having.ok) return;

    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [{ fieldId: amount.id, agg: "sum" }],
      having: having.ast,
      havingRefs: [{ ref: "revenue", fieldId: amount.id, agg: "sum" }],
      fields,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Unknown formula field reference "missing"');
  });

  test("rejects cursor pagination for aggregate-sorted groups", () => {
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [{ fieldId: "*", agg: "count" }],
      groupSort: [{ fieldId: "*", agg: "count", direction: "desc" }],
      cursor: { keys: ["Alice"] },
      fields,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cursor pagination/);
  });

  test("rejects offset together with cursor or tail-window grouped queries", () => {
    const withCursor = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [{ fieldId: "*", agg: "count" }],
      cursor: { keys: ["Alice"] },
      offset: 10,
      fields,
    });
    expect(withCursor.ok).toBe(false);
    if (!withCursor.ok) expect(withCursor.error).toBe("offset pagination is not supported together with grouped cursors");

    const fromEnd = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [{ fieldId: "*", agg: "count" }],
      fromEnd: true,
      offset: 10,
      fields,
    });
    expect(fromEnd.ok).toBe(false);
    if (!fromEnd.ok) expect(fromEnd.error).toBe("offset pagination is not supported for tail-window grouped queries");
  });

  test("compiles select explode grouping", () => {
    const tags = mkField("dddddddd-dddd-dddd-dddd-dddddddddddd", "select", "tags");
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: tags.id }],
      aggregations: [{ fieldId: "*", agg: "count" }],
      fields: [tags],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolvedGroups).toHaveLength(1);
      expect(r.cursorable).toBe(true);
    }
  });

  test("compiles multi-key (two scalars)", () => {
    const customer = mkField("cccccccc-cccc-cccc-cccc-cccccccccccc", "text", "customer");
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }, { fieldId: customer.id }],
      aggregations: [],
      fields: [author, customer],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.resolvedGroups).toHaveLength(2);
      // Default count(*) injected when caller passes empty aggregations.
      expect(r.aggKeys).toEqual(["*__count"]);
    }
  });

  test("rejects sum on non-numeric field", () => {
    const r = compileGroupQuery({
      tableId,
      groupBy: [{ fieldId: author.id }],
      aggregations: [{ fieldId: author.id, agg: "sum" }],
      fields,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not compatible/);
  });
});
