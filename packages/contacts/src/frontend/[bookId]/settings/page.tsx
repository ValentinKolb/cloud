import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { expectUserBackedActor } from "@/actor";
import { ssr } from "../../../config";
import { contactsService } from "../../../service";
import BookSettingsForm from "../../_components/BookSettingsForm.island";
import ContactBookUnavailable from "../../_components/ContactBookUnavailable";
import ContactsSidebar from "../../_components/ContactsSidebar";
import ContactsLayoutHelp from "../../_components/help/ContactsLayoutHelp.island";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const bookId = c.req.param("bookId") ?? "";

  const book = await contactsService.book.get({ id: bookId });
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

  if (book.isSystem) {
    return c.redirect("/app/contacts/system", 302);
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

  const permission = await contactsService.book.permission.get({
    bookId,
    subject: { type: "user", userId: user.id },
  });

  if (permission !== "admin") {
    return c.redirect(`/app/contacts/${bookId}`, 302);
  }

  const [booksResult, accessEntriesResult, apiKeys, bookTags] = await Promise.all([
    contactsService.book.list({ subject: { type: "user", userId: user.id }, includeSystem: true }),
    contactsService.book.access.list({ bookId }),
    contactsService.book.access.apiKeys.list({ bookId }),
    contactsService.tag.list({ bookId }),
  ]);
  const books = booksResult.items;
  const manualBooks = books.filter((entry) => !entry.isSystem);
  const permissionEntries = await Promise.all(
    manualBooks.map(async (entry) => ({
      book: entry,
      permission: await contactsService.book.permission.get({ bookId: entry.id, subject: { type: "user", userId: user.id } }),
    })),
  );
  const adminBookIds = permissionEntries.filter((entry) => entry.permission === "admin").map((entry) => entry.book.id);
  const accessEntries = accessEntriesResult.items;

  return () => (
    <Layout
      c={c}
      title={[
        { title: "Start", href: "/" },
        { title: "Contacts", href: "/app/contacts" },
        { title: book.name, href: `/app/contacts/${book.id}` },
        { title: "Settings" },
      ]}
      fullWidth
    >
      <ContactsLayoutHelp />
      <AppWorkspace>
        <ContactsSidebar books={books} active={book.id} adminBookIds={adminBookIds} />

        <AppWorkspace.Content>
          <AppWorkspace.Main>
            <div class="flex-1 min-h-0 p-[var(--ui-space-section)]" data-scroll-preserve={`contacts-settings-${book.id}`}>
              <div class="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col" style="view-transition-name: contacts-settings-modal">
                <BookSettingsForm
                  bookId={book.id}
                  initialName={book.name}
                  initialDescription={book.description}
                  accessEntries={accessEntries}
                  apiKeys={apiKeys}
                  initialTags={bookTags}
                />
              </div>
            </div>
          </AppWorkspace.Main>
        </AppWorkspace.Content>
      </AppWorkspace>
    </Layout>
  );
});
