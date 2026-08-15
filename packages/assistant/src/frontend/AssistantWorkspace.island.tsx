import { navigate, navigateTo } from "@k2b/ssr/nav";
import { mutation, query } from "@k2b/stdlib/solid";
import { AppWorkspace, Button, Chat } from "@k2b/ui";
import type {
  AiConversation,
  AiConversationPage,
  AiConversationTimelineEntry,
  AiProject,
  AiPublicModelProfile,
  AiSettingsError,
  AiStoredMessage,
} from "@valentinkolb/cloud/ai";
import { type AiLiveServerMessage, parseAiLiveServerMessage } from "@valentinkolb/cloud/ai/live-events";
import { createAiChatController } from "@valentinkolb/cloud/ai/solid";
import {
  AiChatActionsProvider,
  AiChatTurnNavigator,
  type AiComposerAttachment,
  type AiComposerSendInput,
  aiChatAttachments,
  aiChatModelOptions,
  aiComposerAttachmentRecords,
  aiComposerFileAccept,
  aiComposerSendInput,
  aiLatestUsageSnapshot,
  createAiChatTimeline,
  readAiComposerFiles,
} from "@valentinkolb/cloud/ai/ui";
import { createLiveWebSocket, type LiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { assistantApi } from "../api/client";
import type { AssistantChatContextSnapshot } from "../chat-context";
import type { AssistantProjectContextSnapshot } from "../project-context";
import type { AssistantSidebarSnapshot } from "../sidebar";
import { openAssistantFilesDialog } from "./AssistantArtifactDetail";
import { AssistantChatContextPanel, assistantChatContextHasPanel, openAssistantChatContextDialog } from "./AssistantChatContext";
import { openAssistantChatDiscoveryDialog } from "./AssistantChatDiscoveryDialog";
import { openAssistantCreateProjectDialog } from "./AssistantProjectsDialog";
import AssistantProjectView from "./AssistantProjectView";
import AssistantSidebar from "./AssistantSidebar";
import {
  type AssistantLiveInvalidation,
  AssistantLiveProvider,
  createAssistantLiveInvalidationHub,
  matchesAssistantInvalidation,
} from "./assistant-live";
import {
  assistantArtifactHref,
  assistantArtifactPathFromHref,
  assistantConversationHref,
  assistantConversationIdFromHref,
  assistantProjectHref,
  assistantProjectIdFromHref,
  assistantProjectQueryFromHref,
} from "./assistant-navigation";
import { submitAssistantProjectMessage } from "./assistant-project-chat";

type Status = {
  ok: boolean;
  enabled: boolean;
  defaultModelId: string;
  visionModelConfigured: boolean;
  error: AiSettingsError | null;
  models: AiPublicModelProfile[];
};

type InitialDetail = {
  conversation: AiConversation;
  messages: AiStoredMessage[];
  hasMoreMessages?: boolean;
  activeTurn: import("@valentinkolb/cloud/ai").AiTurnSnapshot | null;
  timeline?: AiConversationTimelineEntry[];
};

type Props = {
  status: Status;
  models: AiPublicModelProfile[];
  /** Model of the user's most recent turn (any chat) — preselected for new chats. */
  lastModelId: string;
  initialLiveCursor: string;
  initialConversations: AiConversation[];
  initialConversationId: string | null;
  initialArtifactPath: string | null;
  initialDetail: InitialDetail | null;
  initialContext: AssistantChatContextSnapshot | null;
  projects: AiProject[];
  initialProject: AiProject | null;
  initialProjectQuery: string;
  initialProjectChats: AiConversationPage | null;
  initialProjectContext: AssistantProjectContextSnapshot | null;
};

type ProjectViewState = {
  projectId: string;
  query: string;
  page: AiConversationPage;
  context: AssistantProjectContextSnapshot;
};

export default function AssistantWorkspace(props: Props) {
  const isSelectable = (modelId: string | null | undefined): modelId is string =>
    Boolean(modelId && props.models.some((model) => model.id === modelId));

  const chat = createAiChatController({
    baseUrl: "/api/assistant",
    initialConversationId: props.initialConversationId,
    initialDetail: props.initialDetail,
    initialTimeline: props.initialDetail?.timeline,
    initialError: props.status.error?.message ?? null,
    trackViewedState: true,
  });

  const sidebar = query.create<string, AssistantSidebarSnapshot, AssistantLiveInvalidation>({
    source: () => "/api/assistant/workspace/sidebar",
    initial: {
      source: "/api/assistant/workspace/sidebar",
      data: { conversations: props.initialConversations, projects: props.projects },
    },
    load: (_source, { abortSignal }) => assistantApi.loadSidebar(abortSignal),
  });
  const conversations = () => sidebar.data()?.conversations ?? props.initialConversations;
  const projects = () => sidebar.data()?.projects ?? props.projects;
  const [projectView, setProjectView] = createSignal<ProjectViewState | null>(
    props.initialProject && props.initialProjectChats && props.initialProjectContext
      ? {
          projectId: props.initialProject.id,
          query: props.initialProjectQuery,
          page: props.initialProjectChats,
          context: props.initialProjectContext,
        }
      : null,
  );
  const activeProject = () => {
    const projectId = projectView()?.projectId;
    return projectId ? (projects().find((project) => project.id === projectId) ?? null) : null;
  };

  let liveSocket: LiveWebSocket | null = null;
  const [liveError, setLiveError] = createSignal<string | null>(null);
  const liveHub = createAssistantLiveInvalidationHub({
    onApplied: (cursor) => {
      setLiveError(null);
      liveSocket?.markApplied(cursor);
    },
    onFailed: () => setLiveError("Live updates could not be refreshed. Retrying…"),
  });
  const unregisterSidebar = liveHub.register({
    matches: matchesAssistantInvalidation(["conversation-list", "project-list"]),
    invalidate: (invalidation) => sidebar.invalidate(invalidation),
  });
  const unregisterConversation = liveHub.register({
    matches: (invalidation) => {
      if (!invalidation.domains.has("conversation-detail")) return false;
      const conversationId = chat.activeConversationId();
      return Boolean(conversationId && (!invalidation.conversationIds || invalidation.conversationIds.has(conversationId)));
    },
    invalidate: () => chat.refreshActiveConversation(),
  });
  let subscribeCount = 0;
  liveSocket = createLiveWebSocket<AiLiveServerMessage>({
    url: "/api/assistant/live",
    initialCursor: props.initialLiveCursor,
    subscribe: (cursor) => ({
      type: "ai.live.subscribe",
      payload: { fromCursor: cursor, recover: subscribeCount++ > 0 },
    }),
    parse: parseAiLiveServerMessage,
    onMessage: (message) => {
      if (message.type === "ai.live.event") liveHub.scheduleEvent(message.payload.cursor, message.payload.event);
      else if (message.type === "ai.live.scope_changed") liveHub.scheduleScopeRefresh();
      else if (message.type === "ai.live.ready" && message.payload.recovered) {
        liveHub.scheduleScopeRefresh(message.payload.cursor);
      }
    },
    onFatal: (error) => setLiveError(error.message),
  });
  onMount(() => liveSocket?.connect());
  onCleanup(() => {
    unregisterSidebar();
    unregisterConversation();
    liveHub.dispose();
    liveSocket?.dispose();
  });

  // Model selection is per chat: an explicit pick only applies to the chat it
  // was made in. Without a pick, a chat shows the model of its own last
  // assistant turn; new chats start on the user's last-used model.
  const projectComposerKey = (projectId: string) => `project:${projectId}`;
  const [modelChoices, setModelChoices] = createSignal<Record<string, string>>({});
  const modelSessionKey = () => chat.activeConversationId() ?? (activeProject() ? projectComposerKey(activeProject()!.id) : "__new__");
  const modelOfActiveChat = createMemo(() => {
    if (!chat.activeConversationId()) return null;
    const entry = chat
      .messages()
      .findLast((message) => message.kind === "message" && message.message.role === "assistant" && isSelectable(message.modelProfileId));
    return entry?.modelProfileId ?? null;
  });
  const fallbackModelId = () => {
    if (isSelectable(props.lastModelId)) return props.lastModelId;
    if (isSelectable(props.status.defaultModelId)) return props.status.defaultModelId;
    return props.models[0]?.id ?? "";
  };
  const selectedModelId = createMemo(() => {
    const explicit = modelChoices()[modelSessionKey()];
    if (isSelectable(explicit)) return explicit;
    return modelOfActiveChat() ?? fallbackModelId();
  });
  const setSelectedModelId = (modelId: string) => {
    const key = modelSessionKey();
    setModelChoices((current) => ({ ...current, [key]: modelId }));
  };

  const [composerFocusToken, setComposerFocusToken] = createSignal(0);
  const [composerDrafts, setComposerDrafts] = createSignal<Record<string, string>>({});
  const [composerAttachments, setComposerAttachments] = createSignal<Record<string, AiComposerAttachment[]>>({});
  const [pendingProjectChats, setPendingProjectChats] = createSignal<Record<string, AiConversation>>({});
  const [filesDialogOpen, setFilesDialogOpen] = createSignal(false);
  const [chatContextPresence, setChatContextPresence] = createSignal<boolean | null>(
    props.initialContext
      ? assistantChatContextHasPanel(props.initialContext, Boolean(props.initialDetail?.conversation.projectId))
      : props.initialDetail?.conversation.projectId
        ? true
        : null,
  );
  const [timelineViewport, setTimelineViewport] = createSignal<HTMLDivElement>();
  const [timelineContent, setTimelineContent] = createSignal<HTMLDivElement>();

  createEffect(() => {
    const conversationId = chat.activeConversationId();
    const conversation = conversations().find((item) => item.id === conversationId) ?? chat.conversation();
    const hasProject = Boolean(conversation?.projectId);
    setChatContextPresence(
      props.initialContext?.chatId === conversationId
        ? assistantChatContextHasPanel(props.initialContext, hasProject)
        : hasProject
          ? true
          : null,
    );
  });

  const canUseComposer = createMemo(() => props.status.ok && props.status.enabled && props.models.length > 0);
  const usageSnapshot = createMemo(() => aiLatestUsageSnapshot(chat.messages()));
  const usageModel = createMemo(() => {
    const snapshot = usageSnapshot();
    const modelId = snapshot ? snapshot.modelProfileId : selectedModelId();
    return props.models.find((model) => model.id === modelId) ?? null;
  });
  const composerSessionKey = () => chat.activeConversationId() ?? (activeProject() ? projectComposerKey(activeProject()!.id) : "__new__");
  const composerDraft = (key: string) => composerDrafts()[key] ?? "";
  const setComposerDraft = (key: string, value: string) => setComposerDrafts((current) => ({ ...current, [key]: value }));
  const composerAttachmentsFor = (key: string) => composerAttachments()[key] ?? [];
  const setComposerAttachmentsFor = (key: string, attachments: AiComposerAttachment[]) =>
    setComposerAttachments((current) => ({ ...current, [key]: attachments }));
  const selectedModel = createMemo(() => props.models.find((model) => model.id === selectedModelId()) ?? null);
  const acceptsImages = () =>
    Boolean(
      selectedModel()?.capabilities.includes("vision") ||
        (selectedModel()?.capabilities.includes("tools") && props.status.visionModelConfigured),
    );
  const focusComposer = () => setComposerFocusToken((value) => value + 1);
  const commitConversationUrl = (conversationId: string, replace = false) => {
    const href = assistantConversationHref(window.location.href, conversationId);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (href === current) return;
    navigate(href, { replace, scroll: "manual", viewTransition: false });
  };
  const newConversation = mutation.create<AiConversation | null, { focus: boolean; projectId?: string; navigate?: boolean }>({
    mutation: async ({ focus, projectId, navigate: shouldNavigate = true }) => {
      const conversation = await chat.createConversation(projectId ? { projectId } : undefined);
      if (conversation && chat.activeConversationId() === conversation.id) {
        if (shouldNavigate) {
          setProjectView(null);
          commitConversationUrl(conversation.id);
        }
        if (focus) focusComposer();
      }
      return conversation;
    },
  });
  const createConversation = async (focus: boolean, projectId?: string, shouldNavigate = true) => {
    if (newConversation.loading()) return null;
    await newConversation.mutate({ focus, projectId, navigate: shouldNavigate });
    return newConversation.data();
  };
  const createAndFocusConversation = () => createConversation(true);
  const canSend = createMemo(
    () => canUseComposer() && !newConversation.loading() && !chat.loadingConversation() && !chat.running() && !chat.activeTurn(),
  );
  let navigationRequest = 0;
  const openAndFocusConversation = async (conversationId: string) => {
    const requestId = ++navigationRequest;
    const result = await chat.openConversation(conversationId);
    if (result === "failed") throw new Error("Failed to open conversation");
    if (result === "stale" || requestId !== navigationRequest) return false;
    setProjectView(null);
    if (chat.activeConversationId() === conversationId) focusComposer();
    return true;
  };
  const openProject = async (projectId: string, query = "") => {
    const project = projects().find((item) => item.id === projectId);
    if (!project) throw new Error("Project not found");
    const requestId = ++navigationRequest;
    const [page, context] = await Promise.all([
      assistantApi.listConversationsPage({ projectId, q: query || undefined, page: 1, perPage: 20 }),
      assistantApi.loadProjectContext(projectId),
    ]);
    if (requestId !== navigationRequest) return false;
    setProjectView({ projectId, query, page, context });
    return true;
  };
  const filesRefreshKey = createMemo(() => {
    const toolStates =
      chat
        .activeTurn()
        ?.blocks.filter((block) => block.kind === "tool")
        .map((block) => `${block.id}:${block.status}`)
        .join("|") ?? "";
    return `${chat.activeConversationId() ?? ""}:${toolStates}`;
  });
  const openFiles = async (initialPath = "/") => {
    const conversationId = chat.activeConversationId();
    if (!conversationId || filesDialogOpen()) return;
    setFilesDialogOpen(true);
    try {
      await openAssistantFilesDialog({ conversationId, initialPath, refreshKey: filesRefreshKey, live: liveHub });
    } finally {
      setFilesDialogOpen(false);
      const href = assistantArtifactHref(window.location.href, null);
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (href !== current) navigate(href, { replace: true, scroll: "manual", viewTransition: false });
      focusComposer();
    }
  };

  onMount(() => {
    const initialConversationId = chat.activeConversationId();
    if (initialConversationId) commitConversationUrl(initialConversationId, true);
    if (props.initialArtifactPath) requestAnimationFrame(() => void openFiles(props.initialArtifactPath!));

    const handlePopState = () => {
      const conversationId = assistantConversationIdFromHref(window.location.href);
      const projectId = assistantProjectIdFromHref(window.location.href);
      const artifactPath = assistantArtifactPathFromHref(window.location.href);
      if (projectId) {
        void openProject(projectId, assistantProjectQueryFromHref(window.location.href)).catch(() => navigateTo("/app/assistant"));
        return;
      }
      if (!conversationId) {
        navigateTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
        return;
      }
      if (conversationId !== chat.activeConversationId()) {
        void chat.openConversation(conversationId).then(() => {
          if (artifactPath && chat.activeConversationId() === conversationId) void openFiles(artifactPath);
        });
        return;
      }
      if (artifactPath) void openFiles(artifactPath);
    };
    window.addEventListener("popstate", handlePopState);
    onCleanup(() => window.removeEventListener("popstate", handlePopState));
  });

  const send = async (input: AiComposerSendInput) => {
    if (!canSend()) return false;
    if (!chat.activeConversationId()) {
      const conversation = await createConversation(false);
      if (!conversation || chat.activeConversationId() !== conversation.id) return false;
    }
    const sent = await chat.send({
      ...input,
      modelProfileId: selectedModelId() || undefined,
    });
    return sent;
  };
  const sendProjectMessage = async (projectId: string, input: AiComposerSendInput) => {
    if (!canSend()) return false;
    const modelProfileId = selectedModelId() || undefined;
    return submitAssistantProjectMessage({
      projectId,
      message: input,
      modelProfileId,
      pendingConversation: pendingProjectChats()[projectId],
      activeConversationId: chat.activeConversationId,
      openConversation: chat.openConversation,
      createConversation: (targetProjectId) => createConversation(false, targetProjectId, false),
      send: chat.send,
      rememberPending: (conversation) => setPendingProjectChats((current) => ({ ...current, [projectId]: conversation })),
      clearPending: () =>
        setPendingProjectChats((current) => {
          const next = { ...current };
          delete next[projectId];
          return next;
        }),
      navigate: (conversationId) => navigateTo(assistantConversationHref(window.location.href, conversationId)),
    });
  };
  const steer = async (message: string) => {
    if (!canUseComposer() || !chat.activeTurn()) return false;
    return chat.steer(message);
  };

  const activeConversation = () =>
    conversations().find((conversation) => conversation.id === chat.activeConversationId()) ?? chat.conversation();
  const activeConversationProject = () => {
    const projectId = activeConversation()?.projectId;
    return projectId ? (projects().find((project) => project.id === projectId) ?? null) : null;
  };
  const addComposerFiles = async (sessionKey: string, files: readonly File[]) => {
    const current = composerAttachmentsFor(sessionKey);
    const result = await readAiComposerFiles(files, {
      acceptsImages: acceptsImages(),
      currentCount: current.length,
      currentImageBytes: current.reduce((total, attachment) => total + (attachment.kind === "image" ? attachment.size : 0), 0),
    });
    const attachmentErrors = [...result.errors];
    if (result.discarded > 0) {
      attachmentErrors.push(`${result.discarded} attachment${result.discarded === 1 ? "" : "s"} discarded because the limit was reached.`);
    }
    if (attachmentErrors.length > 0) chat.setError(attachmentErrors.join(" "));
    if (result.attachments.length === 0) return;
    setComposerAttachments((all) => ({
      ...all,
      [sessionKey]: [...(all[sessionKey] ?? []), ...result.attachments],
    }));
  };

  const AssistantComposer = (composerProps: { projectId?: string; projectName?: string }) => {
    const sessionKey = () => (composerProps.projectId ? projectComposerKey(composerProps.projectId) : composerSessionKey());
    const projectComposer = () => Boolean(composerProps.projectId);
    return (
      <Chat.Composer
        value={composerDraft(sessionKey())}
        onValueChange={(value) => setComposerDraft(sessionKey(), value)}
        attachments={aiChatAttachments(composerAttachmentsFor(sessionKey()))}
        onAttachmentsChange={(next) => setComposerAttachmentsFor(sessionKey(), aiComposerAttachmentRecords(next))}
        fileSelection={{
          onSelect: (files) => addComposerFiles(sessionKey(), files),
          accept: aiComposerFileAccept,
          disabled: !projectComposer() && chat.running(),
          label: "Attach files",
        }}
        models={aiChatModelOptions(props.models)}
        selectedModelId={selectedModelId()}
        onModelChange={setSelectedModelId}
        disabled={!canUseComposer() || newConversation.loading() || chat.loadingConversation()}
        state={
          projectComposer()
            ? newConversation.loading()
              ? "submitting"
              : "idle"
            : chat.runStatus() === "stopping"
              ? "stopping"
              : chat.running()
                ? "running"
                : "idle"
        }
        focusToken={projectComposer() ? undefined : composerFocusToken()}
        placeholder={
          props.status.enabled
            ? projectComposer()
              ? `Start a new chat in ${composerProps.projectName ?? "this Project"}`
              : chat.runStatus() === "stopping"
                ? "Stopping response"
                : chat.running()
                  ? "Steer the current response"
                  : "Ask Assistant anything"
            : "AI is not configured"
        }
        error={projectComposer() ? (chat.error() ?? undefined) : undefined}
        onSubmit={(input) =>
          composerProps.projectId
            ? sendProjectMessage(composerProps.projectId, aiComposerSendInput(input))
            : input.intent === "steer"
              ? steer(input.text)
              : send(aiComposerSendInput(input))
        }
        onStop={
          !projectComposer() && chat.activeTurn()
            ? async () => {
                await chat.abort();
              }
            : undefined
        }
        onError={(error) => chat.setError(error instanceof Error ? error.message : "Chat action failed.")}
        menuActions={
          projectComposer() || !activeConversation()
            ? []
            : [
                {
                  id: "search-chat",
                  label: "Search this chat",
                  icon: "ti ti-search",
                  onSelect: async () => {
                    const conversation = activeConversation();
                    if (conversation) await openAssistantChatDiscoveryDialog(conversation.id, conversation.title);
                  },
                },
                {
                  id: "compact-context",
                  label: "Compact context",
                  icon: "ti ti-package",
                  disabled: chat.running(),
                  onSelect: async () => {
                    if (!chat.activeConversationId()) return;
                    await chat.compactConversation({ modelProfileId: selectedModelId() || undefined });
                  },
                },
              ]
        }
        contextActions={[]}
        contextUsage={
          projectComposer()
            ? undefined
            : {
                usage: usageSnapshot()?.request ?? null,
                loopUsage: usageSnapshot()?.loop ?? null,
                contextWindow: usageModel()?.contextWindow,
                modelLabel: usageModel()?.label,
              }
        }
      />
    );
  };

  const updateConversation = (updated: AiConversation) => {
    void sidebar.invalidate({
      cursor: null,
      domains: new Set(["conversation-list"]),
      conversationIds: new Set([updated.id]),
      projectIds: null,
    });
  };

  const archiveConversation = (archived: AiConversation) => {
    void sidebar.invalidate({
      cursor: null,
      domains: new Set(["conversation-list"]),
      conversationIds: new Set([archived.id]),
      projectIds: null,
    });
    setComposerDrafts((current) => {
      const next = { ...current };
      delete next[archived.id];
      return next;
    });
    setComposerAttachments((current) => {
      const next = { ...current };
      delete next[archived.id];
      return next;
    });
    setModelChoices((current) => {
      const next = { ...current };
      delete next[archived.id];
      return next;
    });
    if (archived.id === chat.activeConversationId()) navigateTo("/app/assistant");
  };

  const ConversationTimeline = () => {
    const items = createAiChatTimeline({ messages: chat.messages, activeTurn: chat.activeTurn });

    return (
      <Chat.Timeline
        class="ai-message-list-container h-full"
        conversationKey={chat.activeConversationId()}
        items={items()}
        loading={chat.loadingConversation()}
        hasMore={chat.hasMoreHistory()}
        loadingOlder={chat.loadingOlder()}
        onLoadOlder={chat.loadOlderMessages}
        emptyTitle={props.status.enabled ? "Start a conversation" : "AI is disabled"}
        viewportRef={setTimelineViewport}
        contentRef={setTimelineContent}
        onActionError={(error) => chat.setError(error instanceof Error ? error.message : "Chat action failed.")}
        navigation={
          <AiChatTurnNavigator
            entries={chat.timeline()}
            loading={chat.timelineLoading()}
            viewport={timelineViewport}
            content={timelineContent}
            loadThrough={chat.loadHistoryThroughSeq}
          />
        }
      />
    );
  };

  return (
    <AssistantLiveProvider value={liveHub}>
      <AppWorkspace class="flex-1 min-h-0">
        <AssistantSidebar
          conversations={conversations}
          activeConversationId={chat.activeConversationId}
          activeView="chat"
          projects={projects()}
          activeProjectId={activeProject()?.id ?? null}
          creatingConversation={newConversation.loading}
          onNewConversation={() => void createAndFocusConversation()}
          onCreateProject={async () => {
            const project = await openAssistantCreateProjectDialog();
            if (project) navigateTo(assistantProjectHref("/app/assistant", project.id));
          }}
          onOpenProject={openProject}
          onOpenConversation={openAndFocusConversation}
          canArchiveConversation={(conversation) => conversation.id !== chat.activeConversationId() || !chat.activeTurn()}
          onConversationUpdated={updateConversation}
          onConversationArchived={archiveConversation}
          live={liveHub}
        />

        <AppWorkspace.Content>
          <AppWorkspace.Main>
            <Show
              keyed
              when={projectView()}
              fallback={
                <Chat class="min-h-0 flex-1">
                  <div class="flex min-h-0 flex-1">
                    <div class="flex min-w-0 flex-1 flex-col">
                      <section class="min-h-0 flex-1 overflow-hidden" data-scroll-preserve="assistant-messages">
                        <AiChatActionsProvider
                          actions={{
                            actionDisabled: () => chat.runStatus() === "stopping",
                            onApproval: async (request, input) => {
                              if (!(await chat.respondToApproval(request, input))) throw new Error("Could not submit approval.");
                            },
                            onFrontendToolResult: async (request, result) => {
                              if (!(await chat.submitFrontendToolResult(request, result)))
                                throw new Error("Could not submit tool response.");
                            },
                            onForkMessage: async (entry, input) => {
                              const conversation = await chat.forkMessage(entry.id, input);
                              if (!conversation) throw new Error("Could not fork conversation.");
                              if (chat.activeConversationId() === conversation.id) commitConversationUrl(conversation.id);
                            },
                            onRetryMessage: async (entry, input) => {
                              const retried = await chat.retryUserMessage(entry.id, {
                                ...input,
                                modelProfileId: selectedModelId() || undefined,
                              });
                              if (!retried) throw new Error(chat.error() ?? "Could not retry message.");
                            },
                            onRetrySteer: async (block) => {
                              if (!(await chat.retrySteer(block))) throw new Error(chat.error() ?? "Could not retry steer message.");
                            },
                            onOpenFile: (path) => void openFiles(path),
                            fileUrl: chat.fileContentUrl,
                          }}
                        >
                          <ConversationTimeline />
                        </AiChatActionsProvider>
                      </section>

                      <div class="shrink-0 px-[var(--ui-space-section)] pb-[var(--ui-space-section)] pt-2">
                        <div class="mx-auto flex max-w-4xl flex-col gap-2">
                          <Show when={chat.error() ?? liveError()}>
                            {(message) => (
                              <p class="inline-flex items-start gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/35 dark:text-red-300">
                                <i class="ti ti-alert-circle mt-0.5 text-sm" aria-hidden="true" />
                                <span>{message()}</span>
                              </p>
                            )}
                          </Show>

                          <Show when={chat.streamStatus() === "reconnecting"}>
                            <div class="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/35 dark:text-amber-200">
                              <i class="ti ti-refresh text-sm animate-spin" aria-hidden="true" />
                              <span class="truncate">Reconnecting…</span>
                            </div>
                          </Show>

                          <AssistantComposer />
                          <Show when={activeConversation() && chatContextPresence() === true ? activeConversation() : null}>
                            {(conversation) => (
                              <div class="flex justify-end lg:hidden">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    void openAssistantChatContextDialog(conversation().id, activeConversationProject(), liveHub)
                                  }
                                >
                                  <i class="ti ti-adjustments-horizontal" />
                                  Context
                                </Button>
                              </div>
                            )}
                          </Show>
                        </div>
                      </div>
                    </div>
                    <Show when={activeConversation()}>
                      {(conversation) => (
                        <div class="contents">
                          <AssistantChatContextPanel
                            chatId={conversation().id}
                            project={activeConversationProject()}
                            initial={props.initialContext?.chatId === conversation().id ? props.initialContext : null}
                            onPresenceChange={setChatContextPresence}
                          />
                        </div>
                      )}
                    </Show>
                  </div>
                </Chat>
              }
            >
              {(view) => (
                <Show when={projects().find((project) => project.id === view.projectId)}>
                  {(project) => (
                    <AssistantProjectView
                      project={project()}
                      initialQuery={view.query}
                      initialPage={view.page}
                      initialContext={view.context}
                      composer={<AssistantComposer projectId={project().id} projectName={project().name} />}
                      onOpenConversation={openAndFocusConversation}
                    />
                  )}
                </Show>
              )}
            </Show>
          </AppWorkspace.Main>
        </AppWorkspace.Content>
      </AppWorkspace>
    </AssistantLiveProvider>
  );
}
