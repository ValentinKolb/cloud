import type { User } from "@valentinkolb/cloud/contracts";
import type { PermissionLevel } from "@valentinkolb/cloud/server";
import { contactsService, type Contact, type ContactBook } from "../service";

export const CONTACTS_PER_PAGE = 100;

export const parseContactsPage = (value: string | undefined): number => {
  const parsed = Number(value ?? "1");
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
};

export const buildContactsPaginationBaseUrl = (config: { basePath: string; search: string; tagId?: string | null }): string => {
  const params = new URLSearchParams();
  if (config.search.trim()) params.set("search", config.search.trim());
  if (config.tagId) params.set("tag_id", config.tagId);
  const query = params.toString();
  return query ? `${config.basePath}?${query}&page=` : `${config.basePath}?page=`;
};

export const loadContactBookPermissions = async (config: { books: ContactBook[]; user: User }) => {
  const manualBooks = config.books.filter((book) => !book.isSystem);
  const entries = await Promise.all(
    manualBooks.map(async (book) => ({
      book,
      permission: await contactsService.book.permission.get({
        bookId: book.id,
        subject: { type: "user", userId: config.user.id },
      }),
    })),
  );

  return {
    entries,
    adminBookIds: entries.filter((entry) => entry.permission === "admin").map((entry) => entry.book.id),
    writableBooks: entries
      .filter((entry) => entry.permission === "write" || entry.permission === "admin")
      .map((entry) => ({ id: entry.book.id, name: entry.book.name })),
  };
};

export const permissionForBook = (entries: Array<{ book: ContactBook; permission: PermissionLevel }>, bookId: string): PermissionLevel =>
  entries.find((entry) => entry.book.id === bookId)?.permission ?? "read";

export const resolveSelectedContact = async (config: {
  contacts: Contact[];
  contactId: string | null;
  bookId: string | null;
  user: User;
}): Promise<Contact | null> => {
  if (!config.contactId || !config.bookId) return null;

  const selectedFromPage = config.contacts.find((contact) => contact.id === config.contactId && contact.bookId === config.bookId) ?? null;
  if (selectedFromPage) return selectedFromPage;

  const hasReadAccess = await contactsService.book.permission.canAccess({
    bookId: config.bookId,
    subject: { type: "user", userId: config.user.id },
    requiredLevel: "read",
  });
  if (!hasReadAccess) return null;

  return contactsService.contact.get({ bookId: config.bookId, id: config.contactId });
};
