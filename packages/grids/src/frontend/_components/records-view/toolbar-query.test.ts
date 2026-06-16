import { describe, expect, test } from "bun:test";
import type { RecordQuery } from "../../../contracts";
import { applyToolbarQueryPatch } from "./toolbar-query";

describe("applyToolbarQueryPatch", () => {
  test("preserves groupSort when only filter/sort changes", () => {
    const previous = {
      groupBy: [{ fieldId: "group-field", direction: "asc" }],
      groupSort: [{ fieldId: "*", agg: "count", direction: "asc" }],
    } as RecordQuery;

    expect(applyToolbarQueryPatch(previous, { sort: [{ fieldId: "name", direction: "asc" }] }).groupSort).toEqual(previous.groupSort);
  });

  test("clears groupSort when group fields change", () => {
    const previous = {
      groupBy: [{ fieldId: "group-field", direction: "asc" }],
      groupSort: [{ fieldId: "*", agg: "count", direction: "asc" }],
    } as RecordQuery;

    expect(applyToolbarQueryPatch(previous, { groupBy: [{ fieldId: "other-field", direction: "asc" }] }).groupSort).toBeUndefined();
  });

  test("clears groupSort when aggregations change", () => {
    const previous = {
      groupBy: [{ fieldId: "group-field", direction: "asc" }],
      groupSort: [{ fieldId: "amount", agg: "sum", direction: "desc" }],
    } as RecordQuery;

    expect(applyToolbarQueryPatch(previous, { aggregations: [{ fieldId: "*", agg: "count" }] }).groupSort).toBeUndefined();
  });
});
