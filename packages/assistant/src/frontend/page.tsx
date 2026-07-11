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
  const activeConversation = initial.activeConversation;
  if (requestedConversationId && activeConversation?.id !== requestedConversationId) {
    return c.redirect(
      activeConversation ? `/app/assistant?conversation=${encodeURIComponent(activeConversation.id)}` : "/app/assistant",
      302,
    );
  }
  const initialDetail = activeConversation ? await loadAiStreamState(activeConversation) : null;

  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Assistant" }]}>
      <AssistantLayoutHelp />
      <AssistantWorkspace
        status={status}
        models={models}
        lastModelId={prefs.lastModelId}
        initialConversations={initial.conversations}
        initialConversationId={activeConversation?.id ?? null}
        initialDetail={
          initialDetail
            ? {
                conversation: initialDetail.conversation,
                messages: initialDetail.messages,
                hasMoreMessages: initialDetail.hasMoreMessages ?? false,
                activeTurn: initialDetail.activeTurn,
              }
            : null
        }
      />
    </Layout>
  );
});
