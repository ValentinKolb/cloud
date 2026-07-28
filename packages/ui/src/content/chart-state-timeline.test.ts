import { describe, expect, test } from "bun:test";
import {
  normalizeStateTimelineViewport,
  panStateTimelineViewport,
  renderStateTimeline,
  stateTimelineDomain,
  zoomStateTimelineViewport,
} from "./chart-state-timeline";

const rows = [{ label: "Worker", intervals: [{ from: 20, to: 25, state: "ok", href: "/runs/1", tooltip: "Succeeded" }] }];

describe("state timeline", () => {
  test("normalizes, zooms and pans inside the full domain", () => {
    expect(stateTimelineDomain(rows, [0, 100])).toEqual([0, 100]);
    const zoomed = zoomStateTimelineViewport([0, 100], [0, 100], 1);
    expect(zoomed[1] - zoomed[0]).toBeLessThan(100);
    expect(panStateTimelineViewport(zoomed, [0, 100], 10_000, 500)[0]).toBe(0);
    expect(normalizeStateTimelineViewport([-20, 120], [0, 100])).toEqual([0, 100]);
  });

  test("adds safe links and inspectable tooltip metadata", () => {
    const svg = renderStateTimeline({ width: 600, height: 180, rows, domain: [0, 100] });
    expect(svg).toContain('href="/runs/1"');
    expect(svg).toContain('data-chart-tooltip="Succeeded"');
    expect(svg).toContain(">0<");
    expect(svg).toContain(">100<");
    expect(svg).not.toContain("javascript:");
  });
});
