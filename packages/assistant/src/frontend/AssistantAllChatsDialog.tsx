import { mutation } from "@k2b/stdlib/solid";
import { Button, dialogCore, PanelDialog, panelDialogFixedOptions, Placeholder, SegmentedControl, TextInput } from "@k2b/ui";
import type { AiConversation, AiConversationPage, AiConversationStatusFilter } from "@valentinkolb/cloud/ai";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { assistantApi } from "../api/client";
import AssistantAllChatsList from "./AssistantAllChatsList";
import type { ConversationOpenResult } from "./assistant-navigation";

type ChatView = "all" | "running" | "needs_attention" | "failed" | "unread" | "archived";

const CHAT_VIEWS: ReadonlyArray<{ value: ChatView; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "failed", label: "Failed" },
  { value: "unread", label: "New responses" },
  { value: "archived", label: "Archived" },
];

const PER_PAGE = 20;

const emptyViewText = (view: ChatView, search: string): string => {
  if (search) return "No chats match your search.";
  if (view === "archived") return "No archived chats.";
  if (view === "running") return "No chats are running.";
  if (view === "needs_attention") return "No chats need attention.";
  if (view === "failed") return "No failed chats.";
  if (view === "unread") return "No new responses.";
  return "No chats yet.";
};

type PageRequest = { requestId: number; query: string; view: ChatView; page: number };
type PageResult = { requestId: number; page: AiConversationPage };
function AssistantAllChatsDialog(props: {
  close: () => void;
  openConversation: (conversation: AiConversation) => Promise<ConversationOpenResult>;
}) {
  const [query, setQuery] = createSignal("");
  const [view, setView] = createSignal<ChatView>("all");
  const [page, setPage] = createSignal(1);
  const [result, setResult] = createSignal<AiConversationPage | null>(null);
  let latestRequestId = 0;
  let latestOpenRequestId = 0;

  const load = mutation.create<PageResult, PageRequest>({
    mutation: async (input) => {
      const status = input.view !== "all" && input.view !== "archived" ? (input.view as AiConversationStatusFilter) : undefined;
      const pageResult = await assistantApi.listConversationsPage({
        q: input.query || undefined,
        page: input.page,
        perPage: PER_PAGE,
        archived: input.view === "archived",
        status,
      });
      return { requestId: input.requestId, page: pageResult };
    },
    onSuccess: (next) => {
      if (next.requestId !== latestRequestId) return;
      const lastPage = Math.max(1, Math.ceil(next.page.total / next.page.perPage));
      if (next.page.page > lastPage) {
        setPage(lastPage);
        return;
      }
      setResult(next.page);
    },
  });

  const refresh = () => {
    setResult(null);
    void load.mutate({ requestId: ++latestRequestId, query: query().trim(), view: view(), page: page() });
  };

  createEffect(() => {
    const request = { requestId: ++latestRequestId, query: query().trim(), view: view(), page: page() };
    setResult(null);
    const timer = window.setTimeout(() => void load.mutate(request), 180);
    onCleanup(() => window.clearTimeout(timer));
  });

  const selectView = (next: ChatView) => {
    setPage(1);
    setView(next);
  };
  const totalPages = () => Math.max(1, Math.ceil((result()?.total ?? 0) / (result()?.perPage ?? PER_PAGE)));
  const openConversation = async (conversation: AiConversation): Promise<ConversationOpenResult> => {
    const requestId = ++latestOpenRequestId;
    const result = await props.openConversation(conversation);
    if (requestId !== latestOpenRequestId) return "stale";
    if (result !== "stale") props.close();
    return result;
  };
  onCleanup(() => {
    latestOpenRequestId += 1;
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="All chats"
        subtitle={result() ? `${result()!.total} ${result()!.total === 1 ? "chat" : "chats"}` : "Search and manage your history"}
        icon="ti ti-messages"
        close={props.close}
      />
      <PanelDialog.Body scrollPreserveKey="assistant-all-chats-dialog">
        <div class="flex flex-col gap-3">
          <TextInput
            type="search"
            icon="ti ti-search"
            activeIcon="ti ti-search"
            aria-label="Search chats"
            placeholder="Search chats..."
            value={query}
            onValueChange={(value) => {
              setPage(1);
              setQuery(value);
            }}
            clearable
            onClear={() => {
              setPage(1);
              setQuery("");
            }}
          />
          <SegmentedControl
            options={CHAT_VIEWS}
            value={view}
            onValueChange={selectView}
            ariaLabel="Chat filters"
            size="sm"
            class="max-w-full overflow-x-auto"
          />
        </div>

        <Show when={load.error()}>
          {(error) => (
            <div class="rounded-[var(--ui-radius-surface)] bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {error().message}
            </div>
          )}
        </Show>

        <Show
          when={result() && result()!.items.length > 0}
          fallback={
            <Placeholder
              state={load.loading() && !result() ? "loading" : "empty"}
              variant="panel"
              title={load.loading() && !result() ? "Loading chats…" : emptyViewText(view(), query().trim())}
            />
          }
        >
          <AssistantAllChatsList
            conversations={result()!.items}
            archived={view() === "archived"}
            onChanged={refresh}
            onOpenConversation={openConversation}
          />
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span class="text-xs text-dimmed">
          Page {page()} of {totalPages()}
        </span>
        <nav class="flex items-center gap-1" aria-label="Chat history pages">
          <Button
            variant="ghost"
            size="sm"
            disabled={page() <= 1 || load.loading()}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            <i class="ti ti-chevron-left" aria-hidden="true" />
            Previous
          </Button>
          <Button variant="ghost" size="sm" disabled={!result()?.hasNext || load.loading()} onClick={() => setPage((value) => value + 1)}>
            Next
            <i class="ti ti-chevron-right" aria-hidden="true" />
          </Button>
        </nav>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openAssistantAllChatsDialog = (
  openConversation: (conversation: AiConversation) => Promise<ConversationOpenResult>,
): Promise<void | undefined> =>
  dialogCore.open<void>(
    (close) => <AssistantAllChatsDialog close={() => close()} openConversation={openConversation} />,
    panelDialogFixedOptions,
  );
