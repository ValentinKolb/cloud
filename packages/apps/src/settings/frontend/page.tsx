import { ssr } from "@valentinkolb/cloud/core/config";
import { type SettingEntry } from "@valentinkolb/cloud/core/settings";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import { faqService } from "@/faq/service";
import type { FaqAudience } from "@/faq/contracts";
import FaqDelete from "@/faq/frontend/_components/FaqDelete.island";
import FaqForm from "@/faq/frontend/_components/FaqForm.island";
import FaqReorder from "@/faq/frontend/_components/FaqReorder.island";
import { settingsService } from "../service";
import { GROUP_LABELS } from "@valentinkolb/cloud/core/settings";
import { termsService } from "@/terms/service";
import TermsDelete from "@/terms/frontend/_components/TermsDelete.island";
import TermsForm from "@/terms/frontend/_components/TermsForm.island";
import SettingsForm from "./SettingsForm.island";

const SETTINGS_GROUPS = ["app", "freeipa", "user", "mail", "security"] as const;
const TOP_LEVEL_TABS = ["settings", "faq", "terms"] as const;

type SettingsTab = (typeof TOP_LEVEL_TABS)[number];
type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

const GROUP_META: Record<SettingsGroup, { icon: string; description: string }> = {
  app: {
    icon: "ti ti-app-window",
    description: "Branding, public links, schedules, and global defaults.",
  },
  freeipa: {
    icon: "ti ti-building-fortress",
    description: "FreeIPA connectivity, sync rules, and group mapping.",
  },
  user: {
    icon: "ti ti-users",
    description: "Login, expiry, reminder, and self-service behavior.",
  },
  mail: {
    icon: "ti ti-mail",
    description: "SMTP delivery and email templates.",
  },
  security: {
    icon: "ti ti-shield-lock",
    description: "Rate limits and access protection defaults.",
  },
};

const FAQ_AUDIENCE_LABELS: Record<FaqAudience, { label: string; color: string }> = {
  user: {
    label: "User",
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  guest: {
    label: "Guest",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  anonymous: {
    label: "Not signed in",
    color: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

const isTab = (value: string | undefined): value is SettingsTab => !!value && TOP_LEVEL_TABS.includes(value as SettingsTab);
const isGroup = (value: string | undefined): value is SettingsGroup => !!value && SETTINGS_GROUPS.includes(value as SettingsGroup);

const buildSettingsHref = (tab: SettingsTab, group: SettingsGroup) => {
  const params = new URLSearchParams({ tab });
  if (tab === "settings") params.set("group", group);
  return `/admin/settings?${params.toString()}`;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const TabLink = (props: { href: string; label: string; icon: string; active: boolean; badge?: string }) => (
  <a
    href={props.href}
    class={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
      props.active
        ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-500/35 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-400/40"
        : "text-dimmed hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-800"
    }`}
  >
    <i class={`${props.icon} text-sm`} />
    <span>{props.label}</span>
    {props.badge ? <span class="tag bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300">{props.badge}</span> : null}
  </a>
);

export default ssr<AuthContext>(async (c) => {
  const rawTab = c.req.query("tab");
  const rawGroup = c.req.query("group");
  const tab: SettingsTab = isTab(rawTab) ? rawTab : "settings";
  const group: SettingsGroup = isGroup(rawGroup) ? rawGroup : "app";

  let entries: SettingEntry[] = [];
  let faqEntries: Awaited<ReturnType<typeof faqService.entry.list>>["items"] = [];
  let termsVersions: Awaited<ReturnType<typeof termsService.version.list>>["items"] = [];

  if (tab === "settings") {
    entries = (await settingsService.entry.list({ filter: { group } })).items;
  } else if (tab === "faq") {
    faqEntries = (await faqService.entry.list()).items;
  } else {
    termsVersions = (await termsService.version.list()).items;
  }

  const allFaqIds = faqEntries.map((entry) => entry.id);
  const activeGroup = GROUP_META[group];

  return (
    <AdminLayout c={c} title="Settings" fullHeight>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2 p-4">
          <div class="min-w-0" style="view-transition-name: admin-settings-title">
            <h1 class="text-base font-semibold text-primary">Settings</h1>
            <p class="mt-1 text-xs text-dimmed">Runtime configuration, help content, and terms of service.</p>
          </div>

          <nav class="flex flex-wrap items-center gap-1" aria-label="Settings sections">
            <TabLink href={buildSettingsHref("settings", group)} label="Settings" icon="ti ti-settings" active={tab === "settings"} />
            <TabLink href={buildSettingsHref("faq", group)} label="FAQ" icon="ti ti-help-circle" active={tab === "faq"} />
            <TabLink href={buildSettingsHref("terms", group)} label="Terms Of Service" icon="ti ti-file-text" active={tab === "terms"} />
          </nav>

          {tab === "settings" ? (
            <>
              <section class="paper flex flex-wrap items-start justify-between gap-3 p-3" style="view-transition-name: admin-settings-groups">
                <div class="min-w-0">
                  <div class="flex items-center gap-2 text-sm font-medium text-primary">
                    <i class={activeGroup.icon} />
                    <span>{GROUP_LABELS[group]}</span>
                  </div>
                  <p class="mt-1 text-xs text-dimmed">{activeGroup.description}</p>
                </div>
                <nav class="flex flex-wrap items-center gap-1" aria-label="Setting groups">
                  {SETTINGS_GROUPS.map((entryGroup) => (
                    <TabLink
                      href={buildSettingsHref("settings", entryGroup)}
                      label={GROUP_LABELS[entryGroup] ?? entryGroup}
                      icon={GROUP_META[entryGroup].icon}
                      active={entryGroup === group}
                    />
                  ))}
                </nav>
              </section>

              <section class="paper overflow-hidden" style="view-transition-name: admin-settings-content">
                <SettingsForm entries={entries} />
              </section>
            </>
          ) : null}

          {tab === "faq" ? (
            <>
              <section class="paper flex flex-wrap items-start justify-between gap-3 p-3" style="view-transition-name: admin-faq-toolbar">
                <div class="min-w-0">
                  <h2 class="text-sm font-semibold text-primary">FAQ</h2>
                  <p class="mt-1 text-xs text-dimmed">Manage the public help entries and their audience visibility.</p>
                </div>
                <FaqForm />
              </section>

              {faqEntries.length > 0 ? (
                <section class="paper overflow-hidden" style="view-transition-name: admin-faq-list">
                  <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {faqEntries.map((entry, index) => (
                      <div class="flex gap-3 px-3 py-3">
                        <FaqReorder allIds={allFaqIds} index={index} />
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-sm font-medium text-primary">{entry.question}</h3>
                            {entry.audience.map((audience) => (
                              <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${FAQ_AUDIENCE_LABELS[audience].color}`}>
                                {FAQ_AUDIENCE_LABELS[audience].label}
                              </span>
                            ))}
                          </div>
                          <p class="mt-1 line-clamp-2 text-xs text-dimmed">{entry.answer}</p>
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <FaqForm id={entry.id} question={entry.question} answer={entry.answer} audience={entry.audience} />
                          <FaqDelete id={entry.id} />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <section class="paper p-6 text-center text-sm text-dimmed">No FAQ entries yet.</section>
              )}
            </>
          ) : null}

          {tab === "terms" ? (
            <>
              <section class="paper flex flex-wrap items-start justify-between gap-3 p-3" style="view-transition-name: admin-terms-toolbar">
                <div class="min-w-0">
                  <h2 class="text-sm font-semibold text-primary">Terms Of Service</h2>
                  <p class="mt-1 text-xs text-dimmed">Publish legal text versions. The newest version is always the active one.</p>
                </div>
                <TermsForm />
              </section>

              {termsVersions.length > 0 ? (
                <section class="paper overflow-hidden" style="view-transition-name: admin-terms-list">
                  <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {termsVersions.map((version, index) => (
                      <div class="flex gap-3 px-3 py-3">
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-medium text-primary">{formatDate(version.createdAt)}</span>
                            {index === 0 ? (
                              <span class="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                Latest
                              </span>
                            ) : null}
                          </div>
                          <p class="mt-1 line-clamp-3 whitespace-pre-line text-xs text-dimmed">
                            {version.content.slice(0, 320)}
                            {version.content.length > 320 ? "..." : ""}
                          </p>
                          <a
                            href={`/legal/agb?v=${version.id}`}
                            target="_blank"
                            class="mt-2 inline-flex items-center gap-1 text-xs text-dimmed transition-colors hover:text-primary"
                          >
                            <i class="ti ti-external-link text-[10px]" />
                            View public version
                          </a>
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <TermsDelete id={version.id} />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <section class="paper p-6 text-center text-sm text-dimmed">No terms versions yet.</section>
              )}
            </>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
});
