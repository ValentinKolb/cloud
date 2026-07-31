import { Link, type LinkNavigateEvent, refreshCurrentPath } from "@k2b/ssr/nav";
import type { AiConversation } from "@valentinkolb/cloud/ai";
import { formatDateTime as formatUpdatedAt } from "@valentinkolb/cloud/shared";
import { prompts, Tooltip } from "@valentinkolb/cloud/ui";
import { mutation } from "@k2b/stdlib/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { assistantApi } from "../api/client";
import { conversationIcon, openAssistantConversationEditor } from "./AssistantConversationEditor";
import { assistantConversationHref, type ConversationOpenResult, shouldCommitConversationNavigation } from "./assistant-navigation";
import { ConversationStatusMeta } from "./conversation-status";

type Props = {
  conversations: AiConversation[];
  archived?: boolean;
  onOpenConversation: (conversation: AiConversation) => Promise<ConversationOpenResult>;
  onChanged?: () => void;
};

function ConversationSummary(props: { conversation: AiConversation }) {
  return (
    <>
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--ui-surface-subtle)] text-dimmed">
        <i class={`${conversationIcon(props.conversation)} text-base`} />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium text-primary">{props.conversation.title}</span>
        <span class="block truncate text-xs text-dimmed">
          {props.conversation.description || `Updated ${formatUpdatedAt(props.conversation.updatedAt)}`}
        </span>
      </span>
    </>
  );
}

export default function AssistantAllChatsList(props: Props) {
  const [conversations, setConversations] = createSignal(props.conversations);
  createEffect(() => setConversations(props.conversations));
  const [restoringId, setRestoringId] = createSignal<string | null>(null);
  const restore = mutation.create<AiConversation, AiConversation>({
    mutation: (conversation) => {
      setRestoringId(conversation.id);
      return assistantApi.restoreConversation(conversation.id);
    },
    onSuccess: (conversation) => {
      setRestoringId(null);
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (props.onChanged) props.onChanged();
      else refreshCurrentPath();
    },
    onError: (error) => {
      setRestoringId(null);
      void prompts.error(error.message);
    },
  });

  const openEditor = async (conversation: AiConversation) => {
    const result = await openAssistantConversationEditor(conversation);
    if (!result) return;

    if (result.action === "save") {
      setConversations((prev) => prev.map((item) => (item.id === result.conversation.id ? result.conversation : item)));
      if (props.onChanged) props.onChanged();
      else refreshCurrentPath();
      return;
    }

    setConversations((prev) => prev.filter((item) => item.id !== result.conversation.id));
    if (props.onChanged) props.onChanged();
    else refreshCurrentPath();
  };

  const openConversation = async (conversation: AiConversation, nav: LinkNavigateEvent) => {
    const result = await props.onOpenConversation(conversation);
    if (shouldCommitConversationNavigation(result, window.location.href, nav.url.href)) {
      nav.push(undefined, { scroll: "manual" });
    }
  };

  return (
    <div class="space-y-0.5">
      <For each={conversations()}>
        {(conversation) => (
          <div class="group flex min-w-0 items-center gap-3 rounded-md px-2 py-2.5 text-sm transition-colors hover:bg-[var(--ui-surface-subtle)] focus-within:bg-[var(--ui-surface-subtle)]">
            <Show
              when={!props.archived}
              fallback={
                <span class="flex min-w-0 flex-1 cursor-default items-center gap-3 text-left">
                  <ConversationSummary conversation={conversation} />
                </span>
              }
            >
              <Link
                href={assistantConversationHref("/app/assistant", conversation.id)}
                scroll="manual"
                onNavigate={(nav) => openConversation(conversation, nav)}
                class="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <ConversationSummary conversation={conversation} />
              </Link>
            </Show>
            <ConversationStatusMeta conversation={conversation} labels />
            <span class="hidden shrink-0 text-xs text-dimmed sm:block">{formatUpdatedAt(conversation.updatedAt)}</span>
            <Tooltip content={props.archived ? "Restore chat" : "Edit chat"}>
              <button
                type="button"
                class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-dimmed opacity-60 transition-colors hover:bg-zinc-100 hover:text-primary hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-zinc-800"
                aria-label={props.archived ? `Restore ${conversation.title}` : `Edit ${conversation.title}`}
                disabled={restore.loading()}
                onClick={() => (props.archived ? void restore.mutate(conversation) : void openEditor(conversation))}
              >
                <i
                  class={`ti ${props.archived ? (restoringId() === conversation.id ? "ti-loader-2 animate-spin" : "ti-restore") : "ti-settings"} text-sm`}
                />
              </button>
            </Tooltip>
          </div>
        )}
      </For>
      <Show when={conversations().length === 0}>
        <div class="px-2 py-6 text-sm text-dimmed">No chats left on this page.</div>
      </Show>
    </div>
  );
}
