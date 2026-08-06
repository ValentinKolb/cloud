import { dates } from "@k2b/stdlib";
import { NoticeCard, ButtonLink, Placeholder } from "@k2b/ui";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { accountsAppService, audit, coreSettings, notifications, serviceAccountCredentials, webauthn } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import AccountHub, { AccountPageHeader, AccountProfileActions } from "./AccountHub";
import SignOutButton from "./SignOutButton.island";

const accountExpiryCopy = (expiresAt: string): string => {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "Your account has expired.";
  if (days === 0) return "Your account expires today.";
  return `Your account expires in ${days} ${days === 1 ? "day" : "days"}.`;
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const [rawAppName, freeIpaEnabledRaw] = await Promise.all([
    coreSettings.get<string>("app.name"),
    coreSettings.get<boolean>("freeipa.enable"),
  ]);
  const appName = rawAppName || "Cloud";
  const freeIpaEnabled = Boolean(freeIpaEnabledRaw);
  const [pendingRequest, apiKeys, passkeys, activityPage, notificationPreferences] = await Promise.all([
    user.provider === "local" ? accountsAppService.accountRequest.getPendingForUser({ userId: user.id }) : Promise.resolve(null),
    serviceAccountCredentials.listForDelegatedUser({ userId: user.id }),
    webauthn.listForUser({ userId: user.id }),
    audit.listSelfServiceActivity({ userId: user.id, days: 30, pagination: { page: 1, perPage: 5 } }),
    notifications.user.preferences.list(user.id),
  ]);
  const customizedNotifications = notificationPreferences.definitions.filter((preference) => preference.customized).length;
  const action = c.req.query("action");

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Account" }]}>
      <AccountHub
        user={user}
        active="overview"
        actions={
          <>
            <AccountProfileActions user={user} appName={appName} freeIpaEnabled={freeIpaEnabled} />
            <SignOutButton />
          </>
        }
      >
        <div class="flex flex-col gap-2">
          <AccountPageHeader title="Account overview" description="Your identity, access, security, and personal Cloud setup." />

          {action === "extend" && (
            <NoticeCard tone="info" icon={false}>
              Use <strong>Extend Account</strong> above to renew your account expiry.
            </NoticeCard>
          )}

          {user.accountExpires && (
            <section class="paper flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <i class="ti ti-calendar-exclamation" />
              </span>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-primary">{accountExpiryCopy(user.accountExpires)}</h3>
                <p class="mt-1 text-xs text-dimmed">
                  Extend access before {dates.formatDate(user.accountExpires)} to avoid an interruption.
                </p>
              </div>
              <AccountProfileActions user={user} appName={appName} freeIpaEnabled={freeIpaEnabled} actions={["extend"]} />
            </section>
          )}

          {pendingRequest && (
            <a
              href="/me/access"
              class="paper flex items-center gap-3 p-4 no-underline transition-colors hover:bg-[var(--ui-surface-subtle)]"
            >
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <i class="ti ti-clock" />
              </span>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-primary">FreeIPA account request pending</h3>
                <p class="mt-1 text-xs text-dimmed">
                  Submitted {dates.formatDate(pendingRequest.createdAt.toISOString())}. Open Access to review it.
                </p>
              </div>
              <i class="ti ti-chevron-right text-dimmed" />
            </a>
          )}

          {user.provider === "ipa" && user.profile === "guest" && (
            <NoticeCard tone="info" icon={false}>
              Your account has limited access. Ask a group manager to add you to a group to unlock full features.
            </NoticeCard>
          )}

          <section class="grid gap-2 sm:grid-cols-2">
            <a href="/me/security" class="paper group p-4 no-underline transition-colors hover:bg-[var(--ui-surface-subtle)]">
              <div class="flex items-start gap-3">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-secondary">
                  <i class="ti ti-shield-lock" />
                </span>
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-primary group-hover:text-secondary">Security</h3>
                  <p class="mt-1 text-xs text-dimmed">
                    {passkeys.length} {passkeys.length === 1 ? "passkey" : "passkeys"} ·{" "}
                    {activityPage.items.length > 0 ? "Recent activity available" : "No recent activity"}
                  </p>
                </div>
                <i class="ti ti-chevron-right text-dimmed" />
              </div>
            </a>

            <a href="/me/access" class="paper group p-4 no-underline transition-colors hover:bg-[var(--ui-surface-subtle)]">
              <div class="flex items-start gap-3">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-secondary">
                  <i class="ti ti-users-group" />
                </span>
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-primary group-hover:text-secondary">Access and groups</h3>
                  <p class="mt-1 text-xs text-dimmed">
                    {user.memberofGroup.length} direct memberships · {user.manages.length} managed groups
                  </p>
                </div>
                <i class="ti ti-chevron-right text-dimmed" />
              </div>
            </a>

            <a href="/me/notifications" class="paper group p-4 no-underline transition-colors hover:bg-[var(--ui-surface-subtle)]">
              <div class="flex items-start gap-3">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-secondary">
                  <i class="ti ti-bell" />
                </span>
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-primary group-hover:text-secondary">Notifications</h3>
                  <p class="mt-1 text-xs text-dimmed">
                    {customizedNotifications > 0
                      ? `${customizedNotifications} customized ${customizedNotifications === 1 ? "preference" : "preferences"}`
                      : "Using app defaults"}
                  </p>
                </div>
                <i class="ti ti-chevron-right text-dimmed" />
              </div>
            </a>

            <a href="/me/developer" class="paper group p-4 no-underline transition-colors hover:bg-[var(--ui-surface-subtle)]">
              <div class="flex items-start gap-3">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-secondary">
                  <i class="ti ti-terminal-2" />
                </span>
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-primary group-hover:text-secondary">Developer</h3>
                  <p class="mt-1 text-xs text-dimmed">
                    {apiKeys.length} personal API {apiKeys.length === 1 ? "key" : "keys"} · CLI and SSH setup
                  </p>
                </div>
                <i class="ti ti-chevron-right text-dimmed" />
              </div>
            </a>
          </section>

          <section class="paper p-5">
            <div class="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-primary">Recent security activity</h3>
                <p class="mt-1 text-xs text-dimmed">The latest account-relevant events. Full history remains in Security.</p>
              </div>
              <ButtonLink href="/me/security" variant="ghost" size="sm" class="shrink-0">
                View all
                <i class="ti ti-arrow-right" />
              </ButtonLink>
            </div>
            {activityPage.items.length > 0 ? (
              <div class="flex flex-col gap-1 rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-2">
                {activityPage.items.slice(0, 3).map((entry) => (
                  <div class="grid gap-1 rounded-[var(--ui-radius-control)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-primary">{entry.label}</p>
                      <p class="mt-0.5 truncate text-xs text-dimmed">{entry.context || "Account"}</p>
                    </div>
                    <span class="text-xs text-dimmed">{dates.formatDateTimeRelative(entry.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Placeholder align="left" description="No recent account activity." />
            )}
          </section>
        </div>
      </AccountHub>
    </Layout>
  );
});
