import { describe, expect, test } from "bun:test";
import { buildJobTimelineRows, TIMELINE_LANES } from "./service";

const WINDOW = { fromMs: 1_000_000, toMs: 1_000_000 + 3_600_000 };

const span = (over: Partial<Parameters<typeof buildJobTimelineRows>[0][number]> = {}) => ({
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  name: "job run",
  source: "job:a",
  status: "ok",
  statusMessage: null,
  startedAt: new Date(WINDOW.fromMs + 60_000).toISOString(),
  endedAt: new Date(WINDOW.fromMs + 60_022).toISOString(),
  durationMs: 22,
  ...over,
});

describe("buildJobTimelineRows", () => {
  test("gives a millisecond run a visible width without moving its start", () => {
    // The whole point of the timeline: a 22ms run in a one-hour window would
    // otherwise be a subpixel and effectively invisible.
    const [row] = buildJobTimelineRows([span()], WINDOW);
    const interval = row?.intervals[0];
    expect(interval?.from).toBe(WINDOW.fromMs + 60_000);
    expect(interval?.to).toBeGreaterThan((interval?.from ?? 0) + 22);
    expect(interval?.label).toBe("22ms");
  });

  test("keeps a recent unfinished span running", () => {
    const [row] = buildJobTimelineRows([span({ endedAt: null, durationMs: null })], WINDOW);
    expect(row?.intervals[0]?.state).toBe("running");
  });

  test("marks an old unfinished span as stuck", () => {
    const [row] = buildJobTimelineRows(
      [span({ startedAt: new Date(WINDOW.fromMs - 500_000).toISOString(), endedAt: null, durationMs: null })],
      WINDOW,
    );
    expect(row?.intervals[0]?.state).toBe("stuck");
  });

  test("carries failures through as their own state", () => {
    const [row] = buildJobTimelineRows([span({ status: "error" })], WINDOW);
    expect(row?.intervals[0]?.state).toBe("error");
  });

  test("never draws outside the window", () => {
    const [row] = buildJobTimelineRows(
      [span({ startedAt: new Date(WINDOW.fromMs - 500_000).toISOString(), endedAt: null, durationMs: null })],
      WINDOW,
    );
    expect(row?.intervals[0]?.from).toBe(WINDOW.fromMs);
    expect(row?.intervals[0]?.to).toBeLessThanOrEqual(WINDOW.toMs);
  });

  test("caps lanes and orders the busiest first", () => {
    const spans = Array.from({ length: TIMELINE_LANES + 5 }, (_, i) =>
      Array.from({ length: i + 1 }, () => span({ source: `job:${i}` })),
    ).flat();
    const rows = buildJobTimelineRows(spans, WINDOW);
    expect(rows).toHaveLength(TIMELINE_LANES);
    expect(rows[0]?.label).toBe(`job:${TIMELINE_LANES + 4}`);
    expect(rows[0]?.source).toBe(`job:${TIMELINE_LANES + 4}`);
  });

  test("skips spans with no start", () => {
    expect(buildJobTimelineRows([span({ startedAt: null })], WINDOW)).toEqual([]);
  });
});
