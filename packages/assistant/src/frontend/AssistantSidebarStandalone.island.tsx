import type { AiConversation } from "@valentinkolb/cloud/ai";
import { prompts } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal } from "solid-js";
import { assistantApi } from "../api/client";
import AssistantSidebar from "./AssistantSidebar";

type Props = {
  initialConversations: AiConversation[];
  activeConversationId?: string | null;
  activeView?: "chat" | "all";
};

export default function AssistantSidebarStandalone(props: Props) {
  const [conversations, setConversations] = createSignal(props.initialConversations);
  const [activeConversationId] = createSignal(props.activeConversationId ?? null);
  const refreshCurrentPage = () => {
    if (props.activeView === "all") navigateTo(window.location.pathname + window.location.search);
  };
  const createConversationMutation = mutation.create<AiConversation, void>({
    mutation: () => assistantApi.createConversation(),
    onSuccess: (conversation) => navigateTo(`/app/assistant?conversation=${conversation.id}`),
    onError: () => void prompts.error("Failed to create chat."),
  });
  const createConversation = () => {
    if (!createConversationMutation.loading()) void createConversationMutation.mutate();
  };

  return (
    <AssistantSidebar
      conversations={conversations}
      activeConversationId={activeConversationId}
      activeView={props.activeView ?? "chat"}
      creatingConversation={createConversationMutation.loading}
      onNewConversation={createConversation}
      onConversationUpdated={(updated) => {
        setConversations((prev) => prev.map((conversation) => (conversation.id === updated.id ? updated : conversation)));
        refreshCurrentPage();
      }}
      onConversationDeleted={(deleted) => {
        setConversations((prev) => prev.filter((conversation) => conversation.id !== deleted.id));
        refreshCurrentPage();
      }}
    />
  );
}
