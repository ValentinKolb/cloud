export type WorkflowRunWake = (runId: string) => Promise<void>;

export const wakeWorkflowRunBestEffort = async (input: {
  runId: string;
  wake: WorkflowRunWake;
  onError(error: unknown): void;
}): Promise<void> => {
  try {
    await input.wake(input.runId);
  } catch (error) {
    input.onError(error);
  }
};
