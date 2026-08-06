import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "cloud-chart-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: Chart } = await import("./Chart");

const series = [
  {
    label: "Visits",
    data: [{ latitude: 52.52, longitude: 13.405, label: "Berlin" }],
  },
];

describe("Chart map interaction SSR", () => {
  test("renders interactive controls and the initial viewport on the server", () => {
    const html = renderToString(() =>
      createComponent(Chart, {
        kind: "map",
        series,
        interactive: true,
        viewport: { latitude: 52.52, longitude: 13.405, zoom: 2 },
      }),
    );

    expect(html).toContain('aria-label="Interactive map"');
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Zoom out"');
    expect(html).toContain('aria-label="Reset map view"');
    expect(html).toContain("stdlib-chart-map-viewport");
  });

  test("keeps static maps free of interaction controls", () => {
    const html = renderToString(() =>
      createComponent(Chart, {
        kind: "map",
        series,
      }),
    );

    expect(html).not.toContain('aria-label="Interactive map"');
    expect(html).not.toContain('aria-label="Zoom in"');
    expect(html).toContain("stdlib-chart-map-viewport");
  });
});

describe("Chart state timeline SSR", () => {
  const rows = [
    {
      label: "Notifications recovery",
      href: "/admin/observability/jobs?source=notifications",
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

  test("renders links, tooltip data and timeline controls on the server", () => {
    const html = renderToString(() =>
      createComponent(Chart, {
        kind: "stateTimeline",
        rows,
        domain: [0, 100],
        states: [{ state: "ok", label: "Succeeded", color: "#10b981" }],
        interactive: true,
      }),
    );

    expect(html).toContain('aria-label="Interactive timeline"');
    expect(html).toContain('aria-label="Zoom in"');
    expect(html).toContain('aria-label="Reset timeline view"');
    expect(html).toContain('data-chart-tooltip="Succeeded in 22 ms"');
    expect(html).toContain("/admin/observability/jobs?run=trace%3Aspan");
  });

  test("keeps static timelines free of interaction controls", () => {
    const html = renderToString(() =>
      createComponent(Chart, {
        kind: "stateTimeline",
        rows,
      }),
    );

    expect(html).not.toContain('aria-label="Interactive timeline"');
    expect(html).not.toContain('aria-label="Zoom in"');
  });
});

describe("Chart line interaction SSR", () => {
  test("exposes one keyboard-focusable chart without map or timeline controls", () => {
    const html = renderToString(() =>
      createComponent(Chart, {
        kind: "line",
        series: [
          {
            label: "Errors",
            data: [
              { x: 1, y: 2 },
              { x: 2, y: 3 },
            ],
          },
        ],
        interactive: true,
      }),
    );

    expect(html).toContain('aria-label="Interactive line chart"');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('aria-label="Zoom in"');
    expect(html).toContain('role="tooltip"');
  });
});

describe("Chart presentation hooks", () => {
  test("carries the drag, crosshair and empty affordances as package classes", () => {
    const draggable = renderToString(() => createComponent(Chart, { kind: "map", series, interactive: true }));
    const crosshair = renderToString(() =>
      createComponent(Chart, {
        kind: "line",
        series: [{ label: "Errors", data: [{ x: 1, y: 2 }] }],
        interactive: true,
      }),
    );
    const empty = renderToString(() => createComponent(Chart, { kind: "line", series: [] }));

    // Cloud spells these as `cursor-grab` / `cursor-crosshair` utilities; the
    // package moves them to data attributes so no Tailwind scan is required.
    expect(draggable).toContain('data-drag="idle"');
    expect(draggable).toContain("k2b-chart__controls");
    expect(draggable).toContain("k2b-chart__svg");
    expect(crosshair).toContain('data-crosshair="true"');
    expect(crosshair).toContain("k2b-chart__anchor");
    expect(crosshair).toContain("k2b-tooltip");
    expect(empty).toContain("k2b-chart__empty");
    expect(empty).toContain("No data");
    expect(empty).not.toContain("text-dimmed");
  });
});
