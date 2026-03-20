import { ssr } from "@valentinkolb/cloud/core/config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/core/services";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { getSync } from "@valentinkolb/cloud-core/services/settings";
import { dates } from "@valentinkolb/cloud/lib/shared";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import type { JSX } from "solid-js/jsx-runtime";
import type { BaseGroup } from "@/accounts/contracts";
import AccountsNavSidebar from "../../AccountsNavSidebar";
import { buildUserDetailUrl, buildUsersUrl, parseUsersListState } from "../../lib/url-state";
import AddToGroup from "./AddToGroup.island";
import UserActions from "./UserActions.island";
import RemoveMember from "../../groups/detail/RemoveMember.island";
import {
  getAccountTypeLabel,
  getManagementBadge,
  getManagementLabel,
  getPrimaryAccountBadge,
  getSupplementalRoleColor,
  getSupplementalRoleLabel,
  getSupplementalRoles,
} from "../../lib/account-badges";

const formatAddress = (a: {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
}): string | null => {
  const parts: string[] = [];
  if (a.street) parts.push(a.street);
  if (a.postalCode && a.city) parts.push(`${a.postalCode} ${a.city}`);
  else if (a.city) parts.push(a.city);
  else if (a.postalCode) parts.push(a.postalCode);
  if (a.state) parts.push(a.state);
  return parts.length > 0 ? parts.join(", ") : null;
};

export default ssr<AuthContext>(async (c) => {
  const id = c.req.param("id");
  const recursive = c.req.query("recursive") === "true";
  const freeIpaEnabled = Boolean(getSync<boolean>("freeipa.enable"));

  const listState = parseUsersListState({
    search: c.req.query("search"),
    page: c.req.query("page"),
    provider: c.req.query("provider"),
    profile: c.req.query("profile"),
  });

  const user = await accountsService.user.get({ id });

  if (!user) {
    return (
      <Layout
        c={c}
        fullWidth
        title={[
          { title: "Start", href: "/" },
          { title: "Accounts", href: "/app/accounts" },
          { title: "Users", href: "/app/accounts/users" },
          { title: "Not Found" },
        ]}
      >
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center text-dimmed flex flex-col items-center gap-2">
            <i class="ti ti-user-off text-4xl" />
            <p class="text-sm">User not found.</p>
            <a href={buildUsersUrl(listState)} class="text-xs hover:text-primary">
              Back to Users
            </a>
          </div>
        </div>
      </Layout>
    );
  }

  const isIpaUser = user.provider === "ipa";
  const isGuestProfile = user.profile === "guest";

  const [pendingRequestsPage, recursiveGroupsPage, managedGroupsPage, directGroupIds] = await Promise.all([
    accountsService.accountRequest.list({
      access: { userId: c.get("user").id, isAdmin: true },
      filter: { status: "pending" },
    }),
    accountsService.group.list({
      pagination: { page: 1, perPage: 1000 },
      scope: { userId: id, mode: "member" },
    }),
    accountsService.group.list({
      pagination: { page: 1, perPage: 1000 },
      scope: { userId: id, mode: "managed" },
    }),
    accountsService.user.groupId.list({
      userId: id,
      recursive: false,
    }),
  ]);

  const directGroupsPage = await (
    directGroupIds.length > 0
      ? accountsService.group.list({
          pagination: { page: 1, perPage: 1000 },
          scope: { ids: directGroupIds },
        })
      : {
          items: [] as BaseGroup[],
          page: 1,
          perPage: 0,
          total: 0,
          hasNext: false,
        }
  );

  const allGroups = recursiveGroupsPage.items;
  const directGroups = directGroupsPage.items;
  const directGroupSet = new Set(directGroups.map((group) => group.id));
  const memberGroups = recursive ? allGroups : directGroups;
  const managedGroups = managedGroupsPage.items;

  const isExpired = user.accountExpires ? new Date(user.accountExpires) < new Date() : false;
  const managementBadge = getManagementBadge(user);

  const displayTitle = user.displayName || user.mail || user.uid;
  const primaryBadge = getPrimaryAccountBadge(user);
  const supplementalRoles = getSupplementalRoles(user);
  const ipa = user.provider === "ipa" ? user.ipa : null;
  const totalMemberGroups = recursive ? allGroups.length : directGroups.length;

  const facts: Array<{ label: string; value: JSX.Element }> = [
    { label: "UID", value: <span class="font-mono">{user.uid}</span> },
    { label: "Database ID", value: <span class="truncate font-mono text-[11px]">{user.id}</span> },
    { label: "Managed by", value: <span>{getManagementLabel(user)}</span> },
    { label: "Access", value: <span>{getAccountTypeLabel(user)}</span> },
    {
      label: "Email",
      value: user.mail ? <span class="truncate">{user.mail}</span> : <span class="italic text-dimmed">Not set</span>,
    },
    {
      label: isIpaUser ? "Password expires" : "Account expires",
      value: isIpaUser ? (
        ipa?.passwordExpires ? (
          <span>{dates.formatDate(ipa.passwordExpires)}</span>
        ) : (
          <span class="italic text-dimmed">Never</span>
        )
      ) : user.accountExpires ? (
        <span class={isExpired ? "text-red-600 dark:text-red-400" : ""}>
          {dates.formatDate(user.accountExpires)}
          {isExpired ? " (expired)" : ""}
        </span>
      ) : (
        <span class="italic text-dimmed">Never</span>
      ),
    },
    {
      label: isIpaUser ? "Account expires" : isGuestProfile ? "Guest expires" : "Last web login",
      value: isIpaUser ? (
        user.accountExpires ? (
          <span class={isExpired ? "text-red-600 dark:text-red-400" : ""}>
            {dates.formatDate(user.accountExpires)}
            {isExpired ? " (expired)" : ""}
          </span>
        ) : (
          <span class="italic text-dimmed">Never</span>
        )
      ) : user.lastLoginLocal ? (
        <span>{dates.formatDate(user.lastLoginLocal)}</span>
      ) : (
        <span class="italic text-dimmed">Never</span>
      ),
    },
    {
      label: isIpaUser ? "Last Kerberos login" : "Direct groups",
      value: isIpaUser ? (
        ipa?.lastLoginIpa ? (
          <span>{dates.formatDate(ipa.lastLoginIpa)}</span>
        ) : (
          <span class="italic text-dimmed">Never / Not tracked</span>
        )
      ) : (
        <span>{directGroups.length}</span>
      ),
    },
    {
      label: isIpaUser ? "Last web login" : "Managed groups",
      value: isIpaUser ? (
        user.lastLoginLocal ? (
          <span>{dates.formatDate(user.lastLoginLocal)}</span>
        ) : (
          <span class="italic text-dimmed">Never</span>
        )
      ) : (
        <span>{managedGroups.length}</span>
      ),
    },
  ];

  if (isIpaUser && ipa?.employeeType) {
    facts.push({ label: "Role", value: <span>{ipa.employeeType}</span> });
  }
  if (isIpaUser && ipa?.mobile && ipa.mobile !== ipa.phone) {
    facts.push({ label: "Mobile", value: <span>{ipa.mobile}</span> });
  }
  if (isIpaUser && ipa?.address && formatAddress(ipa.address)) {
    facts.push({ label: "Address", value: <span>{formatAddress(ipa.address)}</span> });
  }

  const detailHref = buildUserDetailUrl(id, listState);
  const toggleUrl = recursive ? detailHref : `${detailHref}${detailHref.includes("?") ? "&" : "?"}recursive=true`;

  return (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Accounts", href: "/app/accounts" },
        { title: "Users", href: "/app/accounts/users" },
        { title: user.uid },
      ]}
    >
      <div class="app-cols h-full">
        <AccountsNavSidebar active="users" isAdmin={true} pendingRequests={pendingRequestsPage.total} />

        <div class="flex-1 min-w-0 flex flex-col">
          <div class="flex-1 min-h-0 overflow-y-auto">
            <div class="flex flex-col gap-3">
              <div>
                <a href={buildUsersUrl(listState)} class="btn-secondary btn-sm">
                  <i class="ti ti-arrow-left" />
                  Back to Users
                </a>
              </div>

              <div class="flex flex-wrap items-start justify-between gap-3" style="view-transition-name: accounts-user-title">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <h1 class="text-base font-semibold text-primary">{displayTitle}</h1>
                    <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${primaryBadge.className}`}>{primaryBadge.label}</span>
                    <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${managementBadge.className}`}>{managementBadge.label}</span>
                    {supplementalRoles.map((role) => (
                      <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getSupplementalRoleColor(role)}`}>
                        {getSupplementalRoleLabel(role)}
                      </span>
                    ))}
                    {isExpired && (
                      <span class="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300">
                        Expired
                      </span>
                    )}
                  </div>
                  <p class="mt-1 truncate text-xs text-dimmed">
                    {user.uid}
                    {user.mail ? ` · ${user.mail}` : ""}
                    {user.givenname || user.sn ? ` · ${[user.givenname, user.sn].filter(Boolean).join(" ")}` : ""}
                  </p>
                </div>
                <UserActions
                  user={user}
                  listHref={buildUsersUrl(listState)}
                  freeIpaEnabled={freeIpaEnabled}
                />
              </div>

              <div class="paper overflow-hidden" style="view-transition-name: accounts-user-facts">
                <dl class="grid gap-px bg-zinc-100 dark:bg-zinc-800 sm:grid-cols-2 xl:grid-cols-3">
                  {facts.map((fact) => (
                    <div class="min-w-0 bg-white px-3 py-2.5 dark:bg-zinc-900">
                      <dt class="text-[11px] uppercase tracking-[0.22em] text-dimmed">{fact.label}</dt>
                      <dd class="mt-1 min-w-0 truncate text-xs text-primary">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {isIpaUser && (ipa?.sshFingerprints.length ?? 0) > 0 && (
                <div class="paper overflow-hidden" style="view-transition-name: accounts-user-ssh">
                  <details class="group">
                    <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs text-dimmed">
                      <span class="flex items-center gap-2">
                        <i class="ti ti-key text-sm" />
                        {(ipa?.sshPublicKeys.length ?? 0)} SSH {(ipa?.sshPublicKeys.length ?? 0) === 1 ? "key" : "keys"}
                      </span>
                      <i class="ti ti-chevron-right text-xs transition-transform group-open:rotate-90" />
                    </summary>
                    <div class="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
                      <div class="flex flex-col gap-1">
                        {ipa?.sshFingerprints.map((fp) => (
                          <code class="rounded bg-zinc-100 px-2 py-1 text-[11px] font-mono text-secondary dark:bg-zinc-800">
                            {fp}
                          </code>
                        ))}
                      </div>
                    </div>
                  </details>
                </div>
              )}

              <div class="flex flex-col gap-2" style="view-transition-name: accounts-user-memberships">
                <div class="min-w-0">
                  <h2 class="text-base font-semibold text-primary">Groups</h2>
                  <p class="mt-1 text-xs text-dimmed">
                    {totalMemberGroups} {recursive ? "memberships including inherited groups" : "direct group memberships"}
                  </p>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <a
                    href={toggleUrl}
                    class={`btn-input btn-input-sm ${recursive ? "!bg-violet-100 dark:!bg-violet-900/50 !text-violet-700 dark:!text-violet-300" : ""}`}
                    title={recursive ? "Show direct memberships only" : "Show all memberships including inherited ones"}
                  >
                    <i class="ti ti-git-branch" />
                    {recursive ? "All groups" : "Direct only"}
                  </a>
                  <div class="ml-auto">
                    <AddToGroup id={user.id} userProvider={user.provider} excludeGroups={allGroups.map((group) => group.id)} />
                  </div>
                </div>

                {memberGroups.length > 0 ? (
                  <div class="paper overflow-hidden">
                    <div class="overflow-x-auto">
                      <table class="w-full text-xs">
                        <thead>
                          <tr class="border-b border-zinc-100 dark:border-zinc-800">
                            <th class="px-3 py-2 text-left font-medium text-dimmed">Group</th>
                            <th class="px-3 py-2 text-left font-medium text-dimmed">Description</th>
                            <th class="px-3 py-2 text-left font-medium text-dimmed">Provider</th>
                            <th class="px-3 py-2 text-left font-medium text-dimmed">Membership</th>
                            <th class="px-3 py-2 text-right font-medium text-dimmed">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {memberGroups.map((group) => {
                            const isDirect = directGroupSet.has(group.id);
                            const providerBadge = getPrimaryAccountBadge({ ...user, provider: group.provider, profile: "user" });
                            return (
                              <tr class="border-b border-zinc-50 dark:border-zinc-800/50">
                                <td class="p-0">
                                  <a href={`/app/accounts/groups/${group.id}`} class="group block px-3 py-1.5 font-medium text-primary">
                                    <span class="truncate group-hover:underline">{group.name}</span>
                                  </a>
                                </td>
                                <td class="max-w-[24rem] p-0 text-dimmed">
                                  <a href={`/app/accounts/groups/${group.id}`} class="block truncate px-3 py-1.5" tabindex={-1} title={group.description || "No description"}>
                                    {group.description || <span class="italic">No description</span>}
                                  </a>
                                </td>
                                <td class="p-0">
                                  <a href={`/app/accounts/groups/${group.id}`} class="block px-3 py-1.5" tabindex={-1}>
                                    <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerBadge.className}`}>{group.provider === "ipa" ? "FreeIPA" : "Local"}</span>
                                  </a>
                                </td>
                                <td class="p-0">
                                  <a href={`/app/accounts/groups/${group.id}`} class="block px-3 py-1.5" tabindex={-1}>
                                    <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isDirect ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" : "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"}`}>
                                      {isDirect ? "Direct" : "Inherited"}
                                    </span>
                                  </a>
                                </td>
                                <td class="px-3 py-1.5 text-right">
                                  {isDirect ? <RemoveMember groupId={group.id} membershipRole="members" type="user" id={user.id} label={user.uid} /> : null}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div class="paper p-6 text-center text-sm text-dimmed">Not a member of any groups.</div>
                )}
              </div>

              {managedGroups.length > 0 && (
                <div class="flex flex-col gap-2" style="view-transition-name: accounts-user-managed-groups">
                  <div class="min-w-0">
                    <h2 class="text-base font-semibold text-primary">Manages</h2>
                    <p class="mt-1 text-xs text-dimmed">{managedGroups.length} manageable group{managedGroups.length === 1 ? "" : "s"}</p>
                  </div>

                  <div class="paper overflow-hidden">
                    <div class="overflow-x-auto">
                      <table class="w-full text-xs">
                        <thead>
                          <tr class="border-b border-zinc-100 dark:border-zinc-800">
                            <th class="px-3 py-2 text-left font-medium text-dimmed">Group</th>
                            <th class="px-3 py-2 text-left font-medium text-dimmed">Description</th>
                            <th class="px-3 py-2 text-left font-medium text-dimmed">Provider</th>
                          </tr>
                        </thead>
                        <tbody>
                          {managedGroups.map((group) => (
                            <tr class="border-b border-zinc-50 dark:border-zinc-800/50">
                              <td class="p-0">
                                <a href={`/app/accounts/groups/${group.id}`} class="group block px-3 py-1.5 font-medium text-primary">
                                  <span class="truncate group-hover:underline">{group.name}</span>
                                </a>
                              </td>
                              <td class="max-w-[24rem] p-0 text-dimmed">
                                <a href={`/app/accounts/groups/${group.id}`} class="block truncate px-3 py-1.5" tabindex={-1} title={group.description || "No description"}>
                                  {group.description || <span class="italic">No description</span>}
                                </a>
                              </td>
                              <td class="p-0">
                                <a href={`/app/accounts/groups/${group.id}`} class="block px-3 py-1.5" tabindex={-1}>
                                  <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${group.provider === "ipa" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"}`}>
                                    {group.provider === "ipa" ? "FreeIPA" : "Local"}
                                  </span>
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
