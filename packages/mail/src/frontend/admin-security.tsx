import { dates } from "@k2b/stdlib";
import { ButtonLink, DataTable, type DataTableColumn, NoticeCard, Placeholder, StatCell, StatGrid, StatusBadge } from "@k2b/ui";
import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { ssr } from "../config";
import type { MailProtectedIdentity, MailSecurityPolicy, MailSecurityReport } from "../security-contracts";
import { type MailRequestContext, security } from "../service";
import MailAdminSecurityActions from "./_components/MailAdminSecurityActions.island";

const matchesSearch = (query: string, values: readonly (string | null | undefined)[]): boolean => {
  const normalized = query.toLocaleLowerCase();
  return normalized === "" || values.some((value) => value?.toLocaleLowerCase().includes(normalized));
};

const securitySearchAction = (searches: Record<string, string>): string => {
  const params = new URLSearchParams(Object.entries(searches).filter((entry) => entry[1] !== ""));
  const query = params.toString();
  return query ? `/admin/mail/security?${query}` : "/admin/mail/security";
};

const SECURITY_NOTICES = [
  {
    title: "Organization rules are exact and shared",
    detail:
      "Block rules contain known sender or link matches for everyone. Trust rules only remove this signal after a configured receiving server confirms the visible sender domain; trust never overrides a block.",
  },
  {
    title: "Protected identities detect impersonation",
    detail:
      "Mail compares an exact visible sender name, such as a company or service, with its allowed sending domains. A mismatch shows readers an explainable warning; it does not delete or move the message.",
  },
] as const;

export default ssr<AuthContext>(async (c) => {
  const reportSearch = (c.req.query("reports") ?? "").trim();
  const policySearch = (c.req.query("rules") ?? "").trim();
  const identitySearch = (c.req.query("identities") ?? "").trim();
  const context: MailRequestContext = {
    actor: c.get("actor"),
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const dateConfig = getDateConfig(c);
  const [reportsResult, policiesResult, identitiesResult, settingsResult] = await Promise.all([
    security.listReports(context, { limit: 100 }),
    security.listPolicies(context),
    security.listProtectedIdentities(context),
    security.getSettings(context),
  ]);
  const reports = reportsResult.ok ? reportsResult.data : [];
  const policies = policiesResult.ok ? policiesResult.data : [];
  const identities = identitiesResult.ok ? identitiesResult.data : [];
  const filteredReports = reports.filter((report) =>
    matchesSearch(reportSearch, [
      report.status,
      report.senderAddress,
      report.senderDomain,
      report.messageId,
      report.mailboxId,
      ...report.assessment.findings.flatMap((finding) => [finding.title, finding.explanation]),
    ]),
  );
  const filteredPolicies = policies.filter((policy) =>
    matchesSearch(policySearch, [policy.disposition, policy.target, policy.value, policy.note, policy.enabled ? "active" : "paused"]),
  );
  const filteredIdentities = identities.filter((identity) =>
    matchesSearch(identitySearch, [identity.name, identity.note, identity.enabled ? "active" : "paused", ...identity.allowedDomains]),
  );
  const openReports = reports.filter((report) => report.status === "new" || report.status === "in_review").length;
  const reportColumns: DataTableColumn<MailSecurityReport>[] = [
    { id: "status", header: "Status", value: (row) => row.status },
    { id: "sender", header: "Sender", value: (row) => row.senderAddress ?? "Unknown" },
    { id: "reason", header: "Evidence", value: (row) => row.assessment.findings.map((finding) => finding.title).join(", ") },
    { id: "reports", header: "Reports", value: (row) => row.reportCount, headerClass: "text-right", cellClass: "text-right" },
    { id: "updated", header: "Updated", value: (row) => row.updatedAt },
    { id: "actions", header: "Actions", headerClass: "w-px text-right", cellClass: "text-right" },
  ];
  const policyColumns: DataTableColumn<MailSecurityPolicy>[] = [
    { id: "rule", header: "Rule", value: (row) => row.disposition },
    { id: "target", header: "Match", value: (row) => row.target },
    { id: "value", header: "Value", value: (row) => row.value },
    { id: "state", header: "State", value: (row) => row.enabled },
    { id: "actions", header: "Actions", headerClass: "w-px text-right", cellClass: "text-right" },
  ];
  const identityColumns: DataTableColumn<MailProtectedIdentity>[] = [
    { id: "name", header: "Visible name", value: (row) => row.name },
    { id: "domains", header: "Allowed domains", value: (row) => row.allowedDomains.join(", ") },
    { id: "actions", header: "Actions", headerClass: "w-px text-right", cellClass: "text-right" },
  ];

  return () => (
    <AdminLayout c={c} title="Mail security">
      <div class="app-rows" data-scroll-preserve="mail-admin-security">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <ButtonLink href="/admin/mail" variant="subtle" size="sm">
                <i class="ti ti-arrow-left" aria-hidden="true" /> Mail
              </ButtonLink>
              <h1 class="text-base font-semibold text-primary">Phishing protection</h1>
            </div>
            <p class="mt-1 text-xs text-dimmed">
              Review user reports and maintain narrow, explainable protection rules. Message bodies stay out of this page.
            </p>
          </div>
          <MailAdminSecurityActions kind="toolbar" trustedAuthservIds={settingsResult.ok ? settingsResult.data.trustedAuthservIds : null} />
        </div>

        <StatGrid columns={4}>
          <StatCell
            label="Open reports"
            value={openReports}
            sub="new or in review"
            accent={openReports ? { tone: "amber", icon: "ti ti-shield-exclamation" } : undefined}
          />
          <StatCell
            label="Blocking rules"
            value={policies.filter((policy) => policy.disposition === "deny" && policy.enabled).length}
            sub="exact matches"
          />
          <StatCell
            label="Trusted senders"
            value={policies.filter((policy) => policy.disposition === "trust" && policy.enabled).length}
            sub="authentication still required"
          />
          <StatCell
            label="Protected identities"
            value={identities.filter((identity) => identity.enabled).length}
            sub="visible sender names"
          />
        </StatGrid>

        <NoticeCard.Grid items={SECURITY_NOTICES}>
          {(notice) => <NoticeCard tone="info" title={notice.title} detail={notice.detail} />}
        </NoticeCard.Grid>

        {reportsResult.ok ? (
          <DataTable.Panel class="overflow-hidden">
            <DataTable.Header
              title="Reported messages"
              subtitle={
                reportSearch
                  ? `${filteredReports.length} of ${reports.length} recent reports`
                  : `${reports.length} recent ${reports.length === 1 ? "report" : "reports"} · newest first`
              }
            />
            <DataTable.Controls>
              <SearchBar
                action={securitySearchAction({ rules: policySearch, identities: identitySearch })}
                value={reportSearch}
                param="reports"
                pageParam="reports-page"
                placeholder="Search recent reports..."
                ariaLabel="Search recent phishing reports"
              />
            </DataTable.Controls>
            <DataTable
              rows={filteredReports}
              columns={reportColumns}
              getRowId={(row) => row.id}
              hoverRows
              class="overflow-x-auto"
              scrollPreserveKey="mail-admin-security-reports"
              empty={reportSearch ? `No recent reports matching "${reportSearch}".` : "No messages have been reported."}
              renderCell={({ row, col }) => {
                if (col.id === "status")
                  return (
                    <StatusBadge
                      tone={row.status === "confirmed" ? "error" : row.status === "dismissed" ? "neutral" : "warning"}
                      label={row.status.replaceAll("_", " ")}
                    />
                  );
                if (col.id === "reason")
                  return (
                    <div class="max-w-xl">
                      <p class="truncate text-xs text-primary">
                        {row.assessment.findings.map((finding) => finding.title).join(" · ") || "Reported by a user"}
                      </p>
                      <p class="truncate text-[10px] text-dimmed">
                        {row.assessment.findings.map((finding) => finding.explanation).join(" · ") ||
                          "No automatic warning was shown; review the report context."}
                      </p>
                      <p class="font-mono text-[10px] text-dimmed">
                        message {row.messageId} · mailbox {row.mailboxId}
                      </p>
                    </div>
                  );
                if (col.id === "sender")
                  return (
                    <div>
                      <p class="font-mono text-xs text-primary">{row.senderAddress ?? "Unknown sender"}</p>
                      {row.senderDomain ? <p class="font-mono text-[10px] text-dimmed">{row.senderDomain}</p> : null}
                    </div>
                  );
                if (col.id === "reports") return <span class="tabular-nums">{row.reportCount}</span>;
                if (col.id === "updated")
                  return (
                    <time title={dates.formatDateTime(row.updatedAt, dateConfig)}>
                      {dates.formatDateTimeRelative(row.updatedAt, dateConfig)}
                    </time>
                  );
                if (col.id === "actions") return <MailAdminSecurityActions kind="report" report={row} />;
                return "";
              }}
            />
          </DataTable.Panel>
        ) : (
          <Placeholder state="error" variant="panel" title="Could not load reports" description={reportsResult.error.message} />
        )}

        {policiesResult.ok ? (
          <DataTable.Panel class="overflow-hidden">
            <DataTable.Header
              title="Organization rules"
              subtitle={
                policySearch ? `${filteredPolicies.length} of ${policies.length} rules` : `${policies.length} organization-wide rules`
              }
            />
            <DataTable.Controls>
              <SearchBar
                action={securitySearchAction({ reports: reportSearch, identities: identitySearch })}
                value={policySearch}
                param="rules"
                pageParam="rules-page"
                placeholder="Search rules by address, domain, or reason..."
                ariaLabel="Search organization Mail security rules"
              />
            </DataTable.Controls>
            <DataTable
              rows={filteredPolicies}
              columns={policyColumns}
              getRowId={(row) => row.id}
              hoverRows
              class="overflow-x-auto"
              scrollPreserveKey="mail-admin-security-rules"
              empty={policySearch ? `No rules matching "${policySearch}".` : "No organization-wide Mail security rules."}
              renderCell={({ row, col }) => {
                if (col.id === "rule")
                  return (
                    <StatusBadge
                      tone={row.disposition === "deny" ? "error" : "ok"}
                      label={row.disposition === "deny" ? "Block" : "Trust"}
                    />
                  );
                if (col.id === "target") return <span class="capitalize text-secondary">{row.target.replaceAll("_", " ")}</span>;
                if (col.id === "value")
                  return (
                    <div>
                      <p class="font-mono text-xs text-primary">{row.value}</p>
                      {row.note ? <p class="text-[10px] text-dimmed">{row.note}</p> : null}
                    </div>
                  );
                if (col.id === "state")
                  return <StatusBadge tone={row.enabled ? "ok" : "neutral"} label={row.enabled ? "Active" : "Paused"} />;
                if (col.id === "actions") return <MailAdminSecurityActions kind="policy" policy={row} />;
                return "";
              }}
            />
          </DataTable.Panel>
        ) : (
          <Placeholder state="error" variant="panel" title="Could not load rules" description={policiesResult.error.message} />
        )}

        {identitiesResult.ok ? (
          <DataTable.Panel class="overflow-hidden">
            <DataTable.Header
              title="Protected identities"
              subtitle={
                identitySearch
                  ? `${filteredIdentities.length} of ${identities.length} protected identities`
                  : `${identities.length} protected ${identities.length === 1 ? "identity" : "identities"}`
              }
            />
            <DataTable.Controls>
              <SearchBar
                action={securitySearchAction({ reports: reportSearch, rules: policySearch })}
                value={identitySearch}
                param="identities"
                pageParam="identities-page"
                placeholder="Search names or allowed domains..."
                ariaLabel="Search protected Mail identities"
              />
            </DataTable.Controls>
            <DataTable
              rows={filteredIdentities}
              columns={identityColumns}
              getRowId={(row) => row.id}
              hoverRows
              class="overflow-x-auto"
              scrollPreserveKey="mail-admin-security-identities"
              empty={identitySearch ? `No protected identities matching "${identitySearch}".` : "No protected sender identities."}
              renderCell={({ row, col }) => {
                if (col.id === "name") return <span class="font-medium text-primary">{row.name}</span>;
                if (col.id === "domains") return <span class="font-mono text-xs text-secondary">{row.allowedDomains.join(", ")}</span>;
                if (col.id === "actions") return <MailAdminSecurityActions kind="protected-identity" identity={row} />;
                return "";
              }}
            />
          </DataTable.Panel>
        ) : (
          <Placeholder
            state="error"
            variant="panel"
            title="Could not load protected identities"
            description={identitiesResult.error.message}
          />
        )}
      </div>
    </AdminLayout>
  );
});
