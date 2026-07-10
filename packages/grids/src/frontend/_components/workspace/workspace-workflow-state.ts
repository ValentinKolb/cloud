import type { Workflow } from "../../../service";
import { gridsService } from "../../../service";
import { okState } from "./workspace-state-helpers";
import type { GridsWorkspaceState, WorkspaceCommon } from "./workspace-state-model";

export const loadWorkflowState = (
  common: WorkspaceCommon,
  requestedWorkflow: Workflow | null,
  activeWorkflowSlug?: string | null,
): GridsWorkspaceState => {
  if (activeWorkflowSlug && !requestedWorkflow) {
    return { kind: "notFound", title: "Not found", message: "Workflow not found" };
  }
  const activeWorkflow = requestedWorkflow
    ? (common.catalog.workflows.find((workflow) => workflow.id === requestedWorkflow.id) ?? null)
    : null;
  if (activeWorkflowSlug && !activeWorkflow) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to this workflow" };
  }
  if (!common.canUseQueryWorkspace && common.catalog.workflows.length === 0) {
    return { kind: "accessDenied", title: "Access denied", message: "No access to workflows" };
  }
  const level = activeWorkflow ? (common.catalog.workflowLevels[activeWorkflow.id] ?? "none") : "none";
  return okState(
    common,
    {
      kind: "workflows",
      activeWorkflow,
      canRunActiveWorkflow: gridsService.permission.hasAtLeast(level, "write"),
      canManageActiveWorkflow: gridsService.permission.hasAtLeast(level, "admin"),
      selectedRunId: common.chrome.url.searchParams.get("run"),
    },
    [
      ...common.chrome.titleBase,
      { title: "Workflows", href: `/app/grids/${common.base.shortId}/workflows` },
      ...(activeWorkflow ? [{ title: activeWorkflow.name }] : []),
    ],
  );
};
