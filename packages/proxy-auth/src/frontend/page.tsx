import { ssr } from "../config";
import { get } from "@valentinkolb/cloud/services";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import CreateProxyClient from "./_components/CreateProxyClient.island";
import ProxyClientActions from "./_components/ProxyClientActions.island";
import { StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { proxyAuthService } from "../service";

export default ssr<AuthContext>(async (c) => {
  const { items: clients } = await proxyAuthService.client.list();
  const rawAppUrl = await get<string>("app.url");
  const baseUrl = rawAppUrl.startsWith("http") ? rawAppUrl : `https://${rawAppUrl}`;

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateStr));
  };

  const totalAllowedGroups = clients.reduce((sum, c) => sum + c.allowedGroups.length, 0);
  const clientsWithoutGroups = clients.filter((c) => c.allowedGroups.length === 0).length;

  return () => (
    <AdminLayout c={c} title="Proxy Auth" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-proxy-auth-title">
            <h1 class="text-base font-semibold text-primary">Proxy Auth</h1>
          </div>

          {/* Stat cards — see skills/cloud-app/references/frontend.md § Stats */}
          <StatGrid columns={3}>
            <StatCell label="Clients" value={clients.length} sub="registered" accent={{ tone: "blue", icon: "ti ti-shield-half" }} />
            <StatCell label="Allowed groups" value={totalAllowedGroups} sub="across all clients" />
            <StatCell
              label="Open access"
              value={clientsWithoutGroups}
              sub={clientsWithoutGroups > 0 ? "any user passes" : "all gated"}
              valueClass={clientsWithoutGroups > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
              accent={clientsWithoutGroups > 0
                ? { tone: "amber", icon: "ti ti-alert-triangle" }
                : { tone: "emerald", icon: "ti ti-check" }}
            />
          </StatGrid>

          <div class="flex justify-end">
            <CreateProxyClient />
          </div>

          {clients.length > 0 ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-proxy-auth-table">
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="border-b border-zinc-100 dark:border-zinc-800">
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Client</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Description</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Allowed groups</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Created</th>
                      <th class="w-px px-3 py-2 text-right font-medium text-dimmed">
                        <span class="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client) => (
                      <tr class="border-b border-zinc-50 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                        <td class="px-3 py-1.5 font-medium text-primary">{client.name}</td>
                        <td class="max-w-[18rem] truncate px-3 py-1.5 text-dimmed" title={client.description || "No description"}>
                          {client.description || <span class="italic">No description</span>}
                        </td>
                        <td class="px-3 py-1.5">
                          <div class="flex flex-wrap gap-1">
                            {client.allowedGroups.map((group) => (
                              <span class="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400">
                                {group.name}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td class="px-3 py-1.5 whitespace-nowrap text-dimmed">{formatDate(client.createdAt)}</td>
                        <td class="px-3 py-1.5 text-right">
                          <ProxyClientActions client={client} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section class="paper p-6 text-center text-sm text-dimmed">
              No proxy auth clients found. Create one to protect external apps via Traefik ForwardAuth.
            </section>
          )}

          <section class="info-block-info p-4" style="view-transition-name: admin-proxy-auth-reference">
            <h2 class="mb-3 text-sm font-medium">Traefik ForwardAuth Setup</h2>
          <p class="text-xs mb-3 opacity-80">
            Use these settings in your Traefik configuration to protect external services. Each client has a unique verify URL.
          </p>

          <div class="space-y-2 text-xs font-mono mb-4">
            <div class="flex flex-col gap-0.5">
              <span class="opacity-70">Verify URL Pattern:</span>
              <code class="break-all">
                {baseUrl}/api/proxy-auth/verify/{"<client-id>"}
              </code>
            </div>
          </div>

            <h2 class="mb-2 border-t border-blue-300 pt-4 text-sm font-medium dark:border-blue-700">Example Configuration</h2>
          <pre class="text-xs bg-blue-50 dark:bg-blue-950/30 p-3 rounded overflow-x-auto">
            {`http:
  middlewares:
    my-proxy-auth:
      forwardAuth:
        address: "${baseUrl}/api/proxy-auth/verify/<client-id>"
        authResponseHeaders:
          - "X-Forwarded-User"
          - "X-Forwarded-Email"
          - "X-Forwarded-Groups"
        trustForwardHeader: true`}
          </pre>

            <h2 class="mb-2 mt-4 border-t border-blue-300 pt-4 text-sm font-medium dark:border-blue-700">Response Headers</h2>
          <div class="space-y-1 text-xs">
            <div>
              <code class="font-mono">X-Forwarded-User</code> <span class="opacity-70">— Username (uid)</span>
            </div>
            <div>
              <code class="font-mono">X-Forwarded-Email</code> <span class="opacity-70">— Email address</span>
            </div>
            <div>
              <code class="font-mono">X-Forwarded-Groups</code> <span class="opacity-70">— Comma-separated group list</span>
            </div>
            </div>
          </section>
        </div>
      </div>
    </AdminLayout>
  );
});
