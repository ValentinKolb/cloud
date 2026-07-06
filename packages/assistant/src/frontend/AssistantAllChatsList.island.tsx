import type { AiConversation } from "@valentinkolb/cloud/ai";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { createSignal, For, Show } from "solid-js";
import { conversationIcon, openAssistantConversationEditor } from "./AssistantConversationEditor";

type Props = {
  conversations: AiConversation[];
};

const formatUpdatedAt = (value: string): string =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export default function AssistantAllChatsList(props: Props) {
  const [conversations, setConversations] = createSignal(props.conversations);

  const openEditor = async (conversation: AiConversation) => {
    const result = await openAssistantConversationEditor(conversation);
    if (!result) return;

    if (result.action === "save") {
      setConversations((prev) => prev.map((item) => (item.id === result.conversation.id ? result.conversation : item)));
      refreshCurrentPath();
      return;
    }

    setConversations((prev) => prev.filter((item) => item.id !== result.conversation.id));
    refreshCurrentPath();
  };

  return (
    <div class="paper overflow-hidden">
      <For each={conversations()}>
        {(conversation) => (
          <div class="group flex min-w-0 items-center gap-3 px-3 py-3 text-sm transition-colors hover:bg-zinc-50/85 focus-within:bg-zinc-50/85 dark:hover:bg-zinc-900/45 dark:focus-within:bg-zinc-900/45">
            <a href={`/app/assistant?conversation=${conversation.id}`} class="flex min-w-0 flex-1 items-center gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-900">
                <i class={`${conversationIcon(conversation)} text-base`} />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium text-primary">{conversation.title}</span>
                <span class="block truncate text-xs text-dimmed">
                  {conversation.description || `Updated ${formatUpdatedAt(conversation.updatedAt)}`}
                </span>
              </span>
            </a>
            <span class="hidden shrink-0 text-xs text-dimmed sm:block">{formatUpdatedAt(conversation.updatedAt)}</span>
            <button
              type="button"
              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-dimmed opacity-60 transition-colors hover:bg-zinc-100 hover:text-primary hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-zinc-800"
              aria-label={`Edit ${conversation.title}`}
              title="Edit chat"
              onClick={() => void openEditor(conversation)}
            >
              <i class="ti ti-settings text-sm" />
            </button>
          </div>
        )}
      </For>
      <Show when={conversations().length === 0}>
        <div class="px-4 py-6 text-sm text-dimmed">No chats left on this page.</div>
      </Show>
    </div>
  );
}
