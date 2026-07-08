import type { AiConversation, AiPublicModelProfile, AiSettingsError, AiStoredMessage } from "@valentinkolb/cloud/ai";
import { createAiChatController } from "@valentinkolb/cloud/ai/solid";
import {
  AiComposer,
  type AiComposerAttachment,
  type AiComposerSendInput,
  AiMessageList,
  type AiSlashCommand,
  aiLatestUsage,
} from "@valentinkolb/cloud/ai/ui";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import AssistantSidebar from "./AssistantSidebar";

type Status = {
  ok: boolean;
  enabled: boolean;
  defaultModelId: string;
  error: AiSettingsError | null;
  models: AiPublicModelProfile[];
};

type InitialDetail = { conversation: AiConversation; messages: AiStoredMessage[]; activeTurn: import("@valentinkolb/cloud/ai").AiTurnSnapshot | null };

type Props = {
  status: Status;
  models: AiPublicModelProfile[];
  initialConversations: AiConversation[];
  initialConversationId: string | null;
  initialDetail: InitialDetail | null;
};

export default function AssistantWorkspace(props: Props) {
  const initialSelectedModelId = () => {
    if (props.models.some((model) => model.id === props.status.defaultModelId)) return props.status.defaultModelId;
    return props.models[0]?.id ?? "";
  };

  const chat = createAiChatController({
    baseUrl: "/api/assistant",
    initialConversations: props.initialConversations,
    initialConversationId: props.initialConversationId,
    initialDetail: props.initialDetail,
    initialError: props.status.error?.message ?? null,
  });
  const [selectedModelId, setSelectedModelId] = createSignal(initialSelectedModelId());
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
    if (selectedModelId() && props.models.some((model) => model.id === selectedModelId())) return;
    setSelectedModelId(initialSelectedModelId());
  });

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

      <AppWorkspace.Main class="bg-zinc-50/70 dark:bg-zinc-950/50">
        <section class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve="assistant-messages">
          <AiMessageList
            session={{
              messages: chat.messages,
              activeTurn: chat.activeTurn,
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
