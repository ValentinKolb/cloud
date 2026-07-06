import { aiConversationStore } from "@valentinkolb/cloud/ai";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { AppWorkspace, Pagination, Placeholder } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import AssistantAllChatsList from "./AssistantAllChatsList.island";
import AssistantSidebarStandalone from "./AssistantSidebarStandalone.island";

const ASSISTANT_APP_ID = "assistant";
const ALL_CHATS_PER_PAGE = 50;

const parsePage = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const buildAllChatsUrl = (params: { search?: string; page?: number }) => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const search = query.toString();
  return search ? `/app/assistant/chats?${search}` : "/app/assistant/chats";
};

const paginationBaseUrl = (search: string): string => {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  const value = query.toString();
  return value ? `/app/assistant/chats?${value}&page=` : "/app/assistant/chats?page=";
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const search = (c.req.query("search") ?? "").trim();
  const page = parsePage(c.req.query("page"));
  const [recentConversations, conversationsPage] = await Promise.all([
    aiConversationStore.listConversations({ appId: ASSISTANT_APP_ID, ownerUserId: user.id }),
    aiConversationStore.listConversationsPage({
      appId: ASSISTANT_APP_ID,
      ownerUserId: user.id,
      search: search || undefined,
      page,
      perPage: ALL_CHATS_PER_PAGE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(conversationsPage.total / conversationsPage.perPage));

  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Assistant", href: "/app/assistant" }, { title: "All Chats" }]}>
      <AppWorkspace class="flex-1 min-h-0">
        <AssistantSidebarStandalone initialConversations={recentConversations} activeView="all" />

        <AppWorkspace.Main class="bg-zinc-50/70 dark:bg-zinc-950/50">
          <div class="flex min-h-0 flex-1 flex-col gap-3">
            <div class="paper flex shrink-0 flex-col gap-3 p-4" style="view-transition-name: assistant-all-chats-header">
              <div class="flex min-w-0 flex-wrap items-end justify-between gap-3">
                <div class="min-w-0">
                  <h1 class="text-base font-semibold text-primary">All Chats</h1>
                  <p class="mt-1 text-xs text-dimmed">
                    {conversationsPage.total} {conversationsPage.total === 1 ? "chat" : "chats"}
                  </p>
                </div>
              </div>
              <SearchBar
                action={buildAllChatsUrl({ page: 1 })}
                value={search}
                placeholder="Search chats..."
                ariaLabel="Search chats"
              />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto" data-scroll-preserve="assistant-all-chats">
              {conversationsPage.items.length === 0 ? (
                <Placeholder surface="paper">{search ? "No chats match your search." : "No chats yet."}</Placeholder>
              ) : (
                <AssistantAllChatsList conversations={conversationsPage.items} />
              )}
            </div>

            <div class="shrink-0">
              <Pagination currentPage={conversationsPage.page} totalPages={totalPages} baseUrl={paginationBaseUrl(search)} />
            </div>
          </div>
        </AppWorkspace.Main>
      </AppWorkspace>
    </Layout>
  );
});
