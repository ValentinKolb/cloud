import { GRIDS_WORKFLOW_CHANNELS, GridsWorkflowRunStatsWindowSchema, GridsWorkflowRunStatusSchema } from "../../../workflows/contracts";
import type { PublicWorkflowRun, PublicWorkflowRunStats } from "../workspace/workspace-public-state-model";

export type WorkflowRunStatusFilter = "all" | PublicWorkflowRun["status"];
export type WorkflowRunChannelFilter = "all" | PublicWorkflowRun["channel"];

export type WorkflowUrlState = {
  window: PublicWorkflowRunStats["window"];
  status: WorkflowRunStatusFilter;
  channel: WorkflowRunChannelFilter;
};

export const DEFAULT_WORKFLOW_URL_STATE: WorkflowUrlState = {
  window: "24h",
  status: "all",
  channel: "all",
};

export const parseWorkflowUrlState = (params: URLSearchParams): WorkflowUrlState => {
  const windowResult = GridsWorkflowRunStatsWindowSchema.safeParse(params.get("window"));
  const statusResult = GridsWorkflowRunStatusSchema.safeParse(params.get("status"));
  const channelParam = params.get("channel");
  const channel = GRIDS_WORKFLOW_CHANNELS.find((value) => value === channelParam);

  return {
    window: windowResult.success ? windowResult.data : DEFAULT_WORKFLOW_URL_STATE.window,
    status: statusResult.success ? statusResult.data : DEFAULT_WORKFLOW_URL_STATE.status,
    channel: channel ?? DEFAULT_WORKFLOW_URL_STATE.channel,
  };
};

export const workflowUrlStateHref = (currentUrl: URL, state: WorkflowUrlState): string => {
  const url = new URL(currentUrl);
  const setOrDelete = (key: keyof WorkflowUrlState, value: string, defaultValue: string) => {
    if (value === defaultValue) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  };

  setOrDelete("window", state.window, DEFAULT_WORKFLOW_URL_STATE.window);
  setOrDelete("status", state.status, DEFAULT_WORKFLOW_URL_STATE.status);
  setOrDelete("channel", state.channel, DEFAULT_WORKFLOW_URL_STATE.channel);
  return `${url.pathname}${url.search}${url.hash}`;
};
