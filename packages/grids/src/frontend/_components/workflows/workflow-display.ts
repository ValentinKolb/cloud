import type { GridsWorkflowChannel, GridsWorkflowRun } from "../../../workflows/contracts";

export const channelLabels: Record<GridsWorkflowChannel, string> = {
  manual: "Manual",
  api: "API",
  cli: "CLI",
  dashboard: "Dashboard",
  scanner: "Scanner",
  bulk: "Bulk",
  schedule: "Schedule",
  recordEvent: "Record event",
  agent: "Agent",
};

export const workflowRunStatusClass = (status: GridsWorkflowRun["status"] | string) =>
  status === "succeeded"
    ? "badge-success"
    : status === "failed" || status === "canceled" || status === "needs_attention"
      ? "badge-danger"
      : "badge-neutral";

export const formatWorkflowRunDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "-");

export const formatWorkflowRunDuration = (run: Pick<GridsWorkflowRun, "startedAt" | "finishedAt">): string => {
  if (!run.startedAt || !run.finishedAt) return "-";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
};
