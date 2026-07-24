import { z } from "zod";
import type { Workflow } from "../../../service";
import { gridsService } from "../../../service";
import { getWorkflowRunStats, listWorkflowRunsPage, listWorkflowStepRuns } from "../../../service/workflow-kernel-observability";
import type { GridsWorkflowRun } from "../../../workflows/contracts";
import { parseWorkflowUrlState } from "../workflows/workflow-url-state";
import { okState } from "./workspace-state-helpers";
import type { GridsWorkspaceState, WorkspaceCommon, WorkspaceWorkflowRunDetail } from "./workspace-state-model";

const WORKFLOW_PAGE_SIZE = 50;
const RUN_DOCUMENT_LIMIT = 100;

export const workflowOverviewRedirectHref = (currentUrl: URL, baseShortId: string, workflowShortId: string): string => {
  const url = new URL(currentUrl);
  url.pathname = `/app/grids/${encodeURIComponent(baseShortId)}/workflows/${encodeURIComponent(workflowShortId)}`;
  url.searchParams.delete("run");
  return `${url.pathname}${url.search}`;
};

export const loadWorkflowRunDetail = async (run: GridsWorkflowRun): Promise<WorkspaceWorkflowRunDetail> => {
  const [steps, documents] = await Promise.all([
    listWorkflowStepRuns(run.id),
    gridsService.document.listRunsForWorkflowRun(run.id, { limit: RUN_DOCUMENT_LIMIT }),
  ]);
  return {
    run,
    steps,
    documents: {
      items: documents.items,
      total: documents.total ?? documents.items.length,
      hasMore: documents.hasMore ?? false,
      nextOffset: documents.nextOffset ?? null,
    },
  };
};

const loadSelectedRun = async (selectedRunId: string | null, visibleWorkflowIds: string[]): Promise<WorkspaceWorkflowRunDetail | null> => {
  if (!selectedRunId || !z.string().uuid().safeParse(selectedRunId).success) return null;
  const run = await gridsService.workflow.getRun(selectedRunId);
  if (!run?.workflowId || !visibleWorkflowIds.includes(run.workflowId)) return null;
  return loadWorkflowRunDetail(run);
};

export const loadWorkflowState = async (
  common: WorkspaceCommon,
  requestedWorkflow: Workflow | null,
  activeWorkflowSlug?: string | null,
): Promise<GridsWorkspaceState> => {
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
  if (!activeWorkflowSlug && common.catalog.workflows.length > 0) {
    const target = common.catalog.workflows[0]!;
    return {
      kind: "redirect",
      href: workflowOverviewRedirectHref(common.chrome.url, common.base.shortId, target.shortId),
    };
  }
  const level = activeWorkflow ? (common.catalog.workflowLevels[activeWorkflow.id] ?? "none") : "none";
  const selectedRunId = common.chrome.url.searchParams.get("run");
  const visibleWorkflowIds = common.catalog.workflows.map((workflow) => workflow.id);
  const filters = parseWorkflowUrlState(common.chrome.url.searchParams);
  const [stats, runs, launchers, initialSelectedRun] = await Promise.all([
    getWorkflowRunStats(common.base.id, visibleWorkflowIds, { window: filters.window }),
    listWorkflowRunsPage({
      baseId: common.base.id,
      workflowIds: visibleWorkflowIds,
      workflowId: activeWorkflow?.id,
      status: filters.status === "all" ? undefined : filters.status,
      channel: filters.channel === "all" ? undefined : filters.channel,
      limit: WORKFLOW_PAGE_SIZE,
    }),
    activeWorkflow ? gridsService.workflow.launcher.list(activeWorkflow.id) : Promise.resolve([]),
    loadSelectedRun(selectedRunId, visibleWorkflowIds),
  ]);
  return okState(
    common,
    {
      kind: "workflows",
      activeWorkflow,
      canRunActiveWorkflow: gridsService.permission.hasAtLeast(level, "write"),
      canManageActiveWorkflow: gridsService.permission.hasAtLeast(level, "admin"),
      selectedRunId: initialSelectedRun?.run.id ?? null,
      initialOverview: { filters, stats, runs, launchers },
      initialSelectedRun,
    },
    [...common.chrome.titleBase, { title: "Workflows" }, ...(activeWorkflow ? [{ title: activeWorkflow.name }] : [])],
  );
};
