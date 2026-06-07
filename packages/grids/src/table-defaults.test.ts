import { describe, expect, test } from "bun:test";
import { defaultTableAggregations } from "./table-defaults";
import type { Field } from "./service/types";

const field = (id: string, type: string): Field => ({
  id,
  shortId: id,
  tableId: "table",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("defaultTableAggregations", () => {
  test("keeps the default footer useful but quiet", () => {
    expect(defaultTableAggregations([
      field("n", "number"),
      field("d", "number"),
      field("p", "percent"),
      field("date", "date"),
      field("identifier", "id"),
      field("text", "text"),
      field("formula", "formula"),
    ])).toEqual([
      { fieldId: "*", agg: "count", label: "records" },
      { fieldId: "n", agg: "sum" },
      { fieldId: "d", agg: "sum" },
      { fieldId: "p", agg: "avg" },
      { fieldId: "date", agg: "latest" },
    ]);
  });
});
