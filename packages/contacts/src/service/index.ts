import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import type { PermissionLevel } from "@valentinkolb/cloud/server";
import { type PageParams, type Paginated, paginate } from "@valentinkolb/stdlib";
import * as books from "./books";
import * as contacts from "./contacts";
import * as notes from "./notes";
import { getSystemBook, isSystemBookId, SYSTEM_BOOK_ID } from "./system";
import * as tags from "./tags";
import type {
  ContactBook,
  ContactBookAdminListItem,
  CreateBookInput,
  CreateContactInput,
  CreateContactNoteInput,
  CreateContactTagInput,
  UpdateBookInput,
  UpdateContactInput,
  UpdateContactNoteInput,
  UpdateContactTagInput,
} from "./types";

const paginateItems = <T>(items: T[], pagination?: PageParams): Paginated<T> => {
  if (!pagination) {
    return {
      items,
      page: 1,
      perPage: items.length,
      total: items.length,
      hasNext: false,
    };
  }

  const { page, perPage, offset } = paginate(pagination);
  const sliced = items.slice(offset, offset + perPage);
  return {
    items: sliced,
    page,
    perPage,
    total: items.length,
    hasNext: page * perPage < items.length,
  };
};

/**
 * Main Contacts app service facade.
 *
 * The service is stateless and grouped by domain (`book`, `contact`).
 * `system` exposes virtual read-only helpers for the IPA-projected book.
 */
export const contactsService = {
  book: {
    list: async (config: {
      userId: string;
      groups: string[];
      pagination?: PageParams;
      filter?: { query?: string };
    }): Promise<Paginated<ContactBook>> => {
      const manualBooks = await books.list({
        userId: config.userId,
        groups: config.groups,
      });

      const allBooks = [getSystemBook(), ...manualBooks];
      const query = config.filter?.query?.trim().toLowerCase();
      const filtered =
        query && query.length > 0
          ? allBooks.filter((book) => {
              const name = book.name.toLowerCase();
              const description = (book.description ?? "").toLowerCase();
              return name.includes(query) || description.includes(query);
            })
          : allBooks;

      return paginateItems(filtered, config.pagination);
    },
    get: async (config: { id: string }): Promise<ContactBook | null> => {
      if (isSystemBookId(config.id)) return getSystemBook();
      return books.get({ id: config.id });
    },
    create: (config: { data: CreateBookInput; creatorId: string }) => books.create(config),
    update: (config: { id: string; data: UpdateBookInput }) => books.update(config),
    remove: (config: { id: string }) => books.remove(config),
    admin: {
      list: async (config: { pagination?: PageParams; filter?: { query?: string } }): Promise<Paginated<ContactBookAdminListItem>> => {
        const { page, perPage, offset } = paginate(config.pagination);
        const result = await books.listAdmin({
          search: config.filter?.query,
          pagination: { limit: perPage, offset },
        });
        return {
          items: result.items,
          page,
          perPage,
          total: result.total,
          hasNext: page * perPage < result.total,
        };
      },
      summary: async (config: { filter?: { query?: string } }) => books.adminSummary({ search: config.filter?.query }),
    },
    permission: {
      get: async (config: { bookId: string; userId: string; userGroups: string[] }): Promise<PermissionLevel> => {
        if (isSystemBookId(config.bookId)) return "read";
        return books.getPermission(config);
      },
      canAccess: async (config: {
        bookId: string;
        userId: string;
        userGroups: string[];
        requiredLevel?: PermissionLevel;
      }): Promise<boolean> => {
        if (isSystemBookId(config.bookId)) {
          const requiredLevel = config.requiredLevel ?? "read";
          return requiredLevel === "read";
        }
        return books.canAccess(config);
      },
    },
    access: {
      list: async (config: {
        bookId: string;
        pagination?: PageParams;
        filter?: {
          query?: string;
          principalType?: AccessEntry["principal"]["type"];
        };
      }): Promise<Paginated<AccessEntry>> => books.access.list(config),
      grant: (config: { bookId: string; principal: AccessEntry["principal"]; permission: PermissionLevel }) => books.access.grant(config),
      remove: (config: { bookId: string; accessId: string }) => books.access.remove(config),
      add: (config: { bookId: string; accessId: string }) => books.access.add(config),
      count: (config: { bookId: string }) => books.access.count(config),
      guard: (config: { bookId: string; accessId: string }) => books.access.guard(config),
    },
  },
  tag: {
    list: (config: { bookId: string }) => tags.list(config),
    create: (config: { bookId: string; data: CreateContactTagInput }) => tags.create(config),
    update: (config: { bookId: string; id: string; data: UpdateContactTagInput }) => tags.update(config),
    remove: (config: { bookId: string; id: string }) => tags.remove(config),
  },
  contact: {
    list: (config: { bookId: string; pagination?: PageParams; filter?: { query?: string; tagIds?: string[] } }) => contacts.list(config),
    get: (config: { bookId: string; id: string }) => contacts.get(config),
    create: (config: { bookId: string; data: CreateContactInput }) => contacts.create(config),
    update: (config: { bookId: string; id: string; data: UpdateContactInput }) => contacts.update(config),
    move: (config: { sourceBookId: string; targetBookId: string; id: string }) => contacts.move(config),
    remove: (config: { bookId: string; id: string }) => contacts.remove(config),
    search: (config: { userId: string; groups: string[]; pagination?: PageParams; filter?: { query?: string; includeSystem?: boolean } }) =>
      contacts.search(config),
    notes: {
      list: (config: { bookId: string; contactId: string }) => notes.list(config),
      create: (config: {
        bookId: string;
        contactId: string;
        authorUserId: string;
        authorDisplayName: string;
        data: CreateContactNoteInput;
      }) => notes.create(config),
      update: (config: { bookId: string; contactId: string; noteId: string; authorUserId: string; data: UpdateContactNoteInput }) =>
        notes.update(config),
      remove: (config: { bookId: string; contactId: string; noteId: string; authorUserId: string; isBookAdmin: boolean }) =>
        notes.remove(config),
    },
  },
  system: {
    bookId: SYSTEM_BOOK_ID,
    isBookId: isSystemBookId,
  },
};

export type {
  Contact,
  ContactBankAccount,
  ContactBankAccountInput,
  ContactBook,
  ContactBookAdminListItem,
  ContactNote,
  ContactRef,
  ContactTag,
  ContactWebsite,
  CreateBookInput,
  CreateContactInput,
  CreateContactNoteInput,
  CreateContactTagInput,
  UpdateBookInput,
  UpdateContactInput,
  UpdateContactNoteInput,
  UpdateContactTagInput,
} from "./types";
