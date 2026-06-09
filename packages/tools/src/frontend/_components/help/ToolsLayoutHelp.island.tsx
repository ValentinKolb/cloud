import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocLead, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function ToolsLayoutHelp() {
  return (
    <Layout.Help
      id="tools-start"
      title="Getting Started"
      icon="ti ti-tool"
      description="What the Tools app contains and when tools use the server."
      order={100}
    >
      <DocPage>
        <DocLead>Tools collects small utilities for generating, encoding, security checks, media work, and network testing.</DocLead>

        <DocSection title="What is included">
          <DocRows
            items={[
              {
                title: "Generators",
                icon: "ti-sparkles",
                text: "Create mailto links, QR codes, UUIDs, placeholder text, and passwords.",
              },
              {
                title: "Encoders and security",
                icon: "ti-shield-lock",
                text: "Encode and decode Base64, Hex, and Base32; convert colors; generate hashes; encrypt and decrypt data.",
              },
              {
                title: "Media and network",
                icon: "ti-network",
                text: "Process images, measure speed against the cloud server, and test webhook endpoints.",
              },
            ]}
          />
        </DocSection>

        <DocSection title="Data handling">
          <DocRows
            items={[
              {
                title: "Browser tools",
                icon: "ti-device-laptop",
                text: "Most tools run locally in your browser.",
              },
              {
                title: "Server tools",
                icon: "ti-server",
                text: "Network tools may call the server for speed tests, stable webhook endpoints, or CORS-free requests.",
              },
            ]}
          />
        </DocSection>
      </DocPage>
    </Layout.Help>
  );
}
