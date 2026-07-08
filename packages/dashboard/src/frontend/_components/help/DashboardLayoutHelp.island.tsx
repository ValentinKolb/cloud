import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function DashboardLayoutHelp() {
  return (
    <Layout.Help
      id="dashboard-start"
      title="Start"
      icon="ti ti-dashboard"
      description="Widgets, shortcuts, greeting color, and saved dashboard settings."
      order={100}
    >
      <DocPage>
        <DocLead>
          Dashboard is your personal start page. It combines app widgets you can access with shortcuts you choose.
        </DocLead>

        <DocSection title="Overview" eyebrow="Start here">
          <DocConceptGrid
            items={[
              {
                title: "Widgets",
                icon: "ti-layout-dashboard",
                text: "Apps can publish dashboard widgets. The dashboard fetches the visible widgets for your current access level.",
              },
              {
                title: "Shortcuts",
                icon: "ti-link",
                text: "Shortcuts can point to a Cloud app or to a custom relative, HTTP(S), or mailto link.",
              },
              {
                title: "Personal settings",
                icon: "ti-device-floppy",
                text: "Hidden widgets, shortcuts, and greeting color are saved to your account.",
              },
            ]}
          />
        </DocSection>

        <DocSection title="Customize">
          <DocRows
            items={[
              {
                title: "Widgets",
                icon: "ti-layout-dashboard",
                text: "Use Edit dashboard to show or hide widgets. Widgets you cannot access are listed separately in the edit dialog.",
              },
              {
                title: "Shortcuts",
                icon: "ti-link",
                text: "Add app shortcuts or custom links from the shortcut section in the edit dialog.",
              },
              {
                title: "Name color",
                icon: "ti-palette",
                text: "Choose the gradient used for your name in the greeting.",
              },
            ]}
          />
        </DocSection>

        <DocNote title="Settings scope" variant="info">
          Dashboard settings require a user-backed session. They are stored per user and reused on other devices after login.
        </DocNote>
      </DocPage>
    </Layout.Help>
  );
}
