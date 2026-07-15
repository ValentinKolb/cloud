import { describe, expect, test } from "bun:test";
import {
  type GridsWorkflowRunEvent,
  isWorkflowRunEventVisible,
  projectWorkflowRunEvent,
  toDashboardWorkflowRunEvent,
} from "./workflow-run-events";

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

  test("dashboard projection removes internal errors, messages, paths, and outcomes", () => {
    const source = event({ kind: "dashboard-widget", dashboardId: "dashboard-a", dashboardWidgetId: "widget-a" });
    source.run.error = { code: "SECRET", message: "internal detail", retryable: false };
    source.run.resultMessage = "private result";
    source.steps = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        runId: source.run.id,
        key: "steps.0",
        sourcePath: ["steps", 0],
        iterationPath: [2],
        kind: "action",
        action: "httpRequest",
        status: "failed",
        outcome: { secret: "response body" },
        executionGeneration: 1,
        startedAt: source.run.startedAt,
        finishedAt: source.run.finishedAt,
      },
    ];

    const projected = toDashboardWorkflowRunEvent(source);

    expect(projected.run).not.toHaveProperty("error");
    expect(projected.run).not.toHaveProperty("resultMessage");
    expect(projected.steps[0]).not.toHaveProperty("sourcePath");
    expect(projected.steps[0]).not.toHaveProperty("iterationPath");
    expect(projected.steps[0]).not.toHaveProperty("outcome");
    expect(projectWorkflowRunEvent(source, { id: "dashboard-a", widgetId: "widget-a" })).toEqual(projected);
    expect(projectWorkflowRunEvent(source, { id: "dashboard-b", widgetId: "widget-a" })).toBeNull();
  });
});
