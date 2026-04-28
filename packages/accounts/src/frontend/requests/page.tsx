import { ssr } from "../../config";
import { accountsAppService as accountsService, coreSettings } from "@valentinkolb/cloud/services";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { dates } from "@valentinkolb/stdlib";
import { Pagination } from "@valentinkolb/cloud/ui";
import AccountsNavSidebar from "../AccountsNavSidebar";
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
  const user = c.get("user");
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

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Requests" }]}>
      <div class="app-cols h-full">
        <AccountsNavSidebar active="requests" isAdmin={true} pendingRequests={pendingPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <div class="flex flex-col gap-2">
            <div class="min-w-0" style="view-transition-name: accounts-requests-title">
              <h1 class="text-base font-semibold text-primary">Requests</h1>
              <p class="mt-1 text-xs text-dimmed">{requestsPage.total} {status === "all" ? "requests" : `${status} requests`}</p>
            </div>

            <div class="flex flex-wrap items-center gap-2" style="view-transition-name: accounts-requests-filters">
              {(["pending", "completed", "denied", "all"] as const).map((value) => (
                <a
                  href={buildRequestsUrl(value, 1)}
                  class={`btn-input btn-input-sm ${status === value ? "btn-input-active" : ""}`}
                >
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
                  <div class="overflow-x-auto">
                    <table class="w-full text-xs">
                      <thead>
                        <tr class="border-b border-zinc-100 dark:border-zinc-800">
                          <th class="px-3 py-2 text-left font-medium text-dimmed">Request</th>
                          <th class="px-3 py-2 text-left font-medium text-dimmed">Email</th>
                          <th class="px-3 py-2 text-left font-medium text-dimmed">Status</th>
                          <th class="px-3 py-2 text-left font-medium text-dimmed">Requested</th>
                          <th class="px-3 py-2 text-left font-medium text-dimmed">Comment</th>
                          <th class="px-3 py-2 text-right font-medium text-dimmed">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requestsPage.items.map((request) => {
                          const displayName = request.displayName || `${request.firstName} ${request.lastName}`;
                          return (
                            <tr class="border-b border-zinc-50 transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                              <td class="px-3 py-1.5 font-medium text-primary">{displayName}</td>
                              <td class="px-3 py-1.5 text-dimmed">{request.email}</td>
                              <td class="px-3 py-1.5">
                                <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_PILL[request.status]}`}>{request.status}</span>
                              </td>
                              <td class="px-3 py-1.5 whitespace-nowrap text-dimmed">{dates.formatDate(request.createdAt)}</td>
                              <td class="max-w-[20rem] truncate px-3 py-1.5 text-dimmed" title={request.comment || "-"}>
                                {request.comment || "-"}
                              </td>
                              <td class="px-3 py-1.5 text-right">
                                {request.status === "pending" ? (
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
                                ) : <span class="text-dimmed">-</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div class="pt-1">
                  <Pagination currentPage={requestsPage.page} totalPages={totalPages} baseUrl={paginationUrl} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
});
