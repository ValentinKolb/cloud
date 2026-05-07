import { test, expect, describe } from "bun:test";
import { formatWidgetValue } from "./widget-format";

// =============================================================================
// formatWidgetValue — pure stat-card / chart-axis number formatter.
// Goal of these tests: lock down the "looks-like-a-number" branch
// (decimal cells store as strings) and the empty-state behaviour. We
// stay locale-agnostic in expectations (Intl output varies by runtime
// default locale) by checking for substring patterns where the number
// formatting itself is the concern.
// =============================================================================

describe("formatWidgetValue", () => {
  test("null / undefined → em-dash placeholder", () => {
    expect(formatWidgetValue(null, "plain")).toBe("—");
    expect(formatWidgetValue(undefined, "plain")).toBe("—");
    expect(formatWidgetValue(null, "currency")).toBe("—");
  });

  test("integer rounds and drops decimals", () => {
    expect(formatWidgetValue(3.7, "integer")).toMatch(/^4$/);
    expect(formatWidgetValue(-2.5, "integer")).toMatch(/^-2$/);
  });

  test("currency includes a € symbol and 2 decimals", () => {
    const out = formatWidgetValue(24.5, "currency");
    expect(out).toMatch(/€/);
    expect(out).toMatch(/24[.,]50/);
  });

  test("percent multiplies by 100 (source values are fractions)", () => {
    const out = formatWidgetValue(0.19, "percent");
    expect(out).toMatch(/19\s?%/);
  });

  test("plain returns the number formatted with up to 4 decimals", () => {
    const out = formatWidgetValue(29.155, "plain");
    expect(out).toMatch(/29[.,]155/);
  });

  test("decimal-string inputs are coerced to numbers (currency cells store as strings)", () => {
    const out = formatWidgetValue("24.50", "currency");
    expect(out).toMatch(/€/);
    expect(out).toMatch(/24[.,]50/);
  });

  test("non-numeric strings pass through (e.g. MIN over a text field)", () => {
    expect(formatWidgetValue("Acme Corp", "plain")).toBe("Acme Corp");
  });

  test("undefined format defaults to plain number formatting", () => {
    const out = formatWidgetValue(42, undefined);
    expect(out).toBe("42");
  });

  test("very small numbers don't lose precision in plain mode", () => {
    const out = formatWidgetValue(0.0001, "plain");
    expect(out).toMatch(/0[.,]0001/);
  });
});
