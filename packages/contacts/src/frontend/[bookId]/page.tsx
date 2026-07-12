import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { expectUserBackedActor } from "@/actor";
import { ssr } from "../../config";
import { contactsService } from "../../service";
import ContactBookUnavailable from "../_components/ContactBookUnavailable";
import ContactDetailPanel from "../_components/ContactDetailPanel.island";
import ContactsSidebar from "../_components/ContactsSidebar";
import ContactsWorkspaceMain from "../_components/ContactsWorkspaceMain";
import DesktopDetailLayoutSync from "../_components/DesktopDetailLayoutSync.island";
import ContactsLayoutHelp from "../_components/help/ContactsLayoutHelp.island";
import { CONTACTS_PER_PAGE, loadContactBookPermissions, parseContactsPage, permissionForBook, resolveSelectedContact } from "../page-data";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const bookId = c.req.param("bookId") ?? "";
  const search = c.req.query("search") ?? "";
  const page = parseContactsPage(c.req.query("page"));
  const perPage = CONTACTS_PER_PAGE;
  const selectedContactIdFromUrl = c.req.query("contact") ?? null;
  const activeTagId = c.req.query("tag_id") ?? null;
  const [book, booksResult] = await Promise.all([
    contactsService.book.get({ id: bookId }),
    contactsService.book.list({
      userId: user.id,
      groups: user.memberofGroupIds,
    }),
  ]);
  if (!book) {
    return () => (
      <Layout c={c} title="Not Found">
        <ContactBookUnavailable
          title="Contact book not found"
          description="The book may have been deleted or this link is no longer valid."
          icon="ti ti-address-book-off"
        />
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
        <ContactBookUnavailable
          title="Contact book unavailable"
          description="Ask a book administrator to grant you access."
          icon="ti ti-lock"
        />
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
  const selectedContact = await resolveSelectedContact({
    contacts,
    contactId: selectedContactIdFromUrl,
    bookId,
    user,
  });
  const initialNotes = selectedContact
    ? await contactsService.contact.notes.list({
        bookId,
        contactId: selectedContact.id,
      })
    : [];
  const bookNames = Object.fromEntries(books.map((entry) => [entry.id, entry.name]));
  const totalPages = Math.max(1, Math.ceil(contactsResult.total / perPage));
  const requestUrl = new URL(c.req.raw.url);
  const resultHref = `${requestUrl.pathname}${requestUrl.search}`;
  const initialSelectedContactId = selectedContact?.id ?? selectedContactIdFromUrl ?? null;
  const initialSelectedBookId = selectedContact ? bookId : selectedContactIdFromUrl ? bookId : null;
  const hasDesktopDetailSelection = Boolean(selectedContact);
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Contacts", href: "/app/contacts" }, { title: book.name }]}>
      <AppWorkspace class="cloud-ui-soft">
        <ContactsLayoutHelp />
        <ContactsSidebar books={books} active={book.id} adminBookIds={adminBookIds} />

        <ContactsWorkspaceMain
          title={book.name}
          description={book.description ?? (book.isSystem ? "Company directory" : "Shared contact book")}
          total={contactsResult.total}
          search={search}
          resultHref={resultHref}
          bookId={bookId}
          perPage={perPage}
          searchPlaceholder={`Filter ${book.name}...`}
          contacts={contacts}
          bookNames={bookNames}
          initialSelectedContactId={initialSelectedContactId}
          initialSelectedBookId={initialSelectedBookId}
          writableBooks={writableBooks}
          defaultCreateBookId={canWrite ? book.id : (writableBooks[0]?.id ?? null)}
          chooseBookOnCreate={!canWrite}
          currentPage={contactsResult.page}
          totalPages={totalPages}
          tags={bookTags}
          activeTagId={activeTagId}
          filtersBasePath={`/app/contacts/${bookId}`}
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
