import { openSpotlightSearch, type PromptSearchItem } from "@k2b/ui";
import type { AiConversationTimelineEntry, AiStoredMessage } from "@valentinkolb/cloud/ai";
import { assistantApi } from "../api/client";

const messageText = (stored: AiStoredMessage): string => {
  if (stored.message.role === "tool_result") return "";
  return stored.message.content
    .flatMap((part) => (typeof part === "string" ? [part] : part.type === "text" ? [part.text] : []))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
};

const messageKind = (message: AiStoredMessage): { label: string; icon: string } => {
  if (message.kind === "summary") return { label: "Context summary", icon: "ti ti-brain" };
  if (message.message.role === "user") return { label: "You", icon: "ti ti-user" };
  if (message.message.role === "assistant") return { label: "Assistant", icon: "ti ti-sparkles" };
  return { label: "System", icon: "ti ti-info-circle" };
};

export const assistantMessageSearchItem = (message: AiStoredMessage): PromptSearchItem<AiStoredMessage> => {
  const kind = messageKind(message);
  return {
    value: message,
    label: messageText(message) || `${kind.label} message`,
    desc: `${kind.label} · Message ${message.seq}`,
    icon: kind.icon,
  };
};

export const assistantMessageAnchorSeq = (message: AiStoredMessage, timeline: readonly AiConversationTimelineEntry[]): number => {
  if (message.message.role === "user") return message.seq;
  const sameTurn = message.loopId ? timeline.find((entry) => entry.loopId === message.loopId) : undefined;
  if (sameTurn) return sameTurn.seq;
  return timeline.findLast((entry) => entry.seq <= message.seq)?.seq ?? message.seq;
};

export const openAssistantChatMessageSearch = async (conversationId: string): Promise<AiStoredMessage | undefined> => {
  const selected = await openSpotlightSearch<AiStoredMessage>({
    title: "Search this chat",
    placeholder: "Search messages…",
    minQueryLength: 1,
    emptyText: "Type to search this chat.",
    noResultsText: "No matching messages.",
    resolve: async ({ query, abortSignal }) => {
      const page = await assistantApi.searchMessages({
        conversationId,
        q: query.trim(),
        limit: 20,
        signal: abortSignal,
      });
      return page.messages.map(assistantMessageSearchItem);
    },
  });
  return selected?.value;
};
