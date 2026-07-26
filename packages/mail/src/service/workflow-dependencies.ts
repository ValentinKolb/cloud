import { logger } from "@valentinkolb/cloud/services";
import type { WorkflowDependency } from "@valentinkolb/cloud/workflows";
import { wakeWorkflowRunsWaitingOn } from "@valentinkolb/cloud/workflows/store";

const log = logger("mail:workflow-dependencies");

/**
 * Dependency wake-up is a latency hint. The kernel also reconciles expired
 * waits from Postgres, so a transient wake failure never changes correctness.
 */
export const publishMailWorkflowDependency = async (input: { mailboxId: string; dependency: WorkflowDependency }): Promise<void> => {
  try {
    await wakeWorkflowRunsWaitingOn({ appId: "mail", ...input.dependency });
  } catch (error) {
    log.warn("Failed to wake Mail workflow dependency", {
      mailboxId: input.mailboxId,
      kind: input.dependency.kind,
      key: input.dependency.key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
