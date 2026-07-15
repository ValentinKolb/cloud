import { logger } from "@valentinkolb/cloud/services";

type MailWorkflowRunDispatcher = (runId: string) => Promise<void>;

let dispatcher: MailWorkflowRunDispatcher | null = null;
const log = logger("mail:workflow-dispatch");

export const bindMailWorkflowRunDispatcher = (next: MailWorkflowRunDispatcher): void => {
  dispatcher = next;
};

export const dispatchMailWorkflowRun = async (runId: string): Promise<void> => {
  // PostgreSQL is authoritative; this port only shortens the wait until reconciliation.
  if (!dispatcher) {
    log.warn("Mail workflow run wake-up is not bound", { runId });
    return;
  }
  try {
    await dispatcher(runId);
  } catch (error) {
    log.warn("Mail workflow run wake-up failed", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
