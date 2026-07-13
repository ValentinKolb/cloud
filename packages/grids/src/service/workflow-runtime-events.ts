import { logger } from "@valentinkolb/cloud/services";
import { topic } from "@valentinkolb/sync";

const log = logger("grids:workflow-runtime-events");
const TENANT_ID = "global";

type WorkflowRuntimeEvent = {
  workflowId: string;
};

const workflowRuntimeTopic = topic<WorkflowRuntimeEvent>({
  id: "runtime-sync",
  prefix: "cloud:grids:workflows",
  tenantId: TENANT_ID,
  retentionMs: 24 * 60 * 60 * 1000,
  limits: { payloadBytes: 1_000 },
});

export const emitWorkflowRuntimeEvent = async (workflowId: string): Promise<void> => {
  try {
    await workflowRuntimeTopic.pub({
      tenantId: TENANT_ID,
      orderingKey: workflowId,
      data: { workflowId },
    });
  } catch (error) {
    log.warn("Failed to publish workflow runtime event", {
      workflowId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const latestWorkflowRuntimeEventCursor = (): Promise<string | null> => workflowRuntimeTopic.latestCursor({ tenantId: TENANT_ID });

export const liveWorkflowRuntimeEvents = (config: { after?: string | null; signal?: AbortSignal }) =>
  workflowRuntimeTopic.live({
    tenantId: TENANT_ID,
    after: config.after ?? "0-0",
    signal: config.signal,
  });
