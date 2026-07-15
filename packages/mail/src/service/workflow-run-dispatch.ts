export type MailWorkflowRunDispatcher = (runId: string) => Promise<void>;

let dispatcher: MailWorkflowRunDispatcher | null = null;

export const bindMailWorkflowRunDispatcher = (next: MailWorkflowRunDispatcher): void => {
  dispatcher = next;
};

export const dispatchMailWorkflowRun = async (runId: string): Promise<void> => {
  if (!dispatcher) throw new Error("Mail workflow run dispatcher is not bound");
  await dispatcher(runId);
};
