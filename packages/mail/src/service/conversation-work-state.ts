import type { ConversationWorkStatus, DraftIntent } from "../contracts";

export type ConversationMessageTransition = {
  direction: "inbound" | "outbound";
  intent: DraftIntent | "observed_reply" | "observed_message";
  automatic: boolean;
};

type ConversationWorkStateTransition = {
  workStatus: ConversationWorkStatus;
  clearSnooze: boolean;
};

export const isAutomaticSubmission = (value: string | null | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && normalized !== "no");
};

export const deriveConversationWorkState = (
  current: ConversationWorkStatus,
  event: ConversationMessageTransition,
): ConversationWorkStateTransition => {
  if (event.direction === "inbound") return { workStatus: "needs_action", clearSnooze: true };

  const reply = event.intent === "reply" || event.intent === "reply_all" || event.intent === "observed_reply";
  if (reply && !event.automatic) return { workStatus: "waiting", clearSnooze: false };

  return { workStatus: current, clearSnooze: false };
};

export const deriveReopenedConversationWorkStatus = (latest: ConversationMessageTransition | null): ConversationWorkStatus =>
  latest ? deriveConversationWorkState("needs_action", latest).workStatus : "needs_action";
