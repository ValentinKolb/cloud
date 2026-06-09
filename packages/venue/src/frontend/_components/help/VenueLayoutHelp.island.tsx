import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

const StartTab = () => (
  <DocPage>
    <DocLead>Venues manage staffed locations with public opening status, shift signup, public page sections, and visitor feedback.</DocLead>

    <DocSection title="Mental model" eyebrow="Start here">
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
            text: "Regular weekly hours plus closed-day overrides define the public status page.",
          },
          {
            title: "Shift",
            icon: "ti-calendar-event",
            text: "A staffing slot with target people, optional maximum people, and assigned users.",
          },
          {
            title: "Public section",
            icon: "ti-layout-list",
            text: "Extra public-page content: markdown, menu, notice, or links.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Common path">
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
            text: "Use settings to maintain regular hours, closed days, and recurring shift templates.",
          },
          {
            title: "Share the public page",
            icon: "ti-external-link",
            text: "The public page shows the venue status and enabled public sections.",
          },
        ]}
      />
    </DocSection>
  </DocPage>
);

const WorkTab = () => (
  <DocPage>
    <DocLead>
      The workspace is split between staffing work, your own assignments, public content, and feedback from the public page.
    </DocLead>

    <DocSection title="Workspace views">
      <DocRows
        items={[
          {
            title: "Shifts",
            icon: "ti-calendar-event",
            text: "Shows staffing slots in a week or month calendar. Writable users can sign up from the action button or by opening a slot.",
          },
          {
            title: "My shifts",
            icon: "ti-user-check",
            text: "Lists your upcoming assignments and lets you cancel your own shifts.",
          },
          {
            title: "Feedback",
            icon: "ti-message-star",
            text: "Shows rating trends, comment search, and 7-, 14-, or 30-day filters when feedback is enabled.",
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
        ]}
      />
    </DocSection>

    <DocNote title="Permissions">
      Read users can view the venue. Staff users can sign up and manage staffing actions. Admin users can change settings, access, schedule,
      and public sections.
    </DocNote>
  </DocPage>
);

export default function VenueLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="venue-start"
        title="Start: Venues"
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
