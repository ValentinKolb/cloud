import { ssr } from "@valentinkolb/cloud/core/config";
import { accountsAppService as accountsService } from "@valentinkolb/cloud/core/services";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { getSync } from "@valentinkolb/cloud-core/services/settings";
import { GroupView } from "@valentinkolb/cloud/lib/ui";
import { dates } from "@valentinkolb/cloud/lib/shared";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
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
            <div class="flex flex-col gap-4 p-4">
              <div>
                <a href={buildUsersUrl(listState)} class="btn-secondary btn-sm">
                  <i class="ti ti-arrow-left" />
                  Back to Users
                </a>
              </div>
              <div class="paper p-6 flex flex-col gap-4">
                <div class="flex items-center gap-4">
                  <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 font-semibold text-zinc-600 dark:text-zinc-300 h-16 w-16 text-xl">
                    {(user.displayName || user.mail || user.uid).slice(0, 2).toUpperCase()}
                  </div>
                  <div class="flex flex-col gap-1 min-w-0 flex-1">
                    <h1 class="text-xl font-bold text-primary">{displayTitle}</h1>
                    <p class="text-sm text-dimmed">
                      {user.givenname} {user.sn}
                    </p>
                  </div>
                  <UserActions
                    user={user}
                    listHref={buildUsersUrl(listState)}
                    freeIpaEnabled={freeIpaEnabled}
                  />
                </div>

                <div class="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const badge = getPrimaryAccountBadge(user);
                    return <span class={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>;
                  })()}
                  <span class={`text-xs font-medium px-2 py-0.5 rounded-full ${managementBadge.className}`}>{managementBadge.label}</span>
                  {getSupplementalRoles(user).map((role) => (
                    <span class={`text-xs font-medium px-2 py-0.5 rounded-full ${getSupplementalRoleColor(role)}`}>
                      {getSupplementalRoleLabel(role)}
                    </span>
                  ))}
                  {isExpired && (
                    <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300">
                      Account expired
                    </span>
                  )}
                </div>

                <div class="border-t border-zinc-200 dark:border-zinc-700 pt-3">
                  <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    {(() => {
                      const ipa = user.ipa;
                      return (
                        <>
                    <dt class="text-dimmed">Database ID</dt>
                    <dd class="font-mono text-secondary">{user.id}</dd>

                    <dt class="text-dimmed">UID</dt>
                    <dd class="font-mono text-secondary">{user.uid}</dd>

                    <dt class="text-dimmed">Managed by</dt>
                    <dd class="text-secondary">{getManagementLabel(user)}</dd>

                    <dt class="text-dimmed">Access level</dt>
                    <dd class="text-secondary">{getAccountTypeLabel(user)}</dd>

                    {isIpaUser && (
                      <>
                        <dt class="text-dimmed">Password Expires</dt>
                        <dd class="text-secondary">
                          {ipa?.passwordExpires ? (
                            dates.formatDate(ipa.passwordExpires)
                          ) : (
                            <span class="text-zinc-400 dark:text-zinc-500 italic">Never</span>
                          )}
                        </dd>

                        <dt class="text-dimmed">Account Expires</dt>
                        <dd class="text-secondary">
                          {user.accountExpires ? (
                            <span class={isExpired ? "text-red-600 dark:text-red-400" : ""}>
                              {dates.formatDate(user.accountExpires)}
                              {isExpired && " (expired)"}
                            </span>
                          ) : (
                            <span class="text-zinc-400 dark:text-zinc-500 italic">Never</span>
                          )}
                        </dd>
                      </>
                    )}

                    {!isIpaUser && isGuestProfile && (
                      <>
                        <dt class="text-dimmed">Guest Expires</dt>
                        <dd class="text-secondary">
                          {user.accountExpires ? (
                            <span class={isExpired ? "text-red-600 dark:text-red-400" : ""}>
                              {dates.formatDate(user.accountExpires)}
                              {isExpired && " (expired)"}
                            </span>
                          ) : (
                            <span class="text-zinc-400 dark:text-zinc-500 italic">Never</span>
                          )}
                        </dd>
                      </>
                    )}

                    {!isIpaUser && !isGuestProfile && (
                      <>
                        <dt class="text-dimmed">Account Expires</dt>
                        <dd class="text-secondary">
                          {user.accountExpires ? (
                            <span class={isExpired ? "text-red-600 dark:text-red-400" : ""}>
                              {dates.formatDate(user.accountExpires)}
                              {isExpired && " (expired)"}
                            </span>
                          ) : (
                            <span class="text-zinc-400 dark:text-zinc-500 italic">Never</span>
                          )}
                        </dd>
                      </>
                    )}

                    <dt class="text-dimmed">Email</dt>
                    <dd class="text-secondary">
                      {user.mail ? user.mail : <span class="text-zinc-400 dark:text-zinc-500 italic">Not set</span>}
                    </dd>

                    <dt class="text-dimmed">Phone</dt>
                    <dd class="text-secondary">
                      {ipa?.phone ? ipa.phone : <span class="text-zinc-400 dark:text-zinc-500 italic">Not set</span>}
                    </dd>

                    {isIpaUser && ipa?.employeeType && (
                      <>
                        <dt class="text-dimmed">Role</dt>
                        <dd class="text-secondary">{ipa.employeeType}</dd>
                      </>
                    )}

                    {isIpaUser && ipa?.mobile && ipa.mobile !== ipa.phone && (
                      <>
                        <dt class="text-dimmed">Mobile</dt>
                        <dd class="text-secondary">{ipa.mobile}</dd>
                      </>
                    )}

                    {isIpaUser && ipa?.address && formatAddress(ipa.address) && (
                      <>
                        <dt class="text-dimmed">Address</dt>
                        <dd class="text-secondary">{formatAddress(ipa.address)}</dd>
                      </>
                    )}

                    {isIpaUser && (
                      <>
                        <dt class="text-dimmed">Last Login (Kerberos)</dt>
                        <dd class="text-secondary">
                          {ipa?.lastLoginIpa ? (
                            dates.formatDate(ipa.lastLoginIpa)
                          ) : (
                            <span class="text-zinc-400 dark:text-zinc-500 italic">Never / Not tracked</span>
                          )}
                        </dd>
                      </>
                    )}

                    <dt class="text-dimmed">Last Login (Web)</dt>
                    <dd class="text-secondary">
                      {user.lastLoginLocal ? (
                        dates.formatDate(user.lastLoginLocal)
                      ) : (
                        <span class="text-zinc-400 dark:text-zinc-500 italic">Never</span>
                      )}
                    </dd>
                        </>
                      );
                    })()}
                  </dl>
                </div>

                {isIpaUser && (user.ipa?.sshFingerprints.length ?? 0) > 0 && (
                  <div class="border-t border-zinc-200 dark:border-zinc-700 pt-3">
                    <details class="group">
                      <summary class="text-sm text-dimmed cursor-pointer select-none flex items-center gap-1 hover:text-secondary transition-colors">
                        <i class="ti ti-key text-sm" />
                        {user.ipa?.sshPublicKeys.length ?? 0} SSH {(user.ipa?.sshPublicKeys.length ?? 0) === 1 ? "Key" : "Keys"}
                        <i class="ti ti-chevron-right text-xs transition-transform group-open:rotate-90" />
                      </summary>
                      <div class="mt-2 flex flex-col gap-1">
                        {user.ipa?.sshFingerprints.map((fp) => (
                          <code class="text-xs font-mono text-secondary bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded break-all">
                            {fp}
                          </code>
                        ))}
                      </div>
                    </details>
                  </div>
                )}
              </div>

              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
                    <i class="ti ti-users-group text-sm" />
                    Groups
                    {recursive && <span class="text-xs font-normal text-dimmed ml-1">(including inherited)</span>}
                  </h2>
                  <div class="flex items-center gap-2">
                    <a
                      href={toggleUrl}
                      class={`btn-secondary btn-sm ${recursive ? "!bg-violet-100 dark:!bg-violet-900/50 !text-violet-700 dark:!text-violet-300" : ""}`}
                      title={recursive ? "Show direct memberships only" : "Show all memberships (including inherited)"}
                    >
                      <i class="ti ti-git-branch" />
                      {recursive ? "All" : "Direct"}
                    </a>
                    <AddToGroup id={user.id} userProvider={user.provider} excludeGroups={allGroups.map((group) => group.id)} />
                  </div>
                </div>

                {memberGroups.length > 0 ? (
                  <>
                    {memberGroups.map((group) => {
                      const isDirect = directGroupSet.has(group.id);
                      return (
                        <div
                          class={`paper p-3 flex items-center gap-3 ${!isDirect ? "border border-violet-200 dark:border-violet-800" : ""}`}
                        >
                          <a href={`/app/accounts/groups/${group.id}`} class="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                            <GroupView group={group} />
                          </a>
                          {!isDirect && (
                            <span
                              class="text-xs px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400"
                              title="Inherited via group hierarchy"
                            >
                              <i class="ti ti-git-branch text-[10px]" />
                            </span>
                          )}
                          {isDirect && <RemoveMember groupId={group.id} membershipRole="members" type="user" id={user.id} label={user.uid} />}
                        </div>
                      );
                    })}
                    {recursive && allGroups.length > directGroupSet.size && (
                      <p class="text-xs text-dimmed flex items-center gap-1 mt-1">
                        <i class="ti ti-git-branch text-[10px]" />
                        {allGroups.length - directGroupSet.size} group(s) inherited via group hierarchy.
                      </p>
                    )}
                  </>
                ) : (
                  <div class="paper p-6 text-center text-sm text-dimmed">Not a member of any groups.</div>
                )}
              </div>

              {managedGroups.length > 0 && (
                <div class="paper p-6 flex flex-col gap-3">
                  <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
                    <i class="ti ti-shield text-sm" />
                    Manages
                  </h2>

                  <div class="flex flex-wrap gap-1.5">
                    {managedGroups.map((group) => {
                      return (
                        <a
                          href={`/app/accounts/groups/${group.id}`}
                          class="text-xs px-2 py-1 rounded transition-colors bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/80"
                          title="Manageable group"
                        >
                          {group.name}
                        </a>
                      );
                    })}
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
