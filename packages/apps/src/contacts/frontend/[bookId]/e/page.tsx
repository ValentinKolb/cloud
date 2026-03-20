import { ssr } from "@valentinkolb/cloud/core/config";
import type { AuthContext } from "@valentinkolb/cloud/lib/server";
import { contactsService } from "../../../service";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const bookId = c.req.param("bookId");

  const book = await contactsService.book.get({ id: bookId });
  if (!book) return c.redirect("/app/contacts", 302);

  const hasReadAccess = await contactsService.book.permission.canAccess({
    bookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel: "read",
  });

  return c.redirect(hasReadAccess ? `/app/contacts/${book.id}` : "/app/contacts", 302);
});
