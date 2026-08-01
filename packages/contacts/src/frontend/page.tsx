import { AppWorkspace } from "@k2b/ui";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { expectUserBackedActor } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import { contactsHelp } from "../help";
import { contactsService } from "../service";
import { captureContactEventCursor } from "../service/events";
import ContactCreateLauncher from "./_components/ContactCreateLauncher.island";
import ContactDetailPanel from "./_components/ContactDetailPanel.island";
import ContactsLiveEvents from "./_components/ContactsLiveEvents.island";
import ContactsSidebar from "./_components/ContactsSidebar";
import ContactsWorkspaceMain from "./_components/ContactsWorkspaceMain";
import DesktopDetailLayoutSync from "./_components/DesktopDetailLayoutSync.island";
import ContactsLayoutHelp from "./_components/help/ContactsLayoutHelp.island";
import {
  CONTACTS_PER_PAGE,
  loadContactBookPermissions,
  loadFavoriteKeysForContacts,
  parseContactsPage,
  parseContactsQueryOptions,
  resolveSelectedContact,
} from "./page-data";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const search = c.req.query("search") ?? "";
  const activeTagId = c.req.query("tag_id") ?? null;
  const page = parseContactsPage(c.req.query("page"));
  const queryOptions = parseContactsQueryOptions((name) => c.req.query(name));
  const perPage = CONTACTS_PER_PAGE;
  const selectedContactIdFromUrl = c.req.query("contact") ?? null;
  const selectedBookIdFromUrl = c.req.query("contactBook") ?? null;
  // The cursor must precede the snapshot reads or an event can fall between them.
  const initialLiveCursor = await captureContactEventCursor();
  const [booksResult, contactsResult] = await Promise.all([
    contactsService.book.list({
      subject: { type: "user", userId: user.id },
      includeSystem: true,
    }),
    contactsService.contact.search({
      subject: { type: "user", userId: user.id },
      pagination: { page, perPage },
      filter: {
        query: search.trim() || undefined,
        tagIds: activeTagId ? [activeTagId] : undefined,
        includeSystem: queryOptions.favorites,
        sort: queryOptions.sort,
        email: queryOptions.email,
        phone: queryOptions.phone,
        favoriteUserId: queryOptions.favorites ? user.id : undefined,
      },
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
  const [{ adminBookIds, writableBooks }, initialNotes, favoriteKeys, globalTags] = await Promise.all([
    loadContactBookPermissions({ books, user }),
    selectedContact
      ? contactsService.contact.notes.list({ bookId: selectedContact.bookId, contactId: selectedContact.id })
      : Promise.resolve([]),
    loadFavoriteKeysForContacts(user.id, selectedContact ? [...contacts, selectedContact] : contacts),
    contactsService.tag.listForBooks({ bookIds: books.filter((book) => !book.isSystem).map((book) => book.id) }),
  ]);
  const bookNames = Object.fromEntries(books.map((book) => [book.id, book.name]));
  const totalPages = Math.max(1, Math.ceil(contactsResult.total / perPage));
  const requestUrl = new URL(c.req.raw.url);
  const resultHref = `${requestUrl.pathname}${requestUrl.search}`;
  const initialSelectedContactId = selectedContact?.id ?? selectedContactIdFromUrl;
  const initialSelectedBookId = selectedContact?.bookId ?? selectedBookIdFromUrl;
  const hasDesktopDetailSelection = Boolean(selectedContact);
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Contacts" }]}>
      <ContactsLayoutHelp documents={contactsHelp.manifest} />
      <ContactsLiveEvents scope={{ kind: "all" }} initialCursor={initialLiveCursor} />
      <ContactCreateLauncher writableBooks={writableBooks} />
      <AppWorkspace>
        <ContactsSidebar books={books} active={queryOptions.favorites ? "favorites" : "all"} adminBookIds={adminBookIds} />

        <AppWorkspace.Content>
          <ContactsWorkspaceMain
            title={queryOptions.favorites ? "Favorites" : "All contacts"}
            description={queryOptions.favorites ? "Your favorite contacts" : "Across your manual contact books"}
            total={contactsResult.total}
            search={search}
            resultHref={resultHref}
            perPage={perPage}
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
            tags={globalTags}
            activeTagId={activeTagId}
            filtersBasePath="/app/contacts"
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
