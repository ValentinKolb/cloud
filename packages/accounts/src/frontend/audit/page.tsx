import type { AuthContext } from "@valentinkolb/cloud/server";
import {
  type AuditActionGroup,
  type AuditEvent,
  type AuditOutcome,
  accountsAppService as accountsService,
  audit,
} from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, Pagination } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { expectUserBackedActor } from "@/shared/actor";
import { ssr } from "../../config";
import AccountsWorkspace from "../AccountsWorkspace";
import AuditFilters from "./AuditFilters.island";
import { actionLabel } from "./audit-labels";

type AuditState = {
  search: string;
  actor: string;
  target: string;
  action: string;
  actionGroup: "" | AuditActionGroup;
  serviceAccountId: string;
  outcome: "" | AuditOutcome;
  provider: "" | "local" | "ipa";
  days: number;
  page: number;
};

const parsePage = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const parseDays = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "30", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 3650) : 30;
};

const parseOutcome = (value: string | undefined): AuditState["outcome"] =>
  value === "allowed" || value === "denied" || value === "failed" ? value : "";

const parseProvider = (value: string | undefined): AuditState["provider"] => (value === "local" || value === "ipa" ? value : "");
const parseActionGroup = (value: string | undefined): AuditState["actionGroup"] => (value === "service_accounts" ? value : "");

const buildAuditUrl = (state: Partial<AuditState> = {}): string => {
  const params = new URLSearchParams();
  const merged: AuditState = {
    search: "",
    actor: "",
    target: "",
    action: "",
    actionGroup: "",
    serviceAccountId: "",
    outcome: "",
    provider: "",
    days: 30,
    page: 1,
    ...state,
  };
  if (merged.search.trim()) params.set("search", merged.search.trim());
  if (merged.actor.trim()) params.set("actor", merged.actor.trim());
  if (merged.target.trim()) params.set("target", merged.target.trim());
  if (merged.action.trim()) params.set("action", merged.action.trim());
  if (merged.actionGroup) params.set("actionGroup", merged.actionGroup);
  if (merged.serviceAccountId.trim()) params.set("serviceAccountId", merged.serviceAccountId.trim());
  if (merged.outcome) params.set("outcome", merged.outcome);
  if (merged.provider) params.set("provider", merged.provider);
  if (merged.days !== 30) params.set("days", String(merged.days));
  if (merged.page > 1) params.set("page", String(merged.page));
  const query = params.toString();
  return query ? `/app/accounts/audit?${query}` : "/app/accounts/audit";
};

const statusClass = (outcome: AuditOutcome): string => {
  if (outcome === "allowed") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (outcome === "denied") return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
};

const providerClass = (provider: string | null): string =>
  provider === "ipa"
    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300";

const initialOf = (value: string): string => value.trim().charAt(0).toUpperCase();

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const state: AuditState = {
    search: (c.req.query("search") ?? "").trim(),
    actor: (c.req.query("actor") ?? "").trim(),
    target: (c.req.query("target") ?? "").trim(),
    action: (c.req.query("action") ?? "").trim(),
    actionGroup: parseActionGroup(c.req.query("actionGroup")),
    serviceAccountId: (c.req.query("serviceAccountId") ?? "").trim(),
    outcome: parseOutcome(c.req.query("outcome")),
    provider: parseProvider(c.req.query("provider")),
    days: parseDays(c.req.query("days")),
    page: parsePage(c.req.query("page")),
  };
  const perPage = 100;
  const [pendingRequestsPage, eventsPage] = await Promise.all([
    accountsService.accountRequest.list({ access: { userId: user.id, isAdmin: true }, filter: { status: "pending" } }),
    audit.list({
      pagination: { page: state.page, perPage },
      filter: {
        search: state.search || undefined,
        actor: state.actor || undefined,
        target: state.target || undefined,
        action: state.action || undefined,
        actionGroup: state.actionGroup || undefined,
        serviceAccountId: state.serviceAccountId || undefined,
        outcome: state.outcome || undefined,
        provider: state.provider || undefined,
        days: state.days,
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(eventsPage.total / perPage));
  const paginationBaseUrl = buildAuditUrl({ ...state, page: 1 }).replace(/(?:\?|&)page=\d+$/, "");
  const paginationUrl = paginationBaseUrl.includes("?") ? `${paginationBaseUrl}&page=` : `${paginationBaseUrl}?page=`;
  const actorFilterLabel = state.actor
    ? (eventsPage.items.find((event) => event.actor.userId === state.actor || event.actor.uid === state.actor)?.actor.uid ?? state.actor)
    : "";
  const targetFilterLabel = state.target
    ? (eventsPage.items.find((event) => event.target.id === state.target || event.target.label === state.target)?.target.label ??
      state.target)
    : "";
  const columns: DataTableColumn<AuditEvent>[] = [
    { id: "time", header: "Time", value: (event) => event.createdAt, cellClass: "whitespace-nowrap" },
    { id: "actor", header: "Actor", value: (event) => event.actor.uid ?? event.actor.userId },
    { id: "action", header: "Action", value: (event) => actionLabel(event.action) },
    { id: "target", header: "Target", value: (event) => event.target.label ?? event.target.id },
    { id: "outcome", header: "Outcome", value: (event) => event.outcome },
    { id: "reason", header: "Reason", value: (event) => event.reason, cellClass: "max-w-[24rem]" },
  ];

  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Accounts", href: "/app/accounts" }, { title: "Audit" }]}>
      <AccountsWorkspace active="audit" isAdmin pendingRequests={pendingRequestsPage.total} scrollPreserveKey="accounts-audit">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: accounts-audit-title">
            <h1 class="text-base font-semibold text-primary">Audit Log</h1>
            <p class="mt-1 text-xs text-dimmed">
              {eventsPage.total} {eventsPage.total === 1 ? "event" : "events"} · last {state.days} days
            </p>
          </div>

          <div style="view-transition-name: accounts-audit-search">
            <SearchBar
              action={buildAuditUrl({ ...state, search: "", page: 1 })}
              value={state.search}
              placeholder="Search audit events..."
              ariaLabel="Search audit events"
            />
          </div>

          <div class="flex flex-wrap items-center gap-2" style="view-transition-name: accounts-audit-filters">
            <AuditFilters
              search={state.search}
              actor={state.actor}
              target={state.target}
              action={state.action}
              actionGroup={state.actionGroup}
              serviceAccountId={state.serviceAccountId}
              outcome={state.outcome}
              provider={state.provider}
              days={state.days}
            />
          </div>

          {state.actor || state.target || state.serviceAccountId ? (
            <div class="flex flex-wrap items-center gap-2" style="view-transition-name: accounts-audit-scope-filters">
              <span class="text-[11px] uppercase tracking-[0.14em] text-dimmed">Scoped to</span>
              {state.actor ? (
                <a
                  href={buildAuditUrl({ ...state, actor: "", page: 1 })}
                  class="tag max-w-full bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  title={`Actor: ${state.actor}`}
                >
                  <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-semibold text-blue-700 dark:bg-blue-800 dark:text-blue-200">
                    {initialOf(actorFilterLabel)}
                  </span>
                  <span class="truncate">Actor: {actorFilterLabel}</span>
                  <i class="ti ti-x" />
                </a>
              ) : null}
              {state.target ? (
                <a
                  href={buildAuditUrl({ ...state, target: "", page: 1 })}
                  class="tag max-w-full bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                  title={`Target: ${state.target}`}
                >
                  <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9px] font-semibold text-violet-700 dark:bg-violet-800 dark:text-violet-200">
                    {initialOf(targetFilterLabel)}
                  </span>
                  <span class="truncate">Target: {targetFilterLabel}</span>
                  <i class="ti ti-x" />
                </a>
              ) : null}
              {state.serviceAccountId ? (
                <a
                  href={buildAuditUrl({ ...state, serviceAccountId: "", page: 1 })}
                  class="tag max-w-full bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  title={`Service account: ${state.serviceAccountId}`}
                >
                  <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-100 text-[9px] font-semibold text-red-700 dark:bg-red-800 dark:text-red-200">
                    <i class="ti ti-user-key text-[10px]" />
                  </span>
                  <span class="truncate">Service account: {state.serviceAccountId}</span>
                  <i class="ti ti-x" />
                </a>
              ) : null}
            </div>
          ) : null}

          {eventsPage.items.length === 0 ? (
            <div class="paper p-6 text-center text-sm text-dimmed">No audit events found.</div>
          ) : (
            <div class="paper overflow-hidden" style="view-transition-name: accounts-audit-table">
              <DataTable
                rows={eventsPage.items}
                columns={columns}
                getRowId={(event) => String(event.id)}
                hoverRows
                highlightColumns={false}
                class="overflow-x-auto"
                scrollPreserveKey="accounts-audit-table"
                renderCell={({ row: event, col }) => {
                  if (col.id === "time") return <span class="text-dimmed">{dates.formatDateTime(event.createdAt)}</span>;
                  if (col.id === "actor") {
                    const actorLabel = event.actor.uid ?? event.actor.userId ?? "System";
                    return (
                      <div class="flex min-w-0 flex-col gap-1">
                        {event.actor.userId ? (
                          <a
                            href={buildAuditUrl({ ...state, actor: event.actor.userId, page: 1 })}
                            class="truncate font-medium text-primary hover:underline"
                          >
                            {actorLabel}
                          </a>
                        ) : (
                          <span class="truncate font-medium text-primary">{actorLabel}</span>
                        )}
                        {event.actor.provider ? (
                          <span class={`w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${providerClass(event.actor.provider)}`}>
                            {event.actor.provider}
                          </span>
                        ) : null}
                      </div>
                    );
                  }
                  if (col.id === "action")
                    return (
                      <div class="flex min-w-0 flex-col gap-1">
                        <span class="truncate font-medium text-primary">{actionLabel(event.action)}</span>
                        <span class="truncate text-[11px] text-dimmed">{event.action}</span>
                      </div>
                    );
                  if (col.id === "target") {
                    const targetLabel = event.target.label ?? event.target.id ?? "-";
                    const href =
                      event.target.type === "user" && event.target.id
                        ? `/app/accounts/users/${event.target.id}`
                        : event.target.type === "group" && event.target.id
                          ? `/app/accounts/groups/${event.target.id}`
                          : null;
                    return (
                      <div class="flex min-w-0 flex-col gap-1">
                        {href ? (
                          <a href={href} class="truncate font-medium text-primary hover:underline">
                            {targetLabel}
                          </a>
                        ) : (
                          <span class="truncate font-medium text-primary">{targetLabel}</span>
                        )}
                        <span class="truncate text-[11px] text-dimmed">{event.target.type ?? "target"}</span>
                      </div>
                    );
                  }
                  if (col.id === "outcome")
                    return (
                      <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClass(event.outcome)}`}>{event.outcome}</span>
                    );
                  if (col.id === "reason")
                    return (
                      <span class="truncate text-dimmed" title={event.reason ?? event.errorMessage ?? ""}>
                        {event.reason ?? event.errorMessage ?? "-"}
                      </span>
                    );
                  return "";
                }}
              />
            </div>
          )}

          <div class="pt-1">
            <Pagination currentPage={state.page} totalPages={totalPages} baseUrl={paginationUrl} />
          </div>
        </div>
      </AccountsWorkspace>
    </Layout>
  );
});
