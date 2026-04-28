import { ssr } from "../config";
import { getSync } from "@valentinkolb/cloud/services";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import CreateClientButton from "./_components/CreateClientButton.island";
import ClientActions from "./_components/ClientActions.island";
import { StatCell } from "@valentinkolb/cloud/ui";
import { oauthService } from "../service";

/** Admin OAuth clients list page. */
export default ssr<AuthContext>(async (c) => {
  const { items: clients } = await oauthService.client.list();

  // Build base URL for OAuth endpoints
  const rawAppUrl = getSync<string>("app.url");
  const baseUrl = rawAppUrl.startsWith("http") ? rawAppUrl : `https://${rawAppUrl}`;

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateStr));
  };

  const publicClients = clients.filter((client) => client.isPublic).length;
  const confidentialClients = clients.length - publicClients;

  return () => (
    <AdminLayout c={c} title="OAuth" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-oauth-title">
            <h1 class="text-base font-semibold text-primary">OAuth</h1>
          </div>

          {/* Stat cards — see skills/cloud-app/references/frontend.md § Stats */}
          <div class="paper overflow-hidden">
            <div class="grid grid-cols-3 gap-px p-px bg-zinc-100 dark:bg-zinc-800">
              <StatCell label="Clients" value={clients.length} sub="registered" accent={{ tone: "blue", icon: "ti ti-key" }} />
              <StatCell label="Public" value={publicClients} sub="PKCE, no secret" />
              <StatCell label="Confidential" value={confidentialClients} sub="with secret" accent={{ tone: "emerald", icon: "ti ti-lock" }} />
            </div>
          </div>

          <div class="flex justify-end">
            <CreateClientButton />
          </div>

          {clients.length > 0 ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-oauth-table">
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="border-b border-zinc-100 dark:border-zinc-800">
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Client</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Description</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Type</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Scopes</th>
                      <th class="px-3 py-2 text-left font-medium text-dimmed">Profiles</th>
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
                          <span
                            class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              client.isPublic
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {client.isPublic ? "Public" : "Confidential"}
                          </span>
                        </td>
                        <td class="px-3 py-1.5">
                          <div class="flex flex-wrap gap-1">
                            {client.scopes.map((scope) => (
                              <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-dimmed dark:bg-zinc-800">{scope}</span>
                            ))}
                          </div>
                        </td>
                        <td class="px-3 py-1.5">
                          <div class="flex flex-wrap gap-1">
                            {client.allowedProfiles.map((profile) => (
                              <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                                {profile}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td class="px-3 py-1.5 whitespace-nowrap text-dimmed">{formatDate(client.createdAt)}</td>
                        <td class="px-3 py-1.5 text-right">
                          <ClientActions client={client} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <section class="paper p-6 text-center text-sm text-dimmed">
              No OAuth clients found. Create one to allow external applications to authenticate users.
            </section>
          )}

          <section class="info-block-info p-4" style="view-transition-name: admin-oauth-reference">
            <h2 class="mb-3 text-sm font-medium">Discovery Endpoints</h2>
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

            <h2 class="mb-2 border-t border-blue-300 pt-4 text-sm font-medium dark:border-blue-700">OAuth Endpoints</h2>
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

            <h2 class="mb-2 border-t border-blue-300 pt-4 text-sm font-medium dark:border-blue-700">Available Scopes</h2>
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

            <h2 class="mb-2 border-t border-blue-300 pt-4 text-sm font-medium dark:border-blue-700">Claim Mapping</h2>
            <div class="space-y-1 text-xs font-mono">
            <div>
                <span class="opacity-70">ID Claim:</span> <code>sub</code> or <code>uid</code> <span class="opacity-60">(username)</span>
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
          </section>
        </div>
      </div>
    </AdminLayout>
  );
});
