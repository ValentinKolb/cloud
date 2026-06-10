import type { AuthContext } from "@valentinkolb/cloud/server";
import { accountsAppService as accountsService, coreSettings } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, Pagination } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { expectUserBackedActor } from "@/shared/actor";
import { ssr } from "../../config";
import AccountsWorkspace from "../AccountsWorkspace";
import DenyRequest from "../users/DenyRequest.island";
import CreateUserForm from "../users/new/CreateUserForm.island";

type StatusFilter = "pending" | "completed" | "denied" | "all";

const parsePage = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const parseStatus = (value: string | undefined): StatusFilter => {
  if (value === "pending" || value === "completed" || value === "denied" || value === "all") return value;
  return "pending";
};

const buildRequestsUrl = (status: StatusFilter, page: number): string => {
  const params = new URLSearchParams();
  if (status !== "pending") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query.length > 0 ? `/app/accounts/requests?${query}` : "/app/accounts/requests";
};

const STATUS_PILL: Record<Exclude<StatusFilter, "all">, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  denied: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const freeIpaEnabled = Boolean(await coreSettings.get<boolean>("freeipa.enable"));
  const page = parsePage(c.req.query("page"));
  const perPage = 100;
  const status = parseStatus(c.req.query("status"));

  const [pendingPage, requestsPage] = await Promise.all([
    accountsService.accountRequest.list({
      access: { userId: user.id, isAdmin: true },
      filter: { status: "pending" },
    }),
    accountsService.accountRequest.list({
      access: { userId: user.id, isAdmin: true },
      pagination: { page, perPage },
      filter: status === "all" ? { scope: "all" } : { status },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(requestsPage.total / perPage));
  const paginationBaseUrl = buildRequestsUrl(status, 1).replace(/(?:\?|&)page=\d+$/, "");
  const paginationUrl = paginationBaseUrl.includes("?") ? `${paginationBaseUrl}&page=` : `${paginationBaseUrl}?page=`;
  type RequestRow = (typeof requestsPage.items)[number];
  const columns: DataTableColumn<RequestRow>[] = [
    { id: "request", header: "Request", value: (request) => request.displayName || `${request.firstName} ${request.lastName}` },
    { id: "email", header: "Email", value: (request) => request.email },
    { id: "status", header: "Status", value: (request) => request.status },
    { id: "requested", header: "Requested", value: (request) => request.createdAt, cellClass: "whitespace-nowrap" },
    { id: "comment", header: "Comment", value: (request) => request.comment, cellClass: "max-w-[20rem]" },
    { id: "actions", header: "Actions", headerClass: "text-right", cellClass: "text-right whitespace-nowrap max-w-none" },
  ];

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Requests" }]}>
      <AccountsWorkspace active="requests" isAdmin={true} pendingRequests={pendingPage.total} scrollPreserveKey="accounts-requests">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: accounts-requests-title">
            <h1 class="text-base font-semibold text-primary">Requests</h1>
            <p class="mt-1 text-xs text-dimmed">
              {requestsPage.total} {status === "all" ? "requests" : `${status} requests`}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2" style="view-transition-name: accounts-requests-filters">
            {(["pending", "completed", "denied", "all"] as const).map((value) => (
              <a href={buildRequestsUrl(value, 1)} class={`btn-input btn-input-sm ${status === value ? "btn-input-active" : ""}`}>
                {value === "all" ? "All" : value[0]!.toUpperCase() + value.slice(1)}
              </a>
            ))}
            <div class="ml-auto">
              <CreateUserForm buttonClass="btn-input btn-input-sm" freeIpaEnabled={freeIpaEnabled} />
            </div>
          </div>

          {requestsPage.items.length === 0 ? (
            <div class="paper p-6 text-center text-sm text-dimmed">No requests found.</div>
          ) : (
            <>
              <div class="paper overflow-hidden" style="view-transition-name: accounts-requests-table">
                <DataTable
                  rows={requestsPage.items}
                  columns={columns}
                  getRowId={(request) => request.id}
                  hoverRows
                  class="overflow-x-auto"
                  scrollPreserveKey="accounts-requests-table"
                  renderCell={({ row: request, col }) => {
                    if (col.id === "request")
                      return (
                        <span class="font-medium text-primary">{request.displayName || `${request.firstName} ${request.lastName}`}</span>
                      );
                    if (col.id === "email") return <span class="text-dimmed">{request.email}</span>;
                    if (col.id === "status")
                      return (
                        <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_PILL[request.status]}`}>{request.status}</span>
                      );
                    if (col.id === "requested") return <span class="text-dimmed">{dates.formatDate(request.createdAt)}</span>;
                    if (col.id === "comment")
                      return (
                        <span class="truncate text-dimmed" title={request.comment || "-"}>
                          {request.comment || "-"}
                        </span>
                      );
                    if (col.id === "actions") {
                      return request.status === "pending" ? (
                        <div class="flex justify-end gap-1">
                          {freeIpaEnabled ? (
                            <CreateUserForm
                              buttonLabel="Create"
                              buttonIcon="ti ti-user-plus"
                              buttonClass="btn-input btn-input-sm"
                              freeIpaEnabled={freeIpaEnabled}
                              prefill={{
                                requestId: request.id,
                                email: request.email,
                                givenname: request.firstName,
                                sn: request.lastName,
                                displayName: request.displayName ?? undefined,
                                firstName: request.firstName,
                              }}
                            />
                          ) : null}
                          <DenyRequest requestId={request.id} email={request.email} firstName={request.firstName} />
                        </div>
                      ) : (
                        <span class="text-dimmed">-</span>
                      );
                    }
                    return "";
                  }}
                />
              </div>

              <div class="pt-1">
                <Pagination currentPage={requestsPage.page} totalPages={totalPages} baseUrl={paginationUrl} />
              </div>
            </>
          )}
        </div>
      </AccountsWorkspace>
    </Layout>
  );
});
