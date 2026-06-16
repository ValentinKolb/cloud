import { describe, expect, test } from "bun:test";
import type { Widget } from "../../../contracts";
import type { GridsWorkspaceState } from "./workspace-state";
import { dashboardRecordTableIds } from "./dashboard-live-dependencies";

const TABLE_A = "11111111-1111-4111-8111-111111111111";
const TABLE_B = "22222222-2222-4222-8222-222222222222";
const TABLE_C = "33333333-3333-4333-8333-333333333333";
const VIEW_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIEW_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FORM_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const widget = (input: Widget): Widget => input;

const stateWithWidgets = (widgets: Widget[]): Extract<GridsWorkspaceState, { kind: "ok" }> =>
  ({
    kind: "ok",
    catalog: {
      viewsByTable: {
        [TABLE_A]: [{ id: VIEW_A }],
        [TABLE_B]: [{ id: VIEW_B }],
      },
      formsByTable: {
        [TABLE_C]: [{ id: FORM_C }],
      },
    },
    route: {
      kind: "dashboard",
      dashboard: {
        config: {
          rows: [{ id: "row", kind: "row", height: "md", cells: widgets }],
        },
      },
    },
  }) as unknown as Extract<GridsWorkspaceState, { kind: "ok" }>;

describe("dashboardRecordTableIds", () => {
  test("uses server-resolved dashboard dependencies when present", () => {
    const state = stateWithWidgets([
      widget({
        id: "stat",
        kind: "stat",
        viewId: VIEW_A,
      }),
    ]);
    if (state.route.kind !== "dashboard") throw new Error("expected dashboard route");
    state.route.recordLiveTableIds = [TABLE_B, TABLE_A, TABLE_B];

    expect(dashboardRecordTableIds(state)).toEqual([TABLE_A, TABLE_B]);
  });

  test("tracks every table that can change server-resolved dashboard widgets", () => {
    const ids = dashboardRecordTableIds(
      stateWithWidgets([
        widget({
          id: "stat",
          kind: "stat",
          viewId: VIEW_A,
        }),
        widget({ id: "chart", kind: "chart", chartType: "bar", viewId: VIEW_B }),
        widget({ id: "view-stats", kind: "view-stats", viewId: VIEW_A }),
        widget({ id: "view-by-view", kind: "view", viewId: VIEW_B }),
        widget({ id: "form", kind: "form", formId: FORM_C }),
        widget({ id: "markdown", kind: "markdown", markdown: "# Notes" }),
        widget({ id: "link", kind: "link", target: { kind: "table", tableId: TABLE_A } }),
        widget({
          id: "automation",
          kind: "automation-button",
          automationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          title: "Run sync",
          buttonLabel: "Run",
        }),
      ]),
    );

    expect(ids).toEqual([TABLE_A, TABLE_B, TABLE_C]);
  });
});
