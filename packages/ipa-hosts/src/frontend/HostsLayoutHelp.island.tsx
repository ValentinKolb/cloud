import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function HostsLayoutHelp() {
  return (
    <Layout.Help
      id="ipa-hosts-start"
      title="Start"
      icon="ti ti-server"
      description="FreeIPA host mirror, hostgroups, sync schedule, and admin actions."
      order={100}
    >
      <DocPage>
        <DocLead>
          Hosts shows a local mirror of FreeIPA hosts and hostgroups, then lets admins sync the mirror and write selected host or hostgroup
          changes back to FreeIPA.
        </DocLead>

        <DocSection title="Overview" eyebrow="Start here">
          <DocConceptGrid
            items={[
              {
                title: "FreeIPA",
                icon: "ti-server-cog",
                text: "FreeIPA is the source of truth. The page reads from the local mirror and mutations call FreeIPA through the service account.",
              },
              {
                title: "Hostgroup",
                icon: "ti-folder",
                text: "A hostgroup groups hosts by FreeIPA membership. Nested hostgroups appear as compact badges in the group header.",
              },
              {
                title: "Ungrouped host",
                icon: "ti-server-off",
                text: "A mirrored host without any hostgroup membership. The page surfaces them first because they usually need assignment.",
              },
              {
                title: "Sync",
                icon: "ti-refresh",
                text: "Sync refreshes the local mirror from FreeIPA. The schedule uses a five-field cron expression in the configured timezone.",
              },
            ]}
          />
        </DocSection>

        <DocSection title="Admin workflow">
          <DocRows
            items={[
              {
                title: "Find hosts and groups",
                icon: "ti-search",
                text: "Use the search field to filter hostgroups and hosts. Pagination keeps large mirrors readable.",
              },
              {
                title: "Review assignment gaps",
                icon: "ti-alert-triangle",
                text: "The Ungrouped stat and section show hosts that are mirrored but not assigned to any hostgroup.",
              },
              {
                title: "Update host metadata",
                icon: "ti-pencil",
                text: "Use a host row's action menu to edit description, locality, location, MAC addresses, or hostgroup membership.",
              },
              {
                title: "Maintain hostgroups",
                icon: "ti-folder-plus",
                text: "Create hostgroups, edit descriptions, or delete obsolete groups from the hostgroup cards.",
              },
              {
                title: "Run or schedule sync",
                icon: "ti-calendar-time",
                text: "Use Sync now for an immediate refresh, or Settings to change the recurring sync cron.",
              },
            ]}
          />
        </DocSection>

        <DocNote title="CLI and audit trail" variant="info">
          The `ipa-hosts` CLI uses the same admin API for list, update, membership, hostgroup, and sync commands. Write actions are audited.
        </DocNote>
      </DocPage>
    </Layout.Help>
  );
}
