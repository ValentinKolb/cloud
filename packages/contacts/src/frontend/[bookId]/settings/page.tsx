import { ssr } from "../../../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { contactsService } from "../../../service";
import BookSettingsForm from "../../_components/BookSettingsForm.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const bookId = c.req.param("bookId");

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

  const accessEntries = (
    await contactsService.book.access.list({
      bookId,
    })
  ).items;

  return () => (
    <Layout
      c={c}
      title={[
        { title: "Start", href: "/" },
        { title: "Contacts", href: "/app/contacts" },
        { title: book.name, href: `/app/contacts/${book.id}` },
        { title: "Settings" },
      ]}
    >
      <div class="max-w-xl mx-auto w-full py-6 px-4 flex flex-col gap-8">
        <div class="flex items-center gap-3">
          <a href={`/app/contacts/${book.id}`} class="p-1.5 text-dimmed hover:text-primary transition-colors" title="Back to contact book">
            <i class="ti ti-arrow-left" />
          </a>
          <h1 class="text-lg font-semibold text-primary">Contact Book Settings</h1>
        </div>

        <BookSettingsForm bookId={book.id} initialName={book.name} initialDescription={book.description} accessEntries={accessEntries} />
      </div>
    </Layout>
  );
});
