import { createHash } from "node:crypto";
import {
  type CloudResourceView,
  type CapabilityInvocationResult,
  type CapabilityExecutionContext,
  defineCapabilities,
  hasRole,
  type UniversalSearchInput,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { hasPermission, type PermissionLevel } from "@valentinkolb/cloud/server";
import { audit, type AuditActor } from "@valentinkolb/cloud/services";
import { err, fail, ok } from "@k2b/stdlib";
import { z } from "zod";
import { contactsService } from "./service";
import { CONTACT_BOOK_RESOURCE_TYPE, CONTACTS_APP_ID } from "./service/access";
import { resolveContactName } from "./shared";

const supportsContactsApp = (roles: string[]) => roles.includes("user");

const contactPreview = (emails: { email: string }[], phones: { phone: string }[]) => emails[0]?.email ?? phones[0]?.phone ?? undefined;

const FACET_OVERFETCH_MULTIPLIER = 5;
const FACET_OVERFETCH_CAP = 200;
const CREATE_CONTACT_ACTION_ID = "contacts.create";

const CreateContactCapabilityInputSchema = z
  .object({
    bookId: z.uuid().describe("Address-book UUID that will own the contact."),
    label: z.string().trim().min(1).max(200).describe("Display label for the person or organization."),
    email: z.email().max(320).optional().describe("Optional primary email address."),
    phone: z.string().trim().min(1).max(100).optional().describe("Optional primary phone number."),
  })
  .strict();

const CreateContactCapabilityDataSchema = z
  .object({
    id: z.uuid().describe("Created contact UUID."),
    bookId: z.uuid().describe("Owning address-book UUID."),
    label: z.string().min(1).describe("Stored contact label."),
  })
  .strict();

type CreateContactCapabilityData = z.infer<typeof CreateContactCapabilityDataSchema>;

const permissionFromScopes = (scopes: readonly string[]): PermissionLevel => {
  if (scopes.includes("admin")) return "admin";
  if (scopes.includes("write")) return "write";
  if (scopes.includes("read")) return "read";
  return "none";
};

const canCreateContact = async (bookId: string, context: CapabilityExecutionContext): Promise<boolean> => {
  const book = await contactsService.book.get({ id: bookId });
  if (!book || book.isSystem) return false;

  if (context.actor.kind === "user" && hasRole(context.actor.user, "admin")) return true;

  if (context.actor.kind === "service_account" && context.actor.serviceAccount.kind === "resource_bound") {
    const account = context.actor.serviceAccount;
    if (account.appId !== CONTACTS_APP_ID || account.resourceType !== CONTACT_BOOK_RESOURCE_TYPE || account.resourceId !== bookId) {
      return false;
    }
  }

  const permission = await contactsService.book.permission.get({ bookId, subject: context.accessSubject });
  if (context.actor.kind === "user") return hasPermission(permission, "write");
  return hasPermission(permission, "write") && hasPermission(permissionFromScopes(context.actor.scopes), "write");
};

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

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

const createContactAudit = (context: CapabilityExecutionContext, bookId: string) => ({
  action: "contacts.capability.contact.create",
  actor: capabilityAuditActor(context),
  target: { type: "contact_book", id: bookId },
  metadata: { capability: CREATE_CONTACT_ACTION_ID },
});

const runCreateContact = async (
  input: z.infer<typeof CreateContactCapabilityInputSchema>,
  context: CapabilityExecutionContext,
): Promise<CapabilityInvocationResult<CreateContactCapabilityData>> => {
  const auditParams = createContactAudit(context, input.bookId);
  if (!context.idempotencyKey) {
    const result: CapabilityInvocationResult<CreateContactCapabilityData> = fail(err.badInput("Idempotency-Key is required"));
    return audit.recordResult({ ...auditParams, result });
  }
  if (!(await canCreateContact(input.bookId, context))) {
    const result: CapabilityInvocationResult<CreateContactCapabilityData> = fail(
      err.forbidden("Write access to this address book is required"),
    );
    return audit.recordResult({ ...auditParams, result });
  }

  const result = await contactsService.contact.createIdempotent({
    bookId: input.bookId,
    data: {
      label: input.label,
      source: "capability",
      ...(input.email ? { emails: [{ label: "Email", email: input.email }] } : {}),
      ...(input.phone ? { phones: [{ label: "Phone", phone: input.phone }] } : {}),
    },
    actorKey: context.actor.kind === "user" ? `user:${context.actor.user.id}` : `service_account:${context.actor.serviceAccount.id}`,
    actionId: CREATE_CONTACT_ACTION_ID,
    idempotencyKeyHash: sha256(context.idempotencyKey),
    requestHash: sha256(JSON.stringify(input)),
  });
  if (!result.ok) {
    const failure: CapabilityInvocationResult<CreateContactCapabilityData> = fail(result.error);
    return audit.recordResult({ ...auditParams, result: failure });
  }

  const created: CapabilityInvocationResult<CreateContactCapabilityData> = ok({
    data: { id: result.data.id, bookId: result.data.bookId, label: resolveContactName(result.data) },
    refs: [{ type: "contacts.contact", id: result.data.id }],
    links: [{ rel: "edit", href: `/app/contacts/${result.data.bookId}?contact=${result.data.id}&contactBook=${result.data.bookId}` }],
  });
  return audit.recordResultAfterSideEffect({
    ...auditParams,
    result: created,
  });
};

const runSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const user = context.user;
  if (!user || !supportsContactsApp(user.roles)) return ok({ data: [] });

  const tags = new Set(input.tags);
  const requirePhone = tags.has("phone");
  const requireEmail = tags.has("email");
  const facetFilterActive = requirePhone || requireEmail;
  const fetchLimit = facetFilterActive ? Math.min(FACET_OVERFETCH_CAP, input.limit * FACET_OVERFETCH_MULTIPLIER) : input.limit;

  const page = await contactsService.contact.search({
    subject: context.accessSubject,
    pagination: { page: 1, perPage: fetchLimit },
    filter: { query: input.query, includeSystem: true },
  });

  const data: CloudResourceView[] = page.items
    .filter((entry) => (!requirePhone || entry.phones.length > 0) && (!requireEmail || entry.emails.length > 0))
    .slice(0, input.limit)
    .map((entry) => {
      const primary = contactPreview(entry.emails, entry.phones);
      return {
        ref: { type: "contacts.contact", id: entry.id },
        title: resolveContactName(entry),
        preview: primary,
        icon: "ti ti-address-book",
        priority: 7,
        metadata: [
          { label: "Type", value: "Contact" },
          { label: "Book", value: entry.bookId },
          ...(primary ? [{ label: "Primary", value: primary }] : []),
        ],
        links: [{ rel: "open", href: `/app/contacts/${entry.bookId}?contact=${entry.id}&contactBook=${entry.bookId}` }],
      };
    });
  return ok({ data });
};

export const contactsCapabilities = defineCapabilities({
  version: 1,
  types: {
    contact: {
      title: "Contact",
      description: "A person or organization in an address book.",
      icon: "ti ti-address-book",
    },
  },
  queries: {
    search: {
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
  },
  actions: {
    create: {
      title: "Create contact",
      description: "Create one contact in an address book the caller may write to and return its stable reference and edit link.",
      input: CreateContactCapabilityInputSchema,
      data: CreateContactCapabilityDataSchema,
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "required",
      run: runCreateContact,
    },
  },
});
