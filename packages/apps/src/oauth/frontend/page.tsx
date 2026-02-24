import { ssr, env } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import CreateClientButton from "./_components/CreateClientButton.island";
import ClientActions from "./_components/ClientActions.island";
import { oauthService } from "../service";

/** Admin OAuth clients list page. */
export default ssr<AuthContext>(async (c) => {
  const { items: clients } = await oauthService.client.list();

  // Build base URL for OAuth endpoints
  const baseUrl = env.APP_URL.startsWith("http") ? env.APP_URL : `https://${env.APP_URL}`;

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateStr));
  };

  return (
    <AdminLayout c={c} title="OAuth">
      <div class="max-w-6xl mx-auto flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4" style="view-transition-name: page-header">
          <h1 class="text-xl font-bold text-primary">OAuth</h1>
          <div class="flex items-center gap-3">
            <span class="text-xs text-dimmed">{clients.length} clients</span>
            <CreateClientButton />
          </div>
        </div>

        {clients.length > 0 ? (
          <div class="paper overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Name</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Description</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Type</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Scopes</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Realms</th>
                    <th class="text-left px-4 py-3 font-medium text-dimmed">Created</th>
                    <th class="text-right px-4 py-3 font-medium text-dimmed">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client) => (
                    <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                      <td class="px-4 py-3 font-medium">{client.name}</td>
                      <td class="px-4 py-3 text-dimmed text-xs max-w-xs truncate">
                        {client.description || <span class="italic">No description</span>}
                      </td>
                      <td class="px-4 py-3">
                        {client.isPublic ? (
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                            Public
                          </span>
                        ) : (
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
                            Confidential
                          </span>
                        )}
                      </td>
                      <td class="px-4 py-3">
                        <div class="flex flex-wrap gap-1">
                          {client.scopes.map((scope) => (
                            <span class="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-dimmed">{scope}</span>
                          ))}
                        </div>
                      </td>
                      <td class="px-4 py-3">
                        <div class="flex flex-wrap gap-1">
                          {client.allowedRoles.map((realm) => (
                            <span class="text-xs px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400">
                              {realm}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td class="px-4 py-3 text-dimmed whitespace-nowrap">{formatDate(client.createdAt)}</td>
                      <td class="px-4 py-3 text-right">
                        <ClientActions client={client} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div class="paper p-6 text-center text-sm text-dimmed">
            No OAuth clients found. Create one to allow external applications to authenticate users.
          </div>
        )}

        <div class="info-block-info p-4">
          <h2 class="text-sm font-medium mb-3">Discovery Endpoints</h2>
          <div class="space-y-1 text-xs font-mono mb-4">
            <div class="flex flex-col gap-0.5">
              <span class="opacity-70">OpenID Configuration:</span>
              <a href="/.well-known/openid-configuration" class="underline hover:opacity-80 break-all" target="_blank">
                {baseUrl}/.well-known/openid-configuration
              </a>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="opacity-70">JWKS:</span>
              <a href="/.well-known/jwks.json" class="underline hover:opacity-80 break-all" target="_blank">
                {baseUrl}/.well-known/jwks.json
              </a>
            </div>
          </div>

          <h2 class="text-sm font-medium mb-2 border-t border-blue-300 dark:border-blue-700 pt-4">OAuth Endpoints</h2>
          <div class="space-y-2 text-xs font-mono mb-4">
            <div class="flex flex-col gap-0.5">
              <span class="opacity-70">Authorization Endpoint URL:</span>
              <code class="break-all">{baseUrl}/oauth/authorize</code>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="opacity-70">Token Endpoint URL:</span>
              <code class="break-all">{baseUrl}/oauth/token</code>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="opacity-70">User Info Endpoint URL:</span>
              <code class="break-all">{baseUrl}/oauth/userinfo</code>
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="opacity-70">Logout URL:</span>
              <code class="break-all">{baseUrl}/oauth/logout</code>
            </div>
          </div>

          <h2 class="text-sm font-medium mb-2 border-t border-blue-300 dark:border-blue-700 pt-4">Available Scopes</h2>
          <div class="space-y-2 text-xs mb-4">
            <div class="flex gap-2">
              <code class="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 font-medium">openid</code>
              <span class="opacity-80">Required. Returns: sub (user ID)</span>
            </div>
            <div class="flex gap-2">
              <code class="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 font-medium">profile</code>
              <span class="opacity-80">Returns: name, display_name, given_name, family_name</span>
            </div>
            <div class="flex gap-2">
              <code class="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 font-medium">email</code>
              <span class="opacity-80">Returns: email</span>
            </div>
            <div class="flex gap-2">
              <code class="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 font-medium">groups</code>
              <span class="opacity-80">Returns: groups (array of all group names, including inherited)</span>
            </div>
          </div>

          <h2 class="text-sm font-medium mb-2 border-t border-blue-300 dark:border-blue-700 pt-4">Claim Mapping</h2>
          <div class="space-y-1 text-xs font-mono">
            <div>
              <span class="opacity-70">ID Claim:</span> <code>sub</code> oder <code>uid</code> <span class="opacity-60">(Username)</span>
            </div>
            <div>
              <span class="opacity-70">Database ID:</span> <code>id</code> <span class="opacity-60">(UUID)</span>
            </div>
            <div>
              <span class="opacity-70">Display Name Claim:</span> <code>display_name</code>
            </div>
            <div>
              <span class="opacity-70">Email Claim:</span> <code>email</code>
            </div>
            <div>
              <span class="opacity-70">Groups Claim:</span> <code>groups</code>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
});
