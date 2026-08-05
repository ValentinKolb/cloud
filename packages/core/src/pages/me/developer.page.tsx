import { cloudMcpResourceUri, publicCloudOrigin } from "@valentinkolb/cloud/api";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { coreSettings, serviceAccountCredentials } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import AccountHub, { AccountPageHeader, AccountProfileActions } from "./AccountHub";
import ApiKeysSettings from "./ApiKeysSettings.island";
import McpSetup from "./McpSetup.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const [rawAppName, rawAppUrl, freeIpaEnabledRaw, apiKeys] = await Promise.all([
    coreSettings.get<string>("app.name"),
    coreSettings.get<string>("app.url"),
    coreSettings.get<boolean>("freeipa.enable"),
    serviceAccountCredentials.listForDelegatedUser({ userId: user.id }),
  ]);
  const appName = rawAppName || "Cloud";
  const freeIpaEnabled = Boolean(freeIpaEnabledRaw);
  const cloudUrl = publicCloudOrigin(rawAppUrl);
  const cliInstallCommand = `curl -fsSL ${cloudUrl}/cli | sh`;
  const mcpResource = cloudMcpResourceUri(rawAppUrl);

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Account", href: "/me" }, { title: "Developer" }]}>
      <AccountHub user={user} active="developer">
        <div class="flex flex-col gap-2">
          <AccountPageHeader title="Developer" description="Cloud MCP, personal automation credentials, terminal setup, and SSH access." />

          <section class="paper p-5 sm:p-6">
            <div class="mb-4">
              <h3 class="flex items-center gap-2 text-sm font-semibold text-primary">
                <i class="ti ti-plug-connected" aria-hidden="true" />
                Cloud MCP
              </h3>
              <p class="mt-1 text-xs text-dimmed">Connect agents to the live Capabilities and registered Help of this Cloud instance.</p>
            </div>
            <McpSetup endpoint={mcpResource} />
            <div class="mt-4 flex flex-col gap-2 text-xs text-dimmed">
              <p>
                Browser login registers a public OAuth client automatically. Review the client name, requested scopes, callback host, and
                this Cloud resource before allowing access.
              </p>
              <p>
                If your MCP client does not support browser login, create an API key below and set it as{" "}
                <code class="font-mono text-secondary">CLOUD_API_KEY</code>. Claude Code stores the header in its local MCP configuration,
                so use a dedicated expiring key.
              </p>
              <a
                class="w-fit text-link hover:underline"
                href="https://github.com/ValentinKolb/cloud/blob/main/docs-site/docs/en/platform/mcp.md"
              >
                View the Cloud MCP source guide on GitHub
              </a>
            </div>
          </section>

          <ApiKeysSettings initialKeys={apiKeys} />

          <section class="paper p-5 sm:p-6">
            <div class="mb-4">
              <h3 class="flex items-center gap-2 text-sm font-semibold text-primary">
                <i class="ti ti-terminal-2" />
                Cloud CLI
              </h3>
              <p class="mt-1 text-xs text-dimmed">Install the command-line client and sign in to this Cloud instance.</p>
            </div>
            <code class="block overflow-x-auto rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2 font-mono text-xs text-secondary">
              {cliInstallCommand}
            </code>
            <p class="mt-3 text-xs text-dimmed">
              Then run <code class="font-mono text-secondary">cld login --server {cloudUrl}</code>.
            </p>
          </section>

          {user.provider === "ipa" && (
            <section class="paper p-5 sm:p-6">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-secondary">
                  <i class="ti ti-key" />
                </span>
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-primary">SSH keys</h3>
                  <p class="mt-1 text-xs text-dimmed">
                    {user.ipa.sshPublicKeys.length} {user.ipa.sshPublicKeys.length === 1 ? "key" : "keys"} configured for provider-managed
                    hosts.
                  </p>
                </div>
                <AccountProfileActions user={user} appName={appName} freeIpaEnabled={freeIpaEnabled} actions={["details"]} />
              </div>
            </section>
          )}
        </div>
      </AccountHub>
    </Layout>
  );
});
