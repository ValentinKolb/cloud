import { mutation } from "@k2b/stdlib/solid";
import { Button, dialogCore, PanelDialog, Placeholder, panelDialogFixedOptions, SegmentedControl, TextInput } from "@k2b/ui";
import type { AiConversationResourceOccurrence, AiConversationResourceRef, AiStoredMessage } from "@valentinkolb/cloud/ai";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { assistantApi } from "../api/client";

type View = "messages" | "chat-resources" | "all-resources";

const visibleText = (stored: AiStoredMessage): string => {
  if (stored.message.role === "tool_result") return "";
  return stored.message.content
    .flatMap((part) => (typeof part === "string" ? [part] : part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
};

const ResourceRow = (props: { resource: AiConversationResourceRef; chat?: AiConversationResourceOccurrence["chat"] }) => (
  <li class="py-2">
    <div class="flex items-start gap-2">
      <i class={`${props.resource.icon || "ti ti-link"} mt-0.5 text-base text-dimmed`} aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Show
            when={props.resource.href}
            fallback={<span class="font-medium">{props.resource.title || `${props.resource.ref.type}/${props.resource.ref.id}`}</span>}
          >
            {(href) => (
              <a class="font-medium text-link hover:underline" href={href()}>
                {props.resource.title || `${props.resource.ref.type}/${props.resource.ref.id}`}
              </a>
            )}
          </Show>
          <span class="font-mono text-xs text-dimmed">{props.resource.ref.id}</span>
        </div>
        <Show when={props.resource.preview}>{(preview) => <p class="mt-1 line-clamp-2 text-sm text-muted">{preview()}</p>}</Show>
        <p class="mt-1 text-xs text-dimmed">
          {props.resource.ref.type}
          {props.chat ? ` · ${props.chat.title} (${props.chat.shortId})` : ""}
        </p>
      </div>
    </div>
  </li>
);

function AssistantChatDiscoveryDialog(props: { close: () => void; conversationId: string; title: string }) {
  const [view, setView] = createSignal<View>("messages");
  const [query, setQuery] = createSignal("");
  const [messages, setMessages] = createSignal<AiStoredMessage[]>([]);
  const [chatResources, setChatResources] = createSignal<AiConversationResourceRef[]>([]);
  const [allResources, setAllResources] = createSignal<AiConversationResourceOccurrence[]>([]);
  const [messagesCursor, setMessagesCursor] = createSignal<string>();
  const [chatResourcesCursor, setChatResourcesCursor] = createSignal<string>();
  const [allResourcesCursor, setAllResourcesCursor] = createSignal<string>();

  const load = mutation.create<void, { view: View; query: string; cursor?: string; append?: boolean; signal?: AbortSignal }>({
    mutation: async (input) => {
      if (input.view === "messages") {
        if (!input.query) {
          setMessages([]);
          setMessagesCursor(undefined);
          return;
        }
        const page = await assistantApi.searchMessages({
          conversationId: props.conversationId,
          q: input.query,
          before: input.cursor ? Number(input.cursor) : undefined,
          limit: 50,
          signal: input.signal,
        });
        setMessages((current) => (input.append ? [...current, ...page.messages] : page.messages));
        setMessagesCursor(page.nextCursor);
        return;
      }
      if (input.view === "chat-resources") {
        const page = await assistantApi.listConversationResources({
          conversationId: props.conversationId,
          q: input.query || undefined,
          cursor: input.cursor,
          limit: 50,
          signal: input.signal,
        });
        setChatResources((current) => (input.append ? [...current, ...page.resources] : page.resources));
        setChatResourcesCursor(page.nextCursor);
        return;
      }
      const page = await assistantApi.listResources({
        q: input.query || undefined,
        cursor: input.cursor,
        limit: 50,
        signal: input.signal,
      });
      setAllResources((current) => (input.append ? [...current, ...page.resources] : page.resources));
      setAllResourcesCursor(page.nextCursor);
    },
  });

  createEffect(() => {
    const input = { view: view(), query: query().trim() };
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load.mutate({ ...input, signal: controller.signal }), 180);
    onCleanup(() => {
      window.clearTimeout(timer);
      controller.abort();
    });
  });

  const emptyTitle = () => {
    if (load.loading()) return "Searching…";
    if (view() === "messages" && !query().trim()) return "Enter words to search this chat.";
    return view() === "messages" ? "No matching messages." : "No matching resources.";
  };

  const nextCursor = () => {
    if (view() === "messages") return messagesCursor();
    if (view() === "chat-resources") return chatResourcesCursor();
    return allResourcesCursor();
  };

  const loadMore = () => {
    const cursor = nextCursor();
    if (cursor) void load.mutate({ view: view(), query: query().trim(), cursor, append: true });
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Chat history and resources"
        subtitle={`${props.title} (${props.conversationId})`}
        icon="ti ti-search"
        close={props.close}
      />
      <PanelDialog.Body scrollPreserveKey="assistant-chat-discovery-dialog">
        <div class="flex flex-col gap-3">
          <SegmentedControl
            options={[
              { value: "messages", label: "Messages" },
              { value: "chat-resources", label: "This chat's resources" },
              { value: "all-resources", label: "All chat resources" },
            ]}
            value={view}
            onValueChange={setView}
            ariaLabel="Assistant search scope"
            size="sm"
            class="max-w-full overflow-x-auto"
          />
          <TextInput
            type="search"
            icon="ti ti-search"
            activeIcon="ti ti-search"
            aria-label={view() === "messages" ? "Search messages in this chat" : "Filter chat resources"}
            placeholder={view() === "messages" ? "Search messages in this chat..." : "Filter by title, type, or resource ID..."}
            value={query}
            onValueChange={setQuery}
            clearable
            onClear={() => setQuery("")}
          />
        </div>

        <Show when={load.error()}>
          {(error) => <Placeholder state="error" variant="panel" title="Search failed" description={error().message} />}
        </Show>

        <Show when={view() === "messages" && messages().length > 0} fallback={null}>
          <ol class="flex flex-col gap-2">
            <For each={messages()}>
              {(message) => (
                <li class="py-2">
                  <div class="flex items-center justify-between gap-3 text-xs text-dimmed">
                    <span class="capitalize">{message.kind === "summary" ? "summary" : message.message.role}</span>
                    <span class="font-mono">
                      {message.id} · #{message.seq}
                    </span>
                  </div>
                  <p class="mt-1 whitespace-pre-wrap text-sm">{visibleText(message)}</p>
                </li>
              )}
            </For>
          </ol>
        </Show>
        <Show when={view() === "chat-resources" && chatResources().length > 0} fallback={null}>
          <ul class="flex flex-col gap-2">
            <For each={chatResources()}>{(resource) => <ResourceRow resource={resource} />}</For>
          </ul>
        </Show>
        <Show when={view() === "all-resources" && allResources().length > 0} fallback={null}>
          <ul class="flex flex-col gap-2">
            <For each={allResources()}>{(resource) => <ResourceRow resource={resource} chat={resource.chat} />}</For>
          </ul>
        </Show>
        <Show when={!load.error() && nextCursor()}>
          <div class="flex justify-center py-2">
            <Button variant="secondary" loading={load.loading()} onClick={loadMore}>
              Load more
            </Button>
          </div>
        </Show>
        <Show
          when={
            !load.error() &&
            ((view() === "messages" && messages().length === 0) ||
              (view() === "chat-resources" && chatResources().length === 0) ||
              (view() === "all-resources" && allResources().length === 0))
          }
        >
          <Placeholder state={load.loading() ? "loading" : "empty"} variant="panel" title={emptyTitle()} />
        </Show>
      </PanelDialog.Body>
    </PanelDialog>
  );
}

export const openAssistantChatDiscoveryDialog = (conversationId: string, title: string): Promise<void | undefined> =>
  dialogCore.open<void>(
    (close) => <AssistantChatDiscoveryDialog close={() => close()} conversationId={conversationId} title={title} />,
    panelDialogFixedOptions,
  );
