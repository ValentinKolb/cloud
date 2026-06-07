import { ssr } from "../../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { dates } from "@valentinkolb/stdlib";
import { canManageAnyGroups, getAccountTypeLabel, getManagementLabel, getSupplementalRoleLabel } from "@valentinkolb/cloud/shared";
import { accountsAppService, coreSettings } from "@valentinkolb/cloud/services";
import ProfileActions from "./ProfileActions.island";
import ProfileSettings from "./ProfileSettings.island";
import RequestFreeIpaAccount from "./RequestFreeIpaAccount.island";
import WithdrawAccountRequest from "./WithdrawAccountRequest.island";

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
  const [rawAppName, freeIpaEnabledRaw] = await Promise.all([
    coreSettings.get<string>("app.name"),
    coreSettings.get<boolean>("freeipa.enable"),
  ]);
  const appName = rawAppName || "My App";
  const freeIpaEnabled = Boolean(freeIpaEnabledRaw);
  const sessionUser = c.get("user");
  const manages = sessionUser.manages;
  const canManageGroups = canManageAnyGroups(sessionUser);
  const showAllGroups = c.req.query("groups") === "all";
  const action = c.req.query("action");
  const isIpaUser = sessionUser.provider === "ipa";
  const ipaData = sessionUser.ipa;
  const isGuestProfile = sessionUser.profile === "guest";
  const directGroups = sessionUser.memberofGroup;
  const supplementalRoles = sessionUser.roles.filter((role) => role === "admin" || role === "group-manager");
  const isExpiredAccount = sessionUser.accountExpires ? new Date(sessionUser.accountExpires) < new Date() : false;
  const pendingRequest = sessionUser.provider === "local" ? await accountsAppService.accountRequest.getPendingForUser({ userId: sessionUser.id }) : null;
  const address = formatAddress(ipaData?.address ?? { street: null, postalCode: null, city: null, state: null });

  let displayGroups: string[] = [];
  if (showAllGroups) {
    displayGroups = (await accountsAppService.user.group.list({ userId: sessionUser.id, recursive: true })).items;
  } else {
    displayGroups = directGroups;
  }

  const profileBadgeClass = sessionUser.profile === "guest"
    ? "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300"
    : "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300";
  const providerBadgeClass = sessionUser.provider === "ipa"
    ? "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
    : "bg-sky-100 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300";

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Profile" }]}>
      <div class="mx-auto flex max-w-6xl flex-col gap-4 px-2">
        {action === "extend" && (
          <div class="info-block-info text-sm">
            Need more time? Use <strong>Extend Account</strong> below to renew your account expiry.
          </div>
        )}

        <section class="paper overflow-hidden" style="view-transition-name: profile-card">
          <div class="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div class="flex min-w-0 gap-4">
              <div
                class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-xl font-semibold text-zinc-600 shadow-[var(--theme-shadow-elevated)] dark:bg-zinc-800 dark:text-zinc-200"
                style="view-transition-name: user-avatar"
              >
                {(sessionUser.displayName || sessionUser.uid).slice(0, 2).toUpperCase()}
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                  <h1 class="text-xl font-semibold leading-tight text-primary">{sessionUser.displayName || sessionUser.uid}</h1>
                </div>
                {sessionUser.displayName && !isGuestProfile && <p class="mt-1 text-xs text-dimmed">{sessionUser.uid}</p>}
              </div>
            </div>

            <ProfileActions
              provider={sessionUser.provider}
              profile={sessionUser.profile}
              uid={sessionUser.uid}
              givenname={sessionUser.givenname}
              sn={sessionUser.sn}
              displayName={sessionUser.displayName}
              ipa={sessionUser.ipa}
              appName={appName}
              freeIpaEnabled={freeIpaEnabled}
            />
          </div>

          <div class="px-5 pb-5 sm:px-6">
            <div class="mb-4 flex flex-wrap gap-2">
              <span class={`tag ${profileBadgeClass}`}>{getAccountTypeLabel(sessionUser)}</span>
              <span class={`tag ${providerBadgeClass}`}>{getManagementLabel(sessionUser)}</span>
              {supplementalRoles.map((role) => (
                <span class={`tag ${role === "admin" ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" : "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"}`}>
                  {getSupplementalRoleLabel(role)}
                </span>
              ))}
              {isExpiredAccount && <span class="tag bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">Expired</span>}
            </div>
            <div class="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {sessionUser.mail && (
                <div class="flex min-w-0 items-center gap-2">
                  <i class="ti ti-mail shrink-0 text-dimmed" />
                  <span class="truncate text-secondary">{sessionUser.mail}</span>
                </div>
              )}
              {ipaData?.phone && (
                <div class="flex min-w-0 items-center gap-2">
                  <i class="ti ti-phone shrink-0 text-dimmed" />
                  <span class="truncate text-secondary">{ipaData.phone}</span>
                </div>
              )}
              {isIpaUser && ipaData?.employeeType && (
                <div class="flex min-w-0 items-center gap-2">
                  <i class="ti ti-briefcase shrink-0 text-dimmed" />
                  <span class="truncate text-secondary">{ipaData.employeeType}</span>
                </div>
              )}
              {isIpaUser && ipaData?.mobile && ipaData.mobile !== ipaData.phone && (
                <div class="flex min-w-0 items-center gap-2">
                  <i class="ti ti-device-mobile shrink-0 text-dimmed" />
                  <span class="truncate text-secondary">{ipaData.mobile}</span>
                </div>
              )}
              {isIpaUser && address && (
                <div class="flex min-w-0 items-center gap-2">
                  <i class="ti ti-map-pin shrink-0 text-dimmed" />
                  <span class="truncate text-secondary">{address}</span>
                </div>
              )}
              {sessionUser.accountExpires && (
                <div class="flex min-w-0 items-center gap-2">
                  <i class="ti ti-calendar-event shrink-0 text-dimmed" />
                  <span class={`truncate text-dimmed ${isExpiredAccount ? "text-red-600 dark:text-red-400" : ""}`}>
                    {isGuestProfile ? "Guest access expires" : "Account expires"} {dates.formatDate(sessionUser.accountExpires)}
                  </span>
                </div>
              )}
              {isIpaUser && ipaData?.passwordExpires && (
                <div class="flex min-w-0 items-center gap-2">
                  <i class="ti ti-key shrink-0 text-dimmed" />
                  <span class="truncate text-dimmed">Password expires {dates.formatDate(ipaData.passwordExpires)}</span>
                </div>
              )}
              {isIpaUser && (ipaData?.sshFingerprints.length ?? 0) > 0 && (
                <div class="flex min-w-0 items-center gap-2">
                  <i class="ti ti-terminal shrink-0 text-dimmed" />
                  <span class="truncate text-dimmed">
                    {ipaData?.sshPublicKeys.length ?? 0} SSH {(ipaData?.sshPublicKeys.length ?? 0) === 1 ? "key" : "keys"} configured
                  </span>
                </div>
              )}
            </div>
            {isIpaUser && isGuestProfile && (
              <div class="mt-4 info-block-info text-xs">
                Your account has limited access. Ask a group manager to add you to a group to unlock full features.
              </div>
            )}
          </div>
        </section>

        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section class="paper p-5 sm:p-6">
            <div class="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <i class="ti ti-shield-lock text-sm" />
                  Access & membership
                </h2>
                <p class="mt-1 text-xs text-dimmed">Groups and delegated management visible to your account.</p>
              </div>
            </div>

            <div class="grid gap-6 xl:grid-cols-2">
              <div class="min-w-0">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase text-dimmed">
                    <i class="ti ti-users-group text-sm" />
                    Groups
                  </h3>
                  {displayGroups.length > 0 && (
                    <a
                      href={showAllGroups ? "/me" : "/me?groups=all"}
                      class={`tag transition-colors ${
                        showAllGroups
                          ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
                          : "bg-zinc-100 text-dimmed hover:text-secondary dark:bg-zinc-800"
                      }`}
                      title={showAllGroups ? "Show direct memberships only" : "Show all memberships (including inherited)"}
                    >
                      <i class="ti ti-git-branch" />
                      {showAllGroups ? "All" : "Direct"}
                    </a>
                  )}
                </div>
                {displayGroups.length > 0 ? (
                  <div class="flex flex-wrap gap-1.5">
                    {displayGroups.map((group) => {
                      const isDirect = directGroups.includes(group);
                      return (
                        <a
                          href={`/app/accounts/groups?scope=member&search=${encodeURIComponent(group)}`}
                          class={`tag transition-colors ${
                            isDirect
                              ? "bg-zinc-100 text-secondary hover:text-primary dark:bg-zinc-800"
                              : "bg-violet-50 text-violet-600 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50"
                          }`}
                          title={isDirect ? "Direct membership" : "Inherited via group hierarchy"}
                        >
                          {group}
                          {!isDirect && <i class="ti ti-git-branch ml-0.5 text-[10px] opacity-70" />}
                        </a>
                      );
                    })}
                  </div>
                ) : (
                  <div class="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center dark:border-zinc-800">
                    <i class="ti ti-users-group text-2xl text-dimmed" />
                    <p class="mt-2 text-xs text-dimmed">Not a member of any groups yet.</p>
                    <a href="/app/accounts/groups" class="mt-1 inline-flex text-xs text-primary hover:underline">Browse groups</a>
                  </div>
                )}
                {showAllGroups && displayGroups.length > directGroups.length && (
                  <p class="mt-2 flex items-center gap-1 text-[10px] text-dimmed">
                    <i class="ti ti-git-branch text-[10px]" />
                    Inherited via group hierarchy.
                  </p>
                )}
              </div>

              <div class="min-w-0">
                <h3 class="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase text-dimmed">
                  <i class="ti ti-shield text-sm" />
                  Manages
                </h3>
                {canManageGroups && manages.length > 0 ? (
                  <div class="flex flex-wrap gap-1.5">
                    {manages.map((group) => (
                      <a
                        href={`/app/accounts/groups?scope=managed&search=${encodeURIComponent(group)}`}
                        class="tag bg-blue-100 text-blue-700 transition-colors hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/80"
                      >
                        {group}
                      </a>
                    ))}
                  </div>
                ) : (
                  <div class="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center dark:border-zinc-800">
                    <i class="ti ti-shield text-2xl text-dimmed" />
                    <p class="mt-2 text-xs text-dimmed">You don't manage any groups.</p>
                    <a href="/app/accounts/groups" class="mt-1 inline-flex text-xs text-primary hover:underline">Browse groups</a>
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside class="flex min-w-0 flex-col gap-4">
            {sessionUser.provider === "local" && (freeIpaEnabled || pendingRequest) && (
              <section class="paper p-5">
                <h2 class="flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <i class="ti ti-building-fortress text-sm" />
                  Request FreeIPA Account
                </h2>
                <p class="mt-1 text-xs text-dimmed">Request a centrally managed account if you need broader group-based access.</p>
                {pendingRequest ? (
                  <div class="mt-4 flex flex-col gap-3">
                    <div class="info-block-info text-xs">Request pending since {dates.formatDate(pendingRequest.createdAt.toISOString())}.</div>
                    <div class="flex justify-end">
                      <WithdrawAccountRequest />
                    </div>
                  </div>
                ) : (
                  <div class="mt-4">
                    <RequestFreeIpaAccount
                      givenname={sessionUser.givenname}
                      sn={sessionUser.sn}
                      displayName={sessionUser.displayName}
                      phone={null}
                      agbUrl="/legal/terms"
                      privacyUrl="/legal/privacy"
                      appName={appName}
                    />
                  </div>
                )}
              </section>
            )}

            <ProfileSettings provider={sessionUser.provider} profile={sessionUser.profile} freeIpaEnabled={freeIpaEnabled} />
          </aside>
        </div>
      </div>
    </Layout>
  );
});
