import type {
  AiConversation,
  AiPendingTurnAction,
  AiPublicModelProfile,
  AiSettingsError,
  AiStoredMessage,
  AiTurn,
} from "@valentinkolb/cloud/ai";
import { createAiChatController } from "@valentinkolb/cloud/ai/solid";
import { AiComposer, type AiComposerSendInput, AiMessageList, type AiSlashCommand, aiLatestUsage } from "@valentinkolb/cloud/ai/ui";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { apiClient } from "../api/client";
import AssistantSidebar from "./AssistantSidebar";

type Status = {
  ok: boolean;
  enabled: boolean;
  defaultModelId: string;
  error: AiSettingsError | null;
  models: AiPublicModelProfile[];
};

type Props = {
  status: Status;
  models: AiPublicModelProfile[];
  initialConversations: AiConversation[];
  initialConversationId: string | null;
  initialMessages: AiStoredMessage[];
  initialActiveTurn: AiTurn | null;
  initialPendingActions: AiPendingTurnAction[];
};

export default function AssistantWorkspace(props: Props) {
  const initialSelectedModelId = () => {
    if (props.models.some((model) => model.id === props.status.defaultModelId)) return props.status.defaultModelId;
    return props.models[0]?.id ?? "";
  };

  const chat = createAiChatController({
    route: apiClient,
    initialConversations: props.initialConversations,
    initialConversationId: props.initialConversationId,
    initialMessages: props.initialMessages,
    initialActiveTurn: props.initialActiveTurn,
    initialPendingActions: props.initialPendingActions,
    initialError: props.status.error?.message ?? null,
  });
  const [selectedModelId, setSelectedModelId] = createSignal(initialSelectedModelId());

  const canSend = createMemo(
    () => props.status.ok && props.status.enabled && props.models.length > 0 && !chat.running() && !chat.activeTurn(),
  );
  const usage = createMemo(() => aiLatestUsage(chat.messages()));

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
        void chat.createConversation();
      },
    },
    {
      name: "rewrite",
      description: "Prepare a rewrite request",
      icon: "ti ti-pencil-spark",
      action: ({ setDraft }) => setDraft("Rewrite this text:\n"),
    },
    {
      name: "summarize",
      description: "Prepare a summary request",
      icon: "ti ti-list-details",
      action: ({ setDraft }) => setDraft("Summarize this:\n"),
    },
    {
      name: "system",
      description: "Draft a system-style instruction for this turn",
      icon: "ti ti-settings-spark",
      action: ({ setDraft }) => setDraft("Instruction for this answer: "),
    },
  ];

  const updateConversation = (updated: AiConversation) => {
    chat.setConversations((prev) => prev.map((conversation) => (conversation.id === updated.id ? updated : conversation)));
  };

  const deleteConversation = (deleted: AiConversation) => {
    chat.setConversations((prev) => prev.filter((conversation) => conversation.id !== deleted.id));
    if (deleted.id === chat.activeConversationId()) navigateTo("/app/assistant");
  };

  return (
    <AppWorkspace class="flex-1 min-h-0">
      <AssistantSidebar
        conversations={chat.conversations}
        activeConversationId={chat.activeConversationId}
        activeView="chat"
        onNewConversation={() => void chat.createConversation()}
        onOpenConversation={(conversationId) => void chat.openConversation(conversationId)}
        onConversationUpdated={updateConversation}
        onConversationDeleted={deleteConversation}
      />

      <AppWorkspace.Main class="bg-zinc-50/70 dark:bg-zinc-950/50">
        <section class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve="assistant-messages">
          <AiMessageList
            messages={chat.messages}
            assistantDraft={chat.assistantDraft}
            assistantThinkingDraft={chat.assistantThinkingDraft}
            assistantBlocks={chat.assistantBlocks}
            onApproval={(request, input) => {
              void chat.respondToApproval(request, input);
            }}
            onFrontendToolResult={(request, result) => {
              void chat.submitFrontendToolResult(request, result);
            }}
            onForkMessage={(entry) => {
              void chat.forkMessage(entry.id);
            }}
            onRetryMessage={(entry, input) => {
              void chat.retryUserMessage(entry.id, { ...input, modelProfileId: selectedModelId() || undefined });
            }}
            streaming={() => Boolean(chat.activeTurn())}
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

            <Show when={chat.activeTurn() && !chat.running()}>
              <div class="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/35 dark:text-amber-200">
                <span class="flex min-w-0 items-center gap-1.5">
                  <i class="ti ti-refresh text-sm" aria-hidden="true" />
                  <span class="truncate">Reconnecting stream</span>
                </span>
                <button type="button" class="btn-input btn-input-sm shrink-0" onClick={chat.resumeActiveTurn}>
                  Reconnect
                </button>
              </div>
            </Show>

            <AiComposer
              models={() => props.models}
              selectedModelId={selectedModelId}
              onModelChange={setSelectedModelId}
              onNewConversation={() => void chat.createConversation()}
              disabled={() => !canSend()}
              running={chat.running}
              placeholder={props.status.enabled ? "Ask Assistant anything or type / ..." : "AI is not configured"}
              usage={usage}
              slashCommands={slashCommands}
              onSend={send}
              onStop={chat.abort}
            />
          </div>
        </div>
      </AppWorkspace.Main>
    </AppWorkspace>
  );
}
