import type { AuthContext } from "@valentinkolb/cloud/server";
import {
  accountsAppService as accountsService,
  type ServiceAccountCredentialOverview,
  serviceAccountCredentials,
} from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, Pagination, Placeholder } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { expectUserBackedActor } from "@/shared/actor";
import { ssr } from "../../config";
import AccountsWorkspace from "../AccountsWorkspace";
import ServiceAccountCredentialActions from "./ServiceAccountCredentialActions.island";
import ServiceAccountsFilters from "./ServiceAccountsFilters.island";

const parsePage = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const buildUrl = (params: { search?: string; kind?: string; status?: string; page?: number }) => {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.kind?.trim()) query.set("kind", params.kind.trim());
  if (params.status?.trim() && params.status !== "active") query.set("status", params.status.trim());
  if (params.page && params.page > 1) query.set("page", String(params.page));
  const search = query.toString();
  return search ? `/app/accounts/service-accounts?${search}` : "/app/accounts/service-accounts";
};

const serviceAccountKindLabel = (kind: ServiceAccountCredentialOverview["serviceAccount"]["kind"]) =>
  kind === "user_delegated" ? "User-bound" : "Resource-bound";

const statusClass = (status: ServiceAccountCredentialOverview["status"]) =>
  status === "active"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
    : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";

const formatNullableDate = (value: string | null) => (value ? dates.formatDateTime(value) : "-");

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const page = parsePage(c.req.query("page"));
  const perPage = 100;
  const search = (c.req.query("search") ?? "").trim();
  const kind = (c.req.query("kind") ?? "").trim();
  const rawStatus = (c.req.query("status") ?? "active").trim();
  const status = rawStatus === "revoked" ? "revoked" : "active";

  const [pendingRequestsPage, credentialsPage] = await Promise.all([
    accountsService.accountRequest.list({ access: { userId: user.id, isAdmin: true }, filter: { status: "pending" } }),
    serviceAccountCredentials.listOverview({
      pagination: { page, perPage },
      filter: {
        search: search || undefined,
        serviceAccountKind: kind === "user_delegated" || kind === "resource_bound" ? kind : undefined,
        credentialStatus: status === "active" || status === "revoked" ? status : undefined,
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(credentialsPage.total / perPage));
  const baseUrl = (() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (kind) params.set("kind", kind);
    if (status !== "active") params.set("status", status);
    const query = params.toString();
    return query ? `/app/accounts/service-accounts?${query}&page=` : "/app/accounts/service-accounts?page=";
  })();

  const columns: DataTableColumn<ServiceAccountCredentialOverview>[] = [
    { id: "key", header: "API Key", value: (entry) => entry.name, cellClass: "min-w-[14rem]" },
    { id: "owner", header: "Owner", value: (entry) => entry.owner.type, cellClass: "min-w-[14rem]" },
    { id: "type", header: "Type", value: (entry) => serviceAccountKindLabel(entry.serviceAccount.kind) },
    { id: "status", header: "Status", value: (entry) => entry.status },
    { id: "expires", header: "Expires", value: (entry) => entry.expiresAt, cellClass: "whitespace-nowrap" },
    { id: "lastUsed", header: "Last used", value: (entry) => entry.lastUsedAt, cellClass: "whitespace-nowrap" },
    { id: "created", header: "Created", value: (entry) => entry.createdAt, cellClass: "whitespace-nowrap" },
    { id: "actions", header: "Actions", headerClass: "text-right", cellClass: "text-right whitespace-nowrap max-w-none" },
  ];

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Service Accounts" }]}
    >
      <AccountsWorkspace
        active="service-accounts"
        isAdmin
        pendingRequests={pendingRequestsPage.total}
        scrollPreserveKey="accounts-service-accounts"
      >
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: accounts-service-accounts-title">
            <h1 class="text-base font-semibold text-primary">Service Accounts</h1>
            <p class="mt-1 text-xs text-dimmed">
              {credentialsPage.total} {credentialsPage.total === 1 ? "API key" : "API keys"} across user-bound and resource-bound service
              accounts
            </p>
          </div>

          <div style="view-transition-name: accounts-service-accounts-search">
            <SearchBar
              action={buildUrl({ kind, status, page: 1 })}
              value={search}
              placeholder="Search API keys, users, apps, resources..."
              ariaLabel="Search service account API keys"
            />
          </div>

          <div class="flex flex-wrap items-center gap-2" style="view-transition-name: accounts-service-accounts-filters">
            <ServiceAccountsFilters search={search} kind={kind} status={status} />
          </div>

          {credentialsPage.items.length === 0 ? (
            <Placeholder surface="paper">No service account API keys found.</Placeholder>
          ) : (
            <div class="paper overflow-hidden" style="view-transition-name: accounts-service-accounts-table">
              <DataTable
                rows={credentialsPage.items}
                columns={columns}
                getRowId={(entry) => entry.id}
                hoverRows
                highlightColumns={false}
                class="overflow-x-auto"
                scrollPreserveKey="accounts-service-accounts-table"
                renderCell={({ row: entry, col }) => {
                  if (col.id === "key") {
                    return (
                      <div class="flex min-w-0 flex-col gap-1">
                        <span class="truncate font-medium text-primary">{entry.name}</span>
                        <span class="truncate font-mono text-[11px] text-dimmed">cld_{entry.tokenPrefix}_...</span>
                      </div>
                    );
                  }
                  if (col.id === "owner") {
                    if (entry.owner.type === "user") {
                      return (
                        <div class="flex min-w-0 flex-col gap-1">
                          <a href={`/app/accounts/users/${entry.owner.userId}`} class="truncate font-medium text-primary hover:underline">
                            {entry.owner.displayName || entry.owner.uid}
                          </a>
                          <span class="truncate text-[11px] text-dimmed">{entry.owner.mail ?? entry.owner.uid}</span>
                        </div>
                      );
                    }
                    return (
                      <div class="flex min-w-0 flex-col gap-1">
                        <span class="truncate font-medium text-primary">{entry.owner.appId || "Resource"}</span>
                        <span class="truncate text-[11px] text-dimmed">
                          {entry.owner.resourceType || "resource"} · {entry.owner.resourceId || "-"}
                        </span>
                      </div>
                    );
                  }
                  if (col.id === "type") return <span class="text-dimmed">{serviceAccountKindLabel(entry.serviceAccount.kind)}</span>;
                  if (col.id === "status")
                    return (
                      <span class={`w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClass(entry.status)}`}>{entry.status}</span>
                    );
                  if (col.id === "expires") return <span class="text-dimmed">{formatNullableDate(entry.expiresAt)}</span>;
                  if (col.id === "lastUsed") return <span class="text-dimmed">{formatNullableDate(entry.lastUsedAt)}</span>;
                  if (col.id === "created") return <span class="text-dimmed">{dates.formatDateTime(entry.createdAt)}</span>;
                  if (col.id === "actions")
                    return (
                      <ServiceAccountCredentialActions credentialId={entry.id} name={entry.name} disabled={entry.status !== "active"} />
                    );
                  return "";
                }}
              />
            </div>
          )}

          <div class="pt-1">
            <Pagination currentPage={page} totalPages={totalPages} baseUrl={baseUrl} />
          </div>
        </div>
      </AccountsWorkspace>
    </Layout>
  );
});
