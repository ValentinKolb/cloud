import { type AuthContext, getDateConfig } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { DataTable, type DataTableColumn, Placeholder, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { ssr } from "../config";
import type { MailboxStorageUsage, PlatformMailboxOperationSummary } from "../contracts";
import { mailHelp } from "../help";
import { type MailRequestContext, operations, storageObservability } from "../service";
import MailLayoutHelp from "./_components/help/MailLayoutHelp.island";
import MailAdminStorageActions from "./_components/MailAdminStorageActions.island";

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
  const operationsCursor = c.req.query("cursor") || undefined;
  const [storageResult, operationsResult] = await Promise.all([
    storageObservability.getMailStorageSummary(context),
    operations.getPlatformMailOperations(context, {
      q: query || undefined,
      cursor: operationsCursor,
      limit: 10,
    }),
  ]);
  const summary = storageResult.ok ? storageResult.data : null;
  const normalizedQuery = query.toLocaleLowerCase();
  const sort = c.req.query("sort") === "name" ? "name" : "total";
  const matchesQuery = (name: string) => !normalizedQuery || name.toLocaleLowerCase().includes(normalizedQuery);
  const operatorMailboxes = operationsResult.ok ? operationsResult.data.mailboxes : [];
  const storageMailboxes = storageResult.ok
    ? storageResult.data.mailboxes
        .filter((mailbox) => matchesQuery(mailbox.mailboxName))
        .toSorted((left, right) =>
          sort === "name"
            ? left.mailboxName.localeCompare(right.mailboxName)
            : right.logicalTotalBytes - left.logicalTotalBytes || left.mailboxName.localeCompare(right.mailboxName),
        )
    : [];
  const columns: DataTableColumn<MailboxStorageUsage>[] = [
    { id: "mailbox", header: "Mailbox", value: (row) => row.mailboxName },
    {
      id: "messages",
      header: "Messages",
      value: (row) => row.messageCount,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "mail",
      header: "Mail bytes",
      value: (row) => row.messageBytes,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "received",
      header: "Received attachments",
      value: (row) => row.receivedAttachmentBytes,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "drafts",
      header: "Draft uploads",
      value: (row) => row.draftAttachmentBytes,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "links",
      header: "Publicly shared",
      value: (row) => row.externalLinkBytes,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "total",
      header: "Logical total",
      value: (row) => row.logicalTotalBytes,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "calculated",
      header: "Calculated",
      value: (row) => row.calculatedAt,
    },
  ];
  const operatorColumns: DataTableColumn<PlatformMailboxOperationSummary>[] = [
    { id: "mailbox", header: "Mailbox", value: (row) => row.mailboxName },
    { id: "health", header: "Health", value: (row) => row.health },
    {
      id: "lag",
      header: "Sync lag",
      value: (row) => row.sync.lagSeconds ?? -1,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "coverage",
      header: "Projection coverage",
      value: (row) => row.coverage.search.covered,
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
  ];

  return () => (
    <AdminLayout c={c} title="Mail">
      <MailLayoutHelp documents={mailHelp.manifest} />
      <div class="app-rows" data-scroll-preserve="mail-admin-storage">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 class="text-base font-semibold text-primary">Mail operations</h1>
            <p class="text-xs text-dimmed">Redacted transport, queue, and projection status without message or attachment content.</p>
            <p class="text-xs text-dimmed">
              Mail bytes are provider-reported and already include received attachments. Publicly shared bytes reference existing files;
              logical total adds only mail and draft uploads.
            </p>
          </div>
          <MailAdminStorageActions />
        </div>
        <StatGrid columns={4}>
          <StatCell
            label="Mailboxes"
            value={summary ? summary.mailboxes.length : "Unavailable"}
            accent={{ tone: "blue", icon: "ti ti-mail" }}
          />
          <StatCell
            label="Need attention"
            value={operationsResult.ok ? operationsResult.data.attentionCount : "Unavailable"}
            accent={{ tone: "amber", icon: "ti ti-alert-triangle" }}
          />
          <StatCell
            label="Mail relations"
            value={summary ? formatBytes(summary.physicalDatabaseBytes) : "Unavailable"}
            accent={{ tone: "zinc", icon: "ti ti-database" }}
          />
          <StatCell
            label="Blob bytes"
            value={summary ? formatBytes(summary.physicalBlobBytes) : "Unavailable"}
            accent={{ tone: "zinc", icon: "ti ti-paperclip" }}
          />
        </StatGrid>
        <form action="/admin/mail" method="get" class="paper flex flex-wrap items-end gap-2 p-2" role="search">
          <label class="min-w-56 flex-1 text-xs font-medium text-secondary">
            Search mailboxes
            <input class="input mt-1 w-full" type="search" name="q" value={query} placeholder="Mailbox name" />
          </label>
          <label class="w-48 text-xs font-medium text-secondary">
            Storage order
            <select class="input mt-1 w-full" name="sort">
              <option value="total" selected={sort === "total"}>
                Largest first
              </option>
              <option value="name" selected={sort === "name"}>
                Mailbox name
              </option>
            </select>
          </label>
          <button type="submit" class="btn-secondary btn-sm">
            <i class="ti ti-search" aria-hidden="true" /> Apply
          </button>
        </form>
        {operationsResult.ok ? (
          <section class="paper overflow-hidden">
            <DataTable
              rows={operatorMailboxes}
              columns={operatorColumns}
              getRowId={(row) => row.mailboxId}
              empty={query ? "No matching active Mail mailboxes." : "No active Mail mailboxes."}
              renderCell={({ row, col }) => {
                if (col.id === "mailbox")
                  return (
                    <a class="font-medium text-primary hover:underline" href={`/app/mail/${row.mailboxId}`}>
                      {row.mailboxName}
                    </a>
                  );
                if (col.id === "health") return <span class="badge">{row.health.replaceAll("_", " ")}</span>;
                if (col.id === "lag")
                  return (
                    <span class="tabular-nums text-secondary">{row.sync.lagSeconds == null ? "Never" : `${row.sync.lagSeconds}s`}</span>
                  );
                if (col.id === "coverage")
                  return (
                    <span class="tabular-nums text-secondary">
                      {row.coverage.search.covered}/{row.coverage.search.total}
                    </span>
                  );
                return <span class="tabular-nums text-secondary">{row.attentionCount}</span>;
              }}
            />
            {operationsResult.data.nextCursor ? (
              <div class="flex justify-center px-2 pb-2 pt-4">
                <a
                  class="btn-secondary btn-sm"
                  href={`/admin/mail?${new URLSearchParams({
                    ...(query ? { q: query } : {}),
                    sort,
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
        <div class="flex items-end justify-between gap-2 pt-2">
          <div>
            <h2 class="text-sm font-semibold text-primary">Storage</h2>
            <p class="text-xs text-dimmed">
              {!storageResult.ok
                ? "Unavailable."
                : summary?.calculatedAt
                  ? `Updated ${dates.formatDateTime(summary.calculatedAt, dateConfig)}.`
                  : "Not reconciled yet."}
            </p>
          </div>
        </div>
        {storageResult.ok ? (
          <section class="paper overflow-hidden">
            <DataTable
              rows={storageMailboxes}
              columns={columns}
              getRowId={(row) => row.mailboxId}
              empty={query ? "No matching reconciled Mail storage data." : "No reconciled Mail storage data."}
              renderCell={({ row, col }) => {
                if (col.id === "mailbox")
                  return (
                    <a class="font-medium text-primary hover:underline" href={`/app/mail/${row.mailboxId}`}>
                      {row.mailboxName}
                    </a>
                  );
                if (col.id === "messages") return <span class="tabular-nums text-secondary">{row.messageCount}</span>;
                if (col.id === "calculated")
                  return (
                    <time class="whitespace-nowrap text-secondary" dateTime={row.calculatedAt}>
                      {dates.formatDateTime(row.calculatedAt, dateConfig)}
                    </time>
                  );
                const value =
                  col.id === "mail"
                    ? row.messageBytes
                    : col.id === "received"
                      ? row.receivedAttachmentBytes
                      : col.id === "drafts"
                        ? row.draftAttachmentBytes
                        : col.id === "links"
                          ? row.externalLinkBytes
                          : row.logicalTotalBytes;
                return <span class="tabular-nums text-secondary">{formatBytes(Number(value))}</span>;
              }}
            />
          </section>
        ) : (
          <Placeholder state="error" variant="panel" title="Could not load Mail storage" description={storageResult.error.message} />
        )}
      </div>
    </AdminLayout>
  );
});
