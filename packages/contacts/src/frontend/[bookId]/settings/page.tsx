import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { ssr } from "../../../config";
import { contactsService } from "../../../service";
import BookSettingsForm from "../../_components/BookSettingsForm.island";
import ContactsSidebar from "../../_components/ContactsSidebar";
import ContactsLayoutHelp from "../../_components/help/ContactsLayoutHelp.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const bookId = c.req.param("bookId") ?? "";

  const book = await contactsService.book.get({ id: bookId });
  if (!book) {
    return () => (
      <Layout c={c} title="Not Found">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-alert-circle text-sm" />
            Book not found
          </div>
        </div>
      </Layout>
    );
  }

  if (book.isSystem) {
    return c.redirect("/app/contacts/system", 302);
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
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-lock text-sm" />
            You don&apos;t have access to this contact book
          </div>
        </div>
      </Layout>
    );
  }

  const permission = await contactsService.book.permission.get({
    bookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });

  if (permission !== "admin") {
    return c.redirect(`/app/contacts/${bookId}`, 302);
  }

  const [booksResult, accessEntriesResult, bookTags] = await Promise.all([
    contactsService.book.list({ userId: user.id, groups: user.memberofGroupIds }),
    contactsService.book.access.list({ bookId }),
    contactsService.tag.list({ bookId }),
  ]);
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
      <AppWorkspace>
        <ContactsLayoutHelp />
        <ContactsSidebar
          books={books}
          active={book.id}
          adminBookIds={adminBookIds}
          writableBooks={writableBooks}
          defaultCreateBookId={writableBooks.some((entry) => entry.id === book.id) ? book.id : (writableBooks[0]?.id ?? null)}
        />

        <AppWorkspace.Main>
          <div class="flex-1 min-h-0 p-2" data-scroll-preserve={`contacts-settings-${book.id}`}>
            <div class="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col" style="view-transition-name: contacts-settings-modal">
              <BookSettingsForm
                bookId={book.id}
                initialName={book.name}
                initialDescription={book.description}
                accessEntries={accessEntries}
                initialTags={bookTags}
              />
            </div>
          </div>
        </AppWorkspace.Main>
      </AppWorkspace>
    </Layout>
  );
});
