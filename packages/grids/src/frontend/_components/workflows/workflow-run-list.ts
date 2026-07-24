import type { GridsWorkflowChannel, GridsWorkflowRun } from "../../../workflows/contracts";

export type WorkflowRunListFilter = {
  workflowId: string | null;
  status: GridsWorkflowRun["status"] | null;
  channel: GridsWorkflowChannel | null;
};

const matchesFilter = (run: GridsWorkflowRun, filter: WorkflowRunListFilter): boolean =>
  (!filter.workflowId || run.workflowId === filter.workflowId) &&
  (!filter.status || run.status === filter.status) &&
  (!filter.channel || run.channel === filter.channel);

export const reconcileWorkflowRunList = (
  runs: GridsWorkflowRun[],
  update: GridsWorkflowRun | null,
  filter: WorkflowRunListFilter,
  prependMissing: boolean,
): GridsWorkflowRun[] => {
  if (!update) return runs;
  const index = runs.findIndex((run) => run.id === update.id);
  if (!matchesFilter(update, filter)) return index < 0 ? runs : runs.filter((run) => run.id !== update.id);
  if (index < 0) return prependMissing ? [update, ...runs] : runs;
  return runs.map((run, runIndex) => (runIndex === index ? update : run));
};
