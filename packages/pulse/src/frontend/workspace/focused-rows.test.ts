import { describe, expect, test } from "bun:test";
import { focusedRowsOffset, mergeFocusedRows } from "./focused-rows";

describe("Pulse focused rows helpers", () => {
  test("uses zero offset for fresh focused row loads", () => {
    expect(
      focusedRowsOffset({
        append: false,
        eventCount: 5,
        metricSeriesCount: 10,
        stateCount: 15,
        view: "metric-detail",
      }),
    ).toBe(0);
  });

  test("uses the current row count for appended focused row loads", () => {
    expect(
      focusedRowsOffset({
        append: true,
        eventCount: 5,
        metricSeriesCount: 10,
        stateCount: 15,
        view: "metric-detail",
      }),
    ).toBe(10);
    expect(
      focusedRowsOffset({
        append: true,
        eventCount: 5,
        metricSeriesCount: 10,
        stateCount: 15,
        view: "state-detail",
      }),
    ).toBe(15);
    expect(
      focusedRowsOffset({
        append: true,
        eventCount: 5,
        metricSeriesCount: 10,
        stateCount: 15,
        view: "event-detail",
      }),
    ).toBe(5);
  });

  test("replaces or appends focused row pages", () => {
    expect(mergeFocusedRows([1, 2], [3], false)).toEqual([3]);
    expect(mergeFocusedRows([1, 2], [3], true)).toEqual([1, 2, 3]);
  });
});
