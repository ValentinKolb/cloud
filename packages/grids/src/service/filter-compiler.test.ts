import { describe, expect, test } from "bun:test";
import { type CompiledClause, compileFilter } from "./filter-compiler";
import type { Field } from "./types";

const mkField = (id: string, type: string, config: Record<string, unknown> = {}): Field => ({
  id,
  shortId: id,
  tableId: "t1",
  name: id,
  description: null,
  type,
  config,
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
  mkField("fld_amount", "number"),
  mkField("fld_date", "date"),
  mkField("fld_done", "boolean"),
  mkField("fld_status", "select"),
  mkField("fld_tags", "select", { multiple: true }),
  mkField("fld_author", "relation"),
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
    const r = compileFilter({ fieldId: "fld_dead", op: "equals", value: "x" }, [...fields, deleted]);
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
    const r = compileFilter({ fieldId: "fld_name", op: "AND", value: "x" } as never, fields);
    // It's a leaf (a real one would never have op "AND", so we get an op-check failure
    // — which is the correct path: validation, not a runtime crash).
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not supported/);
  });

  test("select isAnyOf passes through", () => {
    const r = compileFilter({ fieldId: "fld_tags", op: "isAnyOf", value: ["a", "b"] }, fields);
    expect(r.ok).toBe(true);
    if (r.ok && r.clause.kind === "predicate") {
      expect(r.clause.value).toEqual(["a", "b"]);
    }
  });

  test("date today op needs no value", () => {
    const r = compileFilter({ fieldId: "fld_date", op: "today" }, fields);
    expect(r.ok).toBe(true);
  });

  test("date-time filters require timezone-aware instants", () => {
    const timed = mkField("fld_time", "date", { includeTime: true });
    const ok = compileFilter({ fieldId: "fld_time", op: "=", value: "2026-05-02T12:00:00+02:00" }, [...fields, timed]);
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.clause.kind === "predicate") {
      expect(ok.clause.dateIncludeTime).toBe(true);
      expect(ok.clause.value).toBe("2026-05-02T12:00:00+02:00");
    }

    const local = compileFilter({ fieldId: "fld_time", op: "=", value: "2026-05-02T12:00" }, [...fields, timed]);
    expect(local.ok).toBe(false);
    if (!local.ok) expect(local.error).toMatch(/timezone-aware/);
  });

  test("date-only filters reject date-times and reversed ranges", () => {
    const shifted = compileFilter({ fieldId: "fld_date", op: "=", value: "2026-05-02T12:00:00+02:00" }, fields);
    expect(shifted.ok).toBe(false);
    if (!shifted.ok) expect(shifted.error).toMatch(/ISO date/);

    const reversedDate = compileFilter({ fieldId: "fld_date", op: "between", value: ["2026-05-03", "2026-05-02"] }, fields);
    expect(reversedDate.ok).toBe(false);
    if (!reversedDate.ok) expect(reversedDate.error).toMatch(/lower bound/);

    const reversedNumber = compileFilter({ fieldId: "fld_amount", op: "between", value: [5, 1] }, fields);
    expect(reversedNumber.ok).toBe(false);
    if (!reversedNumber.ok) expect(reversedNumber.error).toMatch(/lower bound/);
  });

  test("select isAnyOf with array", () => {
    const r = compileFilter({ fieldId: "fld_status", op: "isAnyOf", value: ["open", "blocked"] }, fields);
    expect(r.ok).toBe(true);
    if (r.ok && r.clause.kind === "predicate") {
      expect(r.clause.value).toEqual(["open", "blocked"]);
    }
  });

  test("relation containsAny passes through", () => {
    const ids = ["019a0000-0000-7000-8000-000000000001"];
    const r = compileFilter({ fieldId: "fld_author", op: "containsAny", value: ids }, fields);
    expect(r.ok).toBe(true);
    if (r.ok && r.clause.kind === "predicate") {
      expect(r.clause.fieldType).toBe("relation");
      expect(r.clause.value).toEqual(ids);
    }
  });

  test("relation containsAny rejects non-uuid values", () => {
    const r = compileFilter({ fieldId: "fld_author", op: "containsAny", value: ["nope"] }, fields);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/UUID/);
  });
});
