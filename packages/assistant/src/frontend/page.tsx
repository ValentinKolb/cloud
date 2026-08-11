import {
  aiConversationStore,
  aiProjects,
  aiUserPrefs,
  listAiModels,
  loadAiStreamState,
  toPublicAiSettingsState,
} from "@valentinkolb/cloud/ai";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { expectUserBackedActor } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import AssistantWorkspace from "./AssistantWorkspace.island";
import { resolveInitialConversation } from "./initial-conversation";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const url = new URL(c.req.raw.url);
  const requestedConversationId = url.searchParams.get("conversation") ?? undefined;
  const requestedProjectId = url.searchParams.get("project") ?? undefined;
  const projectQuery = url.searchParams.get("q")?.trim() ?? "";
  const initialArtifactPath = url.searchParams.get("artifact");
  const subject = { type: "user" as const, userId: user.id };
  const [status, models, conversations, prefs, projects] = await Promise.all([
    toPublicAiSettingsState(),
    listAiModels({ kind: "selectable", requiredCapabilities: ["streaming"] }),
    aiConversationStore.listConversations({ appId: "assistant", ownerUserId: user.id }),
    aiUserPrefs.get(user.id),
    aiProjects.list(subject),
  ]);
  const activeProject = requestedProjectId ? (projects.find((project) => project.shortId === requestedProjectId) ?? null) : null;
  if (requestedProjectId && !activeProject) return c.redirect("/app/assistant", 302);
  const projectChats = activeProject
    ? await aiConversationStore.listConversationsPage({
        appId: "assistant",
        ownerUserId: user.id,
        projectId: activeProject.id,
        search: projectQuery || undefined,
        page: 1,
        perPage: 20,
      })
    : null;

  const initial = activeProject
    ? { activeConversation: null, conversations }
    : await resolveInitialConversation({
        requestedConversationId,
        conversations,
        loadConversation: (shortId) => aiConversationStore.getConversationByShortId({ shortId, appId: "assistant", ownerUserId: user.id }),
      });
  const resolvedActiveConversation = initial.activeConversation;
  if (requestedConversationId && resolvedActiveConversation?.shortId !== requestedConversationId) {
    return c.redirect(
      resolvedActiveConversation
        ? `/app/assistant?conversation=${encodeURIComponent(resolvedActiveConversation.shortId)}`
        : "/app/assistant",
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
  const activeConversation = resolvedActiveConversation ? { ...resolvedActiveConversation, unreadCompletion: false } : null;
  const projectShortId = (projectId: string | null) => projects.find((project) => project.id === projectId)?.shortId ?? null;
  const initialConversations = initial.conversations.map((conversation) => ({
    ...conversation,
    id: conversation.shortId,
    projectId: projectShortId(conversation.projectId),
    ...(conversation.id === activeConversation?.id ? { unreadCompletion: false } : {}),
  }));
  const [initialDetail, initialTimeline] = activeConversation
    ? await Promise.all([
        loadAiStreamState(activeConversation),
        aiConversationStore.listConversationTimeline({ conversationId: activeConversation.id }),
      ])
    : [null, []];

  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Assistant" }]}>
      <AssistantWorkspace
        status={status}
        models={models}
        lastModelId={prefs.lastModelId}
        initialConversations={initialConversations}
        initialConversationId={activeConversation?.shortId ?? null}
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
        projects={projects.map((project) => ({ ...project, id: project.shortId }))}
        initialProject={activeProject ? { ...activeProject, id: activeProject.shortId } : null}
        initialProjectQuery={projectQuery}
        initialProjectChats={
          projectChats ? { ...projectChats, items: projectChats.items.map((chat) => ({ ...chat, id: chat.shortId })) } : null
        }
      />
    </Layout>
  );
});
