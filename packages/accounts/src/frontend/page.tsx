import type { AuthContext } from "@valentinkolb/cloud/server";
import { accountsAppService as accountsService, coreSettings } from "@valentinkolb/cloud/services";
import { getDefaultGroupScope, isAdminUser } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr";
import { Avatar, LinkCard, LogEntriesTable, ProgressBar, StatCell } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { expectUserBackedActor } from "@/shared/actor";
import { ssr } from "../config";
import AccountsWorkspace from "./AccountsWorkspace";
import AdminOperations from "./dashboard/AdminOperations.island";
import { getAccountTypeLabel, getManagementBadge, getManagementLabel, getPrimaryAccountBadge } from "./lib/account-badges";
import { buildGroupsUrl } from "./lib/url-state";

const BASE_QUICK_LINKS = [
  { href: "/admin/observability/logs?source=auth:ipa:sync", label: "Sync logs" },
  { href: "/admin/observability/logs?source=auth:ipa:backfill", label: "IPA backfill" },
  { href: "/admin/observability/logs?source=auth:local-user:backfill", label: "Local user backfill" },
  { href: "/admin/observability/logs?source=auth:guest:backfill", label: "Guest backfill" },
  { href: "/admin/observability/logs?source=auth:reminder:daily", label: "Reminder runs" },
  { href: "/app/accounts/deleted-accounts", label: "Deleted accounts" },
  { href: "/app/accounts/reminders", label: "Reminder history" },
] as const;

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const isAdmin = isAdminUser(user);
  const freeIpaEnabled = Boolean(await coreSettings.get<boolean>("freeipa.enable"));
  const defaultGroupScope = getDefaultGroupScope(user);
  const [summary, activity, managedGroups, memberGroups, allGroups] = await Promise.all([
    isAdmin ? accountsService.dashboard.get() : Promise.resolve(null),
    isAdmin ? accountsService.dashboard.activity() : Promise.resolve([]),
    accountsService.group.list({ pagination: { page: 1, perPage: 1 }, scope: { userId: user.id, mode: "managed" } }),
    accountsService.group.list({ pagination: { page: 1, perPage: 1 }, scope: { userId: user.id, mode: "member" } }),
    accountsService.group.list({ pagination: { page: 1, perPage: 1 }, scope: { mode: "all" } }),
  ]);
  const primaryBadge = getPrimaryAccountBadge(user);
  const managementBadge = getManagementBadge(user);
  const accountExpires = user.accountExpires ? dates.formatDate(user.accountExpires) : null;
  const loginMethod = user.provider === "ipa" ? "FreeIPA password" : "Magic link";
  const isExpiredAccount = user.accountExpires ? new Date(user.accountExpires) < new Date() : false;
  const totalAccounts = summary ? summary.ipaAccountsTotal + summary.localAccountsTotal : 0;
  const expiringTotal = summary ? summary.ipaExpiring30d + summary.localUserExpiring30d + summary.localGuestExpiring30d : 0;
  const quickLinks = freeIpaEnabled ? BASE_QUICK_LINKS : BASE_QUICK_LINKS.filter((link) => !link.href.includes("auth:ipa:"));
  const healthRows: Array<[string, number, number]> = freeIpaEnabled
    ? [
        ["IPA sync", summary?.recentSyncRuns ?? 0, summary?.recentSyncRunsWithFailures ?? 0],
        ["IPA demotion", summary?.recentDemotionRuns ?? 0, summary?.recentDemotionRunsWithFailures ?? 0],
        ["Reminders", summary?.recentReminderRuns ?? 0, summary?.recentReminderRunsWithFailures ?? 0],
      ]
    : [["Reminders", summary?.recentReminderRuns ?? 0, summary?.recentReminderRunsWithFailures ?? 0]];

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts" }]}>
      <AccountsWorkspace
        active="dashboard"
        isAdmin={isAdmin}
        pendingRequests={summary?.openRequests ?? 0}
        scrollPreserveKey="accounts-dashboard"
      >
        <div class="flex flex-col gap-5">
          {/* Identity */}
          <section class="paper">
            <div class="flex items-center gap-4 p-5">
              <Avatar
                username={user.displayName || user.uid}
                userId={user.id}
                avatarHash={user.avatarHash}
                size="md"
                class="h-11 w-11"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-sm font-semibold text-primary">{user.displayName || user.uid}</h1>
                  <span class={`tag ${primaryBadge.className}`}>{primaryBadge.label}</span>
                  <span class={`tag ${managementBadge.className}`}>{managementBadge.label}</span>
                  {isExpiredAccount && <span class="tag bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300">Expired</span>}
                </div>
                <span class="text-xs text-dimmed">{user.uid}</span>
              </div>
              <a href="/me" class="btn-input btn-input-sm shrink-0">
                <i class="ti ti-user" />
                <span class="hidden sm:inline">Profile</span>
              </a>
            </div>
            <div class="border-t border-zinc-200/60 dark:border-zinc-700/40 px-5 py-3 flex flex-wrap gap-x-6 gap-y-1.5">
              {(
                [
                  ["Access", getAccountTypeLabel(user)],
                  ["Managed by", getManagementLabel(user)],
                  ["Login", loginMethod],
                  ["Expires", accountExpires ?? "Never"],
                ] as const
              ).map(([label, value]) => (
                <div class="flex items-baseline gap-2">
                  <span class="text-[11px] uppercase tracking-[0.14em] text-dimmed">{label}</span>
                  <span
                    class={`text-xs font-medium ${label === "Expires" && isExpiredAccount ? "text-red-600 dark:text-red-400" : "text-primary"}`}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Groups */}
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <LinkCard
              href={buildGroupsUrl({ search: "", page: 1, provider: "", scope: "managed" }, { defaultScope: defaultGroupScope })}
              title="Managed by me"
              description={`${managedGroups.total} group${managedGroups.total === 1 ? "" : "s"}`}
              icon="ti ti-shield"
              color="violet"
            />
            <LinkCard
              href={buildGroupsUrl({ search: "", page: 1, provider: "", scope: "member" }, { defaultScope: defaultGroupScope })}
              title="My groups"
              description={`${memberGroups.total} group${memberGroups.total === 1 ? "" : "s"}`}
              icon="ti ti-users-group"
              color="blue"
            />
            <LinkCard
              href={buildGroupsUrl({ search: "", page: 1, provider: "", scope: "all" }, { defaultScope: defaultGroupScope })}
              title="All groups"
              description={`${allGroups.total} group${allGroups.total === 1 ? "" : "s"}`}
              icon="ti ti-layout-grid"
              color="zinc"
            />
          </div>

          {/* Admin */}
          {isAdmin && summary ? (
            <>
              <div class="flex items-center gap-3 pt-2">
                <div class="h-px flex-1 bg-zinc-200/70 dark:bg-zinc-700/50" />
                <span class="text-[10px] uppercase tracking-[0.2em] text-dimmed select-none">Admin</span>
                <div class="h-px flex-1 bg-zinc-200/70 dark:bg-zinc-700/50" />
              </div>

              <div class="paper px-4 py-3">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="text-xs font-medium text-primary">Administrative account actions are recorded in the audit log.</p>
                    <p class="mt-0.5 text-[11px] text-dimmed">
                      Review user, group, and account request changes from one searchable history.
                    </p>
                  </div>
                  <a href="/app/accounts/audit" class="btn-input btn-input-sm shrink-0">
                    <i class="ti ti-clipboard-list" />
                    Audit Log
                  </a>
                </div>
              </div>

              {/* Hero stats: Run Health (left, list of progress rows) + 2x2 stat grid (right).
                    See skills/cloud-app/references/frontend.md § Stats — Hero pattern.
                    The hero side carries `lg:border-r` so the divider line
                    between the two halves visually continues the StatCell
                    hairlines on the right. At narrow viewports the layout
                    stacks and the border is suppressed (no orphaned line). */}
              <div class="paper overflow-hidden">
                <div class="grid grid-cols-1 lg:grid-cols-[1.2fr_1.8fr]">
                  {/* Run Health — hero side */}
                  <div class="px-5 py-5 flex flex-col gap-3 lg:border-r border-zinc-100 dark:border-zinc-800">
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-[10px] uppercase tracking-wider text-dimmed">Run health</span>
                      <span
                        class={`tag ${
                          summary.lastSync
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                        }`}
                      >
                        <i class={`ti ${summary.lastSync ? "ti-check" : "ti-alert-circle"}`} />
                        {summary.lastSync ? `Synced ${dates.formatDateTimeRelative(summary.lastSync.createdAt)}` : "No sync yet"}
                      </span>
                    </div>
                    <div class="flex flex-col gap-2 flex-1 justify-center">
                      {healthRows.map(([label, runs, failedRuns]) => {
                        const rate = runs > 0 ? Math.round(((runs - failedRuns) / runs) * 100) : 100;
                        const hasFails = failedRuns > 0;
                        return (
                          <div class="flex items-center gap-3">
                            <span class="text-xs text-secondary w-28 shrink-0 truncate">{label}</span>
                            <ProgressBar value={rate} size="xs" tone={hasFails ? "danger" : "primary"} class="flex-1 min-w-0" />
                            <span
                              class={`text-[11px] tabular-nums shrink-0 ${hasFails ? "text-red-600 dark:text-red-400 font-medium" : "text-dimmed"}`}
                            >
                              {rate}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <span class="text-[10px] text-dimmed">Based on last {summary.runHealthWindow} runs</span>
                  </div>
                  {/* Stat cells — 2x2 grid. Inline (not StatGrid) because we're
                        already inside the hero's paper frame; using StatGrid here
                        would nest a second paper container. The hairline body
                        (`gap-px bg-zinc`) is the same pattern StatGrid emits. */}
                  <div class="grid grid-cols-2 gap-px bg-zinc-100 dark:bg-zinc-800">
                    <StatCell
                      label="Accounts"
                      value={totalAccounts}
                      sub={`${summary.ipaAccountsTotal} IPA · ${summary.localAccountsTotal} local`}
                      accent={{ tone: "blue", icon: "ti ti-users" }}
                    />
                    <StatCell
                      label="Groups"
                      value={summary.groupsTotal}
                      sub={`${summary.ipaGroupsTotal} IPA · ${summary.localGroupsTotal} local`}
                    />
                    <StatCell
                      label="Requests"
                      value={summary.openRequests}
                      valueClass={summary.openRequests > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
                      sub={summary.openRequests > 0 ? "pending review" : "none pending"}
                      accent={
                        summary.openRequests > 0
                          ? {
                              tone: "amber",
                              icon: "ti ti-clock",
                              text: "open",
                              href: "/app/accounts/requests",
                            }
                          : undefined
                      }
                    />
                    <StatCell
                      label="Expiring 30d"
                      value={expiringTotal}
                      sub={expiringTotal > 0 ? "accounts" : "none soon"}
                      valueClass={expiringTotal > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
                      accent={expiringTotal > 0 ? { tone: "amber", icon: "ti ti-calendar-due" } : undefined}
                    />
                  </div>
                </div>
              </div>

              {/* Operations */}
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] uppercase tracking-[0.14em] text-dimmed">Operations</span>
                  <a href="/admin/settings" class="text-[11px] text-dimmed transition-colors hover:text-primary">
                    Settings
                  </a>
                </div>
                <AdminOperations freeIpaEnabled={freeIpaEnabled} />
              </div>

              {/* Activity */}
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[11px] uppercase tracking-[0.14em] text-dimmed">Recent activity</span>
                  <div class="flex items-center gap-1 flex-wrap">
                    {quickLinks.map((link) => (
                      <a href={link.href} class="tag bg-zinc-100 dark:bg-zinc-800 text-dimmed transition-colors hover:text-primary">
                        {link.label}
                      </a>
                    ))}
                  </div>
                </div>
                <LogEntriesTable entries={activity} emptyMessage="No lifecycle activity logged yet." />
              </div>
            </>
          ) : null}
        </div>
      </AccountsWorkspace>
    </Layout>
  );
});
