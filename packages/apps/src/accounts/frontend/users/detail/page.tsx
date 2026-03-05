import { ssr } from "@valentinkolb/cloud/core/config";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { GroupView } from "@valentinkolb/cloud/lib/ui";
import { dates } from "@valentinkolb/cloud/lib/shared";
import { hasRole } from "@/accounts/contracts";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import AccountsNavSidebar from "../../AccountsNavSidebar";
import { accountsService } from "../../../service";
import { buildUserDetailUrl, buildUsersUrl, parseUsersListState } from "../../lib/url-state";
import AddToGroup from "./AddToGroup.island";
import UserActions from "./UserActions.island";
import RemoveMember from "../../groups/detail/RemoveMember.island";

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

  const listState = parseUsersListState({
    search: c.req.query("search"),
    page: c.req.query("page"),
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

  const isIpaUser = hasRole(user, "ipa", "ipa-limited");

  const [pendingRequestsPage, allGroupsPage, allManagesPage, directGroupsPage] = await Promise.all([
    accountsService.accountRequest.list({
      access: { userId: c.get("user").id, isAdmin: true },
      filter: { status: "pending" },
    }),
    isIpaUser
      ? accountsService.user.group.list({
          userId: id,
          recursive,
        })
      : Promise.resolve({
          items: [] as string[],
          page: 1,
          perPage: 0,
          total: 0,
          hasNext: false,
        }),
    isIpaUser
      ? accountsService.user.managedGroup.list({
          userId: id,
          recursive,
        })
      : Promise.resolve({
          items: [] as string[],
          page: 1,
          perPage: 0,
          total: 0,
          hasNext: false,
        }),
    isIpaUser && recursive
      ? accountsService.user.group.list({
          userId: id,
          recursive: false,
        })
      : Promise.resolve({
          items: [] as string[],
          page: 1,
          perPage: 0,
          total: 0,
          hasNext: false,
      }),
  ]);

  const allGroups = allGroupsPage.items;
  const allManages = allManagesPage.items;
  const directGroups = directGroupsPage.items;
  const directGroupSet = new Set(recursive ? directGroups : allGroups);

  const memberGroups =
    allGroups.length > 0
      ? (
          await accountsService.group.list({
            scope: { cns: allGroups },
          })
        ).items
      : [];

  const directManages = recursive
    ? (
        await accountsService.user.managedGroup.list({
          userId: id,
          recursive: false,
        })
      ).items
    : allManages;

  const directManagesSet = new Set(directManages);

  const isExpired = user.ipaAccountExpires ? new Date(user.ipaAccountExpires) < new Date() : false;

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
                  All Users
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
                    memberofGroup={Array.from(directGroupSet)}
                    manages={directManages}
                    listHref={buildUsersUrl(listState)}
                  />
                </div>

                <div class="flex items-center gap-2 flex-wrap">
                  {user.roles.map((role) => (
                    <span
                      class={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        role === "admin"
                          ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                          : role === "ipa"
                            ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300"
                            : role === "ipa-limited"
                              ? "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300"
                              : role === "group-manager"
                                ? "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      }`}
                    >
                      {role}
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
                    <dt class="text-dimmed">Database ID</dt>
                    <dd class="font-mono text-secondary">{user.id}</dd>

                    <dt class="text-dimmed">UID</dt>
                    <dd class="font-mono text-secondary">{user.uid}</dd>

                    {isIpaUser && (
                      <>
                        <dt class="text-dimmed">Password Expires</dt>
                        <dd class="text-secondary">
                          {user.ipaPasswordExpires ? (
                            dates.formatDate(user.ipaPasswordExpires)
                          ) : (
                            <span class="text-zinc-400 dark:text-zinc-500 italic">Never</span>
                          )}
                        </dd>

                        <dt class="text-dimmed">Account Expires</dt>
                        <dd class="text-secondary">
                          {user.ipaAccountExpires ? (
                            <span class={isExpired ? "text-red-600 dark:text-red-400" : ""}>
                              {dates.formatDate(user.ipaAccountExpires)}
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
                      {user.phone ? user.phone : <span class="text-zinc-400 dark:text-zinc-500 italic">Not set</span>}
                    </dd>

                    {isIpaUser && user.employeeType && (
                      <>
                        <dt class="text-dimmed">Role</dt>
                        <dd class="text-secondary">{user.employeeType}</dd>
                      </>
                    )}

                    {isIpaUser && user.mobile && user.mobile !== user.phone && (
                      <>
                        <dt class="text-dimmed">Mobile</dt>
                        <dd class="text-secondary">{user.mobile}</dd>
                      </>
                    )}

                    {isIpaUser && formatAddress(user.address) && (
                      <>
                        <dt class="text-dimmed">Address</dt>
                        <dd class="text-secondary">{formatAddress(user.address)}</dd>
                      </>
                    )}

                    {isIpaUser && (
                      <>
                        <dt class="text-dimmed">Last Login (Kerberos)</dt>
                        <dd class="text-secondary">
                          {user.lastLoginIpa ? (
                            dates.formatDate(user.lastLoginIpa)
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
                  </dl>
                </div>

                {isIpaUser && user.sshFingerprints.length > 0 && (
                  <div class="border-t border-zinc-200 dark:border-zinc-700 pt-3">
                    <details class="group">
                      <summary class="text-sm text-dimmed cursor-pointer select-none flex items-center gap-1 hover:text-secondary transition-colors">
                        <i class="ti ti-key text-sm" />
                        {user.sshPublicKeys.length} SSH {user.sshPublicKeys.length === 1 ? "Key" : "Keys"}
                        <i class="ti ti-chevron-right text-xs transition-transform group-open:rotate-90" />
                      </summary>
                      <div class="mt-2 flex flex-col gap-1">
                        {user.sshFingerprints.map((fp) => (
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
                    <AddToGroup id={user.id} excludeGroups={Array.from(directGroupSet)} />
                  </div>
                </div>

                {memberGroups.length > 0 ? (
                  <>
                    {memberGroups.map((group) => {
                      const isDirect = directGroupSet.has(group.cn);
                      return (
                        <div
                          class={`paper p-3 flex items-center gap-3 ${!isDirect ? "border border-violet-200 dark:border-violet-800" : ""}`}
                        >
                          <a href={`/app/accounts/groups/${group.cn}`} class="flex-1 min-w-0 hover:opacity-80 transition-opacity">
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
                          {isDirect && <RemoveMember cn={group.cn} membershipRole="members" type="user" id={user.id} label={user.uid} />}
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

              {allManages.length > 0 && (
                <div class="paper p-6 flex flex-col gap-3">
                  <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
                    <i class="ti ti-shield text-sm" />
                    Manages
                    {recursive && <span class="text-xs font-normal text-dimmed ml-1">(including inherited)</span>}
                  </h2>

                  <div class="flex flex-wrap gap-1.5">
                    {allManages.map((cn: string) => {
                      const isDirect = directManagesSet.has(cn);
                      return (
                        <a
                          href={`/app/accounts/groups/${cn}`}
                          class={`text-xs px-2 py-1 rounded transition-colors ${
                            isDirect
                              ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/80"
                              : "bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50"
                          }`}
                          title={isDirect ? "Direct manager" : "Inherited via group hierarchy"}
                        >
                          {cn}
                          {!isDirect && <i class="ti ti-git-branch text-[10px] ml-1 opacity-70" />}
                        </a>
                      );
                    })}
                  </div>

                  {recursive && allManages.length > directManagesSet.size && (
                    <p class="text-xs text-dimmed flex items-center gap-1">
                      <i class="ti ti-git-branch text-[10px]" />
                      {allManages.length - directManagesSet.size} group(s) managed via group hierarchy.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});
