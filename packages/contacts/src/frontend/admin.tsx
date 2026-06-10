import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, Pagination, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import { contactsService } from "../service";
import AdminBookActions from "./_components/AdminBookActions.island";

const PER_PAGE = 100;

export default ssr<AuthContext>(async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const pageRaw = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const [books, summary] = await Promise.all([
    contactsService.book.admin.list({
      pagination: { page, perPage: PER_PAGE },
      filter: { query: search || undefined },
    }),
    contactsService.book.admin.summary({ filter: { query: search || undefined } }),
  ]);

  const totalPages = Math.ceil(books.total / books.perPage);
  const baseUrl = search ? `/admin/contacts?search=${encodeURIComponent(search)}&page=` : "/admin/contacts?page=";
  type BookRow = (typeof books.items)[number];
  const columns: DataTableColumn<BookRow>[] = [
    { id: "book", header: "Book", value: (book) => book.name },
    { id: "description", header: "Description", value: (book) => book.description, cellClass: "max-w-xl" },
    { id: "contacts", header: "Contacts", value: (book) => book.contactCount, cellClass: "whitespace-nowrap tabular-nums" },
    { id: "permissions", header: "Permissions", value: (book) => book.permissionCount, cellClass: "whitespace-nowrap" },
    {
      id: "actions",
      header: "Settings",
      headerClass: "w-px text-right",
      cellClass: "text-right whitespace-nowrap",
    },
  ];

  return () => (
    <AdminLayout c={c} title="Contacts" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-contacts-title">
            <h1 class="text-base font-semibold text-primary">Contacts</h1>
          </div>

          <StatGrid columns={4}>
            <StatCell
              label="Books"
              value={summary.total}
              sub={search ? "filtered" : "manual books"}
              accent={{ tone: "blue", icon: "ti ti-cube" }}
            />
            <StatCell
              label="Orphaned"
              value={summary.orphaned}
              sub={summary.orphaned > 0 ? "no access" : "all reachable"}
              valueClass={summary.orphaned > 0 ? "text-red-500" : "text-primary"}
              accent={summary.orphaned > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
            />
            <StatCell label="Access entries" value={summary.totalPermissions} sub={search ? "in search" : "across all books"} />
            <StatCell label="Contacts" value={summary.totalContacts} sub={search ? "in search" : "manual contacts"} />
          </StatGrid>

          <section class="paper overflow-hidden" style="view-transition-name: admin-contacts-table">
            <div class="flex flex-col gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
              <div>
                <h2 class="text-xs font-semibold text-primary">Books</h2>
                <p class="text-[10px] text-dimmed">
                  {books.items.length} of {books.total} contact books
                </p>
              </div>
              <SearchBar
                action="/admin/contacts"
                value={search}
                placeholder="Search contact books by name..."
                ariaLabel="Search contact books"
              />
            </div>
            <DataTable
              rows={books.items}
              columns={columns}
              getRowId={(book) => book.id}
              hoverRows
              class="overflow-x-auto"
              empty={search ? `No contact books matching "${search}".` : "No contact books found."}
              renderCell={({ row: book, col }) => {
                if (col.id === "book") {
                  return (
                    <div class="flex min-w-52 items-center gap-2">
                      <i class="ti ti-cube text-dimmed" />
                      <span class="truncate font-medium text-primary">{book.name}</span>
                    </div>
                  );
                }
                if (col.id === "description") {
                  return (
                    <span class="block truncate" title={book.description ?? "No description"}>
                      {book.description || <span class="italic">No description</span>}
                    </span>
                  );
                }
                if (col.id === "contacts") return <span class="text-xs text-dimmed">{book.contactCount}</span>;
                if (col.id === "permissions") {
                  return (
                    <span
                      class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        book.permissionCount === 0
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {book.permissionCount} access {book.permissionCount === 1 ? "entry" : "entries"}
                    </span>
                  );
                }
                if (col.id === "actions") return <AdminBookActions bookId={book.id} bookName={book.name} />;
                return "";
              }}
            />
          </section>

          <Pagination currentPage={books.page} totalPages={totalPages} baseUrl={baseUrl} />
        </div>
      </div>
    </AdminLayout>
  );
});
