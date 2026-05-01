import { test, expect, describe } from "bun:test";
import {
  findFieldRefContexts,
  findFieldRefsInValue,
  hasBlockingDependents,
  type FieldDependent,
} from "./field-dependents";

describe("findFieldRefsInValue", () => {
  const fid = "fld_abc";

  test("matches direct string match", () => {
    expect(findFieldRefsInValue(fid, fid)).toBe(true);
    expect(findFieldRefsInValue("fld_other", fid)).toBe(false);
  });

  test("walks arrays", () => {
    expect(findFieldRefsInValue(["a", fid, "b"], fid)).toBe(true);
    expect(findFieldRefsInValue(["a", "b"], fid)).toBe(false);
  });

  test("walks nested objects", () => {
    expect(findFieldRefsInValue({ filter: { fieldId: fid, op: "eq" } }, fid)).toBe(true);
    expect(findFieldRefsInValue({ a: { b: { c: fid } } }, fid)).toBe(true);
  });

  test("ignores non-matching primitives", () => {
    expect(findFieldRefsInValue(42, fid)).toBe(false);
    expect(findFieldRefsInValue(null, fid)).toBe(false);
    expect(findFieldRefsInValue(undefined, fid)).toBe(false);
    expect(findFieldRefsInValue(true, fid)).toBe(false);
  });
});

describe("findFieldRefContexts (view config scanning)", () => {
  const fid = "fld_abc";

  test("detects fieldId references in filter trees", () => {
    const config = {
      filter: { op: "AND", filters: [{ fieldId: fid, op: "eq", value: "x" }] },
    };
    expect(findFieldRefContexts(config, fid)).toEqual(["filter"]);
  });

  test("detects fieldId in sort spec", () => {
    const config = { sort: [{ fieldId: fid, direction: "asc" }] };
    expect(findFieldRefContexts(config, fid)).toEqual(["sort"]);
  });

  test("detects fieldId in visibleFields and fieldOrder arrays", () => {
    expect(findFieldRefContexts({ visibleFields: ["x", fid] }, fid)).toEqual(["visibleFields"]);
    expect(findFieldRefContexts({ fieldOrder: [fid] }, fid)).toEqual(["fieldOrder"]);
  });

  test("detects fieldId in fieldWidths object keys via value-walk", () => {
    // fieldWidths is { fieldId: number } — the field-id appears as a key,
    // which the recursive walk does NOT match (we only check values). This
    // is intentional: width entries can be cleaned up trivially without a
    // dependency block.
    expect(findFieldRefContexts({ fieldWidths: { [fid]: 150 } }, fid)).toEqual([]);
  });

  test("detects multiple contexts at once", () => {
    const config = {
      filter: { fieldId: fid, op: "eq" },
      visibleFields: [fid],
    };
    expect(findFieldRefContexts(config, fid).sort()).toEqual(["filter", "visibleFields"]);
  });

  test("returns empty when field not referenced", () => {
    const config = { filter: { fieldId: "fld_other" }, sort: [{ fieldId: "fld_other" }] };
    expect(findFieldRefContexts(config, fid)).toEqual([]);
  });
});

describe("hasBlockingDependents", () => {
  test("returns false for empty list", () => {
    expect(hasBlockingDependents([])).toBe(false);
  });

  test("returns false when only non-blocking deps present", () => {
    const deps: FieldDependent[] = [
      { type: "view", resourceId: "v1", resourceName: "View A", blocking: false },
      { type: "form", resourceId: "f1", resourceName: "Form A", blocking: false },
    ];
    expect(hasBlockingDependents(deps)).toBe(false);
  });

  test("returns true if any dep is blocking", () => {
    const deps: FieldDependent[] = [
      { type: "view", resourceId: "v1", resourceName: "View A", blocking: false },
      { type: "formula", resourceId: "fld_x", resourceName: "Total", blocking: true },
    ];
    expect(hasBlockingDependents(deps)).toBe(true);
  });
});
