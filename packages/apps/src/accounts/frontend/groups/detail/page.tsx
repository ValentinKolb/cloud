import { ssr } from "@valentinkolb/cloud/core/config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/core/services";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { getSync } from "@valentinkolb/cloud-core/services/settings";
import { createPagination, type BaseGroup, type BaseUser } from "@/accounts/contracts";
import { canManageGroup, getDefaultGroupScope, isAdminUser } from "@valentinkolb/cloud/lib/shared";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import AccountsNavSidebar from "../../AccountsNavSidebar";
import { GROUPS_CONTEXT_QUERY_KEYS, buildGroupDetailUrl, buildGroupsUrl, parseGroupsListState } from "../../lib/url-state";
import GroupActions from "./GroupActions.island";
import ManagersTab from "./ManagersTab";
import MemberOfTab from "./MemberOfTab";
import MembersTab from "./MembersTab";
import { getProviderBadge } from "../../lib/account-badges";

const TABS = ["members", "managers", "member-of"] as const;

type Tab = (typeof TABS)[number];

export default ssr<AuthContext>(async (c) => {
  const groupId = c.req.param("id");
  const user = c.get("user");
  const isAdmin = isAdminUser(user);
  const freeIpaEnabled = Boolean(getSync<boolean>("freeipa.enable"));
  const defaultScope = getDefaultGroupScope(user);

  const listState = parseGroupsListState(
    {
      search: c.req.query("list_search"),
      page: c.req.query("list_page"),
      provider: c.req.query("list_provider"),
      scope: c.req.query("list_scope"),
      showAll: c.req.query("list_show_all"),
    },
    { keys: GROUPS_CONTEXT_QUERY_KEYS, defaultScope },
  );

  const groupsListHref = buildGroupsUrl(listState, {
    defaultScope,
  });
  const groupsBackLabel =
    listState.scope === "managed" ? "Managed Groups" : listState.scope === "member" ? "My Groups" : "All Groups";

  const group = await accountsService.group.get({ id: groupId });

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
            <p class="text-sm">Group not found.</p>
            <a href={groupsListHref} class="text-xs hover:text-primary">
              Back to Groups
            </a>
          </div>
        </div>
      </Layout>
    );
  }

  const canManage = canManageGroup(user, groupId);
  const providerBadge = group ? getProviderBadge(group.provider) : null;
  const requestedTab = c.req.query("tab") as Tab;
  const tab = (TABS.includes(requestedTab) && (requestedTab !== "member-of" || isAdmin) ? requestedTab : "members") as Tab;
  const canMutateGroup = group.provider === "local" || freeIpaEnabled;
  const canManageMutations = canManage && canMutateGroup;

  const rawPage = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const perPage = 40;
  const search = c.req.query("search") ?? "";
  const indirect = c.req.query("indirect") === "true";

  const buildDetailHref = (targetGroupId: string, overrides: Record<string, string | null | undefined> = {}): string => {
    const base = buildGroupDetailUrl(targetGroupId, listState, {
      keys: GROUPS_CONTEXT_QUERY_KEYS,
      defaultScope,
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

  const membersPageBaseUrl = `${buildDetailHref(groupId, {
    tab: "members",
    page: null,
  })}${buildDetailHref(groupId, { tab: "members", page: null }).includes("?") ? "&" : "?"}page=`;
  const toggleIndirectUrl = buildDetailHref(groupId, {
    tab: "members",
    indirect: indirect ? null : "true",
    page: null,
  });

  const [pendingRequestsPage, parentGroupIdsPage, managedGroupIdsPage] = await Promise.all([
    isAdmin
      ? accountsService.accountRequest.list({
          access: { userId: user.id, isAdmin: true },
          filter: { status: "pending" },
        })
      : Promise.resolve({ total: 0 }),
    accountsService.group.parent.list({ id: groupId }),
    accountsService.group.managedGroup.list({ id: groupId }),
  ]);

  const parentGroupIds = parentGroupIdsPage.items;
  const managedGroupIds = managedGroupIdsPage.items;

  let membersData = {
    users: [] as BaseUser[],
    total: 0,
  };
  let memberGroupIds: string[] = [];
  let memberGroups: BaseGroup[] = [];
  let managerUsers: BaseUser[] = [];
  let managerGroupIds: string[] = [];
  let managerGroups: BaseGroup[] = [];
  let parentGroupsData: BaseGroup[] = [];
  let directMemberUserUids: string[] = [];
  let directMemberGroupIds: string[] = [];

  if (tab === "members") {
    const members =
      (
        await accountsService.group.member.list({
          id: groupId,
          recursive: indirect,
        })
      ).items ?? [];

    const memberUserUids = members.filter((m) => m.type === "user").map((m) => m.id);
    memberGroupIds = members.filter((m) => m.type === "group").map((m) => m.id);

    if (indirect) {
      const directMembers =
        (
          await accountsService.group.member.list({
            id: groupId,
            recursive: false,
          })
        ).items ?? [];

      directMemberUserUids = directMembers.filter((m) => m.type === "user").map((m) => m.id);
      directMemberGroupIds = directMembers.filter((m) => m.type === "group").map((m) => m.id);
    }

    const [usersPage, memberGroupsPage] = await Promise.all([
      accountsService.user.list({
        scope: { uids: memberUserUids },
        filter: { search: search || undefined },
        pagination: { page, perPage },
      }),
      accountsService.group.list({ scope: { ids: memberGroupIds } }),
    ]);

    membersData = {
      users: usersPage.items,
      total: usersPage.total,
    };
    memberGroups = memberGroupsPage.items;
  } else if (tab === "managers") {
    const managers = (await accountsService.group.manager.list({ id: groupId })).items;
    const managerUserUids = managers.filter((m) => m.type === "user").map((m) => m.id);
    managerGroupIds = managers.filter((m) => m.type === "group").map((m) => m.id);

    const [usersPage, managerGroupsPage] = await Promise.all([
      accountsService.user.list({
        scope: { uids: managerUserUids },
        pagination: { page: 1, perPage: 100 },
      }),
      accountsService.group.list({ scope: { ids: managerGroupIds } }),
    ]);

    managerUsers = usersPage.items;
    managerGroups = managerGroupsPage.items;
  } else if (tab === "member-of") {
    parentGroupsData = (await accountsService.group.list({ scope: { ids: parentGroupIds } })).items ?? [];
  }

  const [parentGroupsForSummary, managedGroupsForSummary] = await Promise.all([
    parentGroupIds.length > 0 ? accountsService.group.list({ scope: { ids: parentGroupIds } }) : Promise.resolve({ items: [] as BaseGroup[] }),
    managedGroupIds.length > 0 ? accountsService.group.list({ scope: { ids: managedGroupIds } }) : Promise.resolve({ items: [] as BaseGroup[] }),
  ]);

  const pagination = tab === "members" ? createPagination({ page, perPage, offset: (page - 1) * perPage }, membersData.total) : null;

  return (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Accounts", href: "/app/accounts" },
        { title: "Groups", href: "/app/accounts/groups" },
        { title: group.name },
      ]}
    >
      <div class="app-cols h-full">
        <AccountsNavSidebar active="groups" isAdmin={isAdmin} pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 flex flex-col">
          <div class="flex-1 min-h-0 overflow-y-auto">
            <div class="flex flex-col gap-4 p-4">
              <div>
                <a href={groupsListHref} class="btn-secondary btn-sm">
                  <i class="ti ti-arrow-left" />
                  {groupsBackLabel}
                </a>
              </div>

              <div class="flex items-start gap-3">
                <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 h-10 w-10">
                  <i class="ti ti-users-group text-lg" />
                </div>
                <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-base font-semibold text-primary">{group.name}</span>
                    {providerBadge && (
                      <span class={`tag ${providerBadge.className}`}>{providerBadge.label}</span>
                    )}
                    {group.gidnumber && (
                      <span class="tag bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 shrink-0">POSIX</span>
                    )}
                    {group.gidnumber && (
                      <span class="tag bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 shrink-0">GID {group.gidnumber}</span>
                    )}
                  </div>
                  <span class="text-xs text-dimmed">{group.description || "No description"}</span>
                </div>
                {isAdmin && canMutateGroup && (
                  <GroupActions
                    id={group.id}
                    name={group.name}
                    provider={group.provider}
                    isPosix={!!group.gidnumber}
                    description={group.description}
                    listHref={groupsListHref}
                  />
                )}
              </div>

              {(parentGroupsForSummary.items.length > 0 || managedGroupsForSummary.items.length > 0) && (
                <div class="flex flex-col md:flex-row gap-2">
                  {isAdmin && parentGroupsForSummary.items.length > 0 && (
                    <div class="paper p-3 flex flex-col gap-1.5 flex-1">
                      <span class="section-label mb-0">Member of</span>
                      <div class="flex items-center gap-1 flex-wrap">
                        {parentGroupsForSummary.items.map((parentGroup) => (
                          <a
                            href={buildDetailHref(parentGroup.id)}
                            class="tag bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/80 transition-colors"
                          >
                            {parentGroup.name}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {!isAdmin && canManage && parentGroupsForSummary.items.length > 0 && (
                    <details class="paper p-3 flex-1 group">
                      <summary class="flex cursor-pointer list-none items-center justify-between gap-3">
                        <div class="flex flex-col gap-0.5">
                          <span class="section-label mb-0">Member of</span>
                          <span class="text-xs text-dimmed">
                            {parentGroupsForSummary.items.length} parent group{parentGroupsForSummary.items.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <i class="ti ti-chevron-right text-sm text-dimmed transition-transform group-open:rotate-90" />
                      </summary>
                      <div class="mt-3 flex items-center gap-1 flex-wrap">
                        {parentGroupsForSummary.items.map((parentGroup) => (
                          <a
                            href={buildDetailHref(parentGroup.id)}
                            class="tag bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/80 transition-colors"
                          >
                            {parentGroup.name}
                          </a>
                        ))}
                      </div>
                    </details>
                  )}

                  {managedGroupsForSummary.items.length > 0 && (
                    <div class="paper p-3 flex flex-col gap-1.5 flex-1">
                      <span class="section-label mb-0">Manages</span>
                      <div class="flex items-center gap-1 flex-wrap">
                        {managedGroupsForSummary.items.map((managedGroup) => (
                          <a
                            href={buildDetailHref(managedGroup.id)}
                            class="tag bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/80 transition-colors"
                          >
                            {managedGroup.name}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {canManageMutations && !isAdmin && (
                <div class="info-block-info text-xs">
                  You can manage members and managers here. Group descriptions and hierarchy remain admin-managed.
                </div>
              )}
              {!canMutateGroup && (
                <div class="info-block-warning text-xs">
                  FreeIPA is currently disabled. This group stays visible, but directory-backed mutations are unavailable.
                </div>
              )}

              <div class="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-700" role="tablist" aria-label="Group detail sections">
                <a
                  href={buildDetailHref(groupId, {
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
                  role="tab"
                  aria-selected={tab === "members"}
                >
                  Members
                </a>
                <a
                  href={buildDetailHref(groupId, {
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
                  role="tab"
                  aria-selected={tab === "managers"}
                >
                  Managers
                </a>
                {isAdmin && (
                  <a
                    href={buildDetailHref(groupId, {
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
                    role="tab"
                    aria-selected={tab === "member-of"}
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
                  groupId={groupId}
                  allMemberIds={membersData.users.map((u) => u.id)}
                  allMemberGroupIds={memberGroupIds}
                  isAdmin={isAdmin}
                  canManage={canManageMutations}
                  indirect={indirect}
                  directMemberUserUids={directMemberUserUids}
                  directMemberGroupIds={directMemberGroupIds}
                  groupHref={(targetGroupId) => buildDetailHref(targetGroupId)}
                  pageBaseUrl={membersPageBaseUrl}
                  toggleIndirectUrl={toggleIndirectUrl}
                />
              )}

              {tab === "managers" && (
                <ManagersTab
                  managerUsers={managerUsers}
                  managerGroups={managerGroups}
                  groupId={groupId}
                  allManagerIds={managerUsers.map((u) => u.id)}
                  allManagerGroupIds={managerGroupIds}
                  canManage={canManageMutations}
                  isAdmin={isAdmin}
                  groupHref={(targetGroupId) => buildDetailHref(targetGroupId)}
                />
              )}

              {tab === "member-of" && (
                <MemberOfTab
                  groupId={groupId}
                  parentGroups={parentGroupsData}
                  allParentGroupIds={parentGroupIds}
                  isAdmin={isAdmin && canMutateGroup}
                  groupHref={(targetGroupId) => buildDetailHref(targetGroupId)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
