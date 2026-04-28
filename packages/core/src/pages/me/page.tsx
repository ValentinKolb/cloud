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
      <div class="max-w-4xl mx-auto flex flex-col gap-4">
        {action === "extend" && (
          <div class="info-block-info text-sm">
            Need more time? Use <strong>Extend Account</strong> below to renew your account expiry.
          </div>
        )}

        {/* Profile card */}
        <div class="paper" style="view-transition-name: profile-card">
          {/* Header */}
          <div class="flex items-center gap-4 p-5">
            <div
              class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 font-semibold text-zinc-600 dark:text-zinc-300 h-14 w-14 text-lg"
              style="view-transition-name: user-avatar"
            >
              {(sessionUser.displayName || sessionUser.uid).slice(0, 2).toUpperCase()}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h1 class="text-lg font-bold text-primary leading-tight">{sessionUser.displayName || sessionUser.uid}</h1>
                <span class={`tag ${profileBadgeClass}`}>{getAccountTypeLabel(sessionUser)}</span>
                <span class={`tag ${providerBadgeClass}`}>{getManagementLabel(sessionUser)}</span>
                {supplementalRoles.map((role) => (
                  <span class={`tag ${role === "admin" ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300" : "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300"}`}>
                    {getSupplementalRoleLabel(role)}
                  </span>
                ))}
                {isExpiredAccount && <span class="tag bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300">Expired</span>}
              </div>
              {sessionUser.displayName && !isGuestProfile && <span class="text-xs text-dimmed">{sessionUser.uid}</span>}
            </div>
          </div>

          {/* Details row */}
          <div class="border-t border-zinc-200/60 dark:border-zinc-700/40 px-5 py-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {sessionUser.mail && (
              <>
                <i class="ti ti-mail text-dimmed mt-px" />
                <span class="text-secondary">{sessionUser.mail}</span>
              </>
            )}
            {ipaData?.phone && (
              <>
                <i class="ti ti-phone text-dimmed mt-px" />
                <span class="text-secondary">{ipaData.phone}</span>
              </>
            )}
            {isIpaUser && ipaData?.employeeType && (
              <>
                <i class="ti ti-briefcase text-dimmed mt-px" />
                <span class="text-secondary">{ipaData.employeeType}</span>
              </>
            )}
            {isIpaUser && ipaData?.mobile && ipaData.mobile !== ipaData.phone && (
              <>
                <i class="ti ti-device-mobile text-dimmed mt-px" />
                <span class="text-secondary">{ipaData.mobile}</span>
              </>
            )}
            {isIpaUser && address && (
              <>
                <i class="ti ti-map-pin text-dimmed mt-px" />
                <span class="text-secondary">{address}</span>
              </>
            )}
            {sessionUser.accountExpires && (
              <>
                <i class="ti ti-calendar-event text-dimmed mt-px" />
                <span class={`text-dimmed ${isExpiredAccount ? "text-red-600 dark:text-red-400" : ""}`}>
                  {isGuestProfile ? "Guest access expires" : "Account expires"} {dates.formatDate(sessionUser.accountExpires)}
                </span>
              </>
            )}
            {isIpaUser && ipaData?.passwordExpires && (
              <>
                <i class="ti ti-key text-dimmed mt-px" />
                <span class="text-dimmed">Password expires {dates.formatDate(ipaData.passwordExpires)}</span>
              </>
            )}
            {isIpaUser && (ipaData?.sshFingerprints.length ?? 0) > 0 && (
              <>
                <i class="ti ti-terminal text-dimmed mt-px" />
                <span class="text-dimmed">{ipaData?.sshPublicKeys.length ?? 0} SSH {(ipaData?.sshPublicKeys.length ?? 0) === 1 ? "key" : "keys"} configured</span>
              </>
            )}
          </div>

          {/* Limited account info */}
          {isIpaUser && isGuestProfile && (
            <div class="px-5 pb-4">
              <div class="info-block-info text-xs">
                Your account has limited access. Ask a group manager to add you to a group to unlock full features.
              </div>
            </div>
          )}

          {/* Actions */}
          <div class="border-t border-zinc-200/60 dark:border-zinc-700/40 px-5 py-3">
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
        </div>

        {/* Two-column: Groups + Manages / FreeIPA request */}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Groups */}
          {displayGroups.length > 0 ? (
            <div class="paper p-5 flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
                  <i class="ti ti-users-group text-sm" />
                  Groups
                </h2>
                <a
                  href={showAllGroups ? "/me" : "/me?groups=all"}
                  class={`tag transition-colors ${
                    showAllGroups
                      ? "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300"
                      : "bg-zinc-100 dark:bg-zinc-800 text-dimmed hover:text-secondary"
                  }`}
                  title={showAllGroups ? "Show direct memberships only" : "Show all memberships (including inherited)"}
                >
                  <i class="ti ti-git-branch" />
                  {showAllGroups ? "All" : "Direct"}
                </a>
              </div>
              <div class="flex flex-wrap gap-1.5">
                {displayGroups.map((group) => {
                  const isDirect = directGroups.includes(group);
                  return (
                    <a
                      href={`/app/accounts/groups?scope=member&search=${encodeURIComponent(group)}`}
                      class={`tag transition-colors ${
                        isDirect
                          ? "bg-zinc-100 dark:bg-zinc-800 text-secondary hover:text-primary"
                          : "bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50"
                      }`}
                      title={isDirect ? "Direct membership" : "Inherited via group hierarchy"}
                    >
                      {group}
                      {!isDirect && <i class="ti ti-git-branch text-[10px] ml-0.5 opacity-70" />}
                    </a>
                  );
                })}
              </div>
              {showAllGroups && displayGroups.length > directGroups.length && (
                <p class="text-[10px] text-dimmed flex items-center gap-1">
                  <i class="ti ti-git-branch text-[10px]" />
                  Inherited via group hierarchy.
                </p>
              )}
            </div>
          ) : (
            <div class="paper p-5 flex flex-col items-center justify-center gap-2 text-center">
              <i class="ti ti-users-group text-2xl text-dimmed" />
              <p class="text-xs text-dimmed">Not a member of any groups yet.</p>
              <a href="/app/accounts/groups" class="text-xs text-primary hover:underline">Browse groups</a>
            </div>
          )}

          {/* Right column: Manages or FreeIPA request */}
          {canManageGroups && manages.length > 0 ? (
            <div class="paper p-5 flex flex-col gap-3">
              <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
                <i class="ti ti-shield text-sm" />
                Manages
              </h2>
              <div class="flex flex-wrap gap-1.5">
                {manages.map((group) => (
                  <a
                    href={`/app/accounts/groups?scope=managed&search=${encodeURIComponent(group)}`}
                    class="tag bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/80 transition-colors"
                  >
                    {group}
                  </a>
                ))}
              </div>
            </div>
          ) : sessionUser.provider === "local" && (freeIpaEnabled || pendingRequest) ? (
            <div class="paper p-5 flex flex-col gap-3">
              <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
                <i class="ti ti-building-fortress text-sm" />
                Request FreeIPA Account
              </h2>
              <p class="text-xs text-dimmed">Request a centrally managed account if you need broader group-based access.</p>
              {pendingRequest ? (
                <div class="flex flex-col gap-3">
                  <div class="info-block-info text-xs">Request pending since {dates.formatDate(pendingRequest.createdAt.toISOString())}.</div>
                  <div class="flex justify-end">
                    <WithdrawAccountRequest />
                  </div>
                </div>
              ) : (
                <RequestFreeIpaAccount
                  givenname={sessionUser.givenname}
                  sn={sessionUser.sn}
                  displayName={sessionUser.displayName}
                  phone={null}
                  agbUrl="/legal/terms"
                  privacyUrl="/legal/privacy"
                  appName={appName}
                />
              )}
            </div>
          ) : (
            <div class="paper p-5 flex flex-col items-center justify-center gap-2 text-center">
              <i class="ti ti-shield text-2xl text-dimmed" />
              <p class="text-xs text-dimmed">You don't manage any groups.</p>
              <a href="/app/accounts/groups" class="text-xs text-primary hover:underline">Browse groups</a>
            </div>
          )}
        </div>

        {/* Settings */}
        <div class="flex items-center gap-3 pt-1">
          <div class="h-px flex-1 bg-zinc-200/70 dark:bg-zinc-700/50" />
          <span class="text-[10px] uppercase tracking-[0.2em] text-dimmed select-none">Settings</span>
          <div class="h-px flex-1 bg-zinc-200/70 dark:bg-zinc-700/50" />
        </div>

        <ProfileSettings provider={sessionUser.provider} profile={sessionUser.profile} availableWidgets={[]} freeIpaEnabled={freeIpaEnabled} />
      </div>
    </Layout>
  );
});

