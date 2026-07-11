import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";
import type { WorkflowRun, WorkflowStepRun } from "../contracts";
import {
  type GridsWorkflowRunEvent,
  toWorkflowRunEventSummary,
  toWorkflowRunStepSummary,
  type WorkflowRunEventScope,
} from "../lib/workflow-run-events";

const log = logger("grids:workflow-run-events");
const workflowRunTopic = topic<GridsWorkflowRunEvent>({
  id: "runs",
  prefix: "cloud:grids:workflow-runs",
  retentionMs: 24 * 60 * 60 * 1000,
  limits: { payloadBytes: 64_000 },
});

const tenantId = (baseId: string, workflowId: string): string => `${baseId}:${workflowId}`;

export const notifyWorkflowRunEvent = async (
  run: WorkflowRun,
  steps: WorkflowStepRun[] = [],
  scope: WorkflowRunEventScope = { kind: "workflow" },
): Promise<void> => {
  if (!run.workflowId) return;
  try {
    await workflowRunTopic.pub({
      tenantId: tenantId(run.baseId, run.workflowId),
      orderingKey: run.workflowId,
      idempotencyKey: `${run.id}:${run.status}:${run.finishedAt ?? run.startedAt ?? run.createdAt}`,
      data: {
        v: 1,
        baseId: run.baseId,
        workflowId: run.workflowId,
        run: toWorkflowRunEventSummary(run),
        scope,
        steps: steps.map(toWorkflowRunStepSummary),
      },
    });
  } catch (error) {
    log.warn("Workflow run update publish failed", {
      workflowId: run.workflowId,
      runId: run.id,
      status: run.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const latestWorkflowRunEventCursor = (baseId: string, workflowId: string): Promise<string | null> =>
  workflowRunTopic.latestCursor({ tenantId: tenantId(baseId, workflowId) });

export const liveWorkflowRunEvents = (config: { baseId: string; workflowId: string; after?: string | null; signal?: AbortSignal }) =>
  workflowRunTopic.live({
    tenantId: tenantId(config.baseId, config.workflowId),
    after: config.after ?? undefined,
    signal: config.signal,
  });
