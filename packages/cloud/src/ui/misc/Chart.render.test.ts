import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@valentinkolb/ssr";
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
