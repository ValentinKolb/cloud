import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { dates } from "@valentinkolb/cloud/lib/shared";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { accountsService } from "../../service";
import AccountsNavSidebar from "../AccountsNavSidebar";
import DenyRequest from "../users/DenyRequest.island";

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
  const page = parsePage(c.req.query("page"));
  const perPage = 40;
  const status = parseStatus(c.req.query("status"));

  const [pendingPage, requestsPage] = await Promise.all([
    accountsService.accountRequest.list({
      access: { userId: user.id, isAdmin: true },
      filter: { status: "pending" },
    }),
    accountsService.accountRequest.list({
      access: { userId: user.id, isAdmin: true },
      pagination: { page, perPage },
      filter: status === "all" ? undefined : { status },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(requestsPage.total / perPage));
  const paginationBaseUrl = buildRequestsUrl(status, 1).replace(/(?:\?|&)page=\d+$/, "");
  const paginationUrl = paginationBaseUrl.includes("?") ? `${paginationBaseUrl}&page=` : `${paginationBaseUrl}?page=`;

  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Requests" }]}>
      <div class="app-cols h-full">
        <AccountsNavSidebar active="requests" isAdmin={true} pendingRequests={pendingPage.total} />

        <div class="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <h1 class="text-sm font-semibold text-primary">Account Requests</h1>
              <a href="/app/accounts/users/new" class="btn-secondary btn-sm">
                <i class="ti ti-plus" />
                New User
              </a>
            </div>

            <div class="flex flex-wrap items-center gap-1">
              {(["pending", "completed", "denied", "all"] as const).map((value) => (
                <a
                  href={buildRequestsUrl(value, 1)}
                  class={`btn-input btn-input-sm ${status === value ? "btn-input-active" : ""}`}
                >
                  {value === "all" ? "All" : value[0]!.toUpperCase() + value.slice(1)}
                </a>
              ))}
            </div>

            {requestsPage.items.length === 0 ? (
              <div class="paper p-6 text-center text-sm text-dimmed">No requests found.</div>
            ) : (
              <>
                <div class="flex flex-col gap-2">
                  {requestsPage.items.map((request) => {
                    const displayName = request.displayName || `${request.firstName} ${request.lastName}`;
                    return (
                      <article class="paper p-3 flex items-start gap-3">
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2 flex-wrap">
                            <h2 class="text-sm font-medium text-primary">{displayName}</h2>
                            <span class={`tag ${STATUS_PILL[request.status]}`}>{request.status}</span>
                          </div>
                          <p class="text-xs text-dimmed mt-0.5">{request.email}</p>
                          {request.phone && <p class="text-xs text-dimmed">{request.phone}</p>}
                          {request.comment && <p class="text-xs mt-2 text-secondary line-clamp-2">{request.comment}</p>}
                          <p class="text-[10px] text-dimmed mt-2">Requested {dates.formatDate(request.createdAt)}</p>
                        </div>
                        {request.status === "pending" ? (
                          <div class="flex items-center gap-1 shrink-0">
                            <a href={`/app/accounts/users/new?request=${request.id}`} class="btn-secondary btn-sm">
                              <i class="ti ti-user-plus" />
                              Create
                            </a>
                            <DenyRequest requestId={request.id} email={request.email} firstName={request.firstName} />
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
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
