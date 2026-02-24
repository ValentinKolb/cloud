import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { hasRole } from "@/accounts/contracts";
import GroupSidebar from "./GroupSidebar.island";
import { accountsService } from "../../service";
import {
  GROUPS_CONTEXT_QUERY_KEYS,
  parseGroupsListState,
} from "../lib/url-state"; /** Groups page - 2-column layout with sidebar + empty state. */
export default ssr<AuthContext>(async (c) => {
  const sessionUser = c.get("user");
  const isAdmin = hasRole(sessionUser, "admin");
  const perPage = 40;
  const listState = parseGroupsListState(
    { search: c.req.query("search"), page: c.req.query("page"), showAll: c.req.query("show_all") },
    { defaultShowAll: isAdmin },
  );
  const groupsPage = await accountsService.group.list({
    pagination: { page: listState.page, perPage },
    filter: { search: listState.search || undefined },
    scope: { userId: listState.showAll ? undefined : sessionUser.id },
  });
  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Groups" }]}>
      {" "}
      <div class="app-cols h-full">
        {" "}
        <div class="hidden lg:flex flex-col w-48 shrink-0 overflow-y-auto">
          {" "}
          <GroupSidebar
            groups={groupsPage.items}
            total={groupsPage.total}
            perPage={perPage}
            activeCn={null}
            isAdmin={isAdmin}
            managedCns={sessionUser.manages}
            listState={listState}
            detailQueryKeys={GROUPS_CONTEXT_QUERY_KEYS}
            defaultShowAll={isAdmin}
          />{" "}
        </div>{" "}
        <div class="flex-1 min-w-0 flex flex-col">
          {" "}
          <div class="lg:hidden">
            {" "}
            <GroupSidebar
              groups={groupsPage.items}
              total={groupsPage.total}
              perPage={perPage}
              activeCn={null}
              isAdmin={isAdmin}
              managedCns={sessionUser.manages}
              listState={listState}
              detailQueryKeys={GROUPS_CONTEXT_QUERY_KEYS}
              defaultShowAll={isAdmin}
            />{" "}
          </div>{" "}
          <div class="divider lg:hidden" />{" "}
          <div class="flex-1 flex items-center justify-center">
            {" "}
            <div class="text-center text-dimmed flex flex-col items-center gap-2">
              {" "}
              <i class="ti ti-users-group text-4xl" /> <p class="text-sm">Select a group</p>{" "}
              <p class="text-xs">{groupsPage.total} groups available</p>{" "}
            </div>{" "}
          </div>{" "}
        </div>{" "}
      </div>{" "}
    </Layout>
  );
});
