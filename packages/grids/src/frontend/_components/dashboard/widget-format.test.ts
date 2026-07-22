import { describe, expect, test } from "bun:test";
import { formatWidgetValue } from "./widget-format";

const en = { locale: "en" };

describe("formatWidgetValue", () => {
  test("uses an em dash for missing values", () => {
    expect(formatWidgetValue(null, { style: "number" }, en)).toBe("—");
    expect(formatWidgetValue(undefined, undefined, en)).toBe("—");
  });

  test("preserves decimal-string precision", () => {
    expect(formatWidgetValue("12345678901234567890.123456789", { style: "number", decimalPlaces: 9 }, en)).toBe(
      "12,345,678,901,234,567,890.123456789",
    );
  });

  test("supports explicit decimal places and units on either side", () => {
    expect(formatWidgetValue("24.5", { style: "number", decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" }, en)).toBe("24.50 EUR");
    expect(formatWidgetValue("24.5", { style: "number", decimalPlaces: 2, unit: "$", unitPosition: "prefix" }, en)).toBe("$ 24.50");
  });

  test("integer keeps the previous Math.round tie direction", () => {
    expect(formatWidgetValue("3.7", { style: "integer" }, en)).toBe("4");
    expect(formatWidgetValue("-2.5", { style: "integer" }, en)).toBe("-2");
    expect(formatWidgetValue("-0.4", { style: "integer" }, en)).toBe("-0");
  });

  test("percent treats source values as fractions", () => {
    expect(formatWidgetValue("0.19", { style: "percent" }, en)).toBe("19%");
    expect(formatWidgetValue("0.195", { style: "percent", decimalPlaces: 1 }, en)).toBe("19.5%");
  });

  test("defaults to a compact number and passes through non-numeric text", () => {
    expect(formatWidgetValue("29.155", undefined, en)).toBe("29.155");
    expect(formatWidgetValue("0.0001", undefined, en)).toBe("0.0001");
    expect(formatWidgetValue("Acme Corp", { style: "number", unit: "EUR" }, en)).toBe("Acme Corp");
  });
});
