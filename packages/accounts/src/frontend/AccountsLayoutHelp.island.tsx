import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function AccountsLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="accounts-start"
        title="Start"
        icon="ti ti-users-group"
        description="Accounts, groups, requests, service accounts, notifications, and audit history."
        order={100}
      >
        <DocPage>
          <DocLead>
            Accounts shows your own account context and gives admins one place to manage users, groups, account requests, API keys,
            notification batches, and account history.
          </DocLead>

          <DocSection title="Overview" eyebrow="Start here">
            <DocConceptGrid
              items={[
                {
                  title: "Account",
                  icon: "ti-user",
                  text: "A person record with login provider, profile, roles, expiry data, group memberships, and optional avatar.",
                },
                {
                  title: "Group",
                  icon: "ti-users-group",
                  text: "A local or FreeIPA group. Groups can contain users or groups and can grant management rights over other groups.",
                },
                {
                  title: "Account request",
                  icon: "ti-user-plus",
                  text: "A submitted access request. Admins can create an account from a pending request or deny it with an optional email reason.",
                },
                {
                  title: "Service account key",
                  icon: "ti-user-key",
                  text: "An API key owned by a user or resource. Active keys can be revoked; revoked keys stay visible for audit history.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Common paths">
            <DocRows
              items={[
                {
                  title: "Check your access",
                  icon: "ti-id",
                  text: "Open Dashboard to see your account type, manager scope, login method, expiry date, and group shortcuts.",
                },
                {
                  title: "Find a group",
                  icon: "ti-search",
                  text: "Use Groups to search all visible groups, filter by provider, or switch between groups you manage, belong to, or can view.",
                },
                {
                  title: "Review pending requests",
                  icon: "ti-inbox",
                  text: "Admins use Requests to filter pending, completed, denied, or all account requests.",
                },
                {
                  title: "Trace a change",
                  icon: "ti-clipboard-list",
                  text: "Admins use Audit Log to search account events by actor, target, action, outcome, provider, service account, or time range.",
                },
              ]}
            />
          </DocSection>

          <DocNote title="FreeIPA boundary" variant="info">
            FreeIPA-backed users and groups are written through the Accounts service when FreeIPA is enabled. Local accounts and local groups
            stay in the Cloud database.
          </DocNote>
        </DocPage>
      </Layout.Help>

      <Layout.Help
        id="accounts-admin"
        title="Admin workflows"
        icon="ti ti-settings"
        description="User maintenance, group membership, service-account keys, notifications, and lifecycle views."
        order={110}
      >
        <DocPage>
          <DocLead>
            Admin pages are server-rendered lists with URL-backed search, filters, pagination, and action buttons for account operations.
          </DocLead>

          <DocSection title="User and group management">
            <DocRows
              items={[
                {
                  title: "Users",
                  icon: "ti-users",
                  text: "Search accounts by uid, name, or email. Filter by provider and profile, then open a user to edit profile fields, avatar, roles, provider, expiry, and group membership.",
                },
                {
                  title: "Groups",
                  icon: "ti-users-group",
                  text: "Open a group to review facts, members, managers, and parent groups. Managers can add or remove users and groups where mutations are available.",
                },
                {
                  title: "Deleted accounts",
                  icon: "ti-user-off",
                  text: "Review accounts removed by manual action, expiry cleanup, FreeIPA demotion, or sync scope changes. Metadata remains available from the row details.",
                },
                {
                  title: "Reminder history",
                  icon: "ti-mail-share",
                  text: "Search account-expiry reminder attempts, including target expiry, threshold days, status, attempts, last attempt, and last error.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Access and messaging">
            <DocRows
              items={[
                {
                  title: "Service accounts",
                  icon: "ti-user-key",
                  text: "List active or revoked API keys, filter by user-bound or resource-bound owner, and revoke active keys when access should end.",
                },
                {
                  title: "Notifications",
                  icon: "ti-mail",
                  text: "Create admin notification drafts, preview recipients, finalize the batch, and review delivery counters or failed recipients.",
                },
                {
                  title: "Requests",
                  icon: "ti-user-plus",
                  text: "Create accounts from pending requests or deny requests. A denial reason sends an email when provided.",
                },
              ]}
            />
          </DocSection>

          <DocNote title="Audit trail" variant="info">
            Account and access changes are recorded in Audit Log. Use the service-account filter when investigating API-key activity.
          </DocNote>
        </DocPage>
      </Layout.Help>

      <Layout.Help
        id="accounts-cli"
        title="CLI"
        icon="ti ti-terminal-2"
        description="Agent-friendly account, group, request, audit, and service-account commands."
        order={120}
      >
        <DocPage>
          <DocLead>
            The Accounts CLI uses the same `/api/accounts` API as the app, so agents can list, inspect, and update account data without a
            browser.
          </DocLead>

          <DocSection title="Command groups" eyebrow="Reference">
            <DocConceptGrid
              items={[
                {
                  title: "users",
                  icon: "ti-users",
                  text: "List, inspect, create, update, delete, change provider/profile/admin state, manage avatars, reset IPA passwords, and send login links.",
                },
                {
                  title: "groups",
                  icon: "ti-users-group",
                  text: "List, inspect, create, update, make POSIX, delete, and manage members or managers.",
                },
                {
                  title: "requests",
                  icon: "ti-user-plus",
                  text: "List, inspect, and deny account requests.",
                },
                {
                  title: "audit",
                  icon: "ti-clipboard-list",
                  text: "List audit events with actor, target, action, action group, service-account, outcome, provider, and time filters.",
                },
                {
                  title: "service-accounts",
                  icon: "ti-user-key",
                  text: "List service-account API keys and revoke active credentials.",
                },
              ]}
            />
          </DocSection>

          <DocNote title="Reference output" variant="info">
            Use JSON output for automation. Table output is intended for quick terminal inspection.
          </DocNote>
        </DocPage>
      </Layout.Help>
    </>
  );
}
