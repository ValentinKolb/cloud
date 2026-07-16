import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { Dashboard, Field } from "../../../service";
import "../ssr-test-plugin";
import type { WidgetData } from "./widget-data";

const { default: DashboardLayout } = await import("./DashboardLayout");

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

  test("renders saved GQL view values with their field presentation", () => {
    const tableId = "00000000-0000-4000-8000-000000000010";
    const fieldId = "00000000-0000-4000-8000-000000000011";
    const viewDashboard = {
      ...dashboard,
      config: {
        rows: [
          {
            id: "row-view",
            kind: "row",
            height: "sm",
            cells: [
              {
                id: "widget-view",
                kind: "view",
                title: "Current status",
                viewId: "00000000-0000-4000-8000-000000000012",
              },
            ],
          },
        ],
      },
    } satisfies Dashboard;
    const statusField = {
      id: fieldId,
      shortId: "status",
      tableId,
      name: "Status",
      description: null,
      type: "select",
      config: { options: [{ id: "ready", label: "Ready", color: "#16a34a" }] },
      position: 0,
      required: false,
      presentable: false,
      hideInTable: false,
      defaultValue: null,
      indexed: false,
      uniqueConstraint: false,
      deletedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies Field;
    const viewData = {
      kind: "view",
      title: "Current status",
      queryResult: {
        ok: true,
        mode: "rows",
        columns: [{ key: fieldId, label: "Status", tableId, fieldId, type: "select", sqlType: "text" }],
        rows: [{ recordId: "00000000-0000-4000-8000-000000000013", tableId, values: { [fieldId]: "ready" } }],
        limit: 25,
        truncated: true,
        page: { size: 25, start: 0, returned: 1, nextCursor: null },
      },
      fieldsByTable: { [tableId]: [statusField] },
      tableShortIds: { [tableId]: "table" },
      fullViewLink: { tableShortId: "table", viewShortId: "view" },
      sourceAccess: "open",
    } satisfies Extract<WidgetData, { kind: "view" }>;

    const html = renderToString(() =>
      createComponent(DashboardLayout, {
        dashboard: viewDashboard,
        widgetData: { "widget-view": viewData },
        baseShortId: "base1",
      }),
    );

    expect(html).toContain("Current status");
    expect(html).toContain("Ready");
    expect(html).toContain("Showing first 1 row");
    expect(html).toContain("/app/grids/base1/table/table/view/view");
  });
});
