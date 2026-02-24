import { ssr } from "@config";
import { type AuthContext } from "@valentinkolb/cloud-lib/server/middleware/auth";
import Layout from "@/ssr/Layout";
import { dates } from "@valentinkolb/cloud-lib/shared";
import { hasRole } from "@valentinkolb/cloud-contracts/shared";
import { getSync } from "@valentinkolb/cloud-core/services/settings";
import ProfileActions from "./ProfileActions.island";
import ProfileSettings from "./ProfileSettings.island";
import RequestAccount from "./RequestAccount.island";
import WithdrawRequest from "./WithdrawRequest.island";

export type AccountsService = {
  user: {
    group: {
      list: (config: { userId: string; recursive: boolean }) => Promise<{ items: string[] }>;
    };
  };
  accountRequest: {
    getPendingForUser: (config: { userId: string }) => Promise<{ id: string; createdAt: Date } | null>;
  };
};

/** Build display address from address components. */
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

/** Profile page showing current user info from session. */
export const createProfilePage = (accountsService: AccountsService | null) => ssr<AuthContext>(async (c) => {
  const appName = getSync<string>("app.name") || "My App";
  const sessionUser = c.get("user");
  const manages = sessionUser.manages;
  const showAllGroups = c.req.query("groups") === "all";
  const isExpiredAccount =
    hasRole(sessionUser, "guest") && sessionUser.ipaAccountExpires ? new Date(sessionUser.ipaAccountExpires) < new Date() : false;

  // Load groups for IPA users (recursive only if requested)
  let displayGroups: string[] = [];
  if (hasRole(sessionUser, "ipa", "ipa-limited")) {
    if (showAllGroups && accountsService) {
      displayGroups = (
        await accountsService.user.group.list({
          userId: sessionUser.id,
          recursive: true,
        })
      ).items;
    } else {
      displayGroups = sessionUser.memberofGroup;
    }
  }

  // Load pending account request for guest users
  const pendingAccountRequest =
    hasRole(sessionUser, "guest") && accountsService
      ? await accountsService.accountRequest.getPendingForUser({
          userId: sessionUser.id,
        })
      : null;

  return (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Profile" }]}>
      <div class="max-w-3xl mx-auto flex flex-col gap-4">
        {/* User Info Card */}
        <div class="paper p-6 flex flex-col gap-5" style="view-transition-name: profile-card">
          {/* Header: Avatar + Name */}
          <div class="flex items-center gap-4">
            <div
              class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 font-semibold text-zinc-600 dark:text-zinc-300 h-14 w-14 text-lg"
              style="view-transition-name: user-avatar"
            >
              {(sessionUser.displayName || sessionUser.uid).slice(0, 2).toUpperCase()}
            </div>
            <div class="flex flex-col min-w-0 flex-1">
              <h1 class="text-lg font-bold text-primary leading-tight">{sessionUser.displayName || sessionUser.uid}</h1>
              {sessionUser.displayName && !hasRole(sessionUser, "guest") && <span class="text-sm text-dimmed">{sessionUser.uid}</span>}
            </div>
          </div>

          {/* Roles */}
          <div class="flex items-center gap-2 flex-wrap">
            {sessionUser.roles.map((role) => (
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
            {hasRole(sessionUser, "guest") && isExpiredAccount && (
              <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300">
                expired
              </span>
            )}
          </div>

          {/* Limited account info */}
          {hasRole(sessionUser, "ipa-limited") && (
            <div class="info-block-info text-xs">
              Your account has limited access. Ask a group manager to add you to a group to unlock full features.
            </div>
          )}

          {/* Details Grid */}
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            {sessionUser.mail && (
              <>
                <i class="ti ti-mail text-dimmed mt-0.5" />
                <span class="text-secondary">{sessionUser.mail}</span>
              </>
            )}
            {sessionUser.phone && (
              <>
                <i class="ti ti-phone text-dimmed mt-0.5" />
                <span class="text-secondary">{sessionUser.phone}</span>
              </>
            )}
            {hasRole(sessionUser, "ipa", "ipa-limited") && sessionUser.employeeType && (
              <>
                <i class="ti ti-briefcase text-dimmed mt-0.5" />
                <span class="text-secondary">{sessionUser.employeeType}</span>
              </>
            )}
            {hasRole(sessionUser, "ipa", "ipa-limited") && sessionUser.mobile && sessionUser.mobile !== sessionUser.phone && (
              <>
                <i class="ti ti-device-mobile text-dimmed mt-0.5" />
                <span class="text-secondary">{sessionUser.mobile}</span>
              </>
            )}
            {hasRole(sessionUser, "ipa", "ipa-limited") && formatAddress(sessionUser.address) && (
              <>
                <i class="ti ti-map-pin text-dimmed mt-0.5" />
                <span class="text-secondary">{formatAddress(sessionUser.address)}</span>
              </>
            )}
            {hasRole(sessionUser, "ipa", "ipa-limited") && sessionUser.ipaAccountExpires && (
              <>
                <i class="ti ti-calendar-event text-dimmed mt-0.5" />
                <span class="text-dimmed text-xs leading-relaxed">Account expires {dates.formatDate(sessionUser.ipaAccountExpires)}</span>
              </>
            )}
            {hasRole(sessionUser, "ipa", "ipa-limited") && sessionUser.ipaPasswordExpires && (
              <>
                <i class="ti ti-key text-dimmed mt-0.5" />
                <span class="text-dimmed text-xs leading-relaxed">Password expires {dates.formatDate(sessionUser.ipaPasswordExpires)}</span>
              </>
            )}
          </div>

          {/* SSH Keys */}
          {hasRole(sessionUser, "ipa", "ipa-limited") && sessionUser.sshFingerprints.length > 0 && (
            <div class="border-t border-zinc-200 dark:border-zinc-700 pt-3">
              <details class="group">
                <summary class="text-sm text-dimmed cursor-pointer select-none flex items-center gap-1 hover:text-secondary transition-colors">
                  <i class="ti ti-key text-sm" />
                  {sessionUser.sshPublicKeys.length} SSH {sessionUser.sshPublicKeys.length === 1 ? "Key" : "Keys"}
                  <i class="ti ti-chevron-right text-xs transition-transform group-open:rotate-90" />
                </summary>
                <div class="mt-2 flex flex-col gap-1">
                  {sessionUser.sshFingerprints.map((fp) => (
                    <code class="text-xs font-mono text-secondary bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded break-all">{fp}</code>
                  ))}
                </div>
              </details>
            </div>
          )}

          {/* Profile Action Buttons */}
          <div class="border-t border-zinc-200 dark:border-zinc-700 pt-3">
            <ProfileActions
              roles={sessionUser.roles}
              uid={sessionUser.uid}
              givenname={sessionUser.givenname}
              sn={sessionUser.sn}
              displayName={sessionUser.displayName}
              phone={sessionUser.phone}
              address={sessionUser.address}
              sshPublicKeys={sessionUser.sshPublicKeys}
              sshFingerprints={sessionUser.sshFingerprints}
              appName={appName}
            />
          </div>
        </div>

        {/* Request Account Section (only for guest users) */}
        {hasRole(sessionUser, "guest") && (
          <div class="flex flex-col gap-3">
            <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
              <i class="ti ti-sparkles text-sm" />
              Join {appName}
            </h2>

            {/* Pending account request */}
            {pendingAccountRequest && (
              <div class="paper p-4 flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <i class="ti ti-clock text-amber-600 dark:text-amber-400" />
                  <div>
                    <span class="text-sm font-medium text-primary">Account Request Pending</span>
                    <span class="text-xs text-dimmed ml-2">since {dates.formatDate(pendingAccountRequest.createdAt.toISOString())}</span>
                  </div>
                </div>
                <WithdrawRequest requestId={pendingAccountRequest.id} />
              </div>
            )}

            {/* Request account card - only if no pending request */}
            {!pendingAccountRequest && (
              <div class="paper p-4 flex items-center justify-between">
                <div>
                  <h3 class="text-sm font-medium text-primary">Part of {appName}?</h3>
                  <p class="text-xs text-dimmed mt-1">Request an account to get full access.</p>
                </div>
                <RequestAccount
                  givenname={sessionUser.givenname}
                  sn={sessionUser.sn}
                  displayName={sessionUser.displayName}
                  phone={sessionUser.phone}
                  appName={appName}
                />
              </div>
            )}
          </div>
        )}

        {/* Groups Card (for IPA users) */}
        {hasRole(sessionUser, "ipa", "ipa-limited") && (
          <div class="paper p-6 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
                <i class="ti ti-users-group text-sm" />
                Groups
              </h2>
              <a
                href={showAllGroups ? "/me" : "/me?groups=all"}
                class={`text-xs px-2 py-1 rounded flex items-center gap-1 transition-colors ${
                  showAllGroups
                    ? "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300"
                    : "bg-zinc-100 dark:bg-zinc-800 text-dimmed hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
                title={showAllGroups ? "Show direct memberships only" : "Show all memberships (including inherited)"}
              >
                <i class="ti ti-git-branch text-xs" />
                {showAllGroups ? "All" : "Direct"}
              </a>
            </div>

            {displayGroups.length > 0 ? (
              <div class="flex flex-wrap gap-1.5">
                {displayGroups.map((group) => {
                  const isDirect = sessionUser.memberofGroup.includes(group);
                  return (
                    <a
                      href={`/app/accounts/groups/${group}`}
                      class={`text-xs px-2 py-1 rounded transition-colors ${
                        isDirect
                          ? "bg-zinc-100 dark:bg-zinc-800 text-secondary hover:bg-zinc-200 dark:hover:bg-zinc-700"
                          : "bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50"
                      }`}
                      title={isDirect ? "Direct membership" : "Inherited via group hierarchy"}
                    >
                      {group}
                      {!isDirect && <i class="ti ti-git-branch text-[10px] ml-1 opacity-70" />}
                    </a>
                  );
                })}
              </div>
            ) : (
              <p class="text-xs text-dimmed">No groups.</p>
            )}

            {showAllGroups && displayGroups.length > sessionUser.memberofGroup.length && (
              <p class="text-xs text-dimmed flex items-center gap-1">
                <i class="ti ti-git-branch text-[10px]" />
                Groups with this icon are inherited via group hierarchy.
              </p>
            )}
          </div>
        )}

        {/* Manages Card */}
        {manages.length > 0 && (
          <div class="paper p-6 flex flex-col gap-3">
            <h2 class="text-sm font-semibold text-primary flex items-center gap-1">
              <i class="ti ti-shield text-sm" />
              Manages
            </h2>

            <p class="info-block-success text-xs">You can manage the following groups. This allows you to add and remove members.</p>

            <div class="flex flex-wrap gap-1.5">
              {manages.map((group) => (
                <a
                  href={`/app/accounts/groups/${group}`}
                  class="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/80 transition-colors"
                >
                  {group}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Settings */}
        <h2 class="section-label mb-0 mt-2">Settings</h2>

        { /* todo widget settings */}
        <ProfileSettings roles={sessionUser.roles} availableWidgets={[]} />
      </div>
    </Layout>
  );
});
