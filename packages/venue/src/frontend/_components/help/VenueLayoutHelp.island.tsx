import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

const StartTab = () => (
  <DocPage>
    <DocLead>
      Venues manages staffed places that need public opening status, shift signup, public page content, and visitor feedback.
    </DocLead>

    <DocSection title="Overview" eyebrow="Start here">
      <DocConceptGrid
        items={[
          {
            title: "Venue",
            icon: "ti-building-carousel",
            text: "One staffed place such as a cafe, office hours desk, service counter, or recurring event location.",
          },
          {
            title: "Opening hours",
            icon: "ti-clock",
            text: "Regular weekly hours plus date overrides decide whether the public page says the venue is open.",
          },
          {
            title: "Shift",
            icon: "ti-calendar-event",
            text: "A staffing slot with target people, optional maximum people, and assigned users.",
          },
          {
            title: "Public section",
            icon: "ti-layout-list",
            text: "An editable block on the public page. Sections can be markdown, menu, notice, or links.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="First useful path">
      <DocRows
        items={[
          {
            title: "Create or use a template",
            icon: "ti-plus",
            text: "Start from a blank venue or one of the starter templates on the overview page.",
          },
          {
            title: "Configure the schedule",
            icon: "ti-calendar-time",
            text: "Use settings to maintain weekly opening hours, date overrides, and recurring shift templates.",
          },
          {
            title: "Publish what visitors need",
            icon: "ti-external-link",
            text: "Open the public page from the workspace sidebar. Enabled sections and feedback appear there.",
          },
          {
            title: "Staff the venue",
            icon: "ti-user-plus",
            text: "Staff users sign up for visible shift slots. Admin users can also cancel assignments.",
          },
        ]}
      />
    </DocSection>
  </DocPage>
);

const WorkTab = () => (
  <DocPage>
    <DocLead>
      The venue workspace separates daily staffing, personal assignments, public content, feedback, and administrative settings.
    </DocLead>

    <DocSection title="Workspace views">
      <DocRows
        items={[
          {
            title: "Shifts",
            icon: "ti-calendar-event",
            text: "Shows staffing slots in a week or month calendar. Staff users can sign up from the action button or by double-clicking a slot.",
          },
          {
            title: "My shifts",
            icon: "ti-user-check",
            text: "Lists your upcoming assignments and lets you cancel your own shifts.",
          },
          {
            title: "Feedback",
            icon: "ti-message-star",
            text: "Shows rating trends, comment search, and 7-, 14-, or 30-day filters for public feedback entries.",
          },
          {
            title: "Public sections",
            icon: "ti-speakerphone",
            text: "Admins can add, edit, duplicate, or delete markdown, menu, notice, and links sections.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Settings and access">
      <DocRows
        items={[
          {
            title: "General",
            icon: "ti-id",
            text: "Edit name, slug, description, icon, theme color, logo, banner, and feedback activation.",
          },
          {
            title: "Access",
            icon: "ti-shield",
            text: "Admins grant read, staff, or admin access to users, groups, public, or signed-in users.",
          },
          {
            title: "Links",
            icon: "ti-link",
            text: "Open the public page or copy your personal iCal subscription for venue shifts.",
          },
          {
            title: "API keys",
            icon: "ti-key",
            text: "Admins can create resource-bound keys for integrations that need access to this venue.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Permissions">
      Read users can view the venue and cancel their own listed shifts. Staff users can sign up for shifts. Admin users can change settings,
      access, schedule, public sections, and cancel any shift assignment.
    </DocNote>
  </DocPage>
);

export default function VenueLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="venue-start"
        title="Getting Started"
        icon="ti ti-building-carousel"
        description="Core concepts, setup path, and public page basics."
        order={100}
      >
        <StartTab />
      </Layout.Help>
      <Layout.Help
        id="venue-work"
        title="Shifts & Public Page"
        icon="ti ti-calendar-event"
        description="Workspace views, public sections, feedback, and access."
        order={110}
      >
        <WorkTab />
      </Layout.Help>
    </>
  );
}
