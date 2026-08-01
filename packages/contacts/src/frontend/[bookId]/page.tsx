import { AppWorkspace } from "@k2b/ui";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { expectUserBackedActor } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import { contactsHelp } from "../../help";
import { contactsService } from "../../service";
import { captureContactEventCursor } from "../../service/events";
import ContactBookUnavailable from "../_components/ContactBookUnavailable";
import ContactDetailPanel from "../_components/ContactDetailPanel.island";
import ContactsLiveEvents from "../_components/ContactsLiveEvents.island";
import ContactsSidebar from "../_components/ContactsSidebar";
import ContactsWorkspaceMain from "../_components/ContactsWorkspaceMain";
import DesktopDetailLayoutSync from "../_components/DesktopDetailLayoutSync.island";
import ContactsLayoutHelp from "../_components/help/ContactsLayoutHelp.island";
import {
  CONTACTS_PER_PAGE,
  loadContactBookPermissions,
  loadFavoriteKeysForContacts,
  parseContactsPage,
  parseContactsQueryOptions,
  permissionForBook,
  resolveSelectedContact,
} from "../page-data";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const bookId = c.req.param("bookId") ?? "";
  const search = c.req.query("search") ?? "";
  const page = parseContactsPage(c.req.query("page"));
  const queryOptions = parseContactsQueryOptions((name) => c.req.query(name));
  const perPage = CONTACTS_PER_PAGE;
  const selectedContactIdFromUrl = c.req.query("contact") ?? null;
  const activeTagId = c.req.query("tag_id") ?? null;
  // The cursor must precede the snapshot reads or an event can fall between them.
  const initialLiveCursor = await captureContactEventCursor();
  const [book, booksResult] = await Promise.all([
    contactsService.book.get({ id: bookId }),
    contactsService.book.list({
      subject: { type: "user", userId: user.id },
      includeSystem: true,
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
    subject: { type: "user", userId: user.id },
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
        sort: queryOptions.sort,
        email: queryOptions.email,
        phone: queryOptions.phone,
        favoriteUserId: queryOptions.favorites ? user.id : undefined,
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
  const [initialNotes, favoriteKeys] = await Promise.all([
    selectedContact ? contactsService.contact.notes.list({ bookId, contactId: selectedContact.id }) : Promise.resolve([]),
    loadFavoriteKeysForContacts(user.id, selectedContact ? [...contacts, selectedContact] : contacts),
  ]);
  const bookNames = Object.fromEntries(books.map((entry) => [entry.id, entry.name]));
  const totalPages = Math.max(1, Math.ceil(contactsResult.total / perPage));
  const requestUrl = new URL(c.req.raw.url);
  const resultHref = `${requestUrl.pathname}${requestUrl.search}`;
  const initialSelectedContactId = selectedContact?.id ?? selectedContactIdFromUrl ?? null;
  const initialSelectedBookId = selectedContact ? bookId : selectedContactIdFromUrl ? bookId : null;
  const hasDesktopDetailSelection = Boolean(selectedContact);
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Contacts", href: "/app/contacts" }, { title: book.name }]}>
      <ContactsLayoutHelp documents={contactsHelp.manifest} />
      {!book.isSystem ? <ContactsLiveEvents scope={{ kind: "book", bookId }} initialCursor={initialLiveCursor} /> : null}
      <AppWorkspace>
        <ContactsSidebar books={books} active={book.id} adminBookIds={adminBookIds} />

        <AppWorkspace.Content>
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
            initialFavoriteKeys={favoriteKeys}
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
              initialFavoriteKeys={favoriteKeys}
            />
          </AppWorkspace.Detail>
        </AppWorkspace.Content>
      </AppWorkspace>
      <DesktopDetailLayoutSync detailContainerId="contacts-detail-panel" />
    </Layout>
  );
});
