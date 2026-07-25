import { describe, expect, test } from "bun:test";
import { EMPTY_VALUE, formatBytes, formatDurationMs, formatNumber, formatPercent, formatRatio } from "./format";

describe("formatNumber", () => {
  test("groups by default and compacts on request", () => {
    expect(formatNumber(1_234_567, { locale: "en" })).toBe("1,234,567");
    expect(formatNumber(1_234_567, { locale: "en", compact: true })).toBe("1.2M");
    expect(formatNumber(1234, { locale: "en", compact: true })).toBe("1.2K");
  });

  test("distinguishes absent from zero", () => {
    expect(formatNumber(0, { locale: "en" })).toBe("0");
    expect(formatNumber(null)).toBe(EMPTY_VALUE);
    expect(formatNumber(Number.NaN)).toBe(EMPTY_VALUE);
    expect(formatNumber(undefined, { fallback: "-" })).toBe("-");
  });
});

describe("formatPercent", () => {
  test("takes a ratio, not an already-multiplied number", () => {
    // The old local copies disagreed about this, which is a silent
    // factor-of-100 bug rather than a visible one.
    expect(formatPercent(0.1234)).toBe("12.3%");
    expect(formatPercent(0.999, { decimals: 3 })).toBe("99.900%");
  });

  test("clamps only when asked", () => {
    expect(formatPercent(1.4, { clamp: true })).toBe("100.0%");
    expect(formatPercent(1.4)).toBe("140.0%");
  });
});

describe("formatRatio", () => {
  test("guards the zero total", () => {
    expect(formatRatio(0, 0)).toBe(EMPTY_VALUE);
    expect(formatRatio(20, 200)).toBe("10.0%");
  });
});

describe("formatDurationMs", () => {
  test("walks the unit ladder", () => {
    expect(formatDurationMs(0.4)).toBe("<1ms");
    expect(formatDurationMs(842)).toBe("842ms");
    expect(formatDurationMs(1234)).toBe("1.23s");
    expect(formatDurationMs(90_000)).toBe("1m");
    expect(formatDurationMs(7_200_000)).toBe("2h");
    expect(formatDurationMs(1_000_000_000)).toBe("11d");
  });

  test("renders absent durations as absent", () => {
    expect(formatDurationMs(null)).toBe(EMPTY_VALUE);
    expect(formatDurationMs(0)).toBe("<1ms");
  });
});

describe("formatBytes", () => {
  test("delegates to stdlib and defaults to SI", () => {
    // Storage tooling reports GB; the previous copies split between the two
    // bases without saying which they used.
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(1536, { mode: "iec" })).toBe("1.5 KiB");
  });

  test("treats absent as absent, zero as zero", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe(EMPTY_VALUE);
  });
});
