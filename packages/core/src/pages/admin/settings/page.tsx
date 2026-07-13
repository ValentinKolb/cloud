import { type AiEnrichmentOverview, aiConversationStore } from "@valentinkolb/cloud/ai";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { settingsService } from "@valentinkolb/cloud/services";
import { AdminLayout, getRuntimeContext, hasDedicatedRuntimeRoute } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../../config";
import CoreLayoutHelp from "../../CoreLayoutHelp.island";
import AdminAiSkills from "./_components/AdminAiSkills.island";
import CoreSettingsForm, { type SettingFieldDef } from "./_components/CoreSettingsForm.island";
import LegalSettingsForm, { type LegalInitial } from "./_components/LegalSettingsForm.island";

// Flat tab list. Each tab maps either to a core-settings group (`group` prop)
// or the special `legal` view that uses a custom form (mode-switch UX).
const TABS = [
  {
    id: "general",
    title: "General Settings",
    description: "Branding, public links, schedules, and global defaults.",
    icon: "ti ti-settings",
    group: "app" as const,
  },
  {
    id: "user",
    title: "User Management Settings",
    description: "Login, expiry, reminder, and self-service behavior.",
    icon: "ti ti-users",
    group: "user" as const,
  },
  {
    id: "freeipa",
    title: "FreeIPA Settings",
    description: "FreeIPA connectivity, sync rules, and group mapping.",
    icon: "ti ti-building-fortress",
    group: "freeipa" as const,
  },
  {
    id: "ai-general",
    title: "AI General",
    description: "Availability, system prompt, context handling, and web tools.",
    icon: "ti ti-adjustments",
    group: "ai" as const,
  },
  {
    id: "ai-providers",
    title: "AI Providers",
    description: "Model profiles, provider credentials, and capabilities.",
    icon: "ti ti-sparkles",
    group: "ai" as const,
  },
  {
    id: "ai-skills",
    title: "AI Skills",
    description: "Workspace skill catalog, code review queue, and audit log.",
    icon: "ti ti-wand",
    group: null,
  },
  {
    id: "ai-jobs",
    title: "AI Background Jobs",
    description: "Model and schedule for background AI work like chat enrichment.",
    icon: "ti ti-activity",
    group: "ai" as const,
  },
  { id: "mail", title: "Mail Settings", description: "SMTP delivery and sender credentials.", icon: "ti ti-mail", group: "mail" as const },
  {
    id: "pdf-rendering",
    title: "PDF Rendering Settings",
    description: "Gotenberg connection, credentials, and render limits.",
    icon: "ti ti-file-type-pdf",
    group: "gotenberg" as const,
  },
  {
    id: "email-templates",
    title: "Email Template Settings",
    description: "Transactional email bodies and available template variables.",
    icon: "ti ti-template",
    group: "mail" as const,
  },
  {
    id: "security",
    title: "Security Settings",
    description: "Rate limits and access protection defaults.",
    icon: "ti ti-shield-lock",
    group: "security" as const,
  },
  {
    id: "legal",
    title: "Legal Settings",
    description: "Terms of Service, Privacy Policy, and Imprint.",
    icon: "ti ti-file-certificate",
    group: null,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTabId = (value: string | undefined): value is TabId => !!value && TABS.some((t) => t.id === value);

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
    default: item.default,
    resetValue: item.resetValue,
    valueSource: item.valueSource,
    resetValueSource: item.resetValueSource,
    isCustom: item.isCustom,
    group: item.group,
    options: item.options,
    min: item.min,
    max: item.max,
    placeholder: item.placeholder,
    templateVars: item.templateVars,
  }));
};

/** Read all 9 legal.* entries into the LegalSettingsForm initial shape. */
const buildLegalInitial = (entries: SettingFieldDef[]): LegalInitial => {
  const value = (key: keyof LegalInitial) => entries.find((entry) => entry.key === key)?.value;
  const stringValue = (key: keyof LegalInitial) => {
    const current = value(key);
    return typeof current === "string" ? current : "";
  };
  const asMode = (key: keyof LegalInitial): "local" | "external" => (stringValue(key) === "external" ? "external" : "local");
  return {
    "legal.terms.mode": asMode("legal.terms.mode"),
    "legal.terms.content": stringValue("legal.terms.content"),
    "legal.terms.url": stringValue("legal.terms.url"),
    "legal.privacy.mode": asMode("legal.privacy.mode"),
    "legal.privacy.content": stringValue("legal.privacy.content"),
    "legal.privacy.url": stringValue("legal.privacy.url"),
    "legal.imprint.mode": asMode("legal.imprint.mode"),
    "legal.imprint.content": stringValue("legal.imprint.content"),
    "legal.imprint.url": stringValue("legal.imprint.url"),
  };
};

export default ssr<AuthContext>(async (c) => {
  const rawTab = c.req.query("tab");
  // "ai" predates the split into the AI sidebar group — keep old links working.
  const legacyTab = rawTab === "ai" ? "ai-general" : rawTab;
  const tabId: TabId = isTabId(legacyTab) ? legacyTab : "general";
  const tab = TABS.find((t) => t.id === tabId)!;
  const showAiJobsLink = hasDedicatedRuntimeRoute(getRuntimeContext(c).apps, "/admin/observability/jobs", "core");

  const aiSection =
    tab.id === "ai-general" ? "general" : tab.id === "ai-providers" ? "providers" : tab.id === "ai-jobs" ? "jobs" : undefined;

  let entries: SettingFieldDef[] = [];
  let legalInitial: LegalInitial | null = null;
  let aiEnrichmentOverview: AiEnrichmentOverview | null = null;

  if (tab.group) {
    entries = await buildEntries(tab.group);
    if (tab.id === "mail") entries = entries.filter((entry) => entry.kind !== "template");
    if (tab.id === "email-templates") entries = entries.filter((entry) => entry.kind === "template");
    if (tab.id === "ai-jobs") aiEnrichmentOverview = await aiConversationStore.getEnrichmentOverview();
  } else if (tab.id === "legal") {
    entries = await buildEntries("legal");
    legalInitial = buildLegalInitial(entries);
  }

  return () => (
    <AdminLayout c={c} title={tab.title} stretch>
      <CoreLayoutHelp />
      <div class="flex-1 min-h-0 overflow-hidden">
        <div class="flex h-full min-h-0 flex-col" style="view-transition-name: admin-settings-content">
          {tab.group ? (
            <CoreSettingsForm
              title={tab.title}
              subtitle={tab.description}
              icon={tab.icon}
              entries={entries}
              showTestEmailAction={tab.id === "mail"}
              showTestPdfAction={tab.id === "pdf-rendering"}
              showLegacySettings={tab.id === "general"}
              aiEnrichmentOverview={aiEnrichmentOverview}
              aiSection={aiSection}
              showAiJobsLink={showAiJobsLink}
            />
          ) : null}

          {tab.id === "ai-skills" ? <AdminAiSkills title={tab.title} subtitle={tab.description} icon={tab.icon} /> : null}

          {tab.id === "legal" && legalInitial ? (
            <LegalSettingsForm title={tab.title} subtitle={tab.description} icon={tab.icon} initial={legalInitial} entries={entries} />
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
});
