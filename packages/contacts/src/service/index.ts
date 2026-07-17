import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { type AccessSubject, type PermissionLevel, paginate, paginateItems } from "@valentinkolb/cloud/server";
import type { PageParams, Paginated, Result } from "@valentinkolb/stdlib";
import type { ContactServiceEventData } from "../live-events";
import * as apiKeys from "./api-keys";
import * as books from "./books";
import * as contacts from "./contacts";
import { publishContactEvent } from "./events";
import * as favorites from "./favorites";
import * as imports from "./imports";
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

const withEvent = async <T>(
  operation: Promise<Result<T>>,
  event: ContactServiceEventData | ((data: T) => ContactServiceEventData),
): Promise<Result<T>> => {
  const result = await operation;
  if (result.ok) {
    await publishContactEvent(typeof event === "function" ? event(result.data) : event);
  }
  return result;
};

/**
 * Main Contacts app service facade.
 *
 * The service is stateless and grouped by domain (`book`, `contact`).
 * `system` exposes virtual read-only helpers for the IPA-projected book.
 */
export const contactsService = {
  favorite: favorites,
  book: {
    readableIds: async (config: { subject: AccessSubject; boundBookId?: string | null }): Promise<string[]> =>
      (await books.list(config)).map((book) => book.id),
    list: async (config: {
      subject: AccessSubject;
      boundBookId?: string | null;
      includeSystem?: boolean;
      pagination?: PageParams;
      filter?: { query?: string };
    }): Promise<Paginated<ContactBook>> => {
      const manualBooks = await books.list({
        subject: config.subject,
        boundBookId: config.boundBookId,
      });

      const allBooks = config.includeSystem && config.subject.type === "user" ? [getSystemBook(), ...manualBooks] : manualBooks;
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
    create: (config: { data: CreateBookInput; creatorId: string }) =>
      withEvent(books.create(config), (book) => ({ type: "book.created", bookId: book.id })),
    update: (config: { id: string; data: UpdateBookInput }) => withEvent(books.update(config), { type: "book.updated", bookId: config.id }),
    remove: (config: { id: string }) => withEvent(books.remove(config), { type: "book.deleted", bookId: config.id }),
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
      get: async (config: { bookId: string; subject: AccessSubject }): Promise<PermissionLevel> => {
        if (isSystemBookId(config.bookId)) return config.subject.type === "user" ? "read" : "none";
        return books.getPermission(config);
      },
      canAccess: async (config: { bookId: string; subject: AccessSubject; requiredLevel?: PermissionLevel }): Promise<boolean> => {
        if (isSystemBookId(config.bookId)) {
          const requiredLevel = config.requiredLevel ?? "read";
          return config.subject.type === "user" && requiredLevel === "read";
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
      grant: (config: { bookId: string; principal: AccessEntry["principal"]; permission: PermissionLevel }) =>
        withEvent(books.access.grant(config), { type: "access.changed", bookId: config.bookId }),
      update: (config: { bookId: string; accessId: string; permission: PermissionLevel }) =>
        withEvent(books.access.update(config), { type: "access.changed", bookId: config.bookId }),
      remove: (config: { bookId: string; accessId: string }) =>
        withEvent(books.access.remove(config), { type: "access.changed", bookId: config.bookId }),
      add: (config: { bookId: string; accessId: string }) =>
        withEvent(books.access.add(config), { type: "access.changed", bookId: config.bookId }),
      count: (config: { bookId: string }) => books.access.count(config),
      guard: (config: { bookId: string; accessId: string }) => books.access.guard(config),
      apiKeys: {
        list: apiKeys.list,
        create: apiKeys.create,
        revoke: apiKeys.revoke,
      },
    },
  },
  tag: {
    list: (config: { bookId: string }) => tags.list(config),
    listForBooks: (config: { bookIds: string[] }) => tags.listForBooks(config),
    create: (config: { bookId: string; data: CreateContactTagInput }) =>
      withEvent(tags.create(config), { type: "tags.changed", bookId: config.bookId }),
    update: (config: { bookId: string; id: string; data: UpdateContactTagInput }) =>
      withEvent(tags.update(config), { type: "tags.changed", bookId: config.bookId }),
    remove: (config: { bookId: string; id: string }) => withEvent(tags.remove(config), { type: "tags.changed", bookId: config.bookId }),
  },
  contact: {
    list: (config: { bookId: string; pagination?: PageParams; filter?: import("./types").ContactListFilter }) => contacts.list(config),
    get: (config: { bookId: string; id: string }) => contacts.get(config),
    getMany: (config: { bookId: string; ids: string[] }) => contacts.getMany(config),
    tree: (config: { bookId: string; id: string }) => contacts.tree(config),
    create: (config: { bookId: string; data: CreateContactInput }) =>
      withEvent(contacts.create(config), (contact) => ({ type: "contact.created", bookId: config.bookId, contactId: contact.id })),
    update: (config: { bookId: string; id: string; data: UpdateContactInput }) =>
      withEvent(contacts.update(config), { type: "contact.updated", bookId: config.bookId, contactId: config.id }),
    move: (config: { sourceBookId: string; targetBookId: string; id: string }) =>
      withEvent(contacts.move(config), {
        type: "contact.moved",
        sourceBookId: config.sourceBookId,
        targetBookId: config.targetBookId,
        contactId: config.id,
      }),
    remove: (config: { bookId: string; id: string }) =>
      withEvent(contacts.remove(config), { type: "contact.deleted", bookId: config.bookId, contactId: config.id }),
    bulk: {
      addTags: (config: { bookId: string; ids: string[]; tagIds: string[] }) =>
        withEvent(contacts.addTags(config), { type: "contacts.changed", bookId: config.bookId }),
      remove: (config: { bookId: string; ids: string[] }) =>
        withEvent(contacts.removeMany(config), { type: "contacts.changed", bookId: config.bookId }),
      move: async (config: { sourceBookId: string; targetBookId: string; ids: string[] }) => {
        const result = await contacts.moveMany(config);
        if (result.ok) {
          await Promise.all([
            publishContactEvent({ type: "contacts.changed", bookId: config.sourceBookId }),
            publishContactEvent({ type: "contacts.changed", bookId: config.targetBookId }),
          ]);
        }
        return result;
      },
    },
    duplicates: {
      list: (config: { bookId: string; limit?: number }) => contacts.findDuplicates(config),
      merge: (config: { bookId: string; keepId: string; removeId: string; keepUpdatedAt: string; removeUpdatedAt: string }) =>
        withEvent(contacts.mergeDuplicate(config), { type: "contacts.changed", bookId: config.bookId }),
    },
    search: (config: {
      subject: AccessSubject;
      boundBookId?: string | null;
      pagination?: PageParams;
      filter?: import("./types").ContactListFilter & { includeSystem?: boolean };
    }) => contacts.search(config),
    notes: {
      list: (config: { bookId: string; contactId: string }) => notes.list(config),
      create: (config: {
        bookId: string;
        contactId: string;
        authorUserId: string;
        authorDisplayName: string;
        data: CreateContactNoteInput;
      }) => withEvent(notes.create(config), { type: "notes.changed", bookId: config.bookId, contactId: config.contactId }),
      update: (config: { bookId: string; contactId: string; noteId: string; authorUserId: string; data: UpdateContactNoteInput }) =>
        withEvent(notes.update(config), { type: "notes.changed", bookId: config.bookId, contactId: config.contactId }),
      remove: (config: { bookId: string; contactId: string; noteId: string; authorUserId: string; isBookAdmin: boolean }) =>
        withEvent(notes.remove(config), { type: "notes.changed", bookId: config.bookId, contactId: config.contactId }),
    },
  },
  system: {
    bookId: SYSTEM_BOOK_ID,
    isBookId: isSystemBookId,
  },
  import: {
    ...imports,
    commit: async (config: Parameters<typeof imports.commit>[0]) => {
      const result = await imports.commit(config);
      if (result.created > 0) await publishContactEvent({ type: "contacts.imported", bookId: config.bookId });
      return result;
    },
  },
};

export type {
  Contact,
  ContactBankAccount,
  ContactBankAccountInput,
  ContactBook,
  ContactBookAdminListItem,
  ContactDuplicateMatch,
  ContactDuplicateReason,
  ContactFavorite,
  ContactListFilter,
  ContactNote,
  ContactPresenceFilter,
  ContactRef,
  ContactSort,
  ContactTag,
  ContactTree,
  ContactTreeNode,
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
