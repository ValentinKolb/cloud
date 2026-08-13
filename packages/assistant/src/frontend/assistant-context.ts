import type { AiConversationSource } from "@valentinkolb/cloud/ai";
import type { AssistantChatContextSnapshot } from "../chat-context";

export const splitAssistantConversationSources = (items: AiConversationSource[]) => ({
  sources: items.filter((item) => item.kind === "web" || item.kind === "activity"),
  references: items.filter((item) => item.kind === "resource"),
});

export const assistantChatContextFor = (
  chatId: string,
  snapshot: AssistantChatContextSnapshot | null | undefined,
): AssistantChatContextSnapshot | null => (snapshot?.chatId === chatId ? snapshot : null);
