import { ssr } from "../../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { AppWorkspace, Pagination } from "@valentinkolb/cloud/ui";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
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
  const bookId = c.req.param("bookId") ?? "";
  const search = c.req.query("search") ?? "";
  const page = parsePage(c.req.query("page"));
  const perPage = 100;
  const selectedContactIdFromUrl = c.req.query("contact") ?? null;
  const activeTagId = c.req.query("tag_id") ?? null;
  const [book, booksResult] = await Promise.all([
    contactsService.book.get({ id: bookId }),
    contactsService.book.list({ userId: user.id, groups: user.memberofGroupIds }),
  ]);
  if (!book) {
    return () => (
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
    return () => (
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
  const [contactsResult, bookTags] = await Promise.all([
    contactsService.contact.list({
      bookId,
      pagination: { page, perPage },
      filter: {
        query: search.trim() || undefined,
        tagIds: activeTagId ? [activeTagId] : undefined,
      },
    }),
    contactsService.tag.list({ bookId }),
  ]);
  const contacts = contactsResult.items;
  let selectedContact =
    selectedContactIdFromUrl && contacts.find((contact) => contact.id === selectedContactIdFromUrl)
      ? (contacts.find((contact) => contact.id === selectedContactIdFromUrl) ?? null)
      : null;
  if (!selectedContact && selectedContactIdFromUrl) {
    selectedContact = await contactsService.contact.get({ bookId, id: selectedContactIdFromUrl });
  }
  const initialNotes = selectedContact ? await contactsService.contact.notes.list({ bookId, contactId: selectedContact.id }) : [];
  const bookNames = Object.fromEntries(books.map((entry) => [entry.id, entry.name]));
  const totalPages = Math.max(1, Math.ceil(contactsResult.total / perPage));
  const paginationBaseUrl = buildPaginationBaseUrl(`/app/contacts/${bookId}`, search);
  const initialSelectedContactId = selectedContact?.id ?? selectedContactIdFromUrl ?? null;
  const initialSelectedBookId = selectedContact ? bookId : selectedContactIdFromUrl ? bookId : null;
  const hasDesktopDetailSelection = Boolean(selectedContact);
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Contacts", href: "/app/contacts" }, { title: book.name }]}>
      <AppWorkspace>
        <ContactsSidebar
          books={books}
          active={book.id}
          adminBookIds={adminBookIds}
          writableBooks={writableBooks}
          defaultCreateBookId={canWrite ? book.id : (writableBooks[0]?.id ?? null)}
        />

        <AppWorkspace.Main>
          <div style="view-transition-name: contacts-page-header">
            <SearchBar value={search} />
          </div>
          {bookTags.length > 0 && (
            <div class="flex flex-wrap items-center gap-1.5 pt-2">
              <a
                href={search.trim() ? `/app/contacts/${bookId}?search=${encodeURIComponent(search.trim())}` : `/app/contacts/${bookId}`}
                class={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  activeTagId
                    ? "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-primary dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                }`}
              >
                All
              </a>
              {bookTags.map((tag) => {
                const active = activeTagId === tag.id;
                const params = new URLSearchParams();
                if (search.trim()) params.set("search", search.trim());
                params.set("tag_id", tag.id);
                const href = `/app/contacts/${bookId}?${params.toString()}`;
                return (
                  <a
                    href={href}
                    class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-opacity"
                    style={`background-color: ${tag.color}${active ? "33" : "1f"}; color: ${tag.color}${active ? "" : "cc"}; ${active ? "outline: 1.5px solid " + tag.color + ";" : ""}`}
                  >
                    <span class="h-1.5 w-1.5 rounded-full" style={`background-color: ${tag.color}`} />
                    {tag.name}
                  </a>
                );
              })}
            </div>
          )}
          <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2" data-scroll-preserve={`contacts-main-${book.id}`}>
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
        </AppWorkspace.Main>

        <AppWorkspace.Detail
          id="contacts-detail-panel"
          open={hasDesktopDetailSelection}
          width="lg"
          viewTransitionName="contacts-detail-panel-shell"
        >
          <ContactDetailPanel
            initialContact={selectedContact}
            initialContactId={initialSelectedContactId}
            initialBookId={initialSelectedBookId}
            initialNotes={initialNotes}
            contacts={contacts}
            bookNames={bookNames}
            writableBooks={writableBooks}
            adminBookIds={adminBookIds}
            currentUserId={user.id}
            showEmpty={false}
          />
        </AppWorkspace.Detail>
        <DesktopDetailLayoutSync detailContainerId="contacts-detail-panel" />
      </AppWorkspace>
    </Layout>
  );
});
