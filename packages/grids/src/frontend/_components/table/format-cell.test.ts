import { describe, expect, test } from "bun:test";
import { progressRatio } from "./format-cell";
import { formatCell } from "./format-cell";

describe("formatCell", () => {
  test("normalizes date timestamps to date-only by default", () => {
    expect(formatCell("2026-05-14T00:00:00+00:00", "date", {})).toBe("2026-05-14");
  });

  test("keeps date-time wall time when the date field includes time", () => {
    expect(formatCell("2026-05-14T10:30", "date", { includeTime: true })).toBe("2026-05-14 10:30");
  });
});

describe("progressRatio", () => {
  test("normalizes percent fields from 0..100 unless configured as fraction", () => {
    expect(progressRatio(50, "percent", {})).toBe(0.5);
    expect(progressRatio(0.5, "percent", { range: "fraction" })).toBe(0.5);
  });

  test("clamps formula-like values to a safe 0..1 ratio", () => {
    expect(progressRatio(-1, "formula", {})).toBe(0);
    expect(progressRatio(2, "formula", {})).toBe(1);
    expect(progressRatio("not a number", "formula", {})).toBe(0);
  });
});
