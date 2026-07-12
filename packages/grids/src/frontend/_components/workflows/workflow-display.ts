import type { WorkflowRun, WorkflowTriggerKind } from "../../../contracts";

export const triggerLabels: Record<WorkflowTriggerKind, string> = {
  form: "Form",
  api: "API",
  scanner: "Scanner",
  bulkSelection: "Bulk",
  dashboardButton: "Dashboard",
  schedule: "Schedule",
  recordEvent: "Record event",
};

export const workflowRunStatusClass = (status: WorkflowRun["status"]) =>
  status === "succeeded" ? "badge-success" : status === "failed" || status === "canceled" ? "badge-danger" : "badge-neutral";

export const formatWorkflowRunDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "-");

export const formatWorkflowRunDuration = (run: WorkflowRun): string => {
  if (!run.startedAt || !run.finishedAt) return "-";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
};
