import { navigate, navigateTo } from "@k2b/ssr/nav";
import { mutation } from "@k2b/stdlib/solid";
import { AppWorkspace, Chat, type ChatCommand, prompts } from "@k2b/ui";
import type {
  AiConversation,
  AiConversationTimelineEntry,
  AiPublicModelProfile,
  AiSettingsError,
  AiStoredMessage,
} from "@valentinkolb/cloud/ai";
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
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { assistantApi } from "../api/client";
import { openAssistantFilesDialog } from "./AssistantArtifactDetail";
import { openAssistantConversationEditor } from "./AssistantConversationEditor";
import { openAssistantProjectsDialog } from "./AssistantProjectsDialog";
import AssistantSidebar from "./AssistantSidebar";
import {
  assistantArtifactHref,
  assistantArtifactPathFromHref,
  assistantConversationHref,
  assistantConversationIdFromHref,
} from "./assistant-navigation";

type Status = {
  ok: boolean;
  enabled: boolean;
  defaultModelId: string;
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
  initialConversations: AiConversation[];
  initialConversationId: string | null;
  initialArtifactPath: string | null;
  initialDetail: InitialDetail | null;
};

export default function AssistantWorkspace(props: Props) {
  const isSelectable = (modelId: string | null | undefined): modelId is string =>
    Boolean(modelId && props.models.some((model) => model.id === modelId));

  const chat = createAiChatController({
    baseUrl: "/api/assistant",
    initialConversations: props.initialConversations,
    initialConversationId: props.initialConversationId,
    initialDetail: props.initialDetail,
    initialTimeline: props.initialDetail?.timeline,
    initialError: props.status.error?.message ?? null,
    trackViewedState: true,
  });

  // Model selection is per chat: an explicit pick only applies to the chat it
  // was made in. Without a pick, a chat shows the model of its own last
  // assistant turn; new chats start on the user's last-used model.
  const [modelChoices, setModelChoices] = createSignal<Record<string, string>>({});
  const modelSessionKey = () => chat.activeConversationId() ?? "__new__";
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
  const [filesDialogOpen, setFilesDialogOpen] = createSignal(false);
  const [timelineViewport, setTimelineViewport] = createSignal<HTMLDivElement>();
  const [timelineContent, setTimelineContent] = createSignal<HTMLDivElement>();

  const canUseComposer = createMemo(() => props.status.ok && props.status.enabled && props.models.length > 0);
  const usageSnapshot = createMemo(() => aiLatestUsageSnapshot(chat.messages()));
  const usageModel = createMemo(() => {
    const snapshot = usageSnapshot();
    const modelId = snapshot ? snapshot.modelProfileId : selectedModelId();
    return props.models.find((model) => model.id === modelId) ?? null;
  });
  const composerSessionKey = () => chat.activeConversationId() ?? "__new__";
  const composerDraft = () => composerDrafts()[composerSessionKey()] ?? "";
  const setComposerDraft = (value: string) => {
    const key = composerSessionKey();
    setComposerDrafts((current) => ({ ...current, [key]: value }));
  };
  const activeComposerAttachments = () => composerAttachments()[composerSessionKey()] ?? [];
  const setActiveComposerAttachments = (attachments: AiComposerAttachment[]) => {
    const key = composerSessionKey();
    setComposerAttachments((current) => ({ ...current, [key]: attachments }));
  };
  const selectedModel = createMemo(() => props.models.find((model) => model.id === selectedModelId()) ?? null);
  const supportsVision = () => Boolean(selectedModel()?.capabilities.includes("vision"));
  createEffect(() => {
    selectedModelId();
    if (supportsVision()) return;
    const current = activeComposerAttachments();
    if (!current.some((attachment) => attachment.kind === "image")) return;
    setActiveComposerAttachments(current.filter((attachment) => attachment.kind !== "image"));
    chat.setError("Image attachments were removed because the selected model does not support vision.");
  });
  const focusComposer = () => setComposerFocusToken((value) => value + 1);
  const commitConversationUrl = (conversationId: string, replace = false) => {
    const href = assistantConversationHref(window.location.href, conversationId);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (href === current) return;
    navigate(href, { replace, scroll: "manual", viewTransition: false });
  };
  const newConversation = mutation.create<AiConversation | null, { focus: boolean; projectId?: string }>({
    mutation: async ({ focus, projectId }) => {
      const conversation = await chat.createConversation(projectId ? { projectId } : undefined);
      if (conversation && chat.activeConversationId() === conversation.id) {
        commitConversationUrl(conversation.id);
        if (focus) focusComposer();
      }
      return conversation;
    },
  });
  const createConversation = async (focus: boolean, projectId?: string) => {
    if (newConversation.loading()) return null;
    await newConversation.mutate({ focus, projectId });
    return newConversation.data();
  };
  const createAndFocusConversation = () => createConversation(true);
  const canSend = createMemo(
    () => canUseComposer() && !newConversation.loading() && !chat.loadingConversation() && !chat.running() && !chat.activeTurn(),
  );
  const openAndFocusConversation = async (conversationId: string) => {
    const result = await chat.openConversation(conversationId);
    if (result === "failed") throw new Error("Failed to open conversation");
    if (result === "stale") return false;
    if (chat.activeConversationId() === conversationId) focusComposer();
    return true;
  };
  const filesRefreshKey = createMemo(() => {
    const toolStates =
      chat
        .activeTurn()
        ?.blocks.filter((block) => block.kind === "tool")
        .map((block) => `${block.id}:${block.status}`)
        .join("|") ?? "";
    return `${chat.activeConversationId() ?? ""}:${chat.vfsFileCount()}:${toolStates}`;
  });
  const openFiles = async (initialPath = "/") => {
    const conversationId = chat.activeConversationId();
    if (!conversationId || filesDialogOpen()) return;
    setFilesDialogOpen(true);
    try {
      await openAssistantFilesDialog({ conversationId, initialPath, refreshKey: filesRefreshKey });
    } finally {
      setFilesDialogOpen(false);
      void chat.refreshFiles();
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
      const artifactPath = assistantArtifactPathFromHref(window.location.href);
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
  const steer = async (message: string) => {
    if (!canUseComposer() || !chat.activeTurn()) return false;
    return chat.steer(message);
  };

  const activeConversation = () => chat.conversations().find((conversation) => conversation.id === chat.activeConversationId()) ?? null;
  const requireIdleConversation = (): AiConversation | null => {
    const conversation = activeConversation();
    if (!conversation) {
      chat.setError("Open a chat first.");
      return null;
    }
    if (chat.running()) {
      chat.setError("Stop the current response first.");
      return null;
    }
    return conversation;
  };

  const archiveChat = mutation.create<AiConversation | null, AiConversation>({
    mutation: async (conversation) => {
      const confirmed = await prompts.confirm(`Archive "${conversation.title}"?`, {
        title: "Archive chat",
        icon: "ti ti-archive",
        confirmText: "Archive",
        cancelText: "Cancel",
      });
      if (!confirmed) return null;
      await assistantApi.archiveConversation(conversation.id);
      return conversation;
    },
    onSuccess: (conversation) => {
      if (conversation) archiveConversation(conversation);
    },
    onError: (error) => chat.setError(error.message),
  });

  const slashCommands = (): ChatCommand[] => [
    {
      name: "new",
      description: "Start a new conversation",
      icon: "ti ti-message-plus",
      action: () => {
        void createAndFocusConversation();
      },
    },
    {
      name: "compact",
      description: "Compact this chat's context",
      icon: "ti ti-package",
      action: () => {
        if (!chat.activeConversationId()) {
          chat.setError("Open a chat before compacting context.");
          return;
        }
        void chat.compactConversation({ modelProfileId: selectedModelId() || undefined });
      },
    },
    {
      name: "fork",
      description: "Fork this conversation into a new chat",
      icon: "ti ti-git-fork",
      action: async () => {
        if (!requireIdleConversation()) return;
        const last = chat.messages().at(-1);
        if (!last) {
          chat.setError("Nothing to fork yet.");
          return;
        }
        const conversation = await chat.forkMessage(last.id);
        if (conversation && chat.activeConversationId() === conversation.id) commitConversationUrl(conversation.id);
      },
    },
    {
      name: "retry",
      description: "Regenerate the last answer",
      icon: "ti ti-refresh",
      action: () => {
        if (!requireIdleConversation()) return;
        const target = chat
          .messages()
          .findLast((message) => message.kind === "message" && message.message.role === "user" && !message.compactedAt);
        if (!target) {
          chat.setError("No user message to retry.");
          return;
        }
        void chat
          .retryUserMessage(target.id, {
            modelProfileId: selectedModelId() || undefined,
          })
          .then(() => undefined);
      },
    },
    {
      name: "rename",
      description: "Rename this chat",
      icon: "ti ti-pencil",
      action: async () => {
        const conversation = activeConversation();
        if (!conversation) {
          chat.setError("Open a chat first.");
          return;
        }
        const result = await openAssistantConversationEditor(conversation);
        if (result?.action === "save") updateConversation(result.conversation);
        if (result?.action === "archive") archiveConversation(result.conversation);
      },
    },
    {
      name: "archive",
      description: "Archive this chat",
      icon: "ti ti-archive",
      action: () => {
        const conversation = requireIdleConversation();
        if (!conversation) return;
        void archiveChat.mutate(conversation);
      },
    },
  ];

  const addComposerFiles = async (files: readonly File[]) => {
    const sessionKey = composerSessionKey();
    const current = activeComposerAttachments();
    const result = await readAiComposerFiles(files, {
      supportsVision: supportsVision(),
      currentCount: current.length,
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

  const updateConversation = (updated: AiConversation) => {
    chat.setConversations((prev) => prev.map((conversation) => (conversation.id === updated.id ? updated : conversation)));
  };

  const archiveConversation = (archived: AiConversation) => {
    chat.setConversations((prev) => prev.filter((conversation) => conversation.id !== archived.id));
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
    <AppWorkspace class="flex-1 min-h-0">
      <AssistantSidebar
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        activeView="chat"
        creatingConversation={newConversation.loading}
        onNewConversation={() => void createAndFocusConversation()}
        onOpenProjects={() =>
          openAssistantProjectsDialog(async (project) => {
            await createConversation(true, project.id);
          })
        }
        onOpenConversation={openAndFocusConversation}
        canArchiveConversation={(conversation) => conversation.id !== chat.activeConversationId() || !chat.activeTurn()}
        onConversationUpdated={updateConversation}
        onConversationArchived={archiveConversation}
      />

      <AppWorkspace.Content>
        <AppWorkspace.Main>
          <Chat class="min-h-0 flex-1">
            <section class="min-h-0 flex-1 overflow-hidden" data-scroll-preserve="assistant-messages">
              <AiChatActionsProvider
                actions={{
                  actionDisabled: () => chat.runStatus() === "stopping",
                  onApproval: async (request, input) => {
                    if (!(await chat.respondToApproval(request, input))) throw new Error("Could not submit approval.");
                  },
                  onFrontendToolResult: async (request, result) => {
                    if (!(await chat.submitFrontendToolResult(request, result))) throw new Error("Could not submit tool response.");
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
                <Show when={chat.error()}>
                  <p class="inline-flex items-start gap-1.5 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950/35 dark:text-red-300">
                    <i class="ti ti-alert-circle mt-0.5 text-sm" aria-hidden="true" />
                    <span>{chat.error()}</span>
                  </p>
                </Show>

                <Show when={chat.streamStatus() === "reconnecting"}>
                  <div class="flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/35 dark:text-amber-200">
                    <i class="ti ti-refresh text-sm animate-spin" aria-hidden="true" />
                    <span class="truncate">Reconnecting…</span>
                  </div>
                </Show>

                <Chat.Composer
                  value={composerDraft()}
                  onValueChange={setComposerDraft}
                  attachments={aiChatAttachments(activeComposerAttachments())}
                  onAttachmentsChange={(next) => setActiveComposerAttachments(aiComposerAttachmentRecords(next))}
                  fileSelection={{
                    onSelect: addComposerFiles,
                    accept: aiComposerFileAccept,
                    disabled: chat.running(),
                    label: "Attach files",
                  }}
                  models={aiChatModelOptions(props.models)}
                  selectedModelId={selectedModelId()}
                  onModelChange={setSelectedModelId}
                  commands={slashCommands()}
                  disabled={!canUseComposer() || newConversation.loading() || chat.loadingConversation()}
                  state={chat.runStatus() === "stopping" ? "stopping" : chat.running() ? "running" : "idle"}
                  focusToken={composerFocusToken()}
                  placeholder={
                    props.status.enabled
                      ? chat.runStatus() === "stopping"
                        ? "Stopping response"
                        : chat.running()
                          ? "Steer the current response"
                          : "Ask Assistant anything or type / ..."
                      : "AI is not configured"
                  }
                  onSubmit={(input) => (input.intent === "steer" ? steer(input.text) : send(aiComposerSendInput(input)))}
                  onStop={
                    chat.activeTurn()
                      ? async () => {
                          await chat.abort();
                        }
                      : undefined
                  }
                  onError={(error) => chat.setError(error instanceof Error ? error.message : "Chat action failed.")}
                  menuActions={[
                    {
                      id: "new-chat",
                      label: "New chat",
                      icon: "ti ti-message-plus",
                      disabled: newConversation.loading(),
                      onSelect: async () => {
                        await createAndFocusConversation();
                      },
                    },
                  ]}
                  contextActions={
                    chat.vfsFileCount() > 0
                      ? [
                          {
                            id: "files",
                            label: `${chat.vfsFileCount()} files in this chat`,
                            icon: "ti ti-files",
                            onSelect: async () => {
                              await openFiles("/");
                            },
                          },
                        ]
                      : []
                  }
                  contextUsage={{
                    usage: usageSnapshot()?.request ?? null,
                    loopUsage: usageSnapshot()?.loop ?? null,
                    contextWindow: usageModel()?.contextWindow,
                    modelLabel: usageModel()?.label,
                  }}
                />
              </div>
            </div>
          </Chat>
        </AppWorkspace.Main>
      </AppWorkspace.Content>
    </AppWorkspace>
  );
}
