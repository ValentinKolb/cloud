import type { GridsWorkflowRun, GridsWorkflowStepRun } from "../workflows/contracts";

export type WorkflowRunStepSummary = Pick<
  GridsWorkflowStepRun,
  | "id"
  | "runId"
  | "key"
  | "sourcePath"
  | "iterationPath"
  | "kind"
  | "action"
  | "status"
  | "outcome"
  | "executionGeneration"
  | "startedAt"
  | "finishedAt"
>;

export type WorkflowRunEventSummary = Pick<
  GridsWorkflowRun,
  | "id"
  | "workflowId"
  | "launcherId"
  | "baseId"
  | "workflowRevision"
  | "mode"
  | "channel"
  | "status"
  | "error"
  | "resultMessage"
  | "createdAt"
  | "startedAt"
  | "finishedAt"
>;

export type GridsWorkflowRunEvent = {
  v: 1;
  baseId: string;
  workflowId: string | null;
  run: WorkflowRunEventSummary;
  steps: WorkflowRunStepSummary[];
  scope: WorkflowRunEventScope;
};

export type DashboardWorkflowRunSummary = Omit<WorkflowRunEventSummary, "error" | "resultMessage">;
export type DashboardWorkflowRunStepSummary = Omit<WorkflowRunStepSummary, "sourcePath" | "iterationPath" | "outcome">;
export type DashboardWorkflowRunEvent = Omit<GridsWorkflowRunEvent, "run" | "steps"> & {
  run: DashboardWorkflowRunSummary;
  steps: DashboardWorkflowRunStepSummary[];
};

export type WorkflowRunEventScope = { kind: "workflow" } | { kind: "dashboard-widget"; dashboardId: string; dashboardWidgetId: string };

export const isWorkflowRunEventVisible = (event: GridsWorkflowRunEvent, dashboard?: { id: string; widgetId: string }): boolean =>
  !dashboard ||
  (event.scope.kind === "dashboard-widget" &&
    event.scope.dashboardId === dashboard.id &&
    event.scope.dashboardWidgetId === dashboard.widgetId);

export const toWorkflowRunEventSummary = (run: GridsWorkflowRun): WorkflowRunEventSummary => ({
  id: run.id,
  workflowId: run.workflowId,
  launcherId: run.launcherId,
  baseId: run.baseId,
  workflowRevision: run.workflowRevision,
  mode: run.mode,
  channel: run.channel,
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
  key,
  sourcePath,
  iterationPath,
  kind,
  action,
  status,
  outcome,
  executionGeneration,
  startedAt,
  finishedAt,
}: GridsWorkflowStepRun): WorkflowRunStepSummary => ({
  id,
  runId,
  key,
  sourcePath,
  iterationPath,
  kind,
  action,
  status,
  outcome,
  executionGeneration,
  startedAt,
  finishedAt,
});

export const toDashboardWorkflowRunSummary = ({ error: _error, resultMessage: _resultMessage, ...run }: WorkflowRunEventSummary) => run;

export const toDashboardWorkflowRunStepSummary = ({
  sourcePath: _sourcePath,
  iterationPath: _iterationPath,
  outcome: _outcome,
  ...step
}: WorkflowRunStepSummary): DashboardWorkflowRunStepSummary => step;

export const toDashboardWorkflowRunEvent = (event: GridsWorkflowRunEvent): DashboardWorkflowRunEvent => ({
  ...event,
  run: toDashboardWorkflowRunSummary(event.run),
  steps: event.steps.map(toDashboardWorkflowRunStepSummary),
});

export const projectWorkflowRunEvent = (
  event: GridsWorkflowRunEvent,
  dashboard?: { id: string; widgetId: string },
): GridsWorkflowRunEvent | DashboardWorkflowRunEvent | null => {
  if (!isWorkflowRunEventVisible(event, dashboard)) return null;
  return dashboard ? toDashboardWorkflowRunEvent(event) : event;
};
