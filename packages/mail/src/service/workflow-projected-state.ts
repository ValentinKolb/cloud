import type { WorkflowBoundPlan, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import type { FrozenMailWorkflowSource } from "./workflow-data";

export type MailWorkflowProjectedObject = Record<string, WorkflowJsonValue>;

export const isMailWorkflowProjectedObject = (value: WorkflowJsonValue | undefined): value is MailWorkflowProjectedObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const createMailWorkflowProjectedState = (
  plan: WorkflowBoundPlan,
  source: FrozenMailWorkflowSource,
  invocationInputs: Record<string, WorkflowJsonValue>,
): { source: FrozenMailWorkflowSource; inputs: Record<string, WorkflowJsonValue> } => {
  const projectedSource = structuredClone(source);
  const inputs: Record<string, WorkflowJsonValue> = { ...structuredClone(invocationInputs) };
  for (const input of plan.inputs) {
    if (input.type === "mailMessage") inputs[input.name] = projectedSource.message;
    else if (input.type === "mailConversation") inputs[input.name] = projectedSource.conversation;
  }
  return { source: projectedSource, inputs };
};

export const applyMailMessageTransition = (
  message: MailWorkflowProjectedObject,
  action: "addKeyword" | "removeKeyword" | "moveMessage",
  value: WorkflowJsonValue,
): boolean => {
  if (action === "moveMessage") {
    if (typeof value !== "string" || message.folderId === value) return false;
    message.folderId = value;
    return true;
  }
  if (typeof value !== "string") return false;
  const current = Array.isArray(message.keywords) ? message.keywords.filter((item): item is string => typeof item === "string") : [];
  const index = current.findIndex((item) => item.toLocaleLowerCase("und") === value.toLocaleLowerCase("und"));
  if (action === "addKeyword" && index < 0) {
    message.keywords = [...current, value].sort((left, right) => left.localeCompare(right, "und"));
    return true;
  }
  if (action === "removeKeyword" && index >= 0) {
    message.keywords = current.filter((_, itemIndex) => itemIndex !== index);
    return true;
  }
  return false;
};

export const applyMailConversationTransition = (
  conversation: MailWorkflowProjectedObject,
  action: "assignConversation" | "setConversationStatus",
  value: WorkflowJsonValue,
): boolean => {
  if (action === "assignConversation") {
    if ((typeof value !== "string" && value !== null) || conversation.assigneeUserId === value) return false;
    conversation.assigneeUserId = value;
  } else {
    if (typeof value !== "string" || conversation.workStatus === value) return false;
    conversation.status = value;
    conversation.workStatus = value;
    if (value === "done") conversation.responseNeeded = false;
  }
  conversation.revision = Number(conversation.revision ?? 0) + 1;
  return true;
};

export const mailMessageTransitionChanges = (
  message: MailWorkflowProjectedObject,
  action: "addKeyword" | "removeKeyword" | "moveMessage",
  value: WorkflowJsonValue,
): boolean => applyMailMessageTransition(structuredClone(message), action, value);

export const mailConversationTransitionChanges = (
  conversation: MailWorkflowProjectedObject,
  action: "assignConversation" | "setConversationStatus",
  value: WorkflowJsonValue,
): boolean => applyMailConversationTransition(structuredClone(conversation), action, value);
