import type { WorkflowRun, WorkflowStepRun } from "../contracts";

export type WorkflowRunStepSummary = Pick<
  WorkflowStepRun,
  "id" | "runId" | "stepIndex" | "stepPath" | "kind" | "status" | "error" | "durationMs" | "startedAt" | "finishedAt"
>;

export type WorkflowRunEventSummary = Pick<
  WorkflowRun,
  "id" | "workflowId" | "baseId" | "triggerKind" | "status" | "error" | "resultMessage" | "createdAt" | "startedAt" | "finishedAt"
>;

export type GridsWorkflowRunEvent = {
  v: 1;
  baseId: string;
  workflowId: string;
  run: WorkflowRunEventSummary;
  steps: WorkflowRunStepSummary[];
  scope: WorkflowRunEventScope;
};

export type WorkflowRunEventScope = { kind: "workflow" } | { kind: "dashboard-widget"; dashboardId: string; dashboardWidgetId: string };

export const isWorkflowRunEventVisible = (event: GridsWorkflowRunEvent, dashboard?: { id: string; widgetId: string }): boolean =>
  !dashboard ||
  (event.scope.kind === "dashboard-widget" &&
    event.scope.dashboardId === dashboard.id &&
    event.scope.dashboardWidgetId === dashboard.widgetId);

export const toWorkflowRunEventSummary = (run: WorkflowRun): WorkflowRunEventSummary => ({
  id: run.id,
  workflowId: run.workflowId,
  baseId: run.baseId,
  triggerKind: run.triggerKind,
  status: run.status,
  error: run.error,
  resultMessage: run.resultMessage,
  createdAt: run.createdAt,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
});

export const toWorkflowRunStepSummary = ({
  id,
  runId,
  stepIndex,
  stepPath,
  kind,
  status,
  error,
  durationMs,
  startedAt,
  finishedAt,
}: WorkflowStepRun): WorkflowRunStepSummary => ({
  id,
  runId,
  stepIndex,
  stepPath,
  kind,
  status,
  error,
  durationMs,
  startedAt,
  finishedAt,
});
