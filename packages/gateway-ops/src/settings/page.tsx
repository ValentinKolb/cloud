import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { settingsService, coreSettings } from "@valentinkolb/cloud/services";
import CoreSettingsForm, { type SettingFieldDef } from "./_components/CoreSettingsForm.island";
import LegalSettingsForm, { type LegalInitial } from "./_components/LegalSettingsForm.island";
import LegacySettingsPanel from "./_components/LegacySettingsPanel.island";

// Flat tab list. Each tab maps either to a core-settings group (`group` prop)
// or the special `legal` view that uses a custom form (mode-switch UX).
const TABS = [
  { id: "general", title: "General Settings", description: "Branding, public links, schedules, and global defaults.", group: "app" as const },
  { id: "user", title: "User Management Settings", description: "Login, expiry, reminder, and self-service behavior.", group: "user" as const },
  { id: "freeipa", title: "FreeIPA Settings", description: "FreeIPA connectivity, sync rules, and group mapping.", group: "freeipa" as const },
  { id: "mail", title: "Mail Settings", description: "SMTP delivery and email templates.", group: "mail" as const },
  { id: "security", title: "Security Settings", description: "Rate limits and access protection defaults.", group: "security" as const },
  { id: "legal", title: "Legal Settings", description: "Terms of Service, Privacy Policy, and Imprint.", group: null },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTabId = (value: string | undefined): value is TabId =>
  !!value && TABS.some((t) => t.id === value);

/**
 * Pull the SettingFieldDef list for a given group from the global settings
 * registry. Returns entries with current values resolved (DB → env → default).
 */
const buildEntries = async (group: string): Promise<SettingFieldDef[]> => {
  const result = await settingsService.entry.list({ filter: { group } });
  return result.items.map((item) => ({
    key: item.key,
    label: item.label,
    description: item.description,
    kind: item.kind as SettingFieldDef["kind"],
    value: item.value,
    options: item.options,
    min: item.min,
    max: item.max,
    placeholder: item.placeholder,
  }));
};

/** Read all 9 legal.* settings into the LegalSettingsForm initial shape. */
const buildLegalInitial = async (): Promise<LegalInitial> => {
  const [
    termsMode, termsContent, termsUrl,
    privacyMode, privacyContent, privacyUrl,
    imprintMode, imprintContent, imprintUrl,
  ] = await Promise.all([
    coreSettings.get<string>("legal.terms.mode"),
    coreSettings.get<string>("legal.terms.content"),
    coreSettings.get<string>("legal.terms.url"),
    coreSettings.get<string>("legal.privacy.mode"),
    coreSettings.get<string>("legal.privacy.content"),
    coreSettings.get<string>("legal.privacy.url"),
    coreSettings.get<string>("legal.imprint.mode"),
    coreSettings.get<string>("legal.imprint.content"),
    coreSettings.get<string>("legal.imprint.url"),
  ]);
  const asMode = (v: string | undefined): "local" | "external" => (v === "external" ? "external" : "local");
  return {
    "legal.terms.mode": asMode(termsMode),
    "legal.terms.content": termsContent ?? "",
    "legal.terms.url": termsUrl ?? "",
    "legal.privacy.mode": asMode(privacyMode),
    "legal.privacy.content": privacyContent ?? "",
    "legal.privacy.url": privacyUrl ?? "",
    "legal.imprint.mode": asMode(imprintMode),
    "legal.imprint.content": imprintContent ?? "",
    "legal.imprint.url": imprintUrl ?? "",
  };
};

export default ssr<AuthContext>(async (c) => {
  const rawTab = c.req.query("tab");
  const tabId: TabId = isTabId(rawTab) ? rawTab : "general";
  const tab = TABS.find((t) => t.id === tabId)!;

  let entries: SettingFieldDef[] = [];
  let legalInitial: LegalInitial | null = null;

  if (tab.group) {
    entries = await buildEntries(tab.group);
  } else if (tab.id === "legal") {
    legalInitial = await buildLegalInitial();
  }

  return () => (
    <AdminLayout c={c} title={tab.title} stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-settings-title">
            <h1 class="text-base font-semibold text-primary">{tab.title}</h1>
            <p class="mt-1 text-xs text-dimmed">{tab.description}</p>
          </div>

          {tab.group ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-settings-content">
              <CoreSettingsForm entries={entries} />
            </section>
          ) : null}

          {tab.id === "general" ? <LegacySettingsPanel /> : null}

          {tab.id === "legal" && legalInitial ? (
            <LegalSettingsForm initial={legalInitial} />
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
});
