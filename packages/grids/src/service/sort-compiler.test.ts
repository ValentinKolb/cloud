import { test, expect, describe } from "bun:test";
import { compileSort, encodeCursor, decodeCursor } from "./sort-compiler";
import type { Field } from "./types";

const mkField = (id: string, type: string): Field => ({
  id, tableId: "t1", name: id, description: null, type, config: {}, presentable: false, hideInTable: false,
  position: 0, required: false, defaultValue: null,
  indexed: false, uniqueConstraint: false, deletedAt: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
});

const fields: Field[] = [
  mkField("fld_a", "text"),
  mkField("fld_b", "number"),
  mkField("fld_c", "date"),
];

describe("compileSort — validation", () => {
  test("rejects unknown field", () => {
    const r = compileSort([{ fieldId: "fld_missing", direction: "asc" }], fields, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown sort field/);
  });

  test("rejects deleted field", () => {
    const dead = { ...mkField("fld_x", "text"), deletedAt: "2026-01-01T00:00:00Z" };
    const r = compileSort([{ fieldId: "fld_x", direction: "asc" }], [...fields, dead], null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deleted/);
  });

  test("rejects mixed asc/desc directions (with cursor)", () => {
    const r = compileSort(
      [
        { fieldId: "fld_a", direction: "asc" },
        { fieldId: "fld_b", direction: "desc" },
      ],
      fields,
      { values: ["x", 5], id: "00000000-0000-0000-0000-000000000001" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mixed/);
  });

  test("rejects mixed asc/desc directions on FIRST page (no cursor) too", () => {
    // Codex chunk-1B regression: mixed-direction validation must run before
    // the response so the API doesn't emit a cursor it can't follow.
    const r = compileSort(
      [
        { fieldId: "fld_a", direction: "asc" },
        { fieldId: "fld_b", direction: "desc" },
      ],
      fields,
      null,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mixed/);
  });

  test("succeeds with empty sort spec (no cursor)", () => {
    const r = compileSort([], fields, null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.fieldIds).toEqual([]);
      expect(r.result.cursorWhere).toBeNull();
    }
  });

  test("succeeds with single asc sort + cursor", () => {
    const r = compileSort(
      [{ fieldId: "fld_b", direction: "asc" }],
      fields,
      { values: [42], id: "00000000-0000-0000-0000-000000000001" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.fieldIds).toEqual(["fld_b"]);
      expect(r.result.cursorWhere).not.toBeNull();
      expect(r.result.projections).toEqual([{ fieldId: "fld_b", sqlCast: "numeric" }]);
    }
  });

  test("succeeds with multi-column desc sort + cursor", () => {
    const r = compileSort(
      [
        { fieldId: "fld_c", direction: "desc" },
        { fieldId: "fld_b", direction: "desc" },
      ],
      fields,
      { values: ["2026-05-01", 100], id: "00000000-0000-0000-0000-000000000001" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.fieldIds).toEqual(["fld_c", "fld_b"]);
      expect(r.result.projections.map((p) => p.sqlCast)).toEqual(["date", "numeric"]);
    }
  });

  test("handles null in cursor sort values (was P2 — would skip rows)", () => {
    // Codex chunk-1B regression: null in cursor sort value caused tuple
    // comparison to evaluate to UNKNOWN and skip rows.
    const r = compileSort(
      [{ fieldId: "fld_b", direction: "asc" }],
      fields,
      { values: [null], id: "00000000-0000-0000-0000-000000000001" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.cursorWhere).not.toBeNull();
  });

  test("DESC NULLS FIRST with null cursor still emits a cursor predicate", () => {
    // Codex follow-up: this case used to return FALSE for orderGt and stop
    // pagination at the null tier instead of advancing into non-null rows.
    const r = compileSort(
      [{ fieldId: "fld_b", direction: "desc", nullsFirst: true }],
      fields,
      { values: [null], id: "00000000-0000-0000-0000-000000000001" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.cursorWhere).not.toBeNull();
  });
});

describe("cursor encode/decode", () => {
  test("round-trips values and id", () => {
    const c = { sortValues: ["foo", 42, "2026-05-01"], id: "abc-123" };
    const token = encodeCursor(c);
    const decoded = decodeCursor(token);
    expect(decoded).toEqual({ values: ["foo", 42, "2026-05-01"], id: "abc-123" });
  });

  test("decode returns null for malformed token", () => {
    expect(decodeCursor("not json")).toBeNull();
    expect(decodeCursor('{"only": "object"}')).toBeNull();
    expect(decodeCursor('{"v": "not array", "i": "x"}')).toBeNull();
  });
});
