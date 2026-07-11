import type { GridsWorkflowRunEvent } from "../../../lib/workflow-run-events";

export const createWorkflowRunEventBuffer = (limit = 100) => {
  const events = new Map<string, GridsWorkflowRunEvent>();
  return {
    push: (event: GridsWorkflowRunEvent) => {
      events.delete(event.run.id);
      events.set(event.run.id, event);
      while (events.size > limit) events.delete(events.keys().next().value ?? "");
    },
    take: (runId: string): GridsWorkflowRunEvent | null => {
      const event = events.get(runId) ?? null;
      events.delete(runId);
      return event;
    },
    clear: () => events.clear(),
  };
};
