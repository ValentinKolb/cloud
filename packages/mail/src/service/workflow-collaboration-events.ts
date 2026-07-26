import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import type { MailConversationChangedEvent } from "./events";
import { publishMailCollaborationEvent } from "./events";

const EVENT_KEY = "__mailCollaborationEvent";
type CollaborationEvent = Omit<MailConversationChangedEvent, "type" | "at">;

export const withMailWorkflowCollaborationEvent = (
  output: Record<string, WorkflowJsonValue>,
  event: CollaborationEvent | null,
): Record<string, WorkflowJsonValue> => (event ? { ...output, [EVENT_KEY]: event as unknown as WorkflowJsonValue } : output);

export const publishMailWorkflowCollaborationEventFromOutput = async (output: WorkflowJsonValue | undefined): Promise<void> => {
  if (!output || typeof output !== "object" || Array.isArray(output)) return;
  const event = output[EVENT_KEY];
  if (!event || typeof event !== "object" || Array.isArray(event)) return;
  if (
    typeof event.mailboxId !== "string" ||
    typeof event.conversationId !== "string" ||
    typeof event.reason !== "string" ||
    typeof event.activityId !== "string"
  ) {
    return;
  }
  await publishMailCollaborationEvent(event as unknown as CollaborationEvent);
};
