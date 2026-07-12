import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { expectUserBackedActor } from "@/actor";
import { ssr } from "../config";
import { contactsService } from "../service";
import ContactDetailPanel from "./_components/ContactDetailPanel.island";
import ContactsSidebar from "./_components/ContactsSidebar";
import ContactsWorkspaceMain from "./_components/ContactsWorkspaceMain";
import DesktopDetailLayoutSync from "./_components/DesktopDetailLayoutSync.island";
import ContactsLayoutHelp from "./_components/help/ContactsLayoutHelp.island";
import {
  buildContactsPaginationBaseUrl,
  CONTACTS_PER_PAGE,
  loadContactBookPermissions,
  parseContactsPage,
  resolveSelectedContact,
} from "./page-data";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const search = c.req.query("search") ?? "";
  const page = parseContactsPage(c.req.query("page"));
  const perPage = CONTACTS_PER_PAGE;
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
  const selectedContact = await resolveSelectedContact({
    contacts,
    contactId: selectedContactIdFromUrl,
    bookId: selectedBookIdFromUrl,
    user,
  });
  const { adminBookIds, writableBooks } = await loadContactBookPermissions({ books, user });
  const initialNotes = selectedContact
    ? await contactsService.contact.notes.list({ bookId: selectedContact.bookId, contactId: selectedContact.id })
    : [];
  const bookNames = Object.fromEntries(books.map((book) => [book.id, book.name]));
  const totalPages = Math.max(1, Math.ceil(contactsResult.total / perPage));
  const paginationBaseUrl = buildContactsPaginationBaseUrl({ basePath: "/app/contacts", search });
  const initialSelectedContactId = selectedContact?.id ?? selectedContactIdFromUrl;
  const initialSelectedBookId = selectedContact?.bookId ?? selectedBookIdFromUrl;
  const hasDesktopDetailSelection = Boolean(selectedContact);
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Contacts" }]}>
      <AppWorkspace class="cloud-ui-soft">
        <ContactsLayoutHelp />
        <ContactsSidebar
          books={books}
          active="all"
          adminBookIds={adminBookIds}
          writableBooks={writableBooks}
          defaultCreateBookId={writableBooks[0]?.id ?? null}
        />

        <ContactsWorkspaceMain
          title="All contacts"
          description="Across your manual contact books"
          total={contactsResult.total}
          search={search}
          searchAction="/app/contacts"
          searchPlaceholder="Filter by name, company, email, or phone..."
          contacts={contacts}
          bookNames={bookNames}
          showBookNames
          initialSelectedContactId={initialSelectedContactId}
          initialSelectedBookId={initialSelectedBookId}
          writableBooks={writableBooks}
          defaultCreateBookId={writableBooks[0]?.id ?? null}
          chooseBookOnCreate
          currentPage={contactsResult.page}
          totalPages={totalPages}
          paginationBaseUrl={paginationBaseUrl}
        />

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
