import { aiConversationStore, listAiModels, loadAiStreamState, toPublicAiSettingsState } from "@valentinkolb/cloud/ai";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import AssistantLayoutHelp from "./AssistantLayoutHelp.island";
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
      ? conversations.find((conversation) => conversation.id === requestedConversationId)!
      : (conversations[0] ?? null);
  const initialDetail = activeConversation ? await loadAiStreamState(activeConversation) : null;

  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Assistant" }]}>
      <AssistantLayoutHelp />
      <AssistantWorkspace
        status={status}
        models={models}
        initialConversations={conversations}
        initialConversationId={activeConversation?.id ?? null}
        initialDetail={initialDetail ? { conversation: initialDetail.conversation, messages: initialDetail.messages, activeTurn: initialDetail.activeTurn } : null}
      />
    </Layout>
  );
});
