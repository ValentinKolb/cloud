import type { AuthContext } from "@valentinkolb/cloud/server";
import { accountsAppService as accountsService, coreSettings } from "@valentinkolb/cloud/services";
import { canManageGroup, getDefaultGroupScope, isAdminUser } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr";
import type { JSX } from "solid-js/jsx-runtime";
import { createPagination } from "@/contracts";
import { expectUserBackedActor } from "@/shared/actor";
import { ssr } from "../../../config";
import AccountsFactGrid from "../../AccountsFactGrid";
import AccountsWorkspace from "../../AccountsWorkspace";
import { getProviderBadge } from "../../lib/account-badges";
import { buildGroupsUrl, GROUPS_CONTEXT_QUERY_KEYS, parseGroupsListState } from "../../lib/url-state";
import GroupActions from "./GroupActions.island";
import {
  buildGroupDetailPageBaseUrl,
  createGroupDetailHrefBuilder,
  GROUP_DETAIL_TAB_META,
  getGroupsBackLabel,
  getVisibleGroupDetailTabs,
  parseGroupDetailTab,
} from "./group-detail-url";
import ManagersTab from "./ManagersTab";
import MemberOfTab from "./MemberOfTab";
import MembersTab from "./MembersTab";

export default ssr<AuthContext>(async (c) => {
  const groupId = c.req.param("id");
  const user = expectUserBackedActor(c);
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
  const groupsBackLabel = getGroupsBackLabel(listState.scope);
  const renderGroupNotFound = () => () => (
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

  if (!groupId) {
    return renderGroupNotFound();
  }

  const group = await accountsService.group.get({ id: groupId });

  if (!group) {
    return renderGroupNotFound();
  }

  const canManage = canManageGroup(user, groupId);
  const providerBadge = group ? getProviderBadge(group.provider) : null;
  const tab = parseGroupDetailTab(c.req.query("tab"), isAdmin);
  const canMutateGroup = group.provider === "local" || freeIpaEnabled;
  const canManageMutations = canManage && canMutateGroup;

  const rawPage = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const perPage = 100;
  const search = c.req.query("search") ?? "";
  const indirect = c.req.query("indirect") === "true";

  const buildDetailHref = createGroupDetailHrefBuilder({ listState, defaultScope });

  const membersPageBaseUrl = buildGroupDetailPageBaseUrl(buildDetailHref, groupId, {
    tab: "members",
    search: search || null,
    indirect: indirect ? "true" : null,
  });
  const managersPageBaseUrl = buildGroupDetailPageBaseUrl(buildDetailHref, groupId, {
    tab: "managers",
    search: search || null,
  });
  const memberOfPageBaseUrl = buildGroupDetailPageBaseUrl(buildDetailHref, groupId, {
    tab: "member-of",
    search: search || null,
  });
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
      <AccountsWorkspace
        active="groups"
        isAdmin={isAdmin}
        pendingRequests={pendingRequestsPage.total}
        scrollPreserveKey="accounts-group-detail"
      >
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
                {providerBadge && (
                  <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerBadge.className}`}>{providerBadge.label}</span>
                )}
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

          <AccountsFactGrid facts={facts} columns={4} viewTransitionName="accounts-group-facts" />

          {canManageMutations && !isAdmin && <p class="text-xs text-dimmed">You can manage members and managers here.</p>}
          {!canMutateGroup && (
            <p class="text-xs text-amber-700 dark:text-amber-300">
              FreeIPA is currently disabled. This group stays visible, but directory-backed mutations are unavailable.
            </p>
          )}

          <div class="flex flex-wrap items-start justify-between gap-2" style="view-transition-name: accounts-group-tabs">
            <nav class="flex flex-wrap items-center gap-1" aria-label="Group detail sections">
              {getVisibleGroupDetailTabs(isAdmin).map((entryTab) => (
                <a
                  href={buildDetailHref(groupId, {
                    tab: entryTab,
                    search: null,
                    page: null,
                    indirect: null,
                  })}
                  class={`btn-input btn-input-sm ${tab === entryTab ? "btn-input-active" : ""}`}
                  role="tab"
                  aria-selected={tab === entryTab}
                >
                  <i class={`${GROUP_DETAIL_TAB_META[entryTab].icon} text-sm`} />
                  <span>{GROUP_DETAIL_TAB_META[entryTab].label}</span>
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
      </AccountsWorkspace>
    </Layout>
  );
});
