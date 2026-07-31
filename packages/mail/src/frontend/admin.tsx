import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, Placeholder, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { dates } from "@k2b/stdlib";
import { ssr } from "../config";
import type { PlatformMailboxOperationSummary } from "../contracts";
import { mailHelp } from "../help";
import { type MailRequestContext, operations, storageObservability } from "../service";
import MailLayoutHelp from "./_components/help/MailLayoutHelp.island";
import MailAdminMailboxActions from "./_components/MailAdminMailboxActions.island";
import MailAdminStorageActions from "./_components/MailAdminStorageActions.island";

const PAGE_SIZE = 50;

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export default ssr<AuthContext>(async (c) => {
  const dateConfig = getDateConfig(c);
  const context: MailRequestContext = {
    actor: c.get("actor"),
    accessSubject: c.get("accessSubject"),
    requestId: c.req.header("x-request-id") ?? null,
  };
  const query = (c.req.query("q") ?? "").trim();
  const cursor = c.req.query("cursor") || undefined;
  const [storageResult, operationsResult] = await Promise.all([
    storageObservability.getMailStorageSummary(context),
    operations.getPlatformMailOperations(context, {
      q: query || undefined,
      cursor,
      limit: PAGE_SIZE,
    }),
  ]);
  const storage = storageResult.ok ? storageResult.data : null;
  const logicalStorage = storage?.mailboxes.reduce((total, mailbox) => total + mailbox.logicalTotalBytes, 0) ?? null;
  const mailboxes = operationsResult.ok ? operationsResult.data.mailboxes : [];
  const columns: DataTableColumn<PlatformMailboxOperationSummary>[] = [
    { id: "mailbox", header: "Mailbox", value: (row) => row.mailboxName },
    { id: "health", header: "Health", value: (row) => row.health },
    { id: "sync", header: "Last sync", value: (row) => row.sync.lastAt ?? "" },
    { id: "access", header: "Access", value: (row) => row.access.total },
    {
      id: "storage",
      header: "Storage",
      value: (row) => row.storage?.logicalTotalBytes ?? -1,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "attention",
      header: "Attention",
      value: (row) => row.attentionCount,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    { id: "actions", header: "Settings", headerClass: "w-px text-right", cellClass: "text-right" },
  ];

  return () => (
    <AdminLayout c={c} title="Mail">
      <MailLayoutHelp documents={mailHelp.manifest} />
      <div class="app-rows" data-scroll-preserve="mail-admin">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 class="text-base font-semibold text-primary">Mailboxes</h1>
            <p class="text-xs text-dimmed">
              Recover access and inspect redacted operational status without opening message or attachment content.
            </p>
          </div>
          <MailAdminStorageActions />
        </div>

        <StatGrid columns={6}>
          <StatCell
            label="Mailboxes"
            value={operationsResult.ok ? operationsResult.data.mailboxCount : "Unavailable"}
            sub="active"
            accent={{ tone: "blue", icon: "ti ti-mail" }}
          />
          <StatCell
            label="Need owner"
            value={operationsResult.ok ? operationsResult.data.withoutAdministratorCount : "Unavailable"}
            sub="no administrator"
            valueClass={operationsResult.ok && operationsResult.data.withoutAdministratorCount > 0 ? "text-red-500" : "text-primary"}
            accent={
              operationsResult.ok && operationsResult.data.withoutAdministratorCount > 0
                ? { tone: "red", icon: "ti ti-user-exclamation" }
                : undefined
            }
          />
          <StatCell
            label="Need attention"
            value={operationsResult.ok ? operationsResult.data.attentionCount : "Unavailable"}
            sub="failed or ambiguous commands"
            accent={{ tone: "amber", icon: "ti ti-alert-triangle" }}
          />
          <StatCell
            label="Logical storage"
            value={logicalStorage == null ? "Unavailable" : formatBytes(logicalStorage)}
            sub={storage?.calculatedAt ? `updated ${dates.formatDateTimeRelative(storage.calculatedAt, dateConfig)}` : "not reconciled"}
            accent={{ tone: "zinc", icon: "ti ti-database" }}
          />
          <StatCell
            label="Mail relations"
            value={storage ? formatBytes(storage.physicalDatabaseBytes) : "Unavailable"}
            sub="physical database"
          />
          <StatCell
            label="Blob bytes"
            value={storage ? formatBytes(storage.physicalBlobBytes) : "Unavailable"}
            sub="physical content store"
          />
        </StatGrid>

        {operationsResult.ok ? (
          <section class="paper overflow-hidden">
            <div class="flex flex-col gap-2 px-3 py-3">
              <div>
                <h2 class="text-xs font-semibold text-primary">Active mailboxes</h2>
                <p class="text-[10px] text-dimmed">
                  {mailboxes.length} of {operationsResult.data.mailboxCount} mailboxes
                </p>
              </div>
              <SearchBar action="/admin/mail" value={query} placeholder="Search mailboxes by name or id..." ariaLabel="Search mailboxes" />
            </div>
            <DataTable
              rows={mailboxes}
              columns={columns}
              getRowId={(row) => row.mailboxId}
              hoverRows
              class="overflow-x-auto"
              empty={query ? `No mailboxes matching "${query}".` : "No active Mail mailboxes."}
              renderCell={({ row, col }) => {
                if (col.id === "mailbox")
                  return (
                    <div class="flex min-w-52 items-center gap-2">
                      <i class="ti ti-mail text-dimmed" aria-hidden="true" />
                      <div class="min-w-0">
                        <p class="truncate font-medium text-primary">{row.mailboxName}</p>
                        <p class="truncate font-mono text-[10px] text-dimmed">{row.mailboxId}</p>
                      </div>
                    </div>
                  );
                if (col.id === "health") return <span class="badge whitespace-nowrap">{row.health.replaceAll("_", " ")}</span>;
                if (col.id === "sync")
                  return row.sync.lastAt ? (
                    <time
                      class="whitespace-nowrap text-secondary"
                      dateTime={row.sync.lastAt}
                      title={dates.formatDateTime(row.sync.lastAt, dateConfig)}
                    >
                      {dates.formatDateTimeRelative(row.sync.lastAt, dateConfig)}
                    </time>
                  ) : (
                    <span class="text-dimmed">Never</span>
                  );
                if (col.id === "access")
                  return (
                    <span
                      class={`whitespace-nowrap text-xs ${row.access.administrators === 0 ? "font-medium text-red-500" : "text-secondary"}`}
                    >
                      {row.access.administrators} admin · {row.access.total} total
                    </span>
                  );
                if (col.id === "storage")
                  return <span class="tabular-nums text-secondary">{row.storage ? formatBytes(row.storage.logicalTotalBytes) : "—"}</span>;
                if (col.id === "attention")
                  return (
                    <span
                      class={`tabular-nums ${row.attentionCount > 0 ? "font-medium text-amber-600 dark:text-amber-400" : "text-secondary"}`}
                    >
                      {row.attentionCount}
                    </span>
                  );
                if (col.id === "actions") return <MailAdminMailboxActions mailboxId={row.mailboxId} mailboxName={row.mailboxName} />;
                return "";
              }}
            />
            {operationsResult.data.nextCursor ? (
              <div class="flex justify-center px-3 py-3">
                <a
                  class="btn-secondary btn-sm"
                  href={`/admin/mail?${new URLSearchParams({
                    ...(query ? { q: query } : {}),
                    cursor: operationsResult.data.nextCursor,
                  }).toString()}`}
                >
                  Next page
                </a>
              </div>
            ) : null}
          </section>
        ) : (
          <Placeholder state="error" variant="panel" title="Could not load Mail operations" description={operationsResult.error.message} />
        )}

        {!storageResult.ok ? (
          <Placeholder state="error" variant="panel" title="Could not load Mail storage" description={storageResult.error.message} />
        ) : null}
      </div>
    </AdminLayout>
  );
});
