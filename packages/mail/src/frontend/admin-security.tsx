import { dates } from "@k2b/stdlib";
import { ButtonLink, DataTable, type DataTableColumn, Placeholder, StatCell, StatGrid, StatusBadge } from "@k2b/ui";
import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import type { MailProtectedIdentity, MailSecurityPolicy, MailSecurityReport } from "../security-contracts";
import { type MailRequestContext, security } from "../service";
import {
  MailAdminPolicyActions,
  MailAdminProtectedIdentityActions,
  MailAdminReportActions,
  MailAdminSecurityToolbar,
} from "./_components/MailAdminSecurityActions.island";

export default ssr<AuthContext>(async (c) => {
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
          <MailAdminSecurityToolbar trustedAuthservIds={settingsResult.ok ? settingsResult.data.trustedAuthservIds : null} />
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

        {reportsResult.ok ? (
          <section class="paper overflow-hidden">
            <div class="px-3 py-3">
              <h2 class="text-xs font-semibold text-primary">Reported messages</h2>
              <p class="text-[10px] text-dimmed">Newest activity first</p>
            </div>
            <DataTable
              rows={reports}
              columns={reportColumns}
              getRowId={(row) => row.id}
              hoverRows
              empty="No messages have been reported."
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
                if (col.id === "actions") return <MailAdminReportActions report={row} />;
                return "";
              }}
            />
          </section>
        ) : (
          <Placeholder state="error" variant="panel" title="Could not load reports" description={reportsResult.error.message} />
        )}

        {policiesResult.ok ? (
          <section class="paper overflow-hidden">
            <div class="px-3 py-3">
              <h2 class="text-xs font-semibold text-primary">Organization rules</h2>
              <p class="text-[10px] text-dimmed">Sender addresses and normalized domain decisions</p>
            </div>
            <DataTable
              rows={policies}
              columns={policyColumns}
              getRowId={(row) => row.id}
              hoverRows
              empty="No organization-wide Mail security rules."
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
                if (col.id === "actions") return <MailAdminPolicyActions policy={row} />;
                return "";
              }}
            />
          </section>
        ) : (
          <Placeholder state="error" variant="panel" title="Could not load rules" description={policiesResult.error.message} />
        )}

        {identitiesResult.ok ? (
          <section class="paper overflow-hidden">
            <div class="px-3 py-3">
              <h2 class="text-xs font-semibold text-primary">Protected identities</h2>
              <p class="text-[10px] text-dimmed">Warn when an exact visible name arrives from an unexpected domain</p>
            </div>
            <DataTable
              rows={identities}
              columns={identityColumns}
              getRowId={(row) => row.id}
              hoverRows
              empty="No protected sender identities."
              renderCell={({ row, col }) => {
                if (col.id === "name") return <span class="font-medium text-primary">{row.name}</span>;
                if (col.id === "domains") return <span class="font-mono text-xs text-secondary">{row.allowedDomains.join(", ")}</span>;
                if (col.id === "actions") return <MailAdminProtectedIdentityActions identity={row} />;
                return "";
              }}
            />
          </section>
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
