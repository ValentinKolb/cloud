import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { AppWorkspace, Pagination } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import { contactsService } from "../../service";
import ContactDetailPanel from "../_components/ContactDetailPanel.island";
import ContactTagChip from "../_components/ContactTagChip";
import ContactsLayoutHelp from "../_components/help/ContactsLayoutHelp.island";
import ContactsList from "../_components/ContactsList.island";
import ContactsSidebar from "../_components/ContactsSidebar";
import DesktopDetailLayoutSync from "../_components/DesktopDetailLayoutSync.island";
import {
  CONTACTS_PER_PAGE,
  buildContactsPaginationBaseUrl,
  loadContactBookPermissions,
  parseContactsPage,
  permissionForBook,
  resolveSelectedContact,
} from "../page-data";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const bookId = c.req.param("bookId") ?? "";
  const search = c.req.query("search") ?? "";
  const page = parseContactsPage(c.req.query("page"));
  const perPage = CONTACTS_PER_PAGE;
  const selectedContactIdFromUrl = c.req.query("contact") ?? null;
  const activeTagId = c.req.query("tag_id") ?? null;
  const [book, booksResult] = await Promise.all([
    contactsService.book.get({ id: bookId }),
    contactsService.book.list({ userId: user.id, groups: user.memberofGroupIds }),
  ]);
  if (!book) {
    return () => (
      <Layout c={c} title="Not Found">
        <div class="mx-auto mt-16 max-w-md">
          <div class="info-block-note flex items-center justify-center gap-2 p-8 text-xs">
            <i class="ti ti-alert-circle text-sm" />
            Book not found
          </div>
        </div>
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
        <div class="mx-auto mt-16 max-w-md">
          <div class="info-block-warning flex items-center justify-center gap-2 p-8 text-xs">
            <i class="ti ti-lock text-sm" />
            You don&apos;t have access to this contact book
          </div>
        </div>
      </Layout>
    );
  }
  const books = booksResult.items;
  const { entries: permissionEntries, adminBookIds, writableBooks } = await loadContactBookPermissions({ books, user });
  const currentPermission = permissionForBook(permissionEntries, book.id);
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
  const selectedContact = await resolveSelectedContact({ contacts, contactId: selectedContactIdFromUrl, bookId, user });
  const initialNotes = selectedContact ? await contactsService.contact.notes.list({ bookId, contactId: selectedContact.id }) : [];
  const bookNames = Object.fromEntries(books.map((entry) => [entry.id, entry.name]));
  const totalPages = Math.max(1, Math.ceil(contactsResult.total / perPage));
  const paginationBaseUrl = buildContactsPaginationBaseUrl({ basePath: `/app/contacts/${bookId}`, search });
  const initialSelectedContactId = selectedContact?.id ?? selectedContactIdFromUrl ?? null;
  const initialSelectedBookId = selectedContact ? bookId : selectedContactIdFromUrl ? bookId : null;
  const hasDesktopDetailSelection = Boolean(selectedContact);
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Contacts", href: "/app/contacts" }, { title: book.name }]}>
      <AppWorkspace>
        <ContactsLayoutHelp />
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
                class={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium transition-colors ${
                  activeTagId
                    ? "border-zinc-200 bg-zinc-100/80 text-zinc-600 hover:bg-zinc-200/80 hover:text-primary dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    : "border-blue-300/70 bg-blue-500/12 text-blue-700 dark:border-blue-700/70 dark:bg-blue-500/18 dark:text-blue-300"
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
                  <a href={href} class="inline-flex transition-opacity hover:opacity-85">
                    <ContactTagChip name={tag.name} color={tag.color} active={active} size="sm" />
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
