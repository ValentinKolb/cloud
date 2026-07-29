import { describe, expect, test } from "bun:test";
import { layoutCalendarIntervals } from "./calendar-event-layout";

type Interval = { id: string; start: number; end: number };

const layout = (items: readonly Interval[]) => layoutCalendarIntervals(items, ({ start, end }) => ({ start, end }));

describe("calendar interval layout", () => {
  test("uses the lowest free lane and preserves overlap groups", () => {
    const result = layout([
      { id: "long", start: 0, end: 30 },
      { id: "short", start: 0, end: 10 },
      { id: "reuse", start: 10, end: 20 },
      { id: "next-group", start: 30, end: 40 },
    ]);

    expect(result.map(({ item, lane, lanes, groupId }) => ({ id: item.id, lane, lanes, groupId }))).toEqual([
      { id: "long", lane: 0, lanes: 2, groupId: 0 },
      { id: "short", lane: 1, lanes: 2, groupId: 0 },
      { id: "reuse", lane: 1, lanes: 2, groupId: 0 },
      { id: "next-group", lane: 0, lanes: 1, groupId: 1 },
    ]);
    expect(result[0]).toMatchObject({ groupStart: 0, groupEnd: 30 });
    expect(result[3]).toMatchObject({ groupStart: 30, groupEnd: 40 });
  });

  test("lays out a large overlap group without scanning all existing lanes", () => {
    const intervals = Array.from({ length: 2_048 }, (_, index) => ({
      id: String(index),
      start: 0,
      end: 10,
    }));
    const result = layout(intervals);

    expect(result).toHaveLength(intervals.length);
    expect(result.at(-1)).toMatchObject({ lane: intervals.length - 1, lanes: intervals.length });
  });
});
