import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { v, jsonResponse, requiresAuth, auth, type AuthContext, rateLimit, respond, updateAccess } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import {
  PaginationQuerySchema,
  PaginationResponseSchema,
  ErrorResponseSchema,
  MessageResponseSchema,
  AccessEntrySchema,
  GrantAccessSchema,
  UpdateAccessSchema,
} from "@valentinkolb/cloud/contracts";
import { createPagination, parsePagination, type PermissionLevel } from "@valentinkolb/cloud/contracts";
import { contactsService } from "../service";

const ContactBookSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const ContactEmailSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  label: z.string().nullable(),
  email: z.email(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ContactPhoneSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  label: z.string().nullable(),
  phone: z.string(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ContactAddressSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  label: z.string().nullable(),
  recipientName: z.string().nullable(),
  companyName: z.string().nullable(),
  line1: z.string(),
  line2: z.string().nullable(),
  postalCode: z.string(),
  city: z.string(),
  stateRegion: z.string().nullable(),
  countryCode: z.string().length(2),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ContactRefSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  companyName: z.string().nullable(),
  jobTitle: z.string().nullable(),
});

const ContactSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  label: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  companyName: z.string().nullable(),
  department: z.string().nullable(),
  jobTitle: z.string().nullable(),
  vatId: z.string().nullable(),
  website: z.string().nullable(),
  birthday: z.string().nullable(),
  note: z.string().nullable(),
  source: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  emails: z.array(ContactEmailSchema),
  phones: z.array(ContactPhoneSchema),
  addresses: z.array(ContactAddressSchema),
  parentContactId: z.string().nullable(),
  parent: ContactRefSchema.nullable(),
  members: z.array(ContactRefSchema),
});

const ContactEmailInputSchema = z.object({
  label: z.string().max(100).nullable().optional(),
  email: z.email(),
});

const ContactPhoneInputSchema = z.object({
  label: z.string().max(100).nullable().optional(),
  phone: z.string().min(1).max(64),
});

const ContactAddressInputSchema = z.object({
  label: z.string().max(100).nullable().optional(),
  recipientName: z.string().max(200).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullable().optional(),
  postalCode: z.string().min(1).max(32),
  city: z.string().min(1).max(120),
  stateRegion: z.string().max(120).nullable().optional(),
  countryCode: z.string().length(2),
});

const CreateBookSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

const UpdateBookSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
});

const ListBooksQuerySchema = PaginationQuerySchema.extend({
  q: z.string().optional(),
});

const ListContactsQuerySchema = PaginationQuerySchema.extend({
  q: z.string().optional(),
});

const SearchContactsQuerySchema = PaginationQuerySchema.extend({
  q: z.string().optional(),
  includeSystem: z.coerce.boolean().optional(),
});

const CreateContactSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  firstName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  department: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  vatId: z.string().max(64).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  birthday: z.iso.date().nullable().optional(),
  note: z.string().max(10_000).nullable().optional(),
  source: z.string().max(50).nullable().optional(),
  parentContactId: z.uuid().nullable().optional(),
  emails: z.array(ContactEmailInputSchema).optional(),
  phones: z.array(ContactPhoneInputSchema).optional(),
  addresses: z.array(ContactAddressInputSchema).optional(),
});

const UpdateContactSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  firstName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  department: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  vatId: z.string().max(64).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  birthday: z.iso.date().nullable().optional(),
  note: z.string().max(10_000).nullable().optional(),
  source: z.string().max(50).nullable().optional(),
  parentContactId: z.uuid().nullable().optional(),
  emails: z.array(ContactEmailInputSchema).optional(),
  phones: z.array(ContactPhoneInputSchema).optional(),
  addresses: z.array(ContactAddressInputSchema).optional(),
});

const MoveContactSchema = z.object({
  targetBookId: z.string(),
});

const ContactBookListResponseSchema = z.object({
  data: z.array(ContactBookSchema),
  pagination: PaginationResponseSchema,
});

const ContactListResponseSchema = z.object({
  data: z.array(ContactSchema),
  pagination: PaginationResponseSchema,
});

/**
 * Central helper for mutation handlers that only return a message payload.
 */
const respondMessage = async (c: Context, resultPromise: Promise<Result<void>>, message: string) => {
  return respond(c, async () => {
    const result = await resultPromise;
    if (!result.ok) return result;
    return ok({ message });
  });
};

/**
 * Resolves one book and checks required permissions for the current user.
 */
const requireBookAccess = async (c: Context<AuthContext>, bookId: string, requiredLevel: PermissionLevel = "read") => {
  const user = c.get("user");
  const book = await contactsService.book.get({ id: bookId });

  if (!book) {
    return {
      book: null,
      error: await respond(c, fail(err.notFound("Book"))),
    };
  }

  const hasAccess = await contactsService.book.permission.canAccess({
    bookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    requiredLevel,
  });

  if (!hasAccess) {
    return {
      book: null,
      error: await respond(c, fail(err.forbidden("Access denied"))),
    };
  }

  return { book, error: null as Response | null };
};

/** Contacts API routes (IPA users only). */
const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("user"))

  // ----------------------------------------------------------------
  // BOOKS
  // ----------------------------------------------------------------
  .get(
    "/books",
    describeRoute({
      tags: ["Contacts"],
      summary: "List books",
      description: "List contact books visible to the current user, including the virtual system book.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactBookListResponseSchema, "Paginated book list"),
      },
    }),
    v("query", ListBooksQuerySchema),
    async (c) => {
      const user = c.get("user");
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const result = await contactsService.book.list({
        userId: user.id,
        groups: user.memberofGroupIds,
        pagination,
        filter: { query: query.q },
      });

      return respond(
        c,
        ok({
          data: result.items,
          pagination: createPagination(pagination, result.total),
        }),
      );
    },
  )

  .get(
    "/books/:bookId",
    describeRoute({
      tags: ["Contacts"],
      summary: "Get book",
      description: "Load one contact book by ID.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactBookSchema, "Book details"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Book not found"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId");
      const { book, error } = await requireBookAccess(c, bookId, "read");
      if (error || !book) return error!;
      return respond(c, ok(book));
    },
  )

  .post(
    "/books",
    describeRoute({
      tags: ["Contacts"],
      summary: "Create book",
      description: "Create a manual contact book.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactBookSchema, "Created book"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
      },
    }),
    v("json", CreateBookSchema),
    async (c) => {
      const user = c.get("user");
      const data = c.req.valid("json");
      return respond(c, contactsService.book.create({ data, creatorId: user.id }));
    },
  )

  .patch(
    "/books/:bookId",
    describeRoute({
      tags: ["Contacts"],
      summary: "Update book",
      description: "Update one manual contact book. Requires admin book access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactBookSchema, "Updated book"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Book not found"),
      },
    }),
    v("json", UpdateBookSchema),
    async (c) => {
      const bookId = c.req.param("bookId");
      const data = c.req.valid("json");

      const { book, error } = await requireBookAccess(c, bookId, "admin");
      if (error || !book) return error!;

      if (book.isSystem) {
        return respond(c, fail(err.forbidden("System book is read-only")));
      }

      return respond(c, contactsService.book.update({ id: bookId, data }));
    },
  )

  .delete(
    "/books/:bookId",
    describeRoute({
      tags: ["Contacts"],
      summary: "Delete book",
      description: "Delete one manual contact book. Requires admin book access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Book deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Book not found"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId");

      const { book, error } = await requireBookAccess(c, bookId, "admin");
      if (error || !book) return error!;

      if (book.isSystem) {
        return respond(c, fail(err.forbidden("System book is read-only")));
      }

      return respondMessage(c, contactsService.book.remove({ id: bookId }), "Book deleted");
    },
  )

  // ----------------------------------------------------------------
  // BOOK ACCESS (ACL)
  // ----------------------------------------------------------------
  .get(
    "/books/:bookId/access",
    describeRoute({
      tags: ["Contacts"],
      summary: "List book access entries",
      description: "List all access entries for a manual book. Requires admin book access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.array(AccessEntrySchema), "Access entries"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Book not found"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId");

      if (contactsService.system.isBookId(bookId)) {
        return respond(c, fail(err.forbidden("System book is read-only")));
      }

      const { error } = await requireBookAccess(c, bookId, "admin");
      if (error) return error;

      const entries = await contactsService.book.access.list({ bookId });
      return respond(c, ok(entries.items));
    },
  )

  .post(
    "/books/:bookId/access",
    describeRoute({
      tags: ["Contacts"],
      summary: "Grant book access",
      description: "Grant access to a user, group, or public principal for a manual book. Requires admin book access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AccessEntrySchema, "Created access entry"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Book or principal not found"),
        409: jsonResponse(ErrorResponseSchema, "Principal already has access"),
      },
    }),
    v("json", GrantAccessSchema),
    async (c) => {
      const bookId = c.req.param("bookId");
      const { principal, permission } = c.req.valid("json");

      if (contactsService.system.isBookId(bookId)) {
        return respond(c, fail(err.forbidden("System book is read-only")));
      }

      const { error } = await requireBookAccess(c, bookId, "admin");
      if (error) return error;

      return respond(c, contactsService.book.access.grant({ bookId, principal, permission }));
    },
  )

  .patch(
    "/books/:bookId/access/:accessId",
    describeRoute({
      tags: ["Contacts"],
      summary: "Update book access permission",
      description: "Update one access permission for a manual book. Requires admin book access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Access updated"),
        400: jsonResponse(ErrorResponseSchema, "Cannot remove the last admin from this book"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Access entry not found"),
      },
    }),
    v("json", UpdateAccessSchema),
    async (c) => {
      const bookId = c.req.param("bookId");
      const accessId = c.req.param("accessId");
      const { permission } = c.req.valid("json");

      if (contactsService.system.isBookId(bookId)) {
        return respond(c, fail(err.forbidden("System book is read-only")));
      }

      const { error } = await requireBookAccess(c, bookId, "admin");
      if (error) return error;

      const guard = await contactsService.book.access.guard({ bookId, accessId });
      if (!guard.currentPermission) {
        return respond(c, fail(err.notFound("Access entry")));
      }

      if (guard.currentPermission === "admin" && permission !== "admin" && guard.otherAdmins <= 0) {
        return respond(c, fail(err.badInput("Cannot remove the last admin")));
      }

      return respondMessage(c, updateAccess({ id: accessId, permission }), "Access updated");
    },
  )

  .delete(
    "/books/:bookId/access/:accessId",
    describeRoute({
      tags: ["Contacts"],
      summary: "Revoke book access",
      description: "Delete one access entry from a manual book. Requires admin book access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Access revoked"),
        400: jsonResponse(ErrorResponseSchema, "Cannot remove the last access entry/admin from this book"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Access entry not found"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId");
      const accessId = c.req.param("accessId");

      if (contactsService.system.isBookId(bookId)) {
        return respond(c, fail(err.forbidden("System book is read-only")));
      }

      const { error } = await requireBookAccess(c, bookId, "admin");
      if (error) return error;

      const guard = await contactsService.book.access.guard({ bookId, accessId });
      if (!guard.currentPermission) {
        return respond(c, fail(err.notFound("Access entry")));
      }

      if (guard.total <= 1) {
        return respond(c, fail(err.badInput("Cannot remove the last access entry")));
      }

      if (guard.currentPermission === "admin" && guard.otherAdmins <= 0) {
        return respond(c, fail(err.badInput("Cannot remove the last admin")));
      }

      return respondMessage(c, contactsService.book.access.remove({ bookId, accessId }), "Access revoked");
    },
  )

  // ----------------------------------------------------------------
  // CONTACTS
  // ----------------------------------------------------------------
  .get(
    "/books/:bookId/contacts",
    describeRoute({
      tags: ["Contacts"],
      summary: "List contacts",
      description: "List contacts in a book with pagination and optional search filter.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactListResponseSchema, "Paginated contacts"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Book not found"),
      },
    }),
    v("query", ListContactsQuerySchema),
    async (c) => {
      const bookId = c.req.param("bookId");
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const { error } = await requireBookAccess(c, bookId, "read");
      if (error) return error;

      const result = await contactsService.contact.list({
        bookId,
        pagination,
        filter: { query: query.q },
      });

      return respond(
        c,
        ok({
          data: result.items,
          pagination: createPagination(pagination, result.total),
        }),
      );
    },
  )

  .get(
    "/books/:bookId/contacts/:contactId",
    describeRoute({
      tags: ["Contacts"],
      summary: "Get contact",
      description: "Load one contact from a specific book.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactSchema, "Contact"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Contact or book not found"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId");
      const contactId = c.req.param("contactId");

      const { error } = await requireBookAccess(c, bookId, "read");
      if (error) return error;

      const contact = await contactsService.contact.get({ id: contactId, bookId });
      if (!contact) {
        return respond(c, fail(err.notFound("Contact")));
      }

      return respond(c, ok(contact));
    },
  )

  .post(
    "/books/:bookId/contacts",
    describeRoute({
      tags: ["Contacts"],
      summary: "Create contact",
      description: "Create one contact with optional emails/phones/addresses.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactSchema, "Created contact"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Book not found"),
      },
    }),
    v("json", CreateContactSchema),
    async (c) => {
      const bookId = c.req.param("bookId");
      const data = c.req.valid("json");

      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;

      return respond(c, contactsService.contact.create({ bookId, data }));
    },
  )

  .patch(
    "/books/:bookId/contacts/:contactId",
    describeRoute({
      tags: ["Contacts"],
      summary: "Update contact",
      description: "Update one contact. Provided child arrays fully replace existing entries.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactSchema, "Updated contact"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Contact or book not found"),
      },
    }),
    v("json", UpdateContactSchema),
    async (c) => {
      const bookId = c.req.param("bookId");
      const contactId = c.req.param("contactId");
      const data = c.req.valid("json");

      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;

      return respond(c, contactsService.contact.update({ bookId, id: contactId, data }));
    },
  )

  .post(
    "/books/:bookId/contacts/:contactId/move",
    describeRoute({
      tags: ["Contacts"],
      summary: "Move contact",
      description: "Move one contact from the current manual book to another writable manual book.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactSchema, "Moved contact"),
        400: jsonResponse(ErrorResponseSchema, "Invalid request"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Contact or book not found"),
      },
    }),
    v("json", MoveContactSchema),
    async (c) => {
      const sourceBookId = c.req.param("bookId");
      const contactId = c.req.param("contactId");
      const { targetBookId } = c.req.valid("json");

      const { error: sourceError } = await requireBookAccess(c, sourceBookId, "write");
      if (sourceError) return sourceError;

      const { book: targetBook, error: targetError } = await requireBookAccess(c, targetBookId, "write");
      if (targetError || !targetBook) return targetError!;

      if (targetBook.isSystem) {
        return respond(c, fail(err.forbidden("System book is read-only")));
      }

      return respond(c, contactsService.contact.move({ sourceBookId, targetBookId, id: contactId }));
    },
  )

  .delete(
    "/books/:bookId/contacts/:contactId",
    describeRoute({
      tags: ["Contacts"],
      summary: "Delete contact",
      description: "Delete one contact from the selected book.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Contact deleted"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Contact or book not found"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId");
      const contactId = c.req.param("contactId");

      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;

      return respondMessage(c, contactsService.contact.remove({ bookId, id: contactId }), "Contact deleted");
    },
  )

  // ----------------------------------------------------------------
  // GLOBAL SEARCH
  // ----------------------------------------------------------------
  .get(
    "/search",
    describeRoute({
      tags: ["Contacts"],
      summary: "Search contacts",
      description: "Search across all readable manual books and optionally the system book, returning paginated matches.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactListResponseSchema, "Search results"),
      },
    }),
    v("query", SearchContactsQuerySchema),
    async (c) => {
      const user = c.get("user");
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const result = await contactsService.contact.search({
        userId: user.id,
        groups: user.memberofGroupIds,
        pagination,
        filter: {
          query: query.q,
          includeSystem: query.includeSystem ?? false,
        },
      });

      return respond(
        c,
        ok({
          data: result.items,
          pagination: createPagination(pagination, result.total),
        }),
      );
    },
  );

export default app;
export type ApiType = typeof app;
