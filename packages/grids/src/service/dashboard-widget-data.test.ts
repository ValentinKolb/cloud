import { describe, expect, test } from "bun:test";
import { valueFormatForField } from "./dashboard-widget-data";
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
