import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import UserSidebar from "./UserSidebar.island";
import { accountsService } from "../../service";
import { parseUsersListState } from "../lib/url-state";
type AccountRequest = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  comment: string | null;
  createdAt: string;
}; /** Admin users list page - 2-column layout with sidebar + empty state. */
export default ssr<AuthContext>(async (c) => {
  const perPage = 40;
  const user = c.get("user");
  const listState = parseUsersListState({ search: c.req.query("search"), page: c.req.query("page") });
  const [pendingRequestsPage, usersPage] = await Promise.all([
    accountsService.accountRequest.list({ access: { userId: user.id, isAdmin: true }, filter: { status: "pending" } }),
    accountsService.user.list({ pagination: { page: listState.page, perPage }, filter: { search: listState.search || undefined } }),
  ]);
  const pendingRequests: AccountRequest[] = [...pendingRequestsPage.items].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Users" }]}>
      {" "}
      <div class="app-cols h-full">
        {" "}
        <div class="hidden lg:flex flex-col w-80 shrink-0 overflow-y-auto">
          {" "}
          <UserSidebar
            users={usersPage.items}
            total={usersPage.total}
            perPage={perPage}
            activeId={null}
            pendingRequests={pendingRequests}
            listState={listState}
          />{" "}
        </div>{" "}
        <div class="flex-1 min-w-0 flex flex-col">
          {" "}
          <div class="lg:hidden">
            {" "}
            <UserSidebar
              users={usersPage.items}
              total={usersPage.total}
              perPage={perPage}
              activeId={null}
              pendingRequests={pendingRequests}
              listState={listState}
            />{" "}
          </div>{" "}
          <div class="divider lg:hidden" />{" "}
          <div class="flex-1 flex items-center justify-center">
            {" "}
            <div class="text-center text-dimmed flex flex-col items-center gap-2">
              {" "}
              <i class="ti ti-user text-4xl" /> <p class="text-sm">Select a user</p>{" "}
              <p class="text-xs">{usersPage.total} users available</p>{" "}
            </div>{" "}
          </div>{" "}
        </div>{" "}
      </div>{" "}
    </Layout>
  );
});
