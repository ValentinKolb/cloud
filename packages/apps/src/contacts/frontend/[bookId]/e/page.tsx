import { ssr } from "@valentinkolb/cloud/core/config";
import type { AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { contactsService } from "../../../service";
import ContactUpsertForm from "../../_components/ContactUpsertForm.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const bookId = c.req.param("bookId");

  const book = await contactsService.book.get({ id: bookId });
  if (!book) {
    return (
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

  const hasWriteAccess = await contactsService.book.permission.canAccess({
    bookId,
    userId: user.id,
    userGroups: user.memberofGroup,
    requiredLevel: "write",
  });

  if (!hasWriteAccess) {
    return (
      <Layout c={c} title="Access Denied">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-lock text-sm" />
            You need write access to create contacts in this book
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      c={c}
      title={[
        { title: "Start", href: "/" },
        { title: "Contacts", href: "/app/contacts" },
        { title: book.name, href: `/app/contacts/${book.id}` },
        { title: "New Contact" },
      ]}
    >
      <div class="max-w-4xl mx-auto w-full p-4 md:p-6 space-y-4">
        <div class="flex items-center justify-between gap-3">
          <h1 class="text-lg md:text-xl font-semibold text-primary">New Contact</h1>
          <a href={`/app/contacts/${book.id}`} class="btn-secondary btn-sm">
            <i class="ti ti-arrow-left" />
            Back to Book
          </a>
        </div>

        <ContactUpsertForm mode="create" bookId={book.id} backHref={`/app/contacts/${book.id}`} />
      </div>
    </Layout>
  );
});
