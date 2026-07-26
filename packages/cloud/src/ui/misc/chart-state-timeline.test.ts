import { describe, expect, test } from "bun:test";
import {
  normalizeStateTimelineViewport,
  panStateTimelineViewport,
  renderStateTimelineSvg,
  stateTimelineDomain,
  stateTimelineHeight,
  zoomStateTimelineViewport,
} from "./chart-state-timeline";

const rows = [
  {
    label: "A job with a descriptive source label",
    href: "/admin/observability/jobs?source=a",
    intervals: [
      {
        from: 20,
        to: 22,
        state: "ok",
        href: "/admin/observability/jobs?run=trace%3Aspan",
        tooltip: "Succeeded in 22 ms",
      },
    ],
  },
];

describe("state timeline viewport", () => {
  test("uses an explicit domain instead of shrinking to the data", () => {
    expect(stateTimelineDomain(rows, [0, 100])).toEqual([0, 100]);
  });

  test("keeps zoom and pan bounded by the full domain", () => {
    const zoomed = zoomStateTimelineViewport([0, 100], [0, 100], 1);
    expect(zoomed[1] - zoomed[0]).toBeLessThan(100);
    expect(panStateTimelineViewport(zoomed, [0, 100], 10_000, 500)[0]).toBe(0);
    expect(normalizeStateTimelineViewport([-50, 150], [0, 100])).toEqual([0, 100]);
  });
});

describe("state timeline rendering", () => {
  test("renders safe links, tooltips, semantic colors and the full label in a title", () => {
    const svg = renderStateTimelineSvg({
      width: 800,
      height: stateTimelineHeight(1),
      rows,
      domain: [0, 100],
      states: [{ state: "ok", label: "Succeeded", color: "#10b981" }],
      legend: true,
    });

    expect(svg).toContain('href="/admin/observability/jobs?source=a"');
    expect(svg).toContain('href="/admin/observability/jobs?run=trace%3Aspan"');
    expect(svg).toContain('data-chart-tooltip="Succeeded in 22 ms"');
    expect(svg).toContain('fill="#10b981"');
    expect(svg).toContain("<title>A job with a descriptive source label</title>");
  });

  test("rejects executable links", () => {
    const svg = renderStateTimelineSvg({
      width: 800,
      height: 160,
      rows: [{ ...rows[0]!, href: "javascript:alert(1)" }],
    });
    expect(svg).not.toContain("javascript:");
  });
});
