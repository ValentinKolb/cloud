export {
  activateWorkflow,
  createWorkflow,
  createWorkflowVersion,
  deactivateWorkflow,
  getWorkflow,
  getWorkflowVersion,
  listWorkflows,
  listWorkflowVersions,
  validateWorkflow,
} from "./workflow-definition-service";

import {
  backfillWorkflow as materializeBackfillWorkflow,
  dryRunWorkflow as materializeDryRunWorkflow,
  invokeWorkflow as materializeInvokeWorkflow,
  oneShotWorkflow as materializeOneShotWorkflow,
} from "./workflow-materialization-service";
import { enqueueWorkflowRun } from "./workflow-runtime";

type WithoutWake<T extends { wake?: unknown }> = Omit<T, "wake">;

export const invokeWorkflow = (params: WithoutWake<Parameters<typeof materializeInvokeWorkflow>[0]>) =>
  materializeInvokeWorkflow({ ...params, wake: enqueueWorkflowRun });
export const dryRunWorkflow = (params: WithoutWake<Parameters<typeof materializeDryRunWorkflow>[0]>) =>
  materializeDryRunWorkflow({ ...params, wake: enqueueWorkflowRun });
export const backfillWorkflow = (params: WithoutWake<Parameters<typeof materializeBackfillWorkflow>[0]>) =>
  materializeBackfillWorkflow({ ...params, wake: enqueueWorkflowRun });
export const oneShotWorkflow = (params: WithoutWake<Parameters<typeof materializeOneShotWorkflow>[0]>) =>
  materializeOneShotWorkflow({ ...params, wake: enqueueWorkflowRun });
export { preflightWorkflow } from "./workflow-preflight-service";
export { cancelWorkflowRun, getWorkflowRun, listWorkflowRuns, listWorkflowRunTargets } from "./workflow-run-service";
