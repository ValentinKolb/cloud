import type { AuthContext } from "@valentinkolb/cloud/server";
import { expectUserBackedActor } from "@valentinkolb/cloud/server";
import { ssr } from "../../../config";
import { contactsService } from "../../../service";
import { projectBooks, resolvePublicId } from "../../../service/public-resources";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const publicBookId = c.req.param("bookId") ?? "";
  const bookId = await resolvePublicId("books", publicBookId);
  if (!bookId) return c.redirect("/app/contacts", 302);

  const book = await contactsService.book.get({ id: bookId });
  if (!book) return c.redirect("/app/contacts", 302);

  const hasReadAccess = await contactsService.book.permission.canAccess({
    bookId,
    subject: { type: "user", userId: user.id },
    requiredLevel: "read",
  });

  const publicBook = (await projectBooks([book]))[0]!;
  return c.redirect(hasReadAccess ? `/app/contacts/${publicBook.id}` : "/app/contacts", 302);
});
