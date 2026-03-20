import { ssr } from "@valentinkolb/cloud/core/config";
import type { AuthContext } from "@valentinkolb/cloud/lib/server";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { contactsService } from "../../service";
import ContactsSidebar from "../_components/ContactsSidebar";
import ContactsList from "../_components/ContactsList.island";
import ContactDetailPanel from "../_components/ContactDetailPanel.island";
import DesktopDetailLayoutSync from "../_components/DesktopDetailLayoutSync.island";
const parsePage = (value: string | undefined): number => {
  const parsed = Number(value ?? "1");
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
};
const buildPaginationBaseUrl = (basePath: string, search: string) => {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  const query = params.toString();
  return query ? `${basePath}?${query}&page=` : `${basePath}?page=`;
};
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const bookId = c.req.param("bookId");
  const search = c.req.query("search") ?? "";
  const page = parsePage(c.req.query("page"));
  const perPage = 100;
  const selectedContactIdFromUrl = c.req.query("contact") ?? null;
  const [book, booksResult] = await Promise.all([
    contactsService.book.get({ id: bookId }),
    contactsService.book.list({ userId: user.id, groups: user.memberofGroupIds }),
  ]);
  if (!book) {
    return (
      <Layout c={c} title="Not Found">
        {" "}
        <div class="max-w-md mx-auto mt-16">
          {" "}
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            {" "}
            <i class="ti ti-alert-circle text-sm" /> Book not found{" "}
          </div>{" "}
        </div>{" "}
      </Layout>
    );
  }
  const hasReadAccess = await contactsService.book.permission.canAccess({
    bookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel: "read",
  });
  if (!hasReadAccess) {
    return (
      <Layout c={c} title="Access Denied">
        {" "}
        <div class="max-w-md mx-auto mt-16">
          {" "}
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            {" "}
            <i class="ti ti-lock text-sm" /> You don&apos;t have access to this contact book{" "}
          </div>{" "}
        </div>{" "}
      </Layout>
    );
  }
  const books = booksResult.items;
  const manualBooks = books.filter((entry) => !entry.isSystem);
  const permissionEntries = await Promise.all(
    manualBooks.map(async (entry) => ({
      book: entry,
      permission: await contactsService.book.permission.get({ bookId: entry.id, userId: user.id, userGroups: user.memberofGroupIds }),
    })),
  );
  const writableBooks = permissionEntries
    .filter((entry) => entry.permission === "write" || entry.permission === "admin")
    .map((entry) => ({ id: entry.book.id, name: entry.book.name }));
  const adminBookIds = permissionEntries.filter((entry) => entry.permission === "admin").map((entry) => entry.book.id);
  const currentPermission = permissionEntries.find((entry) => entry.book.id === book.id)?.permission ?? "read";
  const canWrite = currentPermission === "write" || currentPermission === "admin";
  const contactsResult = await contactsService.contact.list({
    bookId,
    pagination: { page, perPage },
    filter: { query: search.trim() || undefined },
  });
  const contacts = contactsResult.items;
  let selectedContact =
    selectedContactIdFromUrl && contacts.find((contact) => contact.id === selectedContactIdFromUrl)
      ? (contacts.find((contact) => contact.id === selectedContactIdFromUrl) ?? null)
      : null;
  if (!selectedContact && selectedContactIdFromUrl) {
    selectedContact = await contactsService.contact.get({ bookId, id: selectedContactIdFromUrl });
  }
  const bookNames = Object.fromEntries(books.map((entry) => [entry.id, entry.name]));
  const totalPages = Math.max(1, Math.ceil(contactsResult.total / perPage));
  const paginationBaseUrl = buildPaginationBaseUrl(`/app/contacts/${bookId}`, search);
  const initialSelectedContactId = selectedContact?.id ?? selectedContactIdFromUrl ?? null;
  const initialSelectedBookId = selectedContact ? bookId : selectedContactIdFromUrl ? bookId : null;
  const hasDesktopDetailSelection = Boolean(selectedContact);
  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Contacts", href: "/app/contacts" }, { title: book.name }]}>
      <div class="app-cols h-full">
        <ContactsSidebar
          books={books}
          active={book.id}
          adminBookIds={adminBookIds}
          writableBooks={writableBooks}
          defaultCreateBookId={canWrite ? book.id : (writableBooks[0]?.id ?? null)}
        />

        <div class="order-3 lg:order-2 flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          <div style="view-transition-name: contacts-page-header">
            <SearchBar value={search} />
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
            <div class="pt-1" style="view-transition-name: contacts-list-container">
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
