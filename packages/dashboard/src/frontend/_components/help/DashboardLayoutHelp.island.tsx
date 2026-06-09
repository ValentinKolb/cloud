import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocLead, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function DashboardLayoutHelp() {
  return (
    <Layout.Help
      id="dashboard-start"
      title="Customize Dashboard"
      icon="ti ti-dashboard"
      description="Widgets, shortcuts, and dashboard settings."
      order={100}
    >
      <DocPage>
        <DocLead>Dashboard is your personal start page. It shows app widgets you can access and shortcuts you choose.</DocLead>

        <DocSection title="Customize">
          <DocRows
            items={[
              {
                title: "Widgets",
                icon: "ti-layout-dashboard",
                text: "Use Edit dashboard to show or hide available widgets. Locked widgets need a higher access level.",
              },
              {
                title: "Shortcuts",
                icon: "ti-link",
                text: "Add app shortcuts or custom links. External links open in a new tab.",
              },
              {
                title: "Name color",
                icon: "ti-palette",
                text: "Choose the gradient used for your name in the greeting.",
              },
            ]}
          />
        </DocSection>

        <DocSection title="Saved settings">
          <DocRows
            items={[
              {
                title: "Account-wide",
                icon: "ti-device-floppy",
                text: "Dashboard settings are saved to your account and apply on every device.",
              },
            ]}
          />
        </DocSection>
      </DocPage>
    </Layout.Help>
  );
}
