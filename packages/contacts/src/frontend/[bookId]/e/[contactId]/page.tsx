import type { AuthContext } from "@valentinkolb/cloud/server";
import { expectUserBackedActor } from "@/actor";
import { ssr } from "../../../../config";
import { contactsService } from "../../../../service";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const bookId = c.req.param("bookId") ?? "";
  const contactId = c.req.param("contactId") ?? "";

  const book = await contactsService.book.get({ id: bookId });
  if (!book) return c.redirect("/app/contacts", 302);

  const hasReadAccess = await contactsService.book.permission.canAccess({
    bookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel: "read",
  });

  if (!hasReadAccess) return c.redirect("/app/contacts", 302);
  if (book.isSystem) return c.redirect(`/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}`, 302);

  const hasWriteAccess = await contactsService.book.permission.canAccess({
    bookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel: "write",
  });

  if (!hasWriteAccess) return c.redirect(`/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}`, 302);

  const contact = await contactsService.contact.get({ bookId, id: contactId });
  if (!contact) return c.redirect(`/app/contacts/${bookId}`, 302);

  return c.redirect(`/app/contacts/${book.id}?contact=${contact.id}&contactBook=${book.id}`, 302);
});
