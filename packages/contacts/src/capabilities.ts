import { createHash } from "node:crypto";
import { err, fail, ok, type Paginated, type Result } from "@k2b/stdlib";
import {
  type CapabilityExecutionContext,
  type CapabilityInvocationResult,
  type CapabilityResult,
  type CloudResourceView,
  defineCapabilities,
  hasRole,
  UniversalSearchDataSchema,
  type UniversalSearchInput,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { hasPermission, type PermissionLevel } from "@valentinkolb/cloud/server";
import { type AuditActor, audit } from "@valentinkolb/cloud/services";
import type { z } from "zod";
import {
  ContactBookListDataSchema,
  ContactBookListInputSchema,
  ContactCreateInputSchema,
  ContactDeleteDataSchema,
  ContactDeleteInputSchema,
  ContactDetailDataSchema,
  ContactGetInputSchema,
  ContactListDataSchema,
  ContactListInputSchema,
  ContactMoveInputSchema,
  ContactMutationDataSchema,
  ContactNoteCreateDataSchema,
  ContactNoteCreateInputSchema,
  ContactNoteListDataSchema,
  ContactNoteListInputSchema,
  ContactTagChangeDataSchema,
  ContactTagChangeInputSchema,
  ContactTagListDataSchema,
  ContactTagListInputSchema,
  ContactUpdateInputSchema,
  FavoriteSetDataSchema,
  FavoriteSetInputSchema,
} from "./capability-contracts";
import { type Contact, type ContactBook, type ContactNote, type ContactTag, contactsService } from "./service";
import { CONTACT_BOOK_RESOURCE_TYPE, CONTACTS_APP_ID } from "./service/access";
import { SYSTEM_BOOK_ID } from "./service/system";
import { resolveContactName } from "./shared";

const CONTACT_CREATE_ACTION_ID = "contacts.contact.create";
const NOTE_CREATE_ACTION_ID = "contacts.note.create";

const contactHref = (contact: Pick<Contact, "id" | "bookId">): string =>
  `/app/contacts/${contact.bookId}?contact=${contact.id}&contactBook=${contact.bookId}`;

const mapTag = (tag: ContactTag) => ({
  id: tag.id,
  bookId: tag.bookId,
  name: tag.name,
  color: tag.color,
  createdAt: tag.createdAt,
  updatedAt: tag.updatedAt,
});

const mapContactSummary = (contact: Contact) => ({
  id: contact.id,
  bookId: contact.bookId,
  displayName: resolveContactName(contact),
  companyName: contact.companyName,
  jobTitle: contact.jobTitle,
  primaryEmail: contact.emails[0]?.email ?? null,
  primaryPhone: contact.phones[0]?.phone ?? null,
  tags: contact.tags.map(mapTag),
  updatedAt: contact.updatedAt,
});

const mapContactDetail = (contact: Contact) => ({
  ...mapContactSummary(contact),
  label: contact.label,
  firstName: contact.firstName,
  lastName: contact.lastName,
  department: contact.department,
  vatId: contact.vatId,
  birthday: contact.birthday,
  salutation: contact.salutation,
  pronouns: contact.pronouns,
  preferredLanguage: contact.preferredLanguage,
  parentContactId: contact.parentContactId,
  emails: contact.emails.map((item) => ({ label: item.label, email: item.email })),
  phones: contact.phones.map((item) => ({ label: item.label, phone: item.phone })),
  addresses: contact.addresses.map((item) => ({
    label: item.label,
    recipientName: item.recipientName,
    companyName: item.companyName,
    line1: item.line1,
    line2: item.line2,
    postalCode: item.postalCode,
    city: item.city,
    stateRegion: item.stateRegion,
    countryCode: item.countryCode,
  })),
  websites: contact.websites.map((item) => ({ label: item.label, url: item.url })),
  bankAccounts: contact.bankAccounts.map((item) => ({
    label: item.label,
    accountHolderName: item.accountHolderName,
    iban: item.iban,
    bic: item.bic,
    bankName: item.bankName,
    note: item.note,
  })),
  createdAt: contact.createdAt,
});

const mapNote = (note: ContactNote) => ({
  id: note.id,
  contactId: note.contactId,
  authorUserId: note.authorUserId,
  authorDisplayName: note.authorDisplayName,
  content: note.content,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
});

const encodeCursor = (page: number): string => Buffer.from(JSON.stringify({ v: 1, page }), "utf8").toString("base64url");

export const decodeContactCapabilityCursor = (cursor: string | undefined): Result<number> => {
  if (!cursor) return ok(1);
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; page?: unknown };
    return value.v === 1 && Number.isInteger(value.page) && Number(value.page) >= 1
      ? ok(Number(value.page))
      : fail(err.badInput("Invalid cursor"));
  } catch {
    return fail(err.badInput("Invalid cursor"));
  }
};

const pageResult = <T>(page: Paginated<unknown>, data: T, refs?: CapabilityResult<T>["refs"]): CapabilityInvocationResult<T> =>
  ok({
    data,
    ...(refs ? { refs } : {}),
    page: { hasMore: page.hasNext, ...(page.hasNext ? { nextCursor: encodeCursor(page.page + 1) } : {}) },
  });

const permissionFromScopes = (scopes: readonly string[]): PermissionLevel => {
  if (scopes.includes("admin")) return "admin";
  if (scopes.includes("write")) return "write";
  if (scopes.includes("read")) return "read";
  return "none";
};

const minPermission = (left: PermissionLevel, right: PermissionLevel): PermissionLevel => {
  const ranks: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2, admin: 3 };
  return ranks[left] <= ranks[right] ? left : right;
};

const userBacked = (context: CapabilityExecutionContext) => context.user;

const resourceBoundBookId = (context: CapabilityExecutionContext): string | null => {
  if (context.actor.kind !== "service_account" || context.actor.serviceAccount.kind !== "resource_bound") return null;
  const account = context.actor.serviceAccount;
  return account.appId === CONTACTS_APP_ID && account.resourceType === CONTACT_BOOK_RESOURCE_TYPE ? (account.resourceId ?? null) : null;
};

const serviceAccountBindingValid = (context: CapabilityExecutionContext): boolean =>
  context.accessSubject.type !== "service_account" ||
  (resourceBoundBookId(context) !== null &&
    hasPermission(permissionFromScopes(context.actor.kind === "service_account" ? context.actor.scopes : []), "read"));

const requireBookPermission = async (
  bookId: string,
  context: CapabilityExecutionContext,
  required: PermissionLevel,
): Promise<Result<{ book: ContactBook; permission: PermissionLevel }>> => {
  const book = await contactsService.book.get({ id: bookId });
  if (!book) return fail(err.notFound("Book"));

  const user = userBacked(context);
  if (user && hasRole(user, "admin")) return ok({ book, permission: "admin" });
  if (book.isSystem) {
    return user && required === "read" ? ok({ book, permission: "read" }) : fail(err.forbidden("System contacts are read-only"));
  }

  if (context.accessSubject.type === "service_account") {
    const boundBookId = resourceBoundBookId(context);
    if (!boundBookId || boundBookId !== bookId) return fail(err.forbidden("Access denied"));
  }

  let permission = await contactsService.book.permission.get({ bookId, subject: context.accessSubject });
  if (context.actor.kind === "service_account" && context.actor.serviceAccount.kind === "resource_bound") {
    permission = minPermission(permission, permissionFromScopes(context.actor.scopes));
  }
  return hasPermission(permission, required)
    ? ok({ book, permission })
    : fail(err.forbidden(`${required === "read" ? "Read" : "Write"} access to this address book is required`));
};

const resolveContact = async (
  contactId: string,
  context: CapabilityExecutionContext,
  required: PermissionLevel = "read",
): Promise<Result<{ contact: Contact; bookId: string }>> => {
  const manualBookId = await contactsService.contact.findBookId({ id: contactId });
  const bookId = manualBookId ?? SYSTEM_BOOK_ID;
  const access = await requireBookPermission(bookId, context, required);
  if (!access.ok) return access;
  const contact = await contactsService.contact.get({ bookId, id: contactId });
  return contact ? ok({ contact, bookId }) : fail(err.notFound("Contact"));
};

const capabilityAuditActor = (context: CapabilityExecutionContext): AuditActor =>
  context.actor.kind === "user"
    ? {
        userId: context.actor.user.id,
        uid: context.actor.user.uid,
        provider: context.actor.user.provider,
        roles: context.actor.user.roles,
      }
    : {
        uid: `service-account:${context.actor.serviceAccount.id}`,
        provider: "service_account",
        roles: context.actor.scopes,
      };

const actionAudit = (context: CapabilityExecutionContext, actionId: string, targetType: string, targetId: string) => ({
  action: `contacts.capability.${actionId}`,
  actor: capabilityAuditActor(context),
  target: { type: targetType, id: targetId },
  metadata: { capability: `contacts.${actionId}` },
});

const audited = async <T>(
  params: ReturnType<typeof actionAudit>,
  operation: () => Promise<CapabilityInvocationResult<T>>,
  replayed: boolean | (() => boolean) = false,
): Promise<CapabilityInvocationResult<T>> => {
  const result = await operation();
  if (!result.ok) return audit.recordResult({ ...params, result });
  const wasReplayed = typeof replayed === "function" ? replayed() : replayed;
  return wasReplayed
    ? audit.recordResult({ ...params, metadata: { ...params.metadata, replayed: true }, result })
    : audit.recordResultAfterSideEffect({ ...params, result });
};

const actorKey = (context: CapabilityExecutionContext): string =>
  context.actor.kind === "user" ? `user:${context.actor.user.id}` : `service_account:${context.actor.serviceAccount.id}`;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const runSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const user = userBacked(context);
  if ((!user || (!user.roles.includes("user") && !user.roles.includes("admin"))) && !serviceAccountBindingValid(context)) {
    return ok({ data: [] });
  }
  const tags = new Set(input.tags);
  const page = await contactsService.contact.search({
    subject: context.accessSubject,
    boundBookId: resourceBoundBookId(context),
    bypassAccess: Boolean(user && hasRole(user, "admin")),
    pagination: { page: 1, perPage: input.limit },
    filter: {
      query: input.query,
      includeSystem: Boolean(user),
      email: tags.has("email") ? "yes" : "all",
      phone: tags.has("phone") ? "yes" : "all",
    },
  });
  const data: CloudResourceView[] = page.items.map((contact) => {
    const primary = contact.emails[0]?.email ?? contact.phones[0]?.phone;
    return {
      ref: { type: "contacts.contact", id: contact.id },
      title: resolveContactName(contact),
      ...(primary ? { preview: primary } : {}),
      icon: "ti ti-address-book",
      priority: 7,
      metadata: [
        { label: "Type", value: "Contact" },
        { label: "Book", value: contact.bookId },
      ],
      links: [{ rel: "open", href: contactHref(contact) }],
    };
  });
  return ok({ data });
};

const runContactList = async (input: z.infer<typeof ContactListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeContactCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const access = await requireBookPermission(input.bookId, context, "read");
  if (!access.ok) return access;
  if (input.favoritesOnly && !userBacked(context)) return fail(err.forbidden("Favorites require a user-backed actor"));
  const page = await contactsService.contact.list({
    bookId: input.bookId,
    pagination: { page: cursor.data, perPage: input.limit },
    filter: {
      query: input.query,
      tagIds: input.tagIds,
      sort: input.sort,
      email: input.email,
      phone: input.phone,
      ...(input.favoritesOnly && userBacked(context) ? { favoriteUserId: userBacked(context)?.id } : {}),
    },
  });
  return pageResult(
    page,
    page.items.map(mapContactSummary),
    page.items.map((contact) => ({ type: "contacts.contact", id: contact.id })),
  );
};

const runContactGet = async (input: z.infer<typeof ContactGetInputSchema>, context: CapabilityExecutionContext) => {
  const resolved = await resolveContact(input.contactId, context);
  if (!resolved.ok) return resolved;
  return ok({
    data: mapContactDetail(resolved.data.contact),
    refs: [{ type: "contacts.contact", id: resolved.data.contact.id }],
    links: [{ rel: "open" as const, href: contactHref(resolved.data.contact) }],
  });
};

const runBookList = async (input: z.infer<typeof ContactBookListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeContactCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  if (!serviceAccountBindingValid(context)) return fail(err.forbidden("A resource-bound Contacts credential is required"));
  const user = userBacked(context);
  if (user && hasRole(user, "admin")) {
    const page = await contactsService.book.admin.list({
      pagination: { page: cursor.data, perPage: input.limit },
      filter: { query: input.query },
    });
    return pageResult(
      page,
      page.items.map((book) => ({
        id: book.id,
        name: book.name,
        description: book.description,
        permission: "admin" as const,
        createdAt: book.createdAt,
        updatedAt: book.updatedAt,
      })),
      page.items.map((book) => ({ type: "contacts.book", id: book.id })),
    );
  }
  const page = await contactsService.book.listPage({
    subject: context.accessSubject,
    boundBookId: resourceBoundBookId(context),
    pagination: { page: cursor.data, perPage: input.limit },
    filter: { query: input.query },
  });
  const scopedPermission =
    context.actor.kind === "service_account" && context.actor.serviceAccount.kind === "resource_bound"
      ? permissionFromScopes(context.actor.scopes)
      : ("admin" as PermissionLevel);
  return pageResult(
    page,
    page.items.map((book) => ({
      id: book.id,
      name: book.name,
      description: book.description,
      permission: minPermission(book.permission, scopedPermission) as "read" | "write" | "admin",
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
    })),
    page.items.map((book) => ({ type: "contacts.book", id: book.id })),
  );
};

const runTagList = async (input: z.infer<typeof ContactTagListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeContactCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const access = await requireBookPermission(input.bookId, context, "read");
  if (!access.ok) return access;
  const page = await contactsService.tag.listPage({ bookId: input.bookId, pagination: { page: cursor.data, perPage: input.limit } });
  return pageResult(
    page,
    page.items.map(mapTag),
    page.items.map((tag) => ({ type: "contacts.tag", id: tag.id })),
  );
};

const runNoteList = async (input: z.infer<typeof ContactNoteListInputSchema>, context: CapabilityExecutionContext) => {
  const cursor = decodeContactCapabilityCursor(input.cursor);
  if (!cursor.ok) return cursor;
  const resolved = await resolveContact(input.contactId, context);
  if (!resolved.ok) return resolved;
  if (resolved.data.bookId === SYSTEM_BOOK_ID) return fail(err.badInput("System contacts do not have notes"));
  const page = await contactsService.contact.notes.listPage({
    bookId: resolved.data.bookId,
    contactId: input.contactId,
    pagination: { page: cursor.data, perPage: input.limit },
  });
  return pageResult(
    page,
    page.items.map(mapNote),
    page.items.map((note) => ({ type: "contacts.note", id: note.id })),
  );
};

const runContactCreate = async (input: z.infer<typeof ContactCreateInputSchema>, context: CapabilityExecutionContext) => {
  const auditParams = actionAudit(context, "contact.create", "contact_book", input.bookId);
  let replayed = false;
  return audited(
    auditParams,
    async () => {
      if (!context.idempotencyKey) return fail(err.badInput("Idempotency-Key is required"));
      const access = await requireBookPermission(input.bookId, context, "write");
      if (!access.ok) return access;
      const { bookId, ...data } = input;
      const result = await contactsService.contact.createIdempotent({
        bookId,
        data: { ...data, source: "capability" },
        actorKey: actorKey(context),
        actionId: CONTACT_CREATE_ACTION_ID,
        idempotencyKeyHash: sha256(context.idempotencyKey),
        requestHash: sha256(JSON.stringify(input)),
      });
      if (!result.ok) return result;
      replayed = result.data.replayed;
      const contact = await contactsService.contact.get({ bookId, id: result.data.id });
      return contact
        ? ok({
            data: { contact: mapContactDetail(contact) },
            refs: [{ type: "contacts.contact", id: contact.id }],
            links: [{ rel: "edit", href: contactHref(contact) }],
          })
        : fail(err.conflict("The contact created by this idempotency key no longer exists"));
    },
    () => replayed,
  );
};

const runContactUpdate = async (input: z.infer<typeof ContactUpdateInputSchema>, context: CapabilityExecutionContext) => {
  const auditParams = actionAudit(context, "contact.update", "contact", input.contactId);
  return audited(auditParams, async () => {
    const resolved = await resolveContact(input.contactId, context, "write");
    if (!resolved.ok) return resolved;
    const { contactId, expectedUpdatedAt, ...data } = input;
    const result = await contactsService.contact.update({
      bookId: resolved.data.bookId,
      id: contactId,
      expectedUpdatedAt,
      data,
    });
    return result.ok
      ? ok({
          data: { contact: mapContactDetail(result.data) },
          refs: [{ type: "contacts.contact", id: result.data.id }],
          links: [{ rel: "edit", href: contactHref(result.data) }],
        })
      : result;
  });
};

const runContactMove = async (input: z.infer<typeof ContactMoveInputSchema>, context: CapabilityExecutionContext) => {
  const auditParams = actionAudit(context, "contact.move", "contact", input.contactId);
  return audited(auditParams, async () => {
    const source = await resolveContact(input.contactId, context, "write");
    if (!source.ok) return source;
    const target = await requireBookPermission(input.targetBookId, context, "write");
    if (!target.ok) return target;
    const result = await contactsService.contact.move({
      sourceBookId: source.data.bookId,
      targetBookId: input.targetBookId,
      id: input.contactId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    return result.ok
      ? ok({
          data: { contact: mapContactDetail(result.data) },
          refs: [{ type: "contacts.contact", id: result.data.id }],
          links: [{ rel: "edit", href: contactHref(result.data) }],
        })
      : result;
  });
};

const runContactDelete = async (input: z.infer<typeof ContactDeleteInputSchema>, context: CapabilityExecutionContext) => {
  const auditParams = actionAudit(context, "contact.delete", "contact", input.contactId);
  return audited(auditParams, async () => {
    const resolved = await resolveContact(input.contactId, context, "write");
    if (!resolved.ok) return resolved;
    const result = await contactsService.contact.remove({
      bookId: resolved.data.bookId,
      id: input.contactId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    return result.ok ? ok({ data: { contactId: input.contactId, deleted: true as const } }) : result;
  });
};

const runFavoriteSet = async (input: z.infer<typeof FavoriteSetInputSchema>, context: CapabilityExecutionContext) => {
  const auditParams = actionAudit(context, "favorite.set", "contact", input.contactId);
  return audited(auditParams, async () => {
    const user = userBacked(context);
    if (!user) return fail(err.forbidden("Favorites require a user-backed actor"));
    const resolved = await resolveContact(input.contactId, context);
    if (!resolved.ok) return resolved;
    await contactsService.favorite.set({
      userId: user.id,
      bookId: resolved.data.bookId,
      contactId: input.contactId,
      favorite: input.favorite,
    });
    return ok({
      data: { contactId: input.contactId, favorite: input.favorite },
      refs: [{ type: "contacts.contact", id: input.contactId }],
    });
  });
};

const runTagChange = async (input: z.infer<typeof ContactTagChangeInputSchema>, context: CapabilityExecutionContext) => {
  const auditParams = actionAudit(context, "tag.change", "contact", input.contactId);
  return audited(auditParams, async () => {
    const resolved = await resolveContact(input.contactId, context, "write");
    if (!resolved.ok) return resolved;
    const result = await contactsService.tag.changeAssignments({
      bookId: resolved.data.bookId,
      contactId: input.contactId,
      addTagIds: input.addTagIds,
      removeTagIds: input.removeTagIds,
    });
    return result.ok
      ? ok({
          data: { contactId: input.contactId, tags: result.data.map(mapTag) },
          refs: [{ type: "contacts.contact", id: input.contactId }],
        })
      : result;
  });
};

const runNoteCreate = async (input: z.infer<typeof ContactNoteCreateInputSchema>, context: CapabilityExecutionContext) => {
  const auditParams = actionAudit(context, "note.create", "contact", input.contactId);
  let replayed = false;
  const result = await audited(
    auditParams,
    async () => {
      const user = userBacked(context);
      if (!user) return fail(err.forbidden("Notes require a user-backed actor"));
      if (!context.idempotencyKey) return fail(err.badInput("Idempotency-Key is required"));
      const resolved = await resolveContact(input.contactId, context, "write");
      if (!resolved.ok) return resolved;
      const created = await contactsService.contact.notes.createIdempotent({
        bookId: resolved.data.bookId,
        contactId: input.contactId,
        authorUserId: user.id,
        authorDisplayName: user.displayName,
        data: { content: input.content },
        actorKey: actorKey(context),
        actionId: NOTE_CREATE_ACTION_ID,
        idempotencyKeyHash: sha256(context.idempotencyKey),
        requestHash: sha256(JSON.stringify(input)),
      });
      if (!created.ok) return created;
      replayed = created.data.replayed;
      return ok({
        data: { note: mapNote(created.data.note) },
        refs: [
          { type: "contacts.note", id: created.data.note.id },
          { type: "contacts.contact", id: input.contactId },
        ],
      });
    },
    () => replayed,
  );
  return result;
};

export const contactsCapabilities = defineCapabilities({
  version: 1,
  types: {
    contact: { title: "Contact", description: "A person or organization in an address book.", icon: "ti ti-address-book" },
    book: { title: "Address book", description: "A permission-scoped collection of contacts.", icon: "ti ti-book" },
    tag: { title: "Contact tag", description: "A book-scoped label assigned to contacts.", icon: "ti ti-tag" },
    note: { title: "Contact note", description: "A user-authored note attached to a contact.", icon: "ti ti-note" },
  },
  queries: {
    "contact.search": {
      title: "Search contacts",
      description: "Find permission-filtered contacts by name, email, phone, or address-book facet.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      universalSearch: {
        tags: [
          { tag: "contact", title: "Contacts", description: "Show contact cards.", aliases: ["addressbook"] },
          { tag: "phone", title: "Phone", description: "Show contacts that have a phone number." },
          { tag: "email", title: "Email", description: "Show contacts that have an email address." },
        ],
      },
      run: runSearch,
    },
    "contact.list": {
      title: "List contacts",
      description: "List one readable address book with bounded filters, stable pagination, and contact references.",
      input: ContactListInputSchema,
      data: ContactListDataSchema,
      run: runContactList,
    },
    "contact.get": {
      title: "Get contact",
      description: "Read one contact by stable UUID after resolving and checking its owning address book.",
      input: ContactGetInputSchema,
      data: ContactDetailDataSchema,
      run: runContactGet,
    },
    "book.list": {
      title: "List address books",
      description: "List address books the current actor may read, including effective permissions for choosing action targets.",
      input: ContactBookListInputSchema,
      data: ContactBookListDataSchema,
      run: runBookList,
    },
    "tag.list": {
      title: "List contact tags",
      description: "List the bounded tag vocabulary for one readable address book.",
      input: ContactTagListInputSchema,
      data: ContactTagListDataSchema,
      run: runTagList,
    },
    "note.list": {
      title: "List contact notes",
      description: "List notes for one readable contact, newest first.",
      input: ContactNoteListInputSchema,
      data: ContactNoteListDataSchema,
      run: runNoteList,
    },
  },
  actions: {
    "contact.create": {
      title: "Create contact",
      description: "Create one contact in an explicitly selected writable address book.",
      input: ContactCreateInputSchema,
      data: ContactMutationDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "required",
      target: { type: "book", inputField: "bookId" },
      run: runContactCreate,
    },
    "contact.update": {
      title: "Update contact",
      description: "Update selected contact fields; provided collection fields replace their current values.",
      input: ContactUpdateInputSchema,
      data: ContactMutationDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "contact", inputField: "contactId" },
      run: runContactUpdate,
    },
    "contact.move": {
      title: "Move contact",
      description: "Move a contact to another writable book. Book-scoped tags and hierarchy links are removed.",
      input: ContactMoveInputSchema,
      data: ContactMutationDataSchema,
      destructive: true,
      openWorld: false,
      approval: "always",
      idempotency: "none",
      target: { type: "contact", inputField: "contactId" },
      run: runContactMove,
    },
    "contact.delete": {
      title: "Delete contact",
      description: "Permanently delete one manual contact after an optimistic version check.",
      input: ContactDeleteInputSchema,
      data: ContactDeleteDataSchema,
      destructive: true,
      openWorld: false,
      approval: "always",
      idempotency: "none",
      target: { type: "contact", inputField: "contactId" },
      run: runContactDelete,
    },
    "favorite.set": {
      title: "Set contact favorite",
      description: "Set or clear the current user's favorite state for one readable contact.",
      input: FavoriteSetInputSchema,
      data: FavoriteSetDataSchema,
      destructive: false,
      openWorld: false,
      approval: "never",
      idempotency: "none",
      target: { type: "contact", inputField: "contactId" },
      run: runFavoriteSet,
    },
    "tag.change": {
      title: "Change contact tags",
      description: "Atomically add and remove book-scoped tags on one writable contact.",
      input: ContactTagChangeInputSchema,
      data: ContactTagChangeDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "contact", inputField: "contactId" },
      run: runTagChange,
    },
    "note.create": {
      title: "Create contact note",
      description: "Append a user-authored note to one writable contact exactly once.",
      input: ContactNoteCreateInputSchema,
      data: ContactNoteCreateDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "required",
      target: { type: "contact", inputField: "contactId" },
      run: runNoteCreate,
    },
  },
});
