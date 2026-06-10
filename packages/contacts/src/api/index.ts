import {
  AccessEntrySchema,
  createPagination,
  ErrorResponseSchema,
  GrantAccessSchema,
  hasRole,
  MessageResponseSchema,
  PaginationQuerySchema,
  PaginationResponseSchema,
  type PermissionLevel,
  parsePagination,
  ServiceAccountCredentialSchema,
  UpdateAccessSchema,
} from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, hasPermission, jsonResponse, rateLimit, requiresAuth, respond, respondMessage, v } from "@valentinkolb/cloud/server";
import { serviceAccountCredentials, serviceAccounts } from "@valentinkolb/cloud/services";
import { err, fail, ok } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { type Context, Hono, type MiddlewareHandler, type TypedResponse } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { contactsService } from "../service";
import { CONTACT_BOOK_RESOURCE_TYPE, CONTACTS_APP_ID } from "../service/access";
import * as vcard from "../service/vcard";
import { isSafeWebsiteUrl } from "../shared";

const documentRoute = (options: Parameters<typeof describeRoute>[0]) => describeRoute(options) as MiddlewareHandler<AuthContext>;

type ApiErrorResponse = TypedResponse<{ message: string; code?: string }, 400 | 401 | 403 | 404 | 409 | 500, "json">;
type ImportCandidate = ReturnType<typeof vcard.parse>[number];
type ImportMatch = { existingId: string; existingName: string } | null;
type ImportMatchHit = { id: string; name: string };
type ImportMatchIndex = {
  email: Map<string, ImportMatchHit>;
  name: Map<string, ImportMatchHit>;
};

const MAX_IMPORT_CONTACTS = 1_000;
const MAX_IMPORT_CONTENT_CHARS = 10_000_000;
const MAX_IMPORT_BODY_BYTES = 12_000_000;
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a #RRGGBB hex value");

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

const permissionFromScopes = (scopes: string[]): PermissionLevel => {
  if (scopes.includes("admin")) return "admin";
  if (scopes.includes("write")) return "write";
  if (scopes.includes("read")) return "read";
  return "none";
};

const minPermission = (a: PermissionLevel, b: PermissionLevel): PermissionLevel => (PERMISSION_RANK[a] <= PERMISSION_RANK[b] ? a : b);

const requireImportBodySize: MiddlewareHandler<AuthContext> = async (c, next) => {
  const rawLength = c.req.header("content-length");
  if (!rawLength) {
    return respond(c, fail(err.badInput("Import request requires Content-Length"))) as unknown as Response;
  }

  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0) {
    return respond(c, fail(err.badInput("Invalid Content-Length"))) as unknown as Response;
  }
  if (length > MAX_IMPORT_BODY_BYTES) {
    return respond(c, fail(err.badInput("Import request is too large"))) as unknown as Response;
  }

  return next();
};

const ContactBookSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const ContactBookApiKeySchema = ServiceAccountCredentialSchema.extend({
  permission: z.enum(["none", "read", "write", "admin"]),
});

const CreateContactBookApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  expiresAt: z.string().datetime().nullable().optional(),
  permission: z.enum(["read", "write", "admin"]).default("read"),
});

const CreateContactBookApiKeyResponseSchema = z.object({
  credential: ContactBookApiKeySchema,
  token: z.string(),
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

const ContactWebsiteSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  label: z.string().nullable(),
  url: z.string(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ContactBankAccountSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  label: z.string().nullable(),
  accountHolderName: z.string(),
  iban: z.string(),
  bic: z.string().nullable(),
  bankName: z.string().nullable(),
  note: z.string().nullable(),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ContactWebsiteInputSchema = z.object({
  label: z.string().max(100).nullable().optional(),
  url: z.string().trim().min(1).max(500).refine(isSafeWebsiteUrl, "Website URL must start with http:// or https://"),
});

const ContactBankAccountInputSchema = z.object({
  label: z.string().max(100).nullable().optional(),
  accountHolderName: z.string().min(1).max(200),
  iban: z.string().min(1).max(64),
  bic: z.string().max(32).nullable().optional(),
  bankName: z.string().max(200).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
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

type ContactTreeNodeApi = z.infer<typeof ContactRefSchema> & {
  parentContactId: string | null;
  children: ContactTreeNodeApi[];
};

const ContactTreeNodeSchema: z.ZodType<ContactTreeNodeApi> = z.lazy(() =>
  ContactRefSchema.extend({
    parentContactId: z.string().nullable(),
    children: z.array(ContactTreeNodeSchema),
  }),
);

const ContactTreeSchema = z.object({
  bookId: z.string(),
  selectedId: z.string(),
  root: ContactTreeNodeSchema,
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
  birthday: z.string().nullable(),
  salutation: z.string().nullable(),
  pronouns: z.string().nullable(),
  preferredLanguage: z.string().nullable(),
  source: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  emails: z.array(ContactEmailSchema),
  phones: z.array(ContactPhoneSchema),
  addresses: z.array(ContactAddressSchema),
  websites: z.array(ContactWebsiteSchema),
  bankAccounts: z.array(ContactBankAccountSchema),
  parentContactId: z.string().nullable(),
  parent: ContactRefSchema.nullable(),
  members: z.array(ContactRefSchema),
  tags: z.array(
    z.object({
      id: z.string(),
      bookId: z.string(),
      name: z.string(),
      color: HexColorSchema,
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

const ContactNoteSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  authorUserId: z.string().nullable(),
  authorDisplayName: z.string(),
  content: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ContactNoteInputSchema = z.object({
  content: z.string().min(1).max(10_000),
});

const ContactTagSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  name: z.string(),
  color: HexColorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ContactTagCreateInputSchema = z.object({
  name: z.string().min(1).max(50),
  color: HexColorSchema,
});

const ContactTagUpdateInputSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: HexColorSchema.optional(),
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
  /** Repeat `tag_id` to filter by multiple tags (OR-mode). */
  tag_id: z.union([z.string(), z.array(z.string())]).optional(),
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
  birthday: z.iso.date().nullable().optional(),
  salutation: z.string().max(120).nullable().optional(),
  pronouns: z.string().max(120).nullable().optional(),
  preferredLanguage: z.string().max(35).nullable().optional(),
  source: z.string().max(50).nullable().optional(),
  parentContactId: z.uuid().nullable().optional(),
  tagIds: z.array(z.uuid()).optional(),
  emails: z.array(ContactEmailInputSchema).optional(),
  phones: z.array(ContactPhoneInputSchema).optional(),
  addresses: z.array(ContactAddressInputSchema).optional(),
  websites: z.array(ContactWebsiteInputSchema).optional(),
  bankAccounts: z.array(ContactBankAccountInputSchema).optional(),
});

const UpdateContactSchema = z.object({
  label: z.string().max(200).nullable().optional(),
  firstName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  department: z.string().max(200).nullable().optional(),
  jobTitle: z.string().max(200).nullable().optional(),
  vatId: z.string().max(64).nullable().optional(),
  birthday: z.iso.date().nullable().optional(),
  salutation: z.string().max(120).nullable().optional(),
  pronouns: z.string().max(120).nullable().optional(),
  preferredLanguage: z.string().max(35).nullable().optional(),
  source: z.string().max(50).nullable().optional(),
  parentContactId: z.uuid().nullable().optional(),
  tagIds: z.array(z.uuid()).optional(),
  emails: z.array(ContactEmailInputSchema).optional(),
  phones: z.array(ContactPhoneInputSchema).optional(),
  addresses: z.array(ContactAddressInputSchema).optional(),
  websites: z.array(ContactWebsiteInputSchema).optional(),
  bankAccounts: z.array(ContactBankAccountInputSchema).optional(),
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

const ImportCommitResponseSchema = z.object({
  created: z.number(),
  failures: z.array(z.string()),
});

const getUserBackedActor = (c: Context<AuthContext>) => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const requireUserBackedActor = (c: Context<AuthContext>) => {
  const user = getUserBackedActor(c);
  if (!user) return fail(err.forbidden("This endpoint requires a user-backed actor"));
  return ok(user);
};

const getBookAccessSubject = (c: Context<AuthContext>) => {
  const user = getUserBackedActor(c);
  const accessSubject = c.get("accessSubject");
  const actor = c.get("actor");
  const serviceAccount = actor.kind === "service_account" ? actor.serviceAccount : null;
  return {
    user,
    userId: accessSubject.type === "user" ? accessSubject.userId : null,
    userGroups: user?.memberofGroupIds ?? [],
    serviceAccountId: accessSubject.type === "service_account" ? accessSubject.serviceAccountId : null,
    serviceAccount,
    serviceAccountScopes: actor.kind === "service_account" ? actor.scopes : [],
  };
};

/**
 * Resolves one book and checks required permissions for the current actor.
 */
const requireBookAccess = async (c: Context<AuthContext>, bookId: string, requiredLevel: PermissionLevel = "read") => {
  const subject = getBookAccessSubject(c);
  const book = await contactsService.book.get({ id: bookId });

  if (!book) {
    return {
      book: null,
      error: await respond(c, fail(err.notFound("Book"))),
    };
  }

  if (subject.user && hasRole(subject.user, "admin")) {
    return { book, permission: "admin" as PermissionLevel, user: subject.user, error: null as ApiErrorResponse | null };
  }

  if (
    subject.serviceAccount?.kind === "resource_bound" &&
    (subject.serviceAccount.appId !== CONTACTS_APP_ID ||
      subject.serviceAccount.resourceType !== CONTACT_BOOK_RESOURCE_TYPE ||
      subject.serviceAccount.resourceId !== bookId)
  ) {
    return {
      book: null,
      permission: "none" as PermissionLevel,
      user: subject.user,
      error: await respond(c, fail(err.forbidden("Access denied"))),
    };
  }

  let permission = await contactsService.book.permission.get({
    bookId,
    userId: subject.userId,
    userGroups: subject.userGroups,
    serviceAccountId: subject.serviceAccountId,
  });

  if (subject.serviceAccount?.kind === "resource_bound") {
    permission = minPermission(permission, permissionFromScopes(subject.serviceAccountScopes));
  }

  if (!hasPermission(permission, requiredLevel)) {
    return {
      book: null,
      permission: "none" as PermissionLevel,
      user: subject.user,
      error: await respond(c, fail(err.forbidden("Access denied"))),
    };
  }

  return { book, permission, user: subject.user, error: null as ApiErrorResponse | null };
};

const requireBookAdminOrAppAdmin = async (c: Context<AuthContext>, bookId: string) => {
  const user = getUserBackedActor(c);
  const book = await contactsService.book.get({ id: bookId });

  if (!book) {
    return {
      book: null,
      error: await respond(c, fail(err.notFound("Book"))),
    };
  }

  if (user && hasRole(user, "admin")) return { book, error: null as ApiErrorResponse | null };
  return requireBookAccess(c, bookId, "admin");
};

const requireManualBookAdminOrAppAdmin = async (c: Context<AuthContext>, bookId: string) => {
  if (contactsService.system.isBookId(bookId)) {
    return {
      book: null,
      error: await respond(c, fail(err.forbidden("System book is read-only"))),
    };
  }

  return requireBookAdminOrAppAdmin(c, bookId);
};

const safeExportFilename = (name: string | null | undefined, extension: "csv" | "vcf"): string => {
  const basename = (name ?? "contacts").replace(/[^a-z0-9-_]+/gi, "_");
  return `${basename}.${extension}`;
};

const loadBookContactsForExport = (bookId: string) => contactsService.contact.list({ bookId, pagination: { page: 1, perPage: 100_000 } });

const loadImportMatchIndex = async (bookId: string): Promise<ImportMatchIndex> => {
  const rows = await sql<{ id: string; first_name: string | null; last_name: string | null; label: string | null; emails: string[] }[]>`
    SELECT
      c.id,
      c.first_name,
      c.last_name,
      c.label,
      COALESCE(
        (SELECT array_agg(LOWER(ce.email)) FROM contacts.contact_emails ce WHERE ce.contact_id = c.id),
        '{}'::text[]
      ) AS emails
    FROM contacts.contacts c
    WHERE c.book_id = ${bookId}::uuid
  `;

  const email = new Map<string, ImportMatchHit>();
  const name = new Map<string, ImportMatchHit>();
  for (const row of rows) {
    const display = [row.first_name, row.last_name].filter(Boolean).join(" ") || row.label || row.id;
    for (const address of row.emails) {
      if (address) email.set(address, { id: row.id, name: display });
    }
    const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim().toLowerCase();
    if (fullName) name.set(fullName, { id: row.id, name: display });
  }

  return { email, name };
};

const findImportMatch = (candidate: ImportCandidate, index: ImportMatchIndex): ImportMatch => {
  for (const email of candidate.emails ?? []) {
    const hit = index.email.get(email.email.toLowerCase());
    if (hit) return { existingId: hit.id, existingName: hit.name };
  }

  const fullName = [candidate.firstName, candidate.lastName].filter(Boolean).join(" ").trim().toLowerCase();
  const hit = fullName ? index.name.get(fullName) : null;
  return hit ? { existingId: hit.id, existingName: hit.name } : null;
};

const previewImportCandidates = async (bookId: string, content: string) => {
  const candidates = vcard.parse(content);
  if (candidates.length > MAX_IMPORT_CONTACTS) {
    return fail(err.badInput(`Import is limited to ${MAX_IMPORT_CONTACTS} contacts at a time`));
  }

  const index = await loadImportMatchIndex(bookId);
  return ok({
    candidates: candidates.map((candidate) => ({
      candidate,
      match: findImportMatch(candidate, index),
    })),
  });
};

const commitImportContacts = async (bookId: string, candidates: unknown[]): Promise<{ created: number; failures: string[] }> => {
  let created = 0;
  const failures: string[] = [];
  for (const raw of candidates) {
    const parsed = CreateContactSchema.safeParse(raw);
    if (!parsed.success) {
      failures.push(parsed.error.message);
      continue;
    }
    const result = await contactsService.contact.create({ bookId, data: parsed.data });
    if (result.ok) created++;
    else failures.push(result.error.message);
  }
  return { created, failures };
};

const adminApi = new Hono<AuthContext>()
  .use(auth.requireRole("admin"))
  .get("/books/:bookId/access", async (c) => {
    const bookId = c.req.param("bookId") ?? "";
    const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
    if (error) return error;
    const entries = await contactsService.book.access.list({ bookId });
    return respond(c, ok(entries.items));
  })
  .post("/books/:bookId/access", v("json", GrantAccessSchema), async (c) => {
    const bookId = c.req.param("bookId") ?? "";
    const { principal, permission } = c.req.valid("json");
    const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
    if (error) return error;
    return respond(c, contactsService.book.access.grant({ bookId, principal, permission }));
  })
  .patch("/books/:bookId/access/:accessId", v("json", UpdateAccessSchema), async (c) => {
    const bookId = c.req.param("bookId") ?? "";
    const accessId = c.req.param("accessId") ?? "";
    const { permission } = c.req.valid("json");
    const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
    if (error) return error;

    return respondMessage(c, contactsService.book.access.update({ bookId, accessId, permission }), "Access updated");
  })
  .delete("/books/:bookId/access/:accessId", async (c) => {
    const bookId = c.req.param("bookId") ?? "";
    const accessId = c.req.param("accessId") ?? "";
    const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
    if (error) return error;

    return respondMessage(c, contactsService.book.access.remove({ bookId, accessId }), "Access revoked");
  });

/** Contacts API routes (IPA users only). */
const app = new Hono<AuthContext>()
  .use(rateLimit())
  .route("/admin", adminApi)
  .use(auth.requireRole("authenticated"))

  // ----------------------------------------------------------------
  // BOOKS
  // ----------------------------------------------------------------
  .get(
    "/books",
    documentRoute({
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
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
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
    documentRoute({
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
      const bookId = c.req.param("bookId") ?? "";
      const { book, error } = await requireBookAccess(c, bookId, "read");
      if (error || !book) return error!;
      return respond(c, ok(book));
    },
  )

  .post(
    "/books",
    documentRoute({
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
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
      const data = c.req.valid("json");
      return respond(c, contactsService.book.create({ data, creatorId: user.id }));
    },
  )

  .patch(
    "/books/:bookId",
    documentRoute({
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
      const bookId = c.req.param("bookId") ?? "";
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
    documentRoute({
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
      const bookId = c.req.param("bookId") ?? "";

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
    documentRoute({
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
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const bookId = c.req.param("bookId") ?? "";

      const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
      if (error) return error;

      const entries = await contactsService.book.access.list({ bookId });
      return respond(c, ok(entries.items));
    },
  )

  .post(
    "/books/:bookId/access",
    documentRoute({
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
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const bookId = c.req.param("bookId") ?? "";
      const { principal, permission } = c.req.valid("json");

      const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
      if (error) return error;

      return respond(c, contactsService.book.access.grant({ bookId, principal, permission }));
    },
  )

  .patch(
    "/books/:bookId/access/:accessId",
    documentRoute({
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
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const bookId = c.req.param("bookId") ?? "";
      const accessId = c.req.param("accessId") ?? "";
      const { permission } = c.req.valid("json");

      const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
      if (error) return error;

      return respondMessage(c, contactsService.book.access.update({ bookId, accessId, permission }), "Access updated");
    },
  )

  .delete(
    "/books/:bookId/access/:accessId",
    documentRoute({
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
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const bookId = c.req.param("bookId") ?? "";
      const accessId = c.req.param("accessId") ?? "";

      const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
      if (error) return error;

      return respondMessage(c, contactsService.book.access.remove({ bookId, accessId }), "Access revoked");
    },
  )

  // ----------------------------------------------------------------
  // BOOK API KEYS
  // ----------------------------------------------------------------
  .get(
    "/books/:bookId/api-keys",
    documentRoute({
      tags: ["Contacts"],
      summary: "List contact book API keys",
      description: "List active resource-bound API keys for this contact book. Requires admin book access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.object({ items: z.array(ContactBookApiKeySchema) }), "Contact book API keys"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Book not found"),
      },
    }),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const bookId = c.req.param("bookId") ?? "";

      const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
      if (error) return error;

      return respond(c, async () => ok({ items: await contactsService.book.access.apiKeys.list({ bookId }) }));
    },
  )

  .post(
    "/books/:bookId/api-keys",
    documentRoute({
      tags: ["Contacts"],
      summary: "Create contact book API key",
      description: "Create a resource-bound API key for this contact book. The raw token is returned once. Requires admin book access.",
      ...requiresAuth,
      responses: {
        201: jsonResponse(CreateContactBookApiKeyResponseSchema, "Contact book API key created"),
        400: jsonResponse(ErrorResponseSchema, "Failed to create API key"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Book not found"),
      },
    }),
    v("json", CreateContactBookApiKeySchema),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
      const bookId = c.req.param("bookId") ?? "";
      const data = c.req.valid("json");

      const { book, error } = await requireManualBookAdminOrAppAdmin(c, bookId);
      if (error || !book) return error!;

      return respond(c, async () => {
        const serviceAccount = await serviceAccounts.createResourceBound({
          name: `${book.name} API key: ${data.name}`,
          appId: CONTACTS_APP_ID,
          resourceType: CONTACT_BOOK_RESOURCE_TYPE,
          resourceId: bookId,
          createdBy: user.id,
        });
        if (!serviceAccount.ok) return serviceAccount;

        const cleanupServiceAccount = async () => {
          await serviceAccounts.delete({ id: serviceAccount.data.id });
        };

        const access = await contactsService.book.access.grant({
          bookId,
          principal: { type: "service_account", serviceAccountId: serviceAccount.data.id },
          permission: data.permission,
        });
        if (!access.ok) {
          await cleanupServiceAccount();
          return access;
        }

        const created = await serviceAccountCredentials.createResourceApiToken({
          serviceAccountId: serviceAccount.data.id,
          actor: user,
          name: data.name,
          expiresAt: data.expiresAt ?? null,
          scopes: [data.permission],
        });
        if (!created.ok) {
          await cleanupServiceAccount();
          return created;
        }

        return ok({
          credential: {
            ...created.data.credential,
            permission: access.data.permission,
          },
          token: created.data.token,
        });
      }, 201);
    },
  )

  .delete(
    "/books/:bookId/api-keys/:credentialId",
    documentRoute({
      tags: ["Contacts"],
      summary: "Revoke contact book API key",
      description: "Revoke a resource-bound API key for this contact book. Requires admin book access.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Contact book API key revoked"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "API key not found"),
      },
    }),
    async (c) => {
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
      const bookId = c.req.param("bookId") ?? "";
      const credentialId = c.req.param("credentialId") ?? "";

      const { error } = await requireManualBookAdminOrAppAdmin(c, bookId);
      if (error) return error;

      return respond(c, async () => {
        const keys = await contactsService.book.access.apiKeys.list({ bookId });
        if (!keys.some((key) => key.id === credentialId)) return fail(err.notFound("API key"));

        const revoked = await serviceAccountCredentials.revoke({ credentialId, actor: user });
        if (!revoked.ok) return revoked;
        return ok({ message: "API key revoked." });
      });
    },
  )

  // ----------------------------------------------------------------
  // CONTACTS
  // ----------------------------------------------------------------
  .get(
    "/books/:bookId/contacts",
    documentRoute({
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
      const bookId = c.req.param("bookId") ?? "";
      const query = c.req.valid("query");
      const pagination = parsePagination(query);

      const { error } = await requireBookAccess(c, bookId, "read");
      if (error) return error;

      const tagIds = Array.isArray(query.tag_id) ? query.tag_id : query.tag_id ? [query.tag_id] : undefined;

      const result = await contactsService.contact.list({
        bookId,
        pagination,
        filter: { query: query.q, tagIds },
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
    documentRoute({
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
      const bookId = c.req.param("bookId") ?? "";
      const contactId = c.req.param("contactId") ?? "";

      const { error } = await requireBookAccess(c, bookId, "read");
      if (error) return error;

      const contact = await contactsService.contact.get({ id: contactId, bookId });
      if (!contact) {
        return respond(c, fail(err.notFound("Contact")));
      }

      return respond(c, ok(contact));
    },
  )

  .get(
    "/books/:bookId/contacts/:contactId/tree",
    documentRoute({
      tags: ["Contacts"],
      summary: "Get contact tree",
      description: "Load the full hierarchy around one manual contact in a specific book.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactTreeSchema, "Contact hierarchy tree"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Contact tree not found"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const contactId = c.req.param("contactId") ?? "";

      const { error } = await requireBookAccess(c, bookId, "read");
      if (error) return error;

      const contactTree = await contactsService.contact.tree({ id: contactId, bookId });
      if (!contactTree) {
        return respond(c, fail(err.notFound("Contact tree")));
      }

      return respond(c, ok(contactTree));
    },
  )

  .post(
    "/books/:bookId/contacts",
    documentRoute({
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
      const bookId = c.req.param("bookId") ?? "";
      const data = c.req.valid("json");

      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;

      return respond(c, contactsService.contact.create({ bookId, data }));
    },
  )

  .patch(
    "/books/:bookId/contacts/:contactId",
    documentRoute({
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
      const bookId = c.req.param("bookId") ?? "";
      const contactId = c.req.param("contactId") ?? "";
      const data = c.req.valid("json");

      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;

      return respond(c, contactsService.contact.update({ bookId, id: contactId, data }));
    },
  )

  .post(
    "/books/:bookId/contacts/:contactId/move",
    documentRoute({
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
      const sourceBookId = c.req.param("bookId") ?? "";
      const contactId = c.req.param("contactId") ?? "";
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
    documentRoute({
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
      const bookId = c.req.param("bookId") ?? "";
      const contactId = c.req.param("contactId") ?? "";

      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;

      return respondMessage(c, contactsService.contact.remove({ bookId, id: contactId }), "Contact deleted");
    },
  )

  // ----------------------------------------------------------------
  // CONTACT NOTES (timeline)
  // ----------------------------------------------------------------
  .get(
    "/books/:bookId/contacts/:contactId/notes",
    documentRoute({
      tags: ["Contacts"],
      summary: "List contact notes",
      description: "Returns the timeline of notes attached to one contact, newest first.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.array(ContactNoteSchema), "Notes timeline"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const contactId = c.req.param("contactId") ?? "";

      const { error } = await requireBookAccess(c, bookId, "read");
      if (error) return error;

      const notes = await contactsService.contact.notes.list({ bookId, contactId });
      return c.json(notes);
    },
  )
  .post(
    "/books/:bookId/contacts/:contactId/notes",
    documentRoute({
      tags: ["Contacts"],
      summary: "Add a note to a contact",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactNoteSchema, "Created note"),
        400: jsonResponse(ErrorResponseSchema, "Validation error"),
      },
    }),
    v("json", ContactNoteInputSchema),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const contactId = c.req.param("contactId") ?? "";
      const data = c.req.valid("json");
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;

      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;

      return respond(
        c,
        contactsService.contact.notes.create({
          bookId,
          contactId,
          authorUserId: user.id,
          authorDisplayName: user.displayName ?? user.uid,
          data,
        }),
      );
    },
  )
  .patch(
    "/books/:bookId/contacts/:contactId/notes/:noteId",
    documentRoute({
      tags: ["Contacts"],
      summary: "Update one note",
      description: "Only the original author may edit their own note.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactNoteSchema, "Updated note"),
        403: jsonResponse(ErrorResponseSchema, "Not the author"),
      },
    }),
    v("json", ContactNoteInputSchema),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const contactId = c.req.param("contactId") ?? "";
      const noteId = c.req.param("noteId") ?? "";
      const data = c.req.valid("json");
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;

      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;

      return respond(
        c,
        contactsService.contact.notes.update({
          bookId,
          contactId,
          noteId,
          authorUserId: user.id,
          data,
        }),
      );
    },
  )
  .delete(
    "/books/:bookId/contacts/:contactId/notes/:noteId",
    documentRoute({
      tags: ["Contacts"],
      summary: "Delete one note",
      description: "Author or book admin may delete.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Note deleted"),
        403: jsonResponse(ErrorResponseSchema, "Not authorized"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const contactId = c.req.param("contactId") ?? "";
      const noteId = c.req.param("noteId") ?? "";
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;

      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;

      const permission = await contactsService.book.permission.get({
        bookId,
        userId: user.id,
        userGroups: user.memberofGroupIds,
      });

      return respondMessage(
        c,
        contactsService.contact.notes.remove({
          bookId,
          contactId,
          noteId,
          authorUserId: user.id,
          isBookAdmin: permission === "admin",
        }),
        "Note deleted",
      );
    },
  )

  // ----------------------------------------------------------------
  // TAGS (per book)
  // ----------------------------------------------------------------
  .get(
    "/books/:bookId/tags",
    documentRoute({
      tags: ["Contacts"],
      summary: "List tags for a book",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.array(ContactTagSchema), "Tags"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const { error } = await requireBookAccess(c, bookId, "read");
      if (error) return error;
      const items = await contactsService.tag.list({ bookId });
      return c.json(items);
    },
  )
  .post(
    "/books/:bookId/tags",
    documentRoute({
      tags: ["Contacts"],
      summary: "Create a tag",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactTagSchema, "Created tag"),
        409: jsonResponse(ErrorResponseSchema, "Name already exists"),
      },
    }),
    v("json", ContactTagCreateInputSchema),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const data = c.req.valid("json");
      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;
      return respond(c, contactsService.tag.create({ bookId, data }));
    },
  )
  .patch(
    "/books/:bookId/tags/:tagId",
    documentRoute({
      tags: ["Contacts"],
      summary: "Update a tag",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ContactTagSchema, "Updated tag"),
      },
    }),
    v("json", ContactTagUpdateInputSchema),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const tagId = c.req.param("tagId") ?? "";
      const data = c.req.valid("json");
      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;
      return respond(c, contactsService.tag.update({ bookId, id: tagId, data }));
    },
  )
  .delete(
    "/books/:bookId/tags/:tagId",
    documentRoute({
      tags: ["Contacts"],
      summary: "Delete a tag",
      ...requiresAuth,
      responses: {
        200: jsonResponse(MessageResponseSchema, "Tag deleted"),
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const tagId = c.req.param("tagId") ?? "";
      const { error } = await requireBookAccess(c, bookId, "write");
      if (error) return error;
      return respondMessage(c, contactsService.tag.remove({ bookId, id: tagId }), "Tag deleted");
    },
  )

  // ----------------------------------------------------------------
  // IMPORT / EXPORT
  // ----------------------------------------------------------------
  .get(
    "/books/:bookId/export.vcf",
    documentRoute({
      tags: ["Contacts"],
      summary: "Export book as vCard",
      ...requiresAuth,
      responses: {
        200: { description: "vCard file" },
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const { book, error } = await requireBookAccess(c, bookId, "admin");
      if (error) return error;
      const result = await loadBookContactsForExport(bookId);
      const body = vcard.serializeBook(result.items);
      return c.body(body, 200, {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeExportFilename(book?.name, "vcf")}"`,
      });
    },
  )
  .get(
    "/books/:bookId/export.csv",
    documentRoute({
      tags: ["Contacts"],
      summary: "Export book as CSV (flat — first email/phone/address only)",
      ...requiresAuth,
      responses: {
        200: { description: "CSV file" },
      },
    }),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const { book, error } = await requireBookAccess(c, bookId, "admin");
      if (error) return error;
      const result = await loadBookContactsForExport(bookId);
      const body = vcard.serializeBookCsv(result.items);
      return c.body(body, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeExportFilename(book?.name, "csv")}"`,
      });
    },
  )
  .post(
    "/books/:bookId/import/preview",
    documentRoute({
      tags: ["Contacts"],
      summary: "Parse a vCard payload and preview matches against existing contacts",
      description:
        "Returns the parsed candidates plus a match indicator (by email or by first+last name) so the client can present a checkbox list before commit.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(z.object({ candidates: z.array(z.unknown()) }), "Preview"),
      },
    }),
    requireImportBodySize,
    v(
      "json",
      z.object({
        format: z.enum(["vcard"]),
        content: z.string().min(1).max(MAX_IMPORT_CONTENT_CHARS),
      }),
    ),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const { error } = await requireBookAccess(c, bookId, "admin");
      if (error) return error;
      const body = c.req.valid("json");
      return respond(c, await previewImportCandidates(bookId, body.content));
    },
  )
  .post(
    "/books/:bookId/import/commit",
    documentRoute({
      tags: ["Contacts"],
      summary: "Bulk create contacts from a previously previewed candidate list",
      description:
        "Caller passes back the candidates that should be created. The server creates them in order and returns the created ids.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(ImportCommitResponseSchema, "Created count with per-contact failures"),
      },
    }),
    requireImportBodySize,
    v(
      "json",
      z.object({
        contacts: z.array(z.unknown()).max(MAX_IMPORT_CONTACTS),
      }),
    ),
    async (c) => {
      const bookId = c.req.param("bookId") ?? "";
      const { error } = await requireBookAccess(c, bookId, "admin");
      if (error) return error;
      const body = c.req.valid("json");
      return c.json(await commitImportContacts(bookId, body.contacts));
    },
  )

  // ----------------------------------------------------------------
  // GLOBAL SEARCH
  // ----------------------------------------------------------------
  .get(
    "/search",
    documentRoute({
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
      const userResult = requireUserBackedActor(c);
      if (!userResult.ok) return respond(c, userResult);
      const user = userResult.data;
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
