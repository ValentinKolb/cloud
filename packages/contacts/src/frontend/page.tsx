import { ssr } from "../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Pagination } from "@valentinkolb/cloud/ui";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { contactsService } from "../service";
import ContactsSidebar from "./_components/ContactsSidebar";
import ContactsList from "./_components/ContactsList.island";
import ContactDetailPanel from "./_components/ContactDetailPanel.island";
import DesktopDetailLayoutSync from "./_components/DesktopDetailLayoutSync.island";
const parsePage = (value: string | undefined): number => {
  const parsed = Number(value ?? "1");
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
};
const buildPaginationBaseUrl = (config: { basePath: string; search: string }): string => {
  const params = new URLSearchParams();
  if (config.search.trim()) params.set("search", config.search.trim());
  const query = params.toString();
  return query ? `${config.basePath}?${query}&page=` : `${config.basePath}?page=`;
};
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const search = c.req.query("search") ?? "";
  const page = parsePage(c.req.query("page"));
  const perPage = 100;
  const selectedContactIdFromUrl = c.req.query("contact") ?? null;
  const selectedBookIdFromUrl = c.req.query("contactBook") ?? null;
  const [booksResult, contactsResult] = await Promise.all([
    contactsService.book.list({ userId: user.id, groups: user.memberofGroupIds }),
    contactsService.contact.search({
      userId: user.id,
      groups: user.memberofGroupIds,
      pagination: { page, perPage },
      filter: { query: search.trim() || undefined, includeSystem: false },
    }),
  ]);
  const books = booksResult.items;
  const contacts = contactsResult.items;
  const selectedFromPage =
    selectedContactIdFromUrl && selectedBookIdFromUrl
      ? (contacts.find((contact) => contact.id === selectedContactIdFromUrl && contact.bookId === selectedBookIdFromUrl) ?? null)
      : null;
  let selectedContact = selectedFromPage;
  if (!selectedContact && selectedContactIdFromUrl && selectedBookIdFromUrl) {
    const hasReadAccess = await contactsService.book.permission.canAccess({
      bookId: selectedBookIdFromUrl,
      userId: user.id,
      userGroups: user.memberofGroupIds,
      requiredLevel: "read",
    });
    if (hasReadAccess) {
      selectedContact = await contactsService.contact.get({ bookId: selectedBookIdFromUrl, id: selectedContactIdFromUrl });
    }
  }
  const manualBooks = books.filter((book) => !book.isSystem);
  const permissionEntries = await Promise.all(
    manualBooks.map(async (book) => ({
      book,
      permission: await contactsService.book.permission.get({ bookId: book.id, userId: user.id, userGroups: user.memberofGroupIds }),
    })),
  );
  const adminBookIds = permissionEntries.filter((entry) => entry.permission === "admin").map((entry) => entry.book.id);
  const writableBooks = permissionEntries
    .filter((entry) => entry.permission === "write" || entry.permission === "admin")
    .map((entry) => ({ id: entry.book.id, name: entry.book.name }));
  const bookNames = Object.fromEntries(books.map((book) => [book.id, book.name]));
  const totalPages = Math.max(1, Math.ceil(contactsResult.total / perPage));
  const paginationBaseUrl = buildPaginationBaseUrl({ basePath: "/app/contacts", search });
  const initialSelectedContactId = selectedContact?.id ?? selectedContactIdFromUrl;
  const initialSelectedBookId = selectedContact?.bookId ?? selectedBookIdFromUrl;
  const hasDesktopDetailSelection = Boolean(selectedContact);
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Contacts" }]}>
      <div class="app-cols h-full">
        <ContactsSidebar
          books={books}
          active="all"
          adminBookIds={adminBookIds}
          writableBooks={writableBooks}
          defaultCreateBookId={writableBooks[0]?.id ?? null}
        />

        <div class="order-3 lg:order-2 flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <div style="view-transition-name: contacts-page-header">
            <SearchBar value={search} />
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
            <div class="pt-2" style="view-transition-name: contacts-list-container">
              <ContactsList
                contacts={contacts}
                initialSelectedContactId={initialSelectedContactId}
                initialSelectedBookId={initialSelectedBookId}
              />
            </div>
            <div class="pb-4">
              <Pagination currentPage={contactsResult.page} totalPages={totalPages} baseUrl={paginationBaseUrl} />
            </div>
          </div>
        </div>

        <div
          id="contacts-detail-panel"
          class={`${hasDesktopDetailSelection ? "flex" : "hidden"} order-2 lg:order-3 flex-col min-h-0 overflow-hidden w-full shrink-0 lg:h-full lg:w-[30rem] xl:w-[34rem]`}
          style="view-transition-name: contacts-detail-panel-shell"
        >
          <ContactDetailPanel
            initialContact={selectedContact}
            initialContactId={initialSelectedContactId}
            initialBookId={initialSelectedBookId}
            contacts={contacts}
            bookNames={bookNames}
            writableBooks={writableBooks}
            showEmpty={false}
          />
        </div>
        <DesktopDetailLayoutSync detailContainerId="contacts-detail-panel" />
      </div>
    </Layout>
  );
});
