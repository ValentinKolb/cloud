import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@valentinkolb/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { Dashboard } from "../../../service";

const ssrRoot = await mkdtemp(join(tmpdir(), "grids-dashboard-layout-"));
const { plugin } = createConfig({ dev: true, rootDir: ssrRoot });
Bun.plugin(plugin());
const { default: DashboardLayout } = await import("./DashboardLayout");

afterAll(() => rm(ssrRoot, { recursive: true, force: true }));

const dashboard = {
  id: "00000000-0000-4000-8000-000000000001",
  shortId: "dash1",
  baseId: "00000000-0000-4000-8000-000000000002",
  name: "Operations",
  description: null,
  icon: null,
  config: {
    rows: [
      {
        id: "row-1",
        kind: "row",
        height: "sm",
        cells: [{ id: "widget-1", kind: "markdown", title: "Quarterly summary", markdown: "Summary" }],
      },
      {
        id: "row-2",
        kind: "row",
        height: "sm",
        cells: [{ id: "widget-2", kind: "markdown", title: "Notes", markdown: "Notes" }],
      },
    ],
  },
  ownerUserId: null,
  position: 0,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies Dashboard;

describe("DashboardLayout edit controls", () => {
  test("renders named keyboard move controls and non-focusable pointer drag handles", () => {
    const html = renderToString(() =>
      createComponent(DashboardLayout, {
        dashboard,
        widgetData: {
          "widget-1": { kind: "markdown", html: "<p>Summary</p>" },
          "widget-2": { kind: "markdown", html: "<p>Notes</p>" },
        },
        baseShortId: "base1",
        edit: {
          onGeneral: () => undefined,
          onAddRowAt: () => undefined,
          onMoveRow: () => undefined,
          onEditRow: () => undefined,
          onAddCell: () => undefined,
          onEditCell: () => undefined,
          onMoveCell: () => undefined,
        },
      }),
    );

    expect(html).toContain("data-dashboard-row-drag");
    expect(html).not.toContain('aria-label="Drag row 1"');
    expect(html).toContain('aria-label="Move row 1 up"');
    expect(html).toContain('aria-label="Move row 1 down"');
    expect(html).toContain('data-dashboard-control="00000000-0000-4000-8000-000000000001:row:row-1:move:1"');
    expect(html).toContain('aria-label="Settings for row 1"');
    expect(html).toContain("data-dashboard-cell-drag");
    expect(html).not.toContain('aria-label="Drag Quarterly summary"');
    expect(html).toContain('aria-label="Move Quarterly summary in row 1, position 1 left"');
    expect(html).toContain('aria-label="Move Quarterly summary in row 1, position 1 right"');
    expect(html).toContain('aria-label="Move Quarterly summary in row 1, position 1 up"');
    expect(html).toContain('aria-label="Move Quarterly summary in row 1, position 1 down"');
    expect(html).toContain('data-dashboard-control="00000000-0000-4000-8000-000000000001:cell:widget-1:move:right"');
    expect(html).toContain('aria-label="Settings for Quarterly summary in row 1, position 1"');
    expect(html).toContain('aria-label="Add widget to row 1"');
  });
});
