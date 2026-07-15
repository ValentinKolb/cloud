import { logger } from "@valentinkolb/cloud/services";
import type { WorkflowRunWake } from "@valentinkolb/cloud/workflows/runtime";
import { wakeWorkflowRunBestEffort } from "@valentinkolb/cloud/workflows/runtime";

const log = logger("mail:workflow-wake");

export const wakeMailWorkflowRun = async (wake: WorkflowRunWake, runId: string): Promise<void> => {
  await wakeWorkflowRunBestEffort({
    runId,
    wake,
    onError: (error) => {
      log.warn("Mail workflow run wake-up failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
};
