import { ssr, env } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import CreateProxyClient from "./_components/CreateProxyClient.island";
import ProxyClientActions from "./_components/ProxyClientActions.island";
import { proxyAuthService } from "../service";

export default ssr<AuthContext>(async (c) => {
  const { items: clients } = await proxyAuthService.client.list();
  const baseUrl = env.APP_URL.startsWith("http") ? env.APP_URL : `https://${env.APP_URL}`;

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateStr));
  };

  return (
    <AdminLayout c={c} title="Proxy Auth">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4" style="view-transition-name: page-header">
          <h1 class="text-xl font-bold text-primary">Proxy Auth</h1>
          <div class="flex items-center gap-3">
            <span class="text-xs text-dimmed">{clients.length} clients</span>
            <CreateProxyClient />
          </div>
        </div>

        {clients.length > 0 ? (
          <div class="paper overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Name</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Allowed Groups</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Created</th>
                    <th class="text-right px-4 py-3 font-medium text-dimmed">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client) => (
                    <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td class="px-4 py-3">
                        <div class="font-medium">{client.name}</div>
                        {client.description && <div class="text-xs text-dimmed truncate max-w-xs">{client.description}</div>}
                      </td>
                      <td class="px-4 py-3">
                        <div class="flex flex-wrap gap-1">
                          {client.allowedGroups.map((group) => (
                            <span class="text-xs px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-400">
                              {group}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td class="px-4 py-3 text-dimmed whitespace-nowrap">{formatDate(client.createdAt)}</td>
                      <td class="px-4 py-3 text-right">
                        <ProxyClientActions client={client} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">
            No proxy auth clients found. Create one to protect external apps via Traefik ForwardAuth.
          </div>
        )}

        {/* Traefik configuration help */}
        <div class="info-block-info p-4">
          <h2 class="text-sm font-medium mb-3">Traefik ForwardAuth Setup</h2>
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

          <h2 class="text-sm font-medium mb-2 border-t border-blue-300 dark:border-blue-700 pt-4">Example Configuration</h2>
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

          <h2 class="text-sm font-medium mb-2 border-t border-blue-300 dark:border-blue-700 pt-4 mt-4">Response Headers</h2>
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
        </div>
      </div>
    </AdminLayout>
  );
});
