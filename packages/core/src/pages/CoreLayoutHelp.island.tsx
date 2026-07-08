import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function CoreLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="core-start"
        title="Start"
        icon="ti ti-cloud"
        description="Profile self-service, platform admin overview, announcements, settings, auth, and legal pages."
        order={100}
      >
        <DocPage>
          <DocLead>
            Core owns platform-level pages and services: login, profile self-service, admin overview, global settings, announcements,
            legal pages, search APIs, and top-level routing fallback.
          </DocLead>

          <DocSection title="Overview" eyebrow="Start here">
            <DocConceptGrid
              items={[
                {
                  title: "Profile",
                  icon: "ti-user-circle",
                  text: "The /me page shows the signed-in user's profile, provider, roles, groups, expiry data, API keys, passkeys, and recent account activity.",
                },
                {
                  title: "Admin overview",
                  icon: "ti-shield",
                  text: "The /admin page lists apps with admin panels and summarizes registered apps, admin panels, and navigation entries.",
                },
                {
                  title: "Announcements",
                  icon: "ti-speakerphone",
                  text: "Admins can create platform announcements and dismissible banners with publish, expiry, state, and version metadata.",
                },
                {
                  title: "Settings",
                  icon: "ti-settings",
                  text: "Core settings cover branding, user lifecycle, FreeIPA, AI, mail, PDF rendering, email templates, security, and legal pages.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Common paths">
            <DocRows
              items={[
                {
                  title: "Check your account",
                  icon: "ti-id",
                  text: "Open Profile to review account type, provider, roles, groups, expiry dates, profile fields, API keys, passkeys, and recent account events.",
                },
                {
                  title: "Find an admin surface",
                  icon: "ti-layout-dashboard",
                  text: "Open Admin Overview to jump to app-specific admin panels such as Gateway Ops, Accounts, IPA Hosts, or app settings.",
                },
                {
                  title: "Publish a notice",
                  icon: "ti-message",
                  text: "Use Announcements for platform messages or banners that should render through the shared layout.",
                },
                {
                  title: "Change platform defaults",
                  icon: "ti-adjustments",
                  text: "Use Core Settings for global service configuration. Settings resolve from database, environment, and defaults.",
                },
              ]}
            />
          </DocSection>

          <DocNote title="Boundary" variant="info">
            Core owns platform pages and shared services. App-specific admin workflows stay in the owning app, even when they appear in the
            Core admin overview.
          </DocNote>
        </DocPage>
      </Layout.Help>

      <Layout.Help
        id="core-profile"
        title="Profile"
        icon="ti ti-user-circle"
        description="Account self-service, FreeIPA requests, API keys, passkeys, groups, and activity history."
        order={110}
      >
        <DocPage>
          <DocLead>
            The Profile page is the user's own account cockpit. It combines local Cloud data, optional FreeIPA data, and self-service
            account actions.
          </DocLead>

          <DocSection title="Profile sections">
            <DocRows
              items={[
                {
                  title: "Identity",
                  icon: "ti-user",
                  text: "Shows display name, uid, avatar, provider, profile type, supplemental roles, email, phone, address, account expiry, and password expiry when available.",
                },
                {
                  title: "Groups",
                  icon: "ti-users-group",
                  text: "Shows direct group membership by default. The page can switch to recursive group membership through the groups query parameter.",
                },
                {
                  title: "FreeIPA request",
                  icon: "ti-building-fortress",
                  text: "Local users can request a FreeIPA account when FreeIPA is enabled. Pending requests can be withdrawn from the same page.",
                },
                {
                  title: "Activity",
                  icon: "ti-clipboard-list",
                  text: "Shows recent self-service audit activity for the selected time window.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Security controls">
            <DocConceptGrid
              items={[
                {
                  title: "API keys",
                  icon: "ti-key",
                  text: "Delegated service-account credentials owned by the user. Active keys can be managed from Profile.",
                },
                {
                  title: "Passkeys",
                  icon: "ti-fingerprint",
                  text: "WebAuthn passkeys attached to the signed-in user and used for passkey login.",
                },
              ]}
            />
          </DocSection>
        </DocPage>
      </Layout.Help>

      <Layout.Help
        id="core-admin"
        title="Admin"
        icon="ti ti-settings"
        description="Admin overview, announcement lifecycle, and Core settings groups."
        order={120}
      >
        <DocPage>
          <DocLead>
            Core admin pages configure platform services and link to app-specific admin panels registered by each app.
          </DocLead>

          <DocSection title="Admin pages">
            <DocRows
              items={[
                {
                  title: "Overview",
                  icon: "ti-apps",
                  text: "Lists registered apps with admin panels and summarizes registered apps, manageable admin panels, and user-visible navigation entries.",
                },
                {
                  title: "Announcements",
                  icon: "ti-speakerphone",
                  text: "Create and edit announcements or banners. Entries can be active, scheduled, or expired based on publish and expiry timestamps.",
                },
                {
                  title: "Settings",
                  icon: "ti-settings",
                  text: "Edit settings by group. Each field shows its current value and source where the settings service exposes it.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Settings groups">
            <DocRows
              items={[
                {
                  title: "General and user management",
                  icon: "ti-users",
                  text: "Branding, public links, schedules, defaults, login behavior, expiry, reminders, and self-service behavior.",
                },
                {
                  title: "FreeIPA",
                  icon: "ti-building-fortress",
                  text: "FreeIPA connection settings, sync rules, and group mapping.",
                },
                {
                  title: "AI, mail, and PDF rendering",
                  icon: "ti-plug",
                  text: "Model profiles, provider credentials, SMTP delivery, sender credentials, Gotenberg connection, credentials, and render limits.",
                },
                {
                  title: "Templates, security, and legal",
                  icon: "ti-file-certificate",
                  text: "Transactional email templates, rate limits, access protection defaults, Terms of Service, Privacy Policy, and Imprint.",
                },
              ]}
            />
          </DocSection>
        </DocPage>
      </Layout.Help>
    </>
  );
}
