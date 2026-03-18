import { ssr } from "@valentinkolb/cloud/core/config";
import type { AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { contactsService } from "../../../../service";
import ContactUpsertForm from "../../../_components/ContactUpsertForm.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const bookId = c.req.param("bookId");
  const contactId = c.req.param("contactId");

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

  const hasReadAccess = await contactsService.book.permission.canAccess({
    bookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel: "read",
  });

  if (!hasReadAccess) {
    return (
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

  if (book.isSystem) {
    return c.redirect(`/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}`, 302);
  }

  const hasWriteAccess = await contactsService.book.permission.canAccess({
    bookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel: "write",
  });

  if (!hasWriteAccess) {
    return (
      <Layout c={c} title="Access Denied">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-lock text-sm" />
            You need write access to edit contacts in this book
          </div>
        </div>
      </Layout>
    );
  }

  const contact = await contactsService.contact.get({
    bookId,
    id: contactId,
  });

  if (!contact) {
    return (
      <Layout c={c} title="Not Found">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-alert-circle text-sm" />
            Contact not found
          </div>
        </div>
      </Layout>
    );
  }

  const detailUrl = `/app/contacts/${book.id}?contact=${contact.id}&contactBook=${book.id}`;

  return (
    <Layout
      c={c}
      title={[
        { title: "Start", href: "/" },
        { title: "Contacts", href: "/app/contacts" },
        { title: book.name, href: `/app/contacts/${book.id}` },
        { title: `Edit ${contact.displayName}` },
      ]}
    >
      <div class="max-w-4xl mx-auto w-full p-4 md:p-6 space-y-4">
        <div class="flex items-center gap-3">
          <a href={detailUrl} class="p-1.5 text-dimmed hover:text-primary transition-colors" title="Back to contact">
            <i class="ti ti-arrow-left" />
          </a>
          <h1 class="text-lg md:text-xl font-semibold text-primary">Edit Contact</h1>
        </div>

        <ContactUpsertForm mode="edit" bookId={book.id} initialContact={contact} backHref={detailUrl} />
      </div>
    </Layout>
  );
});
