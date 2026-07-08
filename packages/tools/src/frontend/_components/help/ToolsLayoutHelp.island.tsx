import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function ToolsLayoutHelp() {
  return (
    <Layout.Help
      id="tools-start"
      title="Start"
      icon="ti ti-tool"
      description="Tool categories, search, browser-local tools, and server-backed network tools."
      order={100}
    >
      <DocPage>
        <DocLead>
          Tools is a workspace for small generators, encoders, security utilities, media tools, and network tests.
        </DocLead>

        <DocSection title="First useful path" eyebrow="Start here">
          <DocRows
            items={[
              {
                title: "Find a tool",
                icon: "ti-search",
                text: "Use the overview, sidebar groups, or tool search to open the utility you need.",
              },
              {
                title: "Enter the smallest input",
                icon: "ti-keyboard",
                text: "Most tools update their output from the values on the page and provide copy or download actions where supported.",
              },
              {
                title: "Check where data goes",
                icon: "ti-shield-check",
                text: "Browser-local tools stay in the page. Network tools call the server because they need a stable endpoint or server-side request.",
              },
            ]}
          />
        </DocSection>

        <DocSection title="Tool groups">
          <DocConceptGrid
            items={[
              {
                title: "Generators",
                icon: "ti-sparkles",
                text: "Mailto links, QR codes, UUIDs, lorem ipsum text, and passwords.",
              },
              {
                title: "Encoders",
                icon: "ti-arrows-exchange",
                text: "Base64, Hex, Base32, and color conversion.",
              },
              {
                title: "Security",
                icon: "ti-shield-lock",
                text: "Hash generation, password generation, and encryption helpers.",
              },
              {
                title: "Media",
                icon: "ti-photo",
                text: "Image resize, crop, filter, rotate, and export.",
              },
              {
                title: "Network",
                icon: "ti-network",
                text: "Speed tests against the cloud server and webhook endpoint testing.",
              },
            ]}
          />
        </DocSection>

        <DocNote title="Webhook tester data" variant="info">
          Webhook endpoints and request logs are stored on the server for inspection. The tester redacts sensitive headers such as
          Authorization and Cookie before logging.
        </DocNote>
      </DocPage>
    </Layout.Help>
  );
}
