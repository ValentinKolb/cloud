import { describe, expect, test } from "bun:test";
import type { RecordQuery } from "../../../contracts";
import { aggregationRowsFromQuery, applyToolbarQueryPatch, filterRowsFromQuery } from "./toolbar-query";

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

  test("adapts only UI-supported aggregations", () => {
    expect(
      aggregationRowsFromQuery([
        { fieldId: "amount", agg: "sum", label: "Total" },
        { fieldId: "created", agg: "earliest", label: "First" },
      ]),
    ).toEqual([{ fieldId: "amount", agg: "sum", label: "Total" }]);
  });

  test("extracts editable leaves from an AND filter", () => {
    expect(
      filterRowsFromQuery({
        op: "AND",
        filters: [
          { fieldId: "status", op: "is", value: "ready" },
          { op: "OR", filters: [{ fieldId: "name", op: "contains", value: "Ada" }] },
        ],
      }),
    ).toEqual([{ fieldId: "status", op: "is", value: "ready" }]);
  });
});
