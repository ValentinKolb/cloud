import { type AiConversation, type AiProject, aiConversations, aiProjects } from "@valentinkolb/cloud/ai";

export type AssistantSidebarSnapshot = {
  conversations: AiConversation[];
  projects: AiProject[];
};

export const loadAssistantSidebarSnapshot = async (userId: string): Promise<AssistantSidebarSnapshot> => {
  const subject = { type: "user" as const, userId };
  const [projects, conversations] = await Promise.all([
    aiProjects.list(subject, "assistant"),
    aiConversations.listSidebarConversations({ appId: "assistant", ownerUserId: userId }),
  ]);
  const projectShortIds = await aiProjects.resolveShortIds(
    conversations.flatMap((conversation) => (conversation.projectId ? [conversation.projectId] : [])),
    "assistant",
    subject,
  );
  return {
    projects: projects.map((project) => ({ ...project, id: project.shortId })),
    conversations: conversations.map((conversation) => ({
      ...conversation,
      id: conversation.shortId,
      projectId: conversation.projectId ? (projectShortIds.get(conversation.projectId) ?? null) : null,
    })),
  };
};
