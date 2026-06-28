import { aiConversationStore, listAiModels, listPendingAiTurnActions, toPublicAiSettingsState } from "@valentinkolb/cloud/ai";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import AssistantWorkspace from "./AssistantWorkspace.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);
  const requestedConversationId = url.searchParams.get("conversation") ?? undefined;
  const [status, models, conversations] = await Promise.all([
    toPublicAiSettingsState(),
    listAiModels({ kind: "selectable", requiredCapabilities: ["streaming"] }),
    aiConversationStore.listConversations({ appId: "assistant", ownerUserId: user.id }),
  ]);

  const activeConversation =
    requestedConversationId && conversations.some((conversation) => conversation.id === requestedConversationId)
      ? requestedConversationId
      : (conversations[0]?.id ?? null);
  const [messages, activeTurn] = activeConversation
    ? await Promise.all([
        aiConversationStore.listMessages({ conversationId: activeConversation }),
        aiConversationStore.getRunningTurn({ conversationId: activeConversation }),
      ])
    : [[], null];
  const pendingActions =
    activeConversation && activeTurn ? listPendingAiTurnActions({ conversationId: activeConversation, turnId: activeTurn.id }) : [];

  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Assistant" }]}>
      <AssistantWorkspace
        status={status}
        models={models}
        initialConversations={conversations}
        initialConversationId={activeConversation}
        initialMessages={messages}
        initialActiveTurn={activeTurn}
        initialPendingActions={pendingActions}
      />
    </Layout>
  );
});
