import { ssr } from "@valentinkolb/cloud/core/config";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { createPagination, hasRole, type BaseGroup, type BaseUser } from "@/accounts/contracts";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import GroupSidebar from "../GroupSidebar.island";
import { accountsService } from "../../../service";
import { GROUPS_CONTEXT_QUERY_KEYS, buildGroupDetailUrl, buildGroupsUrl, parseGroupsListState } from "../../lib/url-state";
import GroupActions from "./GroupActions.island";
import ManagersTab from "./ManagersTab";
import MemberOfTab from "./MemberOfTab";
import MembersTab from "./MembersTab";

const TABS = ["members", "managers", "member-of"] as const;

type Tab = (typeof TABS)[number];

export default ssr<AuthContext>(async (c) => {
  const cn = c.req.param("cn");
  const user = c.get("user");
  const isAdmin = hasRole(user, "admin");

  const listState = parseGroupsListState(
    {
      search: c.req.query("list_search"),
      page: c.req.query("list_page"),
      showAll: c.req.query("list_show_all"),
    },
    { keys: GROUPS_CONTEXT_QUERY_KEYS, defaultShowAll: isAdmin },
  );

  const groupsListHref = buildGroupsUrl(listState, {
    defaultShowAll: isAdmin,
  });

  const group = await accountsService.group.get({ cn });

  if (!group) {
    return (
      <Layout
        c={c}
        fullWidth
        title={[
          { title: "Start", href: "/" },
          { title: "Accounts", href: "/app/accounts" },
          { title: "Groups", href: "/app/accounts/groups" },
          { title: "Not Found" },
        ]}
      >
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center text-dimmed flex flex-col items-center gap-2">
            <i class="ti ti-alert-circle text-4xl" />
            <p class="text-sm">Group "{cn}" not found.</p>
            <a href={groupsListHref} class="text-xs hover:text-primary">
              Back to Groups
            </a>
          </div>
        </div>
      </Layout>
    );
  }

  const canManage = isAdmin || user.manages.includes(cn);
  const requestedTab = c.req.query("tab") as Tab;
  const tab = (TABS.includes(requestedTab) && (requestedTab !== "member-of" || isAdmin) ? requestedTab : "members") as Tab;

  const rawPage = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const perPage = 40;
  const search = c.req.query("search") ?? "";
  const indirect = c.req.query("indirect") === "true";

  const buildDetailHref = (targetCn: string, overrides: Record<string, string | null | undefined> = {}): string => {
    const base = buildGroupDetailUrl(targetCn, listState, {
      keys: GROUPS_CONTEXT_QUERY_KEYS,
      defaultShowAll: isAdmin,
    });
    const url = new URL(base, "https://local.invalid");

    for (const [key, value] of Object.entries(overrides)) {
      if (value === null || value === undefined || value.length === 0) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    }

    return `${url.pathname}${url.search}`;
  };

  const [sidebarGroupsPage, parentGroupsPage, managedGroupsPage] = await Promise.all([
    accountsService.group.list({
      pagination: { page: listState.page, perPage },
      filter: { search: listState.search || undefined },
      scope: { userId: listState.showAll ? undefined : user.id },
    }),
    accountsService.group.parent.list({ cn }),
    accountsService.group.managedGroup.list({ cn }),
  ]);

  const parentGroups = parentGroupsPage.items;
  const managedGroups = managedGroupsPage.items;

  let membersData = {
    users: [] as BaseUser[],
    total: 0,
  };
  let memberGroupCns: string[] = [];
  let memberGroups: BaseGroup[] = [];
  let managerUsers: BaseUser[] = [];
  let managerGroupCns: string[] = [];
  let managerGroups: BaseGroup[] = [];
  let parentGroupsData: BaseGroup[] = [];
  let directMemberUserUids: string[] = [];
  let directMemberGroupCns: string[] = [];

  if (tab === "members") {
    const members =
      (
        await accountsService.group.member.list({
          cn,
          recursive: indirect,
        })
      ).items ?? [];

    const memberUserUids = members.filter((m) => m.type === "user").map((m) => m.id);

    memberGroupCns = members.filter((m) => m.type === "group").map((m) => m.id);

    if (indirect) {
      const directMembers =
        (
          await accountsService.group.member.list({
            cn,
            recursive: false,
          })
        ).items ?? [];

      directMemberUserUids = directMembers.filter((m) => m.type === "user").map((m) => m.id);

      directMemberGroupCns = directMembers.filter((m) => m.type === "group").map((m) => m.id);
    }

    const [usersPage, memberGroupsPage] = await Promise.all([
      accountsService.user.list({
        scope: { uids: memberUserUids },
        filter: { search: search || undefined },
        pagination: { page, perPage },
      }),
      accountsService.group.list({ scope: { cns: memberGroupCns } }),
    ]);

    membersData = {
      users: usersPage.items,
      total: usersPage.total,
    };
    memberGroups = memberGroupsPage.items;
  } else if (tab === "managers") {
    const managers = (await accountsService.group.manager.list({ cn })).items;

    const managerUserUids = managers.filter((m) => m.type === "user").map((m) => m.id);

    managerGroupCns = managers.filter((m) => m.type === "group").map((m) => m.id);

    const [usersPage, managerGroupsPage] = await Promise.all([
      accountsService.user.list({
        scope: { uids: managerUserUids },
        pagination: { page: 1, perPage: 100 },
      }),
      accountsService.group.list({ scope: { cns: managerGroupCns } }),
    ]);

    managerUsers = usersPage.items;
    managerGroups = managerGroupsPage.items;
  } else if (tab === "member-of") {
    parentGroupsData = (await accountsService.group.list({ scope: { cns: parentGroups } })).items ?? [];
  }

  const pagination = tab === "members" ? createPagination({ page, perPage, offset: (page - 1) * perPage }, membersData.total) : null;

  return (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Accounts", href: "/app/accounts" },
        { title: "Groups", href: "/app/accounts/groups" },
        { title: cn },
      ]}
    >
      <div class="app-cols h-full">
        <div class="hidden lg:flex flex-col w-48 shrink-0 overflow-y-auto">
          <GroupSidebar
            groups={sidebarGroupsPage.items}
            total={sidebarGroupsPage.total}
            perPage={perPage}
            activeCn={cn}
            isAdmin={isAdmin}
            managedCns={user.manages}
            listState={listState}
            detailQueryKeys={GROUPS_CONTEXT_QUERY_KEYS}
            defaultShowAll={isAdmin}
          />
        </div>

        <div class="flex-1 min-w-0 flex flex-col">
          <div class="lg:hidden px-3 pt-2 pb-1">
            <a href={groupsListHref} class="list-item text-xs">
              <i class="ti ti-arrow-left text-sm" />
              <span>All Groups</span>
            </a>
          </div>
          <div class="divider lg:hidden" />

          <div class="flex-1 min-h-0 overflow-y-auto">
            <div class="flex flex-col gap-4 p-4">
              <div class="flex items-start gap-3">
                <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 h-10 w-10">
                  <i class="ti ti-users-group text-lg" />
                </div>
                <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-base font-semibold text-primary">{group.cn}</span>
                    {group.gidnumber && (
                      <span class="tag bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 shrink-0">POSIX</span>
                    )}
                    {group.gidnumber && (
                      <span class="tag bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 shrink-0">GID {group.gidnumber}</span>
                    )}
                  </div>
                  <span class="text-xs text-dimmed">{group.description || "No description"}</span>
                </div>
                {isAdmin && (
                  <GroupActions cn={group.cn} isPosix={!!group.gidnumber} description={group.description} listHref={groupsListHref} />
                )}
              </div>

              {(parentGroups.length > 0 || managedGroups.length > 0) && (
                <div class="flex flex-col md:flex-row gap-2">
                  {parentGroups.length > 0 && (
                    <div class="paper p-3 flex flex-col gap-1.5 flex-1">
                      <span class="section-label mb-0">Member of</span>
                      <div class="flex items-center gap-1 flex-wrap">
                        {parentGroups.map((parentCn) => (
                          <a
                            href={buildDetailHref(parentCn)}
                            class="tag bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/80 transition-colors"
                          >
                            {parentCn}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {managedGroups.length > 0 && (
                    <div class="paper p-3 flex flex-col gap-1.5 flex-1">
                      <span class="section-label mb-0">Manages</span>
                      <div class="flex items-center gap-1 flex-wrap">
                        {managedGroups.map((managedCn) => (
                          <a
                            href={buildDetailHref(managedCn)}
                            class="tag bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/80 transition-colors"
                          >
                            {managedCn}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {canManage && !isAdmin && (
                <div class="info-block-info text-xs">You are a manager of this group and can add or remove members.</div>
              )}

              <div class="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-700">
                <a
                  href={buildDetailHref(cn, {
                    tab: "members",
                    search: null,
                    page: null,
                    indirect: null,
                  })}
                  class={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    tab === "members"
                      ? "border-zinc-800 dark:border-zinc-200 text-primary"
                      : "border-transparent text-dimmed hover:text-primary"
                  }`}
                >
                  Members
                </a>
                <a
                  href={buildDetailHref(cn, {
                    tab: "managers",
                    search: null,
                    page: null,
                    indirect: null,
                  })}
                  class={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                    tab === "managers"
                      ? "border-zinc-800 dark:border-zinc-200 text-primary"
                      : "border-transparent text-dimmed hover:text-primary"
                  }`}
                >
                  Managers
                </a>
                {isAdmin && (
                  <a
                    href={buildDetailHref(cn, {
                      tab: "member-of",
                      search: null,
                      page: null,
                      indirect: null,
                    })}
                    class={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                      tab === "member-of"
                        ? "border-zinc-800 dark:border-zinc-200 text-primary"
                        : "border-transparent text-dimmed hover:text-primary"
                    }`}
                  >
                    Member Of
                  </a>
                )}
              </div>

              {tab === "members" && pagination && (
                <MembersTab
                  users={membersData.users}
                  memberGroups={memberGroups}
                  pagination={pagination}
                  search={search}
                  cn={cn}
                  allMemberIds={membersData.users.map((u) => u.id)}
                  allMemberGroupCns={memberGroupCns}
                  isAdmin={isAdmin}
                  canManage={canManage}
                  indirect={indirect}
                  directMemberUserUids={directMemberUserUids}
                  directMemberGroupCns={directMemberGroupCns}
                  groupHref={(groupCn) => buildDetailHref(groupCn)}
                />
              )}

              {tab === "managers" && (
                <ManagersTab
                  managerUsers={managerUsers}
                  managerGroups={managerGroups}
                  cn={cn}
                  allManagerIds={managerUsers.map((u) => u.id)}
                  allManagerGroupCns={managerGroupCns}
                  isAdmin={isAdmin}
                  groupHref={(groupCn) => buildDetailHref(groupCn)}
                />
              )}

              {tab === "member-of" && (
                <MemberOfTab
                  cn={cn}
                  parentGroups={parentGroupsData}
                  allParentGroupCns={parentGroups}
                  isAdmin={isAdmin}
                  groupHref={(groupCn) => buildDetailHref(groupCn)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
