import type { AiConversation, AiConversationPage, AiConversationStatusFilter } from "@valentinkolb/cloud/ai";
import { PanelDialog, panelDialogOptions, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { assistantApi } from "../api/client";
import AssistantAllChatsList from "./AssistantAllChatsList.island";

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

function AssistantAllChatsDialog(props: { close: () => void; openConversation: (conversation: AiConversation) => void }) {
  const [query, setQuery] = createSignal("");
  const [view, setView] = createSignal<ChatView>("all");
  const [page, setPage] = createSignal(1);
  const [result, setResult] = createSignal<AiConversationPage | null>(null);
  let latestRequestId = 0;

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

  const refresh = () => void load.mutate({ requestId: ++latestRequestId, query: query().trim(), view: view(), page: page() });

  createEffect(() => {
    const request = { requestId: ++latestRequestId, query: query().trim(), view: view(), page: page() };
    const timer = window.setTimeout(() => void load.mutate(request), 180);
    onCleanup(() => window.clearTimeout(timer));
  });

  const selectView = (next: ChatView) => {
    setPage(1);
    setView(next);
  };
  const totalPages = () => Math.max(1, Math.ceil((result()?.total ?? 0) / (result()?.perPage ?? PER_PAGE)));

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
            ariaLabel="Search chats"
            placeholder="Search chats..."
            value={query}
            onInput={(value) => {
              setPage(1);
              setQuery(value);
            }}
            clearable
            onClear={() => {
              setPage(1);
              setQuery("");
            }}
          />
          <nav class="flex max-w-full gap-1 overflow-x-auto" aria-label="Chat filters">
            {CHAT_VIEWS.map((option) => (
              <button
                type="button"
                class={`btn-input btn-input-sm shrink-0 ${option.value === view() ? "bg-[var(--ui-selected)] text-primary" : ""}`}
                aria-pressed={option.value === view()}
                onClick={() => selectView(option.value)}
              >
                {option.label}
              </button>
            ))}
          </nav>
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
            <div class="flex min-h-40 items-center justify-center px-4 py-8 text-sm text-dimmed">
              {load.loading() && !result() ? "Loading chats…" : emptyViewText(view(), query().trim())}
            </div>
          }
        >
          <AssistantAllChatsList
            conversations={result()!.items}
            archived={view() === "archived"}
            onChanged={refresh}
            onOpenConversation={(conversation) => {
              props.close();
              props.openConversation(conversation);
            }}
          />
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span class="text-xs text-dimmed">
          Page {page()} of {totalPages()}
        </span>
        <nav class="flex items-center gap-1" aria-label="Chat history pages">
          <button
            type="button"
            class="btn-simple btn-sm"
            disabled={page() <= 1 || load.loading()}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            <i class="ti ti-chevron-left" aria-hidden="true" />
            Previous
          </button>
          <button
            type="button"
            class="btn-simple btn-sm"
            disabled={!result()?.hasNext || load.loading()}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
            <i class="ti ti-chevron-right" aria-hidden="true" />
          </button>
        </nav>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openAssistantAllChatsDialog = (openConversation: (conversation: AiConversation) => void): Promise<void | undefined> =>
  prompts.dialog<void>((close) => <AssistantAllChatsDialog close={() => close()} openConversation={openConversation} />, {
    surface: "bare",
    header: false,
    ...panelDialogOptions,
  });
