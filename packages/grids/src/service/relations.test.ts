import { describe, expect, test } from "bun:test";
import { enrichRecordsWithFormulas, relationLabelFields } from "./relations";
import type { Field, GridRecord } from "./types";

// =============================================================================
// enrichRecordsWithFormulas — pure in-memory function. Tests the dependency
// ordering, cycle detection, shortId resolution, and currency-precision
// integration that powers every records read.
// =============================================================================

const mkField = (overrides: Partial<Field> & Pick<Field, "id" | "type">): Field => ({
  shortId: overrides.id.slice(0, 5),
  tableId: "00000000-0000-0000-0000-000000000000",
  name: overrides.id,
  description: null,
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
  ...overrides,
});

const mkFormula = (id: string, shortId: string, expression: string): Field =>
  mkField({
    id,
    shortId,
    type: "formula",
    config: { expression },
  });

const mkRecord = (id: string, data: Record<string, unknown>): GridRecord => ({
  id,
  tableId: "00000000-0000-0000-0000-000000000000",
  data,
  version: 1,
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("relationLabelFields", () => {
  test("uses presentable fields in position order", () => {
    const a = mkField({ id: "a", type: "text", position: 2, presentable: true });
    const b = mkField({ id: "b", type: "text", position: 1, presentable: true });
    const fallback = mkField({ id: "fallback", type: "text", position: 0 });
    expect(relationLabelFields([a, b, fallback]).map((f) => f.id)).toEqual(["b", "a"]);
  });

  test("falls back to the first single-line text field", () => {
    const n = mkField({ id: "n", type: "number", position: 0 });
    const title = mkField({ id: "title", type: "text", position: 1 });
    const notes = mkField({ id: "notes", type: "longtext", position: 2 });
    expect(relationLabelFields([notes, n, title]).map((f) => f.id)).toEqual(["title"]);
  });

  test("does not use longtext as implicit label fallback", () => {
    const notes = mkField({ id: "notes", type: "longtext", position: 0 });
    expect(relationLabelFields([notes])).toEqual([]);
  });
});

describe("enrichRecordsWithFormulas — basic evaluation", () => {
  test("computes a single formula referencing a #shortId", () => {
    const price = mkField({ id: "fld-price", shortId: "PRICE", type: "decimal" });
    const total = mkFormula("fld-total", "TOTAL", "#PRICE * 1.19");
    const rec = mkRecord("rec-1", {
      "fld-price": "24.50",
    });
    enrichRecordsWithFormulas([rec], [price, total]);
    // Decimal arithmetic preserves precision via decimal.js.
    expect(rec.data["fld-total"]).toBe("29.155");
  });

  test("no formula fields → records pass through unchanged", () => {
    const rec = mkRecord("rec-1", { x: 1 });
    const recs = [rec];
    const out = enrichRecordsWithFormulas(recs, []);
    expect(out).toBe(recs); // identity (early return)
    expect(rec.data).toEqual({ x: 1 });
  });

  test("formula with bad expression renders nothing (silent skip)", () => {
    const broken = mkFormula("fld-broken", "BROKE", "1 + ");
    const rec = mkRecord("rec-1", {});
    enrichRecordsWithFormulas([rec], [broken]);
    // Bad parse → orderFormulasByDeps drops the field; nothing written.
    expect(rec.data["fld-broken"]).toBeUndefined();
  });

  test("formula with empty expression skipped silently", () => {
    const empty = mkFormula("fld-empty", "EMPTY", "");
    const rec = mkRecord("rec-1", {});
    enrichRecordsWithFormulas([rec], [empty]);
    expect(rec.data["fld-empty"]).toBeUndefined();
  });

  test("deleted formula fields are ignored", () => {
    const f = { ...mkFormula("fld-1", "F1", "1 + 1"), deletedAt: "2026-01-02T00:00:00Z" };
    const rec = mkRecord("rec-1", {});
    enrichRecordsWithFormulas([rec], [f]);
    expect(rec.data["fld-1"]).toBeUndefined();
  });
});

describe("enrichRecordsWithFormulas — dependency ordering", () => {
  test("formula referencing another formula evaluates after it", () => {
    // base = 10, doubled = base * 2, plusOne = doubled + 1
    // Declaration order is intentionally reversed from dep order so the
    // test fails if the topo sort regresses.
    const base = mkField({ id: "fld-base", shortId: "BASE", type: "number" });
    const plusOne = mkFormula("fld-plus", "PLUS", "#DBLED + 1");
    const doubled = mkFormula("fld-dbl", "DBLED", "#BASE * 2");
    const rec = mkRecord("rec-1", { "fld-base": 10 });
    enrichRecordsWithFormulas([rec], [base, plusOne, doubled]);
    expect(rec.data["fld-dbl"]).toBe(20);
    expect(rec.data["fld-plus"]).toBe(21);
  });

  test("chain of three formulas evaluates in correct order", () => {
    // a = 1, b = a + 1, c = b + 1, d = c + 1 — produces 2, 3, 4.
    // Slugs are alphanumeric only (matches readableId(5) charset); the
    // tokenizer stops at any non-alnum char, so we can't use underscore-
    // padded names here.
    const a = mkField({ id: "fld-a", shortId: "alpha", type: "number" });
    const b = mkFormula("fld-b", "bravo", "#alpha + 1");
    const c = mkFormula("fld-c", "charl", "#bravo + 1");
    const d = mkFormula("fld-d", "delta", "#charl + 1");
    const rec = mkRecord("rec-1", { "fld-a": 1 });
    // Shuffle declaration: d first, then b, then c. Topo sort must still
    // pick the right order.
    enrichRecordsWithFormulas([rec], [a, d, b, c]);
    expect(rec.data["fld-b"]).toBe(2);
    expect(rec.data["fld-c"]).toBe(3);
    expect(rec.data["fld-d"]).toBe(4);
  });
});

describe("enrichRecordsWithFormulas — cycle detection", () => {
  test("self-reference renders #CYCLE", () => {
    const self = mkFormula("fld-self", "selfx", "#selfx + 1");
    const rec = mkRecord("rec-1", {});
    enrichRecordsWithFormulas([rec], [self]);
    expect(rec.data["fld-self"]).toBe("#CYCLE");
  });

  test("two-node cycle marks BOTH members with #CYCLE", () => {
    // a → b → a
    const a = mkFormula("fld-a", "AAAAA", "#BBBBB + 1");
    const b = mkFormula("fld-b", "BBBBB", "#AAAAA + 1");
    const rec = mkRecord("rec-1", {});
    enrichRecordsWithFormulas([rec], [a, b]);
    expect(rec.data["fld-a"]).toBe("#CYCLE");
    expect(rec.data["fld-b"]).toBe("#CYCLE");
  });

  test("three-node cycle marks all three", () => {
    // a → b → c → a
    const a = mkFormula("fld-a", "AAAAA", "#BBBBB");
    const b = mkFormula("fld-b", "BBBBB", "#CCCCC");
    const c = mkFormula("fld-c", "CCCCC", "#AAAAA");
    const rec = mkRecord("rec-1", {});
    enrichRecordsWithFormulas([rec], [a, b, c]);
    expect(rec.data["fld-a"]).toBe("#CYCLE");
    expect(rec.data["fld-b"]).toBe("#CYCLE");
    expect(rec.data["fld-c"]).toBe("#CYCLE");
  });

  test("non-cycle formula adjacent to a cycle still evaluates", () => {
    // a ↔ b cycle; clean = 2 + 2 (independent).
    const a = mkFormula("fld-a", "AAAAA", "#BBBBB");
    const b = mkFormula("fld-b", "BBBBB", "#AAAAA");
    const clean = mkFormula("fld-c", "CLEAN", "2 + 2");
    const rec = mkRecord("rec-1", {});
    enrichRecordsWithFormulas([rec], [a, b, clean]);
    expect(rec.data["fld-a"]).toBe("#CYCLE");
    expect(rec.data["fld-b"]).toBe("#CYCLE");
    expect(rec.data["fld-c"]).toBe(4);
  });
});

describe("enrichRecordsWithFormulas — shortId map", () => {
  test("shortId map is built across all alive non-formula fields, not just formulas", () => {
    // The formula references a non-formula field by shortId. If the shortId map
    // skipped non-formulas, this would fail to resolve and return null.
    const price = mkField({ id: "fld-price", shortId: "Pr1cE", type: "decimal" });
    const total = mkFormula("fld-total", "TOTAL", "#Pr1cE * 2");
    const rec = mkRecord("rec-1", { "fld-price": "5" });
    enrichRecordsWithFormulas([rec], [price, total]);
    expect(rec.data["fld-total"]).toBe("10");
  });

  test("deleted fields are excluded from the shortId map", () => {
    const live = mkField({ id: "fld-live", shortId: "alive", type: "number" });
    const dead = {
      ...mkField({ id: "fld-dead", shortId: "deadx", type: "number" }),
      deletedAt: "2026-01-02T00:00:00Z",
    };
    // Formula references the deleted field's shortId — should resolve to null
    // (shortId not in the map), not to the deleted field's record value.
    const f = mkFormula("fld-f", "FFFFF", "#deadx + 1");
    const rec = mkRecord("rec-1", { "fld-live": 10, "fld-dead": 99 });
    enrichRecordsWithFormulas([rec], [live, dead, f]);
    expect(rec.data["fld-f"]).toBeNull();
  });

  test("legacy {uuid} syntax still resolves alongside #shortId refs", () => {
    const a = mkField({ id: "fld-a", shortId: "AAAAA", type: "number" });
    const b = mkField({ id: "fld-b", shortId: "BBBBB", type: "number" });
    const f = mkFormula("fld-f", "FFFFF", "{fld-a} + #BBBBB");
    const rec = mkRecord("rec-1", { "fld-a": 3, "fld-b": 7 });
    enrichRecordsWithFormulas([rec], [a, b, f]);
    expect(rec.data["fld-f"]).toBe(10);
  });
});

describe("enrichRecordsWithFormulas — multiple records", () => {
  test("evaluates per-record without leaking state between rows", () => {
    const x = mkField({ id: "fld-x", shortId: "XXXXX", type: "number" });
    const f = mkFormula("fld-f", "FFFFF", "#XXXXX * 2");
    const r1 = mkRecord("r-1", { "fld-x": 1 });
    const r2 = mkRecord("r-2", { "fld-x": 5 });
    const r3 = mkRecord("r-3", { "fld-x": null });
    enrichRecordsWithFormulas([r1, r2, r3], [x, f]);
    expect(r1.data["fld-f"]).toBe(2);
    expect(r2.data["fld-f"]).toBe(10);
    expect(r3.data["fld-f"]).toBeNull();
  });
});
