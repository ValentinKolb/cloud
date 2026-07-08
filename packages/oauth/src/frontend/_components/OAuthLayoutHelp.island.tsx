import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function OAuthLayoutHelp() {
  return (
    <Layout.Help
      id="oauth-start"
      title="Start"
      icon="ti ti-key"
      description="OAuth clients, redirect URLs, access rules, scopes, secrets, and OIDC endpoints."
      order={100}
    >
      <DocPage>
        <DocLead>
          OAuth lets admins register external applications that use the Cloud login as an OAuth 2.0 and OpenID Connect provider.
        </DocLead>

        <DocSection title="Overview" eyebrow="Start here">
          <DocConceptGrid
            items={[
              {
                title: "Client",
                icon: "ti-key",
                text: "One external application. Each client has a client id, redirect URLs, allowed scopes, and access rules.",
              },
              {
                title: "Public client",
                icon: "ti-device-mobile",
                text: "A client without a secret. Use it for browser or native clients that cannot keep a secret.",
              },
              {
                title: "Confidential client",
                icon: "ti-lock",
                text: "A server-side client with a secret. New and regenerated secrets are shown once.",
              },
              {
                title: "Access rules",
                icon: "ti-user-check",
                text: "Limit a client to full users, all profiles, or selected users and recursive group members.",
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
                text: "Set a name, redirect URI, optional logout URI, scopes, access rules, and whether the client is public.",
              },
              {
                title: "Copy integration values",
                icon: "ti-copy",
                text: "Use the client id, optional secret, discovery URL, authorization URL, token URL, UserInfo URL, and JWKS URL in the external app.",
              },
              {
                title: "Adjust access",
                icon: "ti-users-group",
                text: "Edit the client to change scopes or switch between profile-based access and selected users or groups.",
              },
              {
                title: "Rotate or remove",
                icon: "ti-refresh",
                text: "Regenerate a confidential client secret when it is exposed. Delete a client to stop new OAuth flows for that app.",
              },
            ]}
          />
        </DocSection>

        <DocSection title="Scopes and claims">
          <DocConceptGrid
            items={[
              { title: "openid", icon: "ti-id", text: "Required for OIDC. Returns the subject identifier." },
              { title: "profile", icon: "ti-user", text: "Returns name and display-name claims." },
              { title: "email", icon: "ti-mail", text: "Returns the user's email claim." },
              { title: "groups", icon: "ti-users-group", text: "Returns all group names, including inherited group membership." },
            ]}
          />
        </DocSection>

        <DocNote title="CLI and API" variant="info">
          The `oauth` CLI can list, inspect, create, update, delete, and regenerate secrets for clients through the same admin API used by
          this page.
        </DocNote>
      </DocPage>
    </Layout.Help>
  );
}
