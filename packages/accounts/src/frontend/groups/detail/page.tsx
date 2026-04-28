import { ssr } from "../../../config";
import { accountsAppService as accountsService, coreSettings } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { createPagination } from "@/contracts";
import { canManageGroup, getDefaultGroupScope, isAdminUser } from "@valentinkolb/cloud/shared";
import { type AuthContext } from "@valentinkolb/cloud/server";
import type { JSX } from "solid-js/jsx-runtime";
import AccountsNavSidebar from "../../AccountsNavSidebar";
import { GROUPS_CONTEXT_QUERY_KEYS, buildGroupDetailUrl, buildGroupsUrl, parseGroupsListState } from "../../lib/url-state";
import GroupActions from "./GroupActions.island";
import ManagersTab from "./ManagersTab";
import MemberOfTab from "./MemberOfTab";
import MembersTab from "./MembersTab";
import { getProviderBadge } from "../../lib/account-badges";

const TABS = ["members", "managers", "member-of"] as const;
const TAB_META: Record<(typeof TABS)[number], { label: string; icon: string }> = {
  members: { label: "Members", icon: "ti ti-users-group" },
  managers: { label: "Managers", icon: "ti ti-user-cog" },
  "member-of": { label: "Member Of", icon: "ti ti-folders" },
};

type Tab = (typeof TABS)[number];

export default ssr<AuthContext>(async (c) => {
  const groupId = c.req.param("id");
  const user = c.get("user");
  const isAdmin = isAdminUser(user);
  const freeIpaEnabled = Boolean(await coreSettings.get<boolean>("freeipa.enable"));
  const defaultScope = getDefaultGroupScope(user);

  const listState = parseGroupsListState(
    {
      search: c.req.query("list_search"),
      page: c.req.query("list_page"),
      provider: c.req.query("list_provider"),
      scope: c.req.query("list_scope"),
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
    return () => (
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
  const perPage = 100;
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
    search: search || null,
    indirect: indirect ? "true" : null,
    page: null,
  })}${buildDetailHref(groupId, { tab: "members", search: search || null, indirect: indirect ? "true" : null, page: null }).includes("?") ? "&" : "?"}page=`;
  const managersPageBaseUrl = `${buildDetailHref(groupId, {
    tab: "managers",
    search: search || null,
    page: null,
  })}${buildDetailHref(groupId, { tab: "managers", search: search || null, page: null }).includes("?") ? "&" : "?"}page=`;
  const memberOfPageBaseUrl = `${buildDetailHref(groupId, {
    tab: "member-of",
    search: search || null,
    page: null,
  })}${buildDetailHref(groupId, { tab: "member-of", search: search || null, page: null }).includes("?") ? "&" : "?"}page=`;
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

  let memberItems = [] as Awaited<ReturnType<typeof accountsService.entity.list>>["items"];
  let managerItems = [] as Awaited<ReturnType<typeof accountsService.entity.list>>["items"];
  let parentItems = [] as Awaited<ReturnType<typeof accountsService.entity.list>>["items"];
  let directMemberUserIds: string[] = [];
  let directMemberGroupIds: string[] = [];
  let directManagerUserIds: string[] = [];
  let directManagerGroupIds: string[] = [];
  let membersPagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, 0);
  let managersPagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, 0);
  let memberOfPagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, 0);

  if (tab === "members") {
    const [membersPage, directMembersPage] = await Promise.all([
      accountsService.entity.list({
        pagination: { page, perPage },
        search: search || undefined,
        memberOfGroupId: groupId,
        recursive: indirect,
      }),
      accountsService.group.member.list({
        id: groupId,
        recursive: false,
      }),
    ]);

    memberItems = membersPage.items;
    directMemberUserIds = directMembersPage.items.filter((member) => member.type === "user").map((member) => member.id);
    directMemberGroupIds = directMembersPage.items.filter((member) => member.type === "group").map((member) => member.id);
    membersPagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, membersPage.total);
  } else if (tab === "managers") {
    const [managersPage, directManagersPage] = await Promise.all([
      accountsService.entity.list({
        pagination: { page, perPage },
        search: search || undefined,
        managerOfGroupId: groupId,
      }),
      accountsService.group.manager.list({
        id: groupId,
      }),
    ]);

    managerItems = managersPage.items;
    directManagerUserIds = directManagersPage.items.filter((manager) => manager.type === "user").map((manager) => manager.id);
    directManagerGroupIds = directManagersPage.items.filter((manager) => manager.type === "group").map((manager) => manager.id);
    managersPagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, managersPage.total);
  } else if (tab === "member-of") {
    const parentGroupsPage = await accountsService.entity.list({
      pagination: { page, perPage },
      search: search || undefined,
      parentGroupId: groupId,
      kinds: ["group"],
    });

    parentItems = parentGroupsPage.items;
    memberOfPagination = createPagination({ page, perPage, offset: (page - 1) * perPage }, parentGroupsPage.total);
  }

  const facts: Array<{ label: string; value: JSX.Element }> = [
    {
      label: "Provider",
      value: <span>{group.provider === "ipa" ? "FreeIPA" : "Local"}</span>,
    },
    {
      label: "Description",
      value: group.description ? <span>{group.description}</span> : <span class="italic text-dimmed">No description</span>,
    },
    {
      label: "Group type",
      value: <span>{group.gidnumber ? "POSIX group" : "Standard group"}</span>,
    },
    {
      label: "GID",
      value: group.gidnumber ? <span class="font-mono">{group.gidnumber}</span> : <span class="italic text-dimmed">Not set</span>,
    },
    {
      label: "Parent groups",
      value: <span>{parentGroupIds.length}</span>,
    },
    {
      label: "Managed groups",
      value: <span>{managedGroupIds.length}</span>,
    },
    {
      label: "Access",
      value: <span>{canManage ? "Can manage members" : "Read-only"}</span>,
    },
    {
      label: "Mutations",
      value: <span>{canMutateGroup ? "Available" : "Unavailable while FreeIPA is disabled"}</span>,
    },
  ];

  const activeCountText =
    tab === "members"
      ? `${membersPagination.total} ${search ? "matching " : ""}member${membersPagination.total === 1 ? "" : "s"}`
      : tab === "managers"
        ? `${managersPagination.total} ${search ? "matching " : ""}manager${managersPagination.total === 1 ? "" : "s"}`
        : `${memberOfPagination.total} ${search ? "matching " : ""}parent group${memberOfPagination.total === 1 ? "" : "s"}`;

  return () => (
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
            <div class="flex flex-col gap-3">
              <div>
                <a href={groupsListHref} class="btn-secondary btn-sm">
                  <i class="ti ti-arrow-left" />
                  {groupsBackLabel}
                </a>
              </div>

              <div class="flex flex-wrap items-start justify-between gap-3" style="view-transition-name: accounts-group-title">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <h1 class="text-base font-semibold text-primary">{group.name}</h1>
                    {providerBadge && <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerBadge.className}`}>{providerBadge.label}</span>}
                    {group.gidnumber && (
                      <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        POSIX
                      </span>
                    )}
                  </div>
                  <p class="mt-1 truncate text-xs text-dimmed">
                    {group.description || "No description"}
                    {group.gidnumber ? ` · GID ${group.gidnumber}` : ""}
                  </p>
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

              <div class="paper overflow-hidden" style="view-transition-name: accounts-group-facts">
                <dl class="grid gap-px bg-zinc-100 dark:bg-zinc-800 sm:grid-cols-2 xl:grid-cols-4">
                  {facts.map((fact) => (
                    <div class="min-w-0 bg-white px-3 py-2.5 dark:bg-zinc-900">
                      <dt class="text-[11px] uppercase tracking-[0.22em] text-dimmed">{fact.label}</dt>
                      <dd class="mt-1 min-w-0 truncate text-xs text-primary">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {canManageMutations && !isAdmin && <p class="text-xs text-dimmed">You can manage members and managers here.</p>}
              {!canMutateGroup && (
                <p class="text-xs text-amber-700 dark:text-amber-300">FreeIPA is currently disabled. This group stays visible, but directory-backed mutations are unavailable.</p>
              )}

              <div class="flex flex-wrap items-start justify-between gap-2" style="view-transition-name: accounts-group-tabs">
                <nav class="flex flex-wrap items-center gap-1" aria-label="Group detail sections">
                  {TABS.filter((entryTab) => entryTab !== "member-of" || isAdmin).map((entryTab) => (
                    <a
                      href={buildDetailHref(groupId, {
                        tab: entryTab,
                        search: null,
                        page: null,
                        indirect: null,
                      })}
                      class={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                        tab === entryTab
                          ? "border-blue-500/35 bg-blue-50 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200"
                          : "text-dimmed hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-800"
                      }`}
                      role="tab"
                      aria-selected={tab === entryTab}
                    >
                      <i class={`${TAB_META[entryTab].icon} text-sm`} />
                      <span>{TAB_META[entryTab].label}</span>
                    </a>
                  ))}
                </nav>
                <p class="px-1 py-2 text-xs text-dimmed">{activeCountText}</p>
              </div>

              {tab === "members" && (
                <MembersTab
                  items={memberItems}
                  pagination={membersPagination}
                  search={search}
                  groupId={groupId}
                  groupProvider={group.provider}
                  allMemberIds={directMemberUserIds}
                  allMemberGroupIds={directMemberGroupIds}
                  isAdmin={isAdmin}
                  canManage={canManageMutations}
                  indirect={indirect}
                  groupHref={(targetGroupId) => buildDetailHref(targetGroupId)}
                  pageBaseUrl={membersPageBaseUrl}
                  toggleIndirectUrl={toggleIndirectUrl}
                />
              )}

              {tab === "managers" && (
                <ManagersTab
                  items={managerItems}
                  pagination={managersPagination}
                  groupId={groupId}
                  groupProvider={group.provider}
                  allManagerIds={directManagerUserIds}
                  allManagerGroupIds={directManagerGroupIds}
                  canManage={canManageMutations}
                  isAdmin={isAdmin}
                  groupHref={(targetGroupId) => buildDetailHref(targetGroupId)}
                  pageBaseUrl={managersPageBaseUrl}
                />
              )}

              {tab === "member-of" && (
                <MemberOfTab
                  groupId={groupId}
                  groupProvider={group.provider}
                  items={parentItems}
                  allParentGroupIds={parentGroupIds}
                  isAdmin={isAdmin && canMutateGroup}
                  groupHref={(targetGroupId) => buildDetailHref(targetGroupId)}
                  pagination={memberOfPagination}
                  pageBaseUrl={memberOfPageBaseUrl}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
