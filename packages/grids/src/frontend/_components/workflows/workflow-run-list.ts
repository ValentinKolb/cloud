import type { PublicWorkflowRun } from "../workspace/workspace-public-state-model";

export type WorkflowRunListFilter = {
  workflowId: string | null;
  status: PublicWorkflowRun["status"] | null;
  channel: PublicWorkflowRun["channel"] | null;
};

const matchesFilter = (run: PublicWorkflowRun, filter: WorkflowRunListFilter): boolean =>
  (!filter.workflowId || run.workflowId === filter.workflowId) &&
  (!filter.status || run.status === filter.status) &&
  (!filter.channel || run.channel === filter.channel);

export const reconcileWorkflowRunList = (
  runs: PublicWorkflowRun[],
  update: PublicWorkflowRun | null,
  filter: WorkflowRunListFilter,
  prependMissing: boolean,
): PublicWorkflowRun[] => {
  if (!update) return runs;
  const index = runs.findIndex((run) => run.id === update.id);
  if (!matchesFilter(update, filter)) return index < 0 ? runs : runs.filter((run) => run.id !== update.id);
  if (index < 0) return prependMissing ? [update, ...runs] : runs;
  return runs.map((run, runIndex) => (runIndex === index ? update : run));
};
