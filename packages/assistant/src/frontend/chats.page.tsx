import { aiConversationStore, type AiConversationStatusFilter } from "@valentinkolb/cloud/ai";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { AppWorkspace, Pagination, Placeholder } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import AssistantAllChatsList from "./AssistantAllChatsList.island";
import AssistantLayoutHelp from "./AssistantLayoutHelp.island";
import AssistantSidebarStandalone from "./AssistantSidebarStandalone.island";

const ASSISTANT_APP_ID = "assistant";
const ALL_CHATS_PER_PAGE = 50;

const parsePage = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

type ChatView = "all" | "running" | "needs_attention" | "failed" | "unread" | "archived";

const CHAT_VIEWS: { value: ChatView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "failed", label: "Failed" },
  { value: "unread", label: "New responses" },
  { value: "archived", label: "Archived" },
];

const parseView = (value: string | undefined): ChatView => (CHAT_VIEWS.some((view) => view.value === value) ? (value as ChatView) : "all");

const emptyViewText = (view: ChatView, search: string): string => {
  if (search) return "No chats match your search.";
  if (view === "archived") return "No archived chats.";
  if (view === "running") return "No chats are running.";
  if (view === "needs_attention") return "No chats need attention.";
  if (view === "failed") return "No failed chats.";
  if (view === "unread") return "No new responses.";
  return "No chats yet.";
};

const buildAllChatsUrl = (params: { search?: string; page?: number; view?: ChatView }) => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.view && params.view !== "all") query.set("view", params.view);
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const search = query.toString();
  return search ? `/app/assistant/chats?${search}` : "/app/assistant/chats";
};

const paginationBaseUrl = (search: string, view: ChatView): string => {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  if (view !== "all") query.set("view", view);
  const value = query.toString();
  return value ? `/app/assistant/chats?${value}&page=` : "/app/assistant/chats?page=";
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const search = (c.req.query("search") ?? "").trim();
  const view = parseView(c.req.query("view"));
  const page = parsePage(c.req.query("page"));
  const [recentConversations, conversationsPage] = await Promise.all([
    aiConversationStore.listConversations({ appId: ASSISTANT_APP_ID, ownerUserId: user.id }),
    aiConversationStore.listConversationsPage({
      appId: ASSISTANT_APP_ID,
      ownerUserId: user.id,
      search: search || undefined,
      archived: view === "archived",
      status: view !== "all" && view !== "archived" ? (view as AiConversationStatusFilter) : undefined,
      page,
      perPage: ALL_CHATS_PER_PAGE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(conversationsPage.total / conversationsPage.perPage));

  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Assistant", href: "/app/assistant" }, { title: "All Chats" }]}>
      <AssistantLayoutHelp />
      <AppWorkspace class="cloud-ui-soft flex-1 min-h-0">
        <AssistantSidebarStandalone initialConversations={recentConversations} activeView="all" />

        <AppWorkspace.Main>
          <header
            class="flex shrink-0 flex-col gap-3 border-b border-[var(--ui-divider)] px-[var(--ui-space-section)] py-4"
            style="view-transition-name: assistant-all-chats-header"
          >
            <div class="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="min-w-0 shrink-0">
                <h1 class="whitespace-nowrap text-base font-semibold text-primary">All Chats</h1>
                <p class="mt-0.5 text-xs text-dimmed">
                  {conversationsPage.total} {conversationsPage.total === 1 ? "chat" : "chats"}
                </p>
              </div>
              <div class="w-full lg:max-w-sm">
                <SearchBar
                  action={buildAllChatsUrl({ page: 1, view })}
                  value={search}
                  placeholder="Search chats..."
                  ariaLabel="Search chats"
                />
              </div>
            </div>
            <nav class="flex max-w-full gap-1 overflow-x-auto pb-0.5" aria-label="Chat filters">
              {CHAT_VIEWS.map((option) => (
                <a
                  href={buildAllChatsUrl({ search, view: option.value })}
                  class={`btn-input btn-input-sm shrink-0 ${option.value === view ? "bg-[var(--ui-selected)] text-primary" : ""}`}
                  aria-current={option.value === view ? "page" : undefined}
                >
                  {option.label}
                </a>
              ))}
            </nav>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-[var(--ui-space-section)] py-3" data-scroll-preserve="assistant-all-chats">
            {conversationsPage.items.length === 0 ? (
              <Placeholder surface="paper">{emptyViewText(view, search)}</Placeholder>
            ) : (
              <AssistantAllChatsList conversations={conversationsPage.items} archived={view === "archived"} />
            )}
          </div>

          <div class="shrink-0 border-t border-[var(--ui-divider)] px-[var(--ui-space-section)] py-2">
            <Pagination currentPage={conversationsPage.page} totalPages={totalPages} baseUrl={paginationBaseUrl(search, view)} />
          </div>
        </AppWorkspace.Main>
      </AppWorkspace>
    </Layout>
  );
});
