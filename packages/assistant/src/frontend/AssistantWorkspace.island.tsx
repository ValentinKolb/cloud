import type { AiConversation, AiPublicModelProfile, AiSettingsError, AiStoredMessage } from "@valentinkolb/cloud/ai";
import { conversationFileSource, createAiChatController } from "@valentinkolb/cloud/ai/solid";
import {
  AiComposer,
  type AiComposerAttachment,
  type AiComposerSendInput,
  AiMessageList,
  type AiSlashCommand,
  aiLatestUsage,
} from "@valentinkolb/cloud/ai/ui";
import { AppWorkspace, openFileBrowser, prompts } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { assistantApi } from "../api/client";
import { openAssistantConversationEditor } from "./AssistantConversationEditor";
import AssistantSidebar from "./AssistantSidebar";

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
};

type Props = {
  status: Status;
  models: AiPublicModelProfile[];
  /** Model of the user's most recent turn (any chat) — preselected for new chats. */
  lastModelId: string;
  initialConversations: AiConversation[];
  initialConversationId: string | null;
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
    initialError: props.status.error?.message ?? null,
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

  const canSend = createMemo(
    () => props.status.ok && props.status.enabled && props.models.length > 0 && !chat.running() && !chat.activeTurn(),
  );
  const usage = createMemo(() => aiLatestUsage(chat.messages()));
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
  const focusComposer = () => setComposerFocusToken((value) => value + 1);
  const createAndFocusConversation = async () => {
    const conversation = await chat.createConversation();
    if (conversation) focusComposer();
    return conversation;
  };
  const openAndFocusConversation = async (conversationId: string) => {
    await chat.openConversation(conversationId);
    focusComposer();
  };

  createEffect(() => {
    const id = chat.activeConversationId();
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("conversation", id);
      else url.searchParams.delete("conversation");
      window.history.replaceState(null, "", url);
    }
  });

  const send = async (input: AiComposerSendInput) => {
    if (!canSend()) return false;
    return chat.send({ ...input, modelProfileId: selectedModelId() || undefined });
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

  const slashCommands = (): AiSlashCommand[] => [
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
      action: () => {
        if (!requireIdleConversation()) return;
        const last = chat.messages().at(-1);
        if (!last) {
          chat.setError("Nothing to fork yet.");
          return;
        }
        void chat.forkMessage(last.id);
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
        void chat.retryUserMessage(target.id, { modelProfileId: selectedModelId() || undefined });
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
        if (result?.action === "delete") deleteConversation(result.conversation);
      },
    },
    {
      name: "delete",
      description: "Delete this chat",
      icon: "ti ti-trash",
      action: async () => {
        const conversation = activeConversation();
        if (!conversation) {
          chat.setError("Open a chat first.");
          return;
        }
        const confirmed = await prompts.confirm(`Delete "${conversation.title}"?`, {
          title: "Delete chat",
          icon: "ti ti-trash",
          variant: "danger",
          confirmText: "Delete",
          cancelText: "Cancel",
        });
        if (!confirmed) return;
        try {
          await assistantApi.deleteConversation(conversation.id);
          deleteConversation(conversation);
        } catch (error) {
          chat.setError(error instanceof Error ? error.message : "Failed to delete chat");
        }
      },
    },
  ];

  const updateConversation = (updated: AiConversation) => {
    chat.setConversations((prev) => prev.map((conversation) => (conversation.id === updated.id ? updated : conversation)));
  };

  const deleteConversation = (deleted: AiConversation) => {
    chat.setConversations((prev) => prev.filter((conversation) => conversation.id !== deleted.id));
    setComposerDrafts((current) => {
      const next = { ...current };
      delete next[deleted.id];
      return next;
    });
    setComposerAttachments((current) => {
      const next = { ...current };
      delete next[deleted.id];
      return next;
    });
    setModelChoices((current) => {
      const next = { ...current };
      delete next[deleted.id];
      return next;
    });
    if (deleted.id === chat.activeConversationId()) navigateTo("/app/assistant");
  };

  return (
    <AppWorkspace class="flex-1 min-h-0">
      <AssistantSidebar
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        activeView="chat"
        onNewConversation={() => void createAndFocusConversation()}
        onOpenConversation={(conversationId) => void openAndFocusConversation(conversationId)}
        onConversationUpdated={updateConversation}
        onConversationDeleted={deleteConversation}
      />

      <AppWorkspace.Main class="paper">
        <section class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve="assistant-messages">
          <AiMessageList
            session={{
              messages: chat.messages,
              activeTurn: chat.activeTurn,
              history: {
                hasMore: chat.hasMoreHistory,
                loading: chat.loadingOlder,
                loadOlder: chat.loadOlderMessages,
              },
            }}
            actions={{
              onApproval: (request, input) => {
                void chat.respondToApproval(request, input);
              },
              onFrontendToolResult: (request, result) => {
                void chat.submitFrontendToolResult(request, result);
              },
              onForkMessage: (entry, input) => {
                void chat.forkMessage(entry.id, input);
              },
              onRetryMessage: (entry, input) => {
                void chat.retryUserMessage(entry.id, { ...input, modelProfileId: selectedModelId() || undefined });
              },
              fileUrl: chat.fileContentUrl,
            }}
            emptyTitle={props.status.enabled ? "Start a conversation" : "AI is disabled"}
          />
        </section>

        <div class="shrink-0 bg-gradient-to-t from-zinc-50 via-zinc-50/95 to-transparent px-3 pb-3 pt-6 dark:from-zinc-950 dark:via-zinc-950/95">
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

            <AiComposer
              models={{
                profiles: () => props.models,
                selectedId: selectedModelId,
                onSelect: setSelectedModelId,
              }}
              state={{
                draft: composerDraft,
                onDraftChange: setComposerDraft,
                attachments: activeComposerAttachments,
                onAttachmentsChange: setActiveComposerAttachments,
                disabled: () => !canSend(),
                running: chat.running,
                focusToken: composerFocusToken,
                placeholder: props.status.enabled ? "Ask Assistant anything or type / ..." : "AI is not configured",
                usage,
                files: {
                  count: chat.vfsFileCount,
                  onOpen: () => {
                    const conversationId = chat.activeConversationId();
                    if (!conversationId) return;
                    void openFileBrowser({
                      source: conversationFileSource("/api/assistant", conversationId),
                      title: "Chat files",
                      subtitle: "Uploads (read-only) and the assistant's workspace files for this chat.",
                      icon: "ti ti-paperclip",
                    }).then(() => void chat.refreshFiles());
                  },
                },
              }}
              actions={{
                onNewConversation: () => void createAndFocusConversation(),
                slashCommands,
                send,
                stop: chat.abort,
              }}
            />
          </div>
        </div>
      </AppWorkspace.Main>
    </AppWorkspace>
  );
}
