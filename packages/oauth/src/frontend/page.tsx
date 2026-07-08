import type { AuthContext } from "@valentinkolb/cloud/server";
import { get } from "@valentinkolb/cloud/services";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, Placeholder, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import { oauthService } from "../service";
import ClientActions from "./_components/ClientActions.island";
import CreateClientButton from "./_components/CreateClientButton.island";
import OAuthLayoutHelp from "./_components/OAuthLayoutHelp.island";

/** Admin OAuth clients list page. */
export default ssr<AuthContext>(async (c) => {
  const { items: clients } = await oauthService.client.list();

  // Build base URL for OAuth endpoints
  const rawAppUrl = await get<string>("app.url");
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
  type ClientRow = (typeof clients)[number];
  const columns: DataTableColumn<ClientRow>[] = [
    { id: "client", header: "Client", value: (client) => client.name },
    { id: "description", header: "Description", value: (client) => client.description, cellClass: "max-w-[18rem]" },
    { id: "type", header: "Type", value: (client) => client.isPublic },
    { id: "access", header: "Access", value: (client) => client.accessMode },
    { id: "scopes", header: "Scopes", value: (client) => client.scopes },
    { id: "profiles", header: "Profiles", value: (client) => client.allowedProfiles },
    { id: "created", header: "Created", value: (client) => client.createdAt, cellClass: "whitespace-nowrap" },
    {
      id: "actions",
      header: <span class="sr-only">Actions</span>,
      headerClass: "w-px text-right",
      cellClass: "text-right whitespace-nowrap max-w-none",
    },
  ];

  return () => (
    <AdminLayout c={c} title="OAuth" stretch>
      <OAuthLayoutHelp />
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-oauth-title">
            <h1 class="text-base font-semibold text-primary">OAuth</h1>
          </div>

          {/* Stat cards — see skills/cloud-app/references/frontend.md § Stats */}
          <StatGrid columns={3}>
            <StatCell label="Clients" value={clients.length} sub="registered" accent={{ tone: "blue", icon: "ti ti-key" }} />
            <StatCell label="Public" value={publicClients} sub="PKCE, no secret" />
            <StatCell label="Confidential" value={confidentialClients} sub="with secret" accent={{ tone: "emerald", icon: "ti ti-lock" }} />
          </StatGrid>

          <div class="flex justify-end">
            <CreateClientButton />
          </div>

          {clients.length > 0 ? (
            <section class="paper overflow-hidden" style="view-transition-name: admin-oauth-table">
              <DataTable
                rows={clients}
                columns={columns}
                getRowId={(client) => client.id}
                hoverRows
                class="overflow-x-auto"
                renderCell={({ row: client, col }) => {
                  if (col.id === "client") return <span class="font-medium text-primary">{client.name}</span>;
                  if (col.id === "description") {
                    return (
                      <span class="text-dimmed" title={client.description || "No description"}>
                        {client.description || <span class="italic">No description</span>}
                      </span>
                    );
                  }
                  if (col.id === "type") {
                    return (
                      <span
                        class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          client.isPublic
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {client.isPublic ? "Public" : "Confidential"}
                      </span>
                    );
                  }
                  if (col.id === "scopes") {
                    return (
                      <div class="flex flex-wrap gap-1">
                        {client.scopes.map((scope) => (
                          <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-dimmed dark:bg-zinc-800">{scope}</span>
                        ))}
                      </div>
                    );
                  }
                  if (col.id === "access") {
                    if (client.accessMode === "specific") {
                      return (
                        <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                          {client.accessUsers.length + client.accessGroups.length} selected
                        </span>
                      );
                    }
                    return <span class="text-dimmed">Profiles</span>;
                  }
                  if (col.id === "profiles") {
                    return (
                      <div class="flex flex-wrap gap-1">
                        {client.allowedProfiles.map((profile) => (
                          <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                            {profile}
                          </span>
                        ))}
                      </div>
                    );
                  }
                  if (col.id === "created") return <span class="text-dimmed">{formatDate(client.createdAt)}</span>;
                  if (col.id === "actions") return <ClientActions client={client} />;
                  return "";
                }}
              />
            </section>
          ) : (
            <Placeholder surface="paper">
              No OAuth clients found. Create one to allow external applications to authenticate users.
            </Placeholder>
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
