import type { AiConversation } from "@valentinkolb/cloud/ai";
import { prompts } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { createSignal } from "solid-js";
import { apiClient } from "../api/client";
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
  const createConversation = async () => {
    const response = await apiClient.conversations.$post({ json: {} });
    if (!response.ok) {
      await prompts.error("Failed to create chat.");
      return;
    }
    const conversation = (await response.json()) as AiConversation;
    navigateTo(`/app/assistant?conversation=${conversation.id}`);
  };

  return (
    <AssistantSidebar
      conversations={conversations}
      activeConversationId={activeConversationId}
      activeView={props.activeView ?? "chat"}
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
