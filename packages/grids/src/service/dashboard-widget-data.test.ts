import { describe, expect, test } from "bun:test";
import type { DslQueryPreviewResponse } from "../contracts";
import { chartDataFromPreview, metricCellsFromPreview, valueFormatForField } from "./dashboard-widget-data";
import type { Field } from "./types";

const field = (type: Field["type"], config: Field["config"] = {}): Field =>
  ({ id: crypto.randomUUID(), tableId: crypto.randomUUID(), name: "Value", type, config }) as Field;

describe("dashboard view-stat value formats", () => {
  test("respects both supported percent storage ranges", () => {
    expect(valueFormatForField(field("percent", { decimals: 1 }))).toEqual({
      style: "number",
      decimalPlaces: 1,
      unit: "%",
      unitPosition: "suffix",
    });
    expect(valueFormatForField(field("percent", { range: "fraction", decimals: 2 }))).toEqual({
      style: "percent",
      decimalPlaces: 2,
    });
  });

  test("keeps number units and integer semantics explicit", () => {
    expect(valueFormatForField(field("number", { decimalPlaces: 2, unit: "kg", unitPosition: "suffix" }))).toEqual({
      style: "number",
      decimalPlaces: 2,
      unit: "kg",
      unitPosition: "suffix",
    });
    expect(valueFormatForField(field("number", { integerOnly: true, unit: "items" }))).toEqual({ style: "integer" });
  });

  test("does not claim formatting semantics for non-numeric fields", () => {
    expect(valueFormatForField(field("text"))).toBeUndefined();
  });
});

describe("dashboard insight presentation transforms", () => {
  test("turns one aggregate row into named metric cells", () => {
    const preview: Extract<DslQueryPreviewResponse, { ok: true }> = {
      ok: true,
      mode: "groups",
      columns: [
        { key: "requests", label: "Requests", type: "aggregate", sqlType: "number", aggregate: "count" },
        { key: "revenue", label: "Revenue", type: "aggregate", sqlType: "number", aggregate: "sum" },
      ],
      rows: [{ values: { requests: 42, revenue: "120.50" } }],
      limit: 1,
      truncated: false,
    };

    expect(metricCellsFromPreview(preview, [])).toEqual([
      { label: "Requests", value: 42, valueFormat: { style: "integer" } },
      { label: "Revenue", value: "120.50", valueFormat: undefined },
    ]);
  });

  test("turns grouped aggregate output into chart buckets", () => {
    const preview: Extract<DslQueryPreviewResponse, { ok: true }> = {
      ok: true,
      mode: "groups",
      columns: [
        { key: "status", label: "Status", type: "text", sqlType: "text" },
        { key: "requests", label: "Requests", type: "aggregate", sqlType: "number", aggregate: "count" },
      ],
      rows: [{ values: { status: "Open", requests: 3 } }, { values: { status: "Done", requests: 7 } }],
      limit: 100,
      truncated: false,
    };

    expect(chartDataFromPreview(preview, [])).toEqual({
      kind: "chart",
      buckets: [
        { keys: ["Open"], values: { requests__count: 3 } },
        { keys: ["Done"], values: { requests__count: 7 } },
      ],
      fields: [],
      viewQuery: {
        groupBy: [{ fieldId: "status", label: "Status" }],
        aggregations: [{ fieldId: "requests", agg: "count", label: "Requests" }],
      },
      relationLabels: {},
    });
  });
});
