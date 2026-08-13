import { type AiConversationSource, type AiFileStat, aiChatTasks, aiConversations, listAiConversationFiles } from "@valentinkolb/cloud/ai";
import { type AssistantChatTask, toAssistantChatTask } from "./chat-tasks-contracts";

export type AssistantChatContextSnapshot = {
  chatId: string;
  sources: AiConversationSource[];
  files: AiFileStat[];
  tasks: AssistantChatTask[];
};

export const loadAssistantChatContextSnapshot = async (userId: string, chatId: string): Promise<AssistantChatContextSnapshot | null> => {
  const conversation = await aiConversations.getConversationByShortId({ shortId: chatId, appId: "assistant", ownerUserId: userId });
  if (!conversation) return null;
  const [sourcePage, files, tasks] = await Promise.all([
    aiConversations.listConversationSources({ conversationId: conversation.id, limit: 100 }),
    listAiConversationFiles(conversation.id),
    aiChatTasks.list({ appId: "assistant", userId, chatId, limit: 100 }),
  ]);
  return {
    chatId,
    sources: sourcePage.sources,
    files,
    tasks: tasks.map(toAssistantChatTask),
  };
};
