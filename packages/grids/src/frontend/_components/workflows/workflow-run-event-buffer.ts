import type { PublicWorkflowRunEvent } from "./workflow-run-public-event";

export const createWorkflowRunEventBuffer = (limit = 100) => {
  const events = new Map<string, PublicWorkflowRunEvent>();
  return {
    push: (event: PublicWorkflowRunEvent) => {
      events.delete(event.run.id);
      events.set(event.run.id, event);
      while (events.size > limit) events.delete(events.keys().next().value ?? "");
    },
    take: (runId: string): PublicWorkflowRunEvent | null => {
      const event = events.get(runId) ?? null;
      events.delete(runId);
      return event;
    },
    clear: () => events.clear(),
  };
};
