import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function ProxyAuthLayoutHelp() {
  return (
    <Layout.Help
      id="proxy-auth-start"
      title="Start"
      icon="ti ti-load-balancer"
      description="ForwardAuth clients, group gates, verify URLs, and response headers."
      order={100}
    >
      <DocPage>
        <DocLead>
          Proxy Auth lets admins protect external services through Traefik ForwardAuth by creating one verify endpoint per client and
          allowing access for selected account groups.
        </DocLead>

        <DocSection title="Overview" eyebrow="Start here">
          <DocConceptGrid
            items={[
              {
                title: "Client",
                icon: "ti-shield-half",
                text: "One protected external service or route. Each client has a stable verify URL with its own client id.",
              },
              {
                title: "Allowed groups",
                icon: "ti-users-group",
                text: "A user must belong to at least one allowed group before the verify endpoint returns access.",
              },
              {
                title: "Verify URL",
                icon: "ti-link",
                text: "Traefik calls `/proxy-auth/verify/<client-id>` before forwarding the original request to the upstream service.",
              },
              {
                title: "Forwarded headers",
                icon: "ti-arrow-forward-up",
                text: "On success, the endpoint returns user, email, and effective direct or nested group headers for the upstream service.",
              },
            ]}
          />
        </DocSection>

        <DocSection title="Admin workflow">
          <DocRows
            items={[
              {
                title: "Create a client",
                icon: "ti-plus",
                text: "Name the client, add a description if useful, and select at least one allowed group.",
              },
              {
                title: "Copy the verify URL",
                icon: "ti-copy",
                text: "Copy the URL after creation or from the client action menu, then place it in the Traefik ForwardAuth middleware.",
              },
              {
                title: "Review group coverage",
                icon: "ti-alert-triangle",
                text: "The No groups stat highlights clients that are blocked until a group is configured.",
              },
              {
                title: "Update access",
                icon: "ti-pencil",
                text: "Edit a client to change the description or allowed groups. Delete removes the client and invalidates its verify URL.",
              },
            ]}
          />
        </DocSection>

        <DocNote title="Access result" variant="info">
          The verify endpoint redirects unauthenticated users to login, returns 403 for authenticated users outside the allowed groups, and
          returns 200 with forwarded identity headers when access is allowed.
        </DocNote>
      </DocPage>
    </Layout.Help>
  );
}
