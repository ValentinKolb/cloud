import { test, expect, describe } from "bun:test";
import { compileFilter, type CompiledClause } from "./filter-compiler";
import type { Field } from "./types";

const mkField = (id: string, type: string): Field => ({
  id,
  slug: id,
  tableId: "t1",
  name: id,
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
});

const fields: Field[] = [
  mkField("fld_name", "text"),
  mkField("fld_amount", "decimal"),
  mkField("fld_date", "date"),
  mkField("fld_done", "boolean"),
  mkField("fld_status", "single-select"),
  mkField("fld_tags", "multi-select"),
];

describe("compileFilter — structural compilation", () => {
  test("null/undefined tree compiles to TRUE", () => {
    expect(compileFilter(null, fields)).toEqual({ ok: true, clause: { kind: "true" } });
    expect(compileFilter(undefined, fields)).toEqual({ ok: true, clause: { kind: "true" } });
  });

  test("empty AND group compiles to TRUE", () => {
    expect(compileFilter({ op: "AND", filters: [] }, fields)).toEqual({
      ok: true,
      clause: { kind: "true" },
    });
  });

  test("empty OR group compiles to FALSE (vacuously false)", () => {
    expect(compileFilter({ op: "OR", filters: [] }, fields)).toEqual({
      ok: true,
      clause: { kind: "false" },
    });
  });

  test("simple text equals compiles to predicate", () => {
    const r = compileFilter({ fieldId: "fld_name", op: "equals", value: "Alice" }, fields);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.clause).toEqual({
        kind: "predicate",
        fieldId: "fld_name",
        fieldType: "text",
        op: "equals",
        value: "Alice",
        caseInsensitive: undefined,
      });
    }
  });

  test("nested AND/OR group", () => {
    const tree = {
      op: "AND" as const,
      filters: [
        { fieldId: "fld_name", op: "contains", value: "Smith" },
        {
          op: "OR" as const,
          filters: [
            { fieldId: "fld_done", op: "=", value: true },
            { fieldId: "fld_amount", op: ">=", value: 100 },
          ],
        },
      ],
    };
    const r = compileFilter(tree, fields);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.clause.kind).toBe("and");
      const and = r.clause as Extract<CompiledClause, { kind: "and" }>;
      expect(and.parts).toHaveLength(2);
      expect(and.parts[0]?.kind).toBe("predicate");
      expect(and.parts[1]?.kind).toBe("or");
    }
  });

  test("rejects unknown field id", () => {
    const r = compileFilter({ fieldId: "fld_missing", op: "equals", value: "x" }, fields);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown field/);
  });

  test("rejects deleted field", () => {
    const deleted = { ...mkField("fld_dead", "text"), deletedAt: "2026-01-01T00:00:00Z" };
    const r = compileFilter(
      { fieldId: "fld_dead", op: "equals", value: "x" },
      [...fields, deleted],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deleted/);
  });

  test("rejects op not supported by field type", () => {
    // contains is text-only; reject on a number field.
    const r = compileFilter({ fieldId: "fld_amount", op: "contains", value: "x" }, fields);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not supported/);
  });

  test("isGroup checks filters-array shape, not just op", () => {
    // A leaf with op "AND" but no `filters` array must be treated as a leaf,
    // not silently misclassified as a malformed group.
    const r = compileFilter(
      { fieldId: "fld_name", op: "AND", value: "x" } as never,
      fields,
    );
    // It's a leaf (a real one would never have op "AND", so we get an op-check failure
    // — which is the correct path: validation, not a runtime crash).
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not supported/);
  });

  test("multi-select containsAll passes through", () => {
    const r = compileFilter({ fieldId: "fld_tags", op: "containsAll", value: ["a", "b"] }, fields);
    expect(r.ok).toBe(true);
    if (r.ok && r.clause.kind === "predicate") {
      expect(r.clause.value).toEqual(["a", "b"]);
    }
  });

  test("date today op needs no value", () => {
    const r = compileFilter({ fieldId: "fld_date", op: "today" }, fields);
    expect(r.ok).toBe(true);
  });

  test("single-select isAnyOf with array", () => {
    const r = compileFilter({ fieldId: "fld_status", op: "isAnyOf", value: ["open", "blocked"] }, fields);
    expect(r.ok).toBe(true);
    if (r.ok && r.clause.kind === "predicate") {
      expect(r.clause.value).toEqual(["open", "blocked"]);
    }
  });
});
