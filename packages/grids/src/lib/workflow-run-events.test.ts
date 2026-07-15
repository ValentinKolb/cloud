import { describe, expect, test } from "bun:test";
import { type GridsWorkflowRunEvent, isWorkflowRunEventVisible } from "./workflow-run-events";

const event = (scope: GridsWorkflowRunEvent["scope"]): GridsWorkflowRunEvent => ({
  v: 1,
  baseId: "11111111-1111-4111-8111-111111111111",
  workflowId: "22222222-2222-4222-8222-222222222222",
  run: {
    id: "33333333-3333-4333-8333-333333333333",
    workflowId: "22222222-2222-4222-8222-222222222222",
    launcherId: null,
    baseId: "11111111-1111-4111-8111-111111111111",
    workflowRevision: 1,
    mode: "execute",
    channel: "scanner",
    status: "succeeded",
    error: null,
    resultMessage: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    startedAt: "2026-07-11T00:00:00.100Z",
    finishedAt: "2026-07-11T00:00:00.200Z",
  },
  steps: [],
  scope,
});

describe("workflow run event visibility", () => {
  test("direct workflow readers can receive every run of the workflow", () => {
    expect(isWorkflowRunEventVisible(event({ kind: "workflow" }))).toBe(true);
    expect(isWorkflowRunEventVisible(event({ kind: "dashboard-widget", dashboardId: "dashboard-a", dashboardWidgetId: "widget-a" }))).toBe(
      true,
    );
  });

  test("dashboard readers receive only runs originating from their exact widget", () => {
    const dashboard = { id: "dashboard-a", widgetId: "widget-a" };
    expect(isWorkflowRunEventVisible(event({ kind: "workflow" }), dashboard)).toBe(false);
    expect(
      isWorkflowRunEventVisible(event({ kind: "dashboard-widget", dashboardId: "dashboard-b", dashboardWidgetId: "widget-a" }), dashboard),
    ).toBe(false);
    expect(
      isWorkflowRunEventVisible(event({ kind: "dashboard-widget", dashboardId: "dashboard-a", dashboardWidgetId: "widget-b" }), dashboard),
    ).toBe(false);
    expect(
      isWorkflowRunEventVisible(event({ kind: "dashboard-widget", dashboardId: "dashboard-a", dashboardWidgetId: "widget-a" }), dashboard),
    ).toBe(true);
  });
});
