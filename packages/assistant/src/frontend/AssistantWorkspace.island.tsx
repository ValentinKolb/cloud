import type {
  AiConversation,
  AiPendingTurnAction,
  AiPublicModelProfile,
  AiSettingsError,
  AiStoredMessage,
  AiTurn,
} from "@valentinkolb/cloud/ai";
import { createAiChatController } from "@valentinkolb/cloud/ai/solid";
import { markdown } from "@valentinkolb/cloud/shared";
import { AppWorkspace, MarkdownView, Placeholder } from "@valentinkolb/cloud/ui";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../api/client";

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

const messageText = (entry: AiStoredMessage["message"]): string => {
  if (entry.role === "tool_result") return typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result, null, 2);
  return entry.content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.type === "text") return part.text;
      if (part.type === "thinking") return "";
      if (part.type === "tool_call") return "";
      return "";
    })
    .join("")
    .trim();
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
  const [draft, setDraft] = createSignal("");
  const [selectedModelId, setSelectedModelId] = createSignal(initialSelectedModelId());
  const [searchQuery, setSearchQuery] = createSignal("");

  const activeConversation = createMemo(
    () => chat.conversations().find((conversation) => conversation.id === chat.activeConversationId()) ?? null,
  );
  const canSend = createMemo(
    () => props.status.ok && props.status.enabled && props.models.length > 0 && !chat.running() && !chat.activeTurn(),
  );
  const filteredConversations = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    if (!query) return chat.conversations();
    return chat.conversations().filter((conversation) => conversation.title.toLowerCase().includes(query));
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

  const send = async () => {
    const text = draft().trim();
    if (!text || !canSend()) return;

    setDraft("");
    const sent = await chat.send({ message: text, modelProfileId: selectedModelId() || undefined });
    if (!sent) setDraft(text);
  };

  const renderMessages = () => (
    <ol class="flex min-h-full flex-col gap-4 px-4 py-4 sm:px-6">
      <For each={chat.messages()}>
        {(entry) => {
          const role = entry.message.role;
          const text = messageText(entry.message);
          const isUser = role === "user";
          return (
            <li class={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <article
                class={`max-w-[min(46rem,92%)] rounded-lg border px-3 py-2 text-sm ${
                  isUser
                    ? "border-blue-500/20 bg-blue-50 text-blue-950 dark:border-blue-400/25 dark:bg-blue-950/35 dark:text-blue-50"
                    : "border-zinc-200 bg-white text-primary dark:border-zinc-800 dark:bg-zinc-950"
                }`}
              >
                <Show when={text} fallback={<p class="text-xs text-dimmed">No text content</p>}>
                  {isUser ? (
                    <p class="whitespace-pre-wrap leading-6">{text}</p>
                  ) : (
                    <MarkdownView html={markdown.renderSync(text)} class="markdown-content-sm" />
                  )}
                </Show>
              </article>
            </li>
          );
        }}
      </For>

      <Show when={chat.assistantDraft()}>
        <li class="flex justify-start">
          <article class="max-w-[min(46rem,92%)] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-primary dark:border-zinc-800 dark:bg-zinc-950">
            <MarkdownView html={markdown.renderSync(chat.assistantDraft())} class="markdown-content-sm" />
          </article>
        </li>
      </Show>
    </ol>
  );

  const sidebarContent = (
    <>
      <AppWorkspace.SidebarSection title="Actions">
        <AppWorkspace.SidebarItem icon="ti ti-plus" active={!chat.activeConversationId()} onClick={() => void chat.createConversation()}>
          New conversation
        </AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarSection>
      <div class="px-2 pb-2">
        <label class="sr-only" for="assistant-search">
          Search conversations
        </label>
        <div class="relative">
          <i class="ti ti-search pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-zinc-500" />
          <input
            id="assistant-search"
            type="search"
            class="input h-8 w-full pl-8 text-xs"
            value={searchQuery()}
            placeholder="Search conversations"
            onInput={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </div>
      </div>
      <AppWorkspace.SidebarSection title="Recent">
        <Show when={chat.conversations().length > 0} fallback={<p class="px-2 py-1 text-xs text-dimmed">No conversations yet</p>}>
          <Show when={filteredConversations().length > 0} fallback={<p class="px-2 py-1 text-xs text-dimmed">No matching conversations</p>}>
            <For each={filteredConversations()}>
              {(conversation) => (
                <AppWorkspace.SidebarItem
                  icon="ti ti-message"
                  active={conversation.id === chat.activeConversationId()}
                  onClick={() => void chat.openConversation(conversation.id)}
                  title={conversation.title}
                >
                  {conversation.title}
                </AppWorkspace.SidebarItem>
              )}
            </For>
          </Show>
        </Show>
      </AppWorkspace.SidebarSection>
    </>
  );

  return (
    <AppWorkspace class="flex-1 min-h-0">
      <AppWorkspace.Sidebar>
        <AppWorkspace.SidebarHeader
          title="Assistant"
          subtitle="General purpose"
          icon="ti ti-sparkles"
          iconStyle="background-image: linear-gradient(135deg, var(--color-teal-500), var(--color-blue-500))"
        />
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileBody scrollPreserveKey="assistant-sidebar-mobile">{sidebarContent}</AppWorkspace.SidebarMobileBody>
        </AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody scrollPreserveKey="assistant-sidebar">{sidebarContent}</AppWorkspace.SidebarBody>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>

      <AppWorkspace.Main>
        <header class="flex shrink-0 flex-col gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <h1 class="truncate text-sm font-semibold text-primary">{activeConversation()?.title ?? "New conversation"}</h1>
            <p class="mt-0.5 text-xs text-dimmed">{props.status.enabled ? "AI assistant" : "AI is disabled"}</p>
          </div>
          <Show when={props.models.length > 0}>
            <label class="flex items-center gap-2 text-xs text-dimmed">
              <i class="ti ti-cpu text-sm" />
              <select
                class="input h-8 min-w-0 max-w-64 text-xs"
                value={selectedModelId()}
                disabled={chat.running()}
                onChange={(event) => setSelectedModelId(event.currentTarget.value)}
              >
                <For each={props.models}>{(model) => <option value={model.id}>{model.label}</option>}</For>
              </select>
            </label>
          </Show>
        </header>

        <section class="min-h-0 flex-1 overflow-y-auto bg-zinc-50/60 dark:bg-zinc-950/40" data-scroll-preserve="assistant-messages">
          <Show
            when={chat.messages().length > 0 || chat.assistantDraft()}
            fallback={
              <div class="flex h-full items-center justify-center p-4">
                <Placeholder surface="none" icon="ti ti-sparkles">
                  Start a conversation
                </Placeholder>
              </div>
            }
          >
            {renderMessages()}
          </Show>
        </section>

        <footer class="shrink-0 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <Show when={chat.error()}>
            <p class="mb-2 flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
              <i class="ti ti-alert-circle text-sm" />
              {chat.error()}
            </p>
          </Show>

          <Show when={chat.activeTurn() && !chat.running()}>
            <div class="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
              <span class="flex min-w-0 items-center gap-1.5">
                <i class="ti ti-wifi-off text-sm" />
                <span class="truncate">Stream paused</span>
              </span>
              <button type="button" class="btn-secondary btn-xs shrink-0" onClick={chat.resumeActiveTurn}>
                Resume
              </button>
            </div>
          </Show>

          <Show when={chat.approvalRequests().length > 0}>
            <div class="mb-2 space-y-2">
              <For each={chat.approvalRequests()}>
                {(request) => (
                  <div class="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100">
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div class="min-w-0">
                        <p class="font-medium">Approve tool: {request.name}</p>
                        <p class="mt-0.5 text-amber-800 dark:text-amber-200">
                          {request.message ?? "The assistant wants to run this tool."}
                        </p>
                        <details class="mt-1">
                          <summary class="cursor-pointer text-amber-700 dark:text-amber-300">Details</summary>
                          <pre class="mt-1 max-h-32 overflow-auto rounded border border-amber-200/80 bg-white/70 p-2 text-[11px] text-amber-950 dark:border-amber-900 dark:bg-zinc-950/50 dark:text-amber-100">
                            {JSON.stringify(request.args, null, 2)}
                          </pre>
                        </details>
                      </div>
                      <div class="flex shrink-0 flex-wrap gap-1">
                        <button
                          type="button"
                          class="btn-secondary btn-xs"
                          onClick={() => void chat.respondToApproval(request, { approved: false })}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          class="btn-primary btn-xs"
                          onClick={() => void chat.respondToApproval(request, { approved: true })}
                        >
                          Approve
                        </button>
                        <Show when={request.allowAlways}>
                          <button
                            type="button"
                            class="btn-secondary btn-xs"
                            onClick={() => void chat.respondToApproval(request, { approved: true, remember: "always" })}
                          >
                            Always allow
                          </button>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <form
            class="mx-auto flex max-w-4xl items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              class="input-ai min-h-12 max-h-40 flex-1 resize-y py-2 text-sm leading-5"
              value={draft()}
              disabled={!canSend()}
              placeholder={props.status.enabled ? "Ask, rewrite, summarize..." : "AI is not configured"}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Show
              when={chat.running()}
              fallback={
                <button type="submit" class="btn-ai h-10 shrink-0 px-3" disabled={!draft().trim() || !canSend()}>
                  <i class="ti ti-send" />
                  Send
                </button>
              }
            >
              <button type="button" class="btn-secondary h-10 shrink-0" onClick={chat.abort}>
                <i class="ti ti-player-stop" />
                Stop
              </button>
            </Show>
          </form>
        </footer>
      </AppWorkspace.Main>
    </AppWorkspace>
  );
}
