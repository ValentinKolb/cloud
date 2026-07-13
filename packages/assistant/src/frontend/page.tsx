import { aiConversationStore, aiUserPrefs, listAiModels, loadAiStreamState, toPublicAiSettingsState } from "@valentinkolb/cloud/ai";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import AssistantLayoutHelp from "./AssistantLayoutHelp.island";
import AssistantWorkspace from "./AssistantWorkspace.island";
import { resolveInitialConversation } from "./initial-conversation";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);
  const requestedConversationId = url.searchParams.get("conversation") ?? undefined;
  const initialArtifactPath = url.searchParams.get("artifact");
  const [status, models, conversations, prefs] = await Promise.all([
    toPublicAiSettingsState(),
    listAiModels({ kind: "selectable", requiredCapabilities: ["streaming"] }),
    aiConversationStore.listConversations({ appId: "assistant", ownerUserId: user.id }),
    aiUserPrefs.get(user.id),
  ]);

  const initial = await resolveInitialConversation({
    requestedConversationId,
    conversations,
    loadConversation: (conversationId) => aiConversationStore.getConversation({ conversationId, appId: "assistant", ownerUserId: user.id }),
  });
  const resolvedActiveConversation = initial.activeConversation;
  if (requestedConversationId && resolvedActiveConversation?.id !== requestedConversationId) {
    return c.redirect(
      resolvedActiveConversation ? `/app/assistant?conversation=${encodeURIComponent(resolvedActiveConversation.id)}` : "/app/assistant",
      302,
    );
  }
  if (resolvedActiveConversation) {
    await aiConversationStore.markConversationViewed({
      conversationId: resolvedActiveConversation.id,
      appId: "assistant",
      ownerUserId: user.id,
    });
  }
  const activeConversation = resolvedActiveConversation
    ? { ...resolvedActiveConversation, unreadCompletion: false }
    : null;
  const initialConversations = initial.conversations.map((conversation) =>
    conversation.id === activeConversation?.id ? { ...conversation, unreadCompletion: false } : conversation,
  );
  const [initialDetail, initialTimeline] = activeConversation
    ? await Promise.all([
        loadAiStreamState(activeConversation),
        aiConversationStore.listConversationTimeline({ conversationId: activeConversation.id }),
      ])
    : [null, []];

  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Assistant" }]}>
      <AssistantLayoutHelp />
      <AssistantWorkspace
        status={status}
        models={models}
        lastModelId={prefs.lastModelId}
        initialConversations={initialConversations}
        initialConversationId={activeConversation?.id ?? null}
        initialArtifactPath={initialArtifactPath}
        initialDetail={
          initialDetail
            ? {
                conversation: initialDetail.conversation,
                messages: initialDetail.messages,
                hasMoreMessages: initialDetail.hasMoreMessages ?? false,
                activeTurn: initialDetail.activeTurn,
                timeline: initialTimeline,
              }
            : null
        }
      />
    </Layout>
  );
});
