import { z } from "zod";

const NullableTextSchema = z.string().nullable();
const TimestampSchema = z.string().datetime({ offset: true });
const CursorSchema = z.string().min(1).max(256).optional().describe("Opaque cursor returned by the previous page.");
const LimitSchema = z.number().int().min(1).max(100).default(25).describe("Maximum number of results to return.");
const ReadableContactBookIdSchema = z.union([z.uuid(), z.literal("system")]);

const CapabilityPageInputShape = {
  cursor: CursorSchema,
  limit: LimitSchema,
};

export const NormalizedContactEmailSchema = z.email().max(320);

const ContactTagDataSchema = z
  .object({
    id: z.uuid(),
    bookId: z.uuid(),
    name: z.string().min(1),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

const ContactEmailDataSchema = z.object({ label: NullableTextSchema, email: z.email() }).strict();
const ContactPhoneDataSchema = z.object({ label: NullableTextSchema, phone: z.string().min(1) }).strict();
const ContactWebsiteDataSchema = z.object({ label: NullableTextSchema, url: z.string().url() }).strict();
const ContactAddressDataSchema = z
  .object({
    label: NullableTextSchema,
    recipientName: NullableTextSchema,
    companyName: NullableTextSchema,
    line1: z.string().min(1),
    line2: NullableTextSchema,
    postalCode: z.string(),
    city: z.string(),
    stateRegion: NullableTextSchema,
    countryCode: z.string().length(2),
  })
  .strict();
const ContactBankAccountDataSchema = z
  .object({
    label: NullableTextSchema,
    accountHolderName: z.string().min(1),
    iban: z.string().min(1),
    bic: NullableTextSchema,
    bankName: NullableTextSchema,
    note: NullableTextSchema,
  })
  .strict();

const ContactSummaryDataSchema = z
  .object({
    id: z.uuid(),
    bookId: z.string().min(1),
    displayName: z.string().min(1),
    companyName: NullableTextSchema,
    jobTitle: NullableTextSchema,
    primaryEmail: z.email().nullable(),
    primaryPhone: NullableTextSchema,
    tags: z.array(ContactTagDataSchema).max(100),
    updatedAt: TimestampSchema,
  })
  .strict();

const ContactLookupEmailDataSchema = z.object({ label: NullableTextSchema, email: z.email() }).strict();
const ContactLookupPhoneDataSchema = z.object({ label: NullableTextSchema, phone: z.string().min(1) }).strict();

export const ContactSuggestInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(500)
      .describe("Text matched against readable contact names, organizations, email addresses, phone numbers, and addresses."),
    cursor: CursorSchema,
    limit: z.number().int().min(1).max(25).default(8).describe("Maximum number of contact suggestions to return."),
  })
  .strict();

export const ContactSuggestionDataSchema = z
  .object({
    contactId: z.uuid(),
    bookId: z.string().min(1),
    displayName: z.string().min(1),
    companyName: NullableTextSchema,
    jobTitle: NullableTextSchema,
    emails: z.array(ContactLookupEmailDataSchema).min(1).max(20),
    phones: z.array(ContactLookupPhoneDataSchema).max(20),
    contactPointsTruncated: z.boolean(),
    openHref: z.string().startsWith("/app/contacts/"),
    updatedAt: TimestampSchema,
  })
  .strict();

export const ContactSuggestDataSchema = z.array(ContactSuggestionDataSchema).max(25);

export const ContactResolveInputSchema = z
  .object({
    emails: z
      .array(NormalizedContactEmailSchema)
      .min(1)
      .max(100)
      .describe("Normalized email addresses to resolve to every readable matching contact."),
    contactIds: z.array(z.uuid()).max(20).optional().describe("Optional contact UUIDs that further restrict the matches."),
    cursor: CursorSchema,
    limit: z.number().int().min(1).max(50).default(25).describe("Maximum number of exact contact matches to return."),
  })
  .strict();

export const ContactResolveMatchDataSchema = z
  .object({
    contactId: z.uuid(),
    bookId: z.string().min(1),
    bookName: z.string().min(1),
    displayName: z.string().min(1),
    companyName: NullableTextSchema,
    jobTitle: NullableTextSchema,
    matchedEmails: z.array(NormalizedContactEmailSchema).min(1).max(100),
    emails: z.array(ContactLookupEmailDataSchema).max(20),
    phones: z.array(ContactLookupPhoneDataSchema).max(20),
    contactPointsTruncated: z.boolean(),
    openHref: z.string().startsWith("/app/contacts/"),
    updatedAt: TimestampSchema,
  })
  .strict();

export const ContactResolveDataSchema = z
  .object({
    items: z.array(ContactResolveMatchDataSchema).max(50),
    matchedEmails: z.array(NormalizedContactEmailSchema).max(100),
  })
  .strict();

export const ContactDetailDataSchema = ContactSummaryDataSchema.extend({
  label: NullableTextSchema,
  firstName: NullableTextSchema,
  lastName: NullableTextSchema,
  department: NullableTextSchema,
  vatId: NullableTextSchema,
  birthday: NullableTextSchema,
  salutation: NullableTextSchema,
  pronouns: NullableTextSchema,
  preferredLanguage: NullableTextSchema,
  parentContactId: z.uuid().nullable(),
  emails: z.array(ContactEmailDataSchema).max(100),
  phones: z.array(ContactPhoneDataSchema).max(100),
  addresses: z.array(ContactAddressDataSchema).max(100),
  websites: z.array(ContactWebsiteDataSchema).max(100),
  bankAccounts: z.array(ContactBankAccountDataSchema).max(100),
  createdAt: TimestampSchema,
}).strict();

export const ContactListInputSchema = z
  .object({
    bookId: ReadableContactBookIdSchema.describe('Address-book UUID, or "system" for the read-only system address book.'),
    query: z.string().trim().max(500).optional().describe("Optional text matched against contact fields."),
    tagIds: z.array(z.uuid()).max(100).optional().describe("Only contacts having at least one of these book-scoped tags."),
    sort: z.enum(["name", "updated", "created", "company"]).default("name").describe("Contact sort order."),
    email: z.enum(["all", "yes", "no"]).default("all").describe("Filter by email-address presence."),
    phone: z.enum(["all", "yes", "no"]).default("all").describe("Filter by phone-number presence."),
    favoritesOnly: z.boolean().default(false).describe("Only contacts favorited by the current user."),
    ...CapabilityPageInputShape,
  })
  .strict();

export const ContactGetInputSchema = z.object({ contactId: z.uuid().describe("Stable contact UUID.") }).strict();

const ContactBookDataSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    description: NullableTextSchema,
    permission: z.enum(["read", "write", "admin"]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export const ContactBookListDataSchema = z.array(ContactBookDataSchema).max(100);
export const ContactBookListInputSchema = z
  .object({
    query: z.string().trim().max(500).optional().describe("Optional address-book name or description search."),
    minimumPermission: z
      .enum(["read", "write", "admin"])
      .default("read")
      .describe("Minimum effective permission required for each returned address book."),
    ...CapabilityPageInputShape,
  })
  .strict();

export const ContactTagListDataSchema = z.array(ContactTagDataSchema).max(100);
export const ContactTagListInputSchema = z
  .object({ bookId: z.uuid().describe("Address-book UUID whose tags should be listed."), ...CapabilityPageInputShape })
  .strict();

const ContactNoteDataSchema = z
  .object({
    id: z.uuid(),
    contactId: z.uuid(),
    authorUserId: z.uuid().nullable(),
    authorDisplayName: z.string().min(1),
    content: z.string().min(1),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export const ContactNoteListDataSchema = z.array(ContactNoteDataSchema).max(100);
export const ContactNoteListInputSchema = z
  .object({ contactId: z.uuid().describe("Contact whose notes should be listed."), ...CapabilityPageInputShape })
  .strict();

const EmailInputSchema = z
  .object({
    label: z.string().trim().max(100).nullable().optional().describe("Optional email label."),
    email: z.email().max(320).describe("Email address."),
  })
  .strict();
const PhoneInputSchema = z
  .object({
    label: z.string().trim().max(100).nullable().optional().describe("Optional phone label."),
    phone: z.string().trim().min(1).max(100).describe("Phone number."),
  })
  .strict();
const WebsiteInputSchema = z
  .object({
    label: z.string().trim().max(100).nullable().optional().describe("Optional website label."),
    url: z.string().url().max(2048).describe("Website URL."),
  })
  .strict();
const AddressInputSchema = z
  .object({
    label: z.string().trim().max(100).nullable().optional().describe("Optional address label."),
    recipientName: z.string().trim().max(200).nullable().optional().describe("Optional recipient name."),
    companyName: z.string().trim().max(200).nullable().optional().describe("Optional company name."),
    line1: z.string().trim().min(1).max(300).describe("Primary street address line."),
    line2: z.string().trim().max(300).nullable().optional().describe("Optional secondary address line."),
    postalCode: z.string().trim().max(50).describe("Postal code."),
    city: z.string().trim().max(200).describe("City or locality."),
    stateRegion: z.string().trim().max(200).nullable().optional().describe("Optional state or region."),
    countryCode: z.string().trim().length(2).describe("Two-letter country code."),
  })
  .strict();
const BankAccountInputSchema = z
  .object({
    label: z.string().trim().max(100).nullable().optional().describe("Optional bank-account label."),
    accountHolderName: z.string().trim().min(1).max(200).describe("Account holder name."),
    iban: z.string().trim().min(1).max(80).describe("IBAN or local account identifier."),
    bic: z.string().trim().max(40).nullable().optional().describe("Optional BIC."),
    bankName: z.string().trim().max(200).nullable().optional().describe("Optional bank name."),
    note: z.string().trim().max(1000).nullable().optional().describe("Optional account note."),
  })
  .strict();

const ContactFieldsShape = {
  label: z.string().trim().max(200).nullable().optional().describe("Optional explicit display label."),
  firstName: z.string().trim().max(200).nullable().optional().describe("Person first name."),
  lastName: z.string().trim().max(200).nullable().optional().describe("Person last name."),
  companyName: z.string().trim().max(200).nullable().optional().describe("Organization name."),
  department: z.string().trim().max(200).nullable().optional().describe("Organization department."),
  jobTitle: z.string().trim().max(200).nullable().optional().describe("Job title."),
  vatId: z.string().trim().max(100).nullable().optional().describe("VAT identifier."),
  birthday: z.string().date().nullable().optional().describe("Birthday as YYYY-MM-DD."),
  salutation: z.string().trim().max(100).nullable().optional().describe("Preferred salutation."),
  pronouns: z.string().trim().max(100).nullable().optional().describe("Preferred pronouns."),
  preferredLanguage: z.string().trim().max(40).nullable().optional().describe("Preferred language code."),
  parentContactId: z.uuid().nullable().optional().describe("Optional parent contact in the same book."),
  tagIds: z.array(z.uuid()).max(100).optional().describe("Complete replacement set of book-scoped tag UUIDs."),
  emails: z.array(EmailInputSchema).max(100).optional().describe("Complete replacement set of email addresses."),
  phones: z.array(PhoneInputSchema).max(100).optional().describe("Complete replacement set of phone numbers."),
  addresses: z.array(AddressInputSchema).max(100).optional().describe("Complete replacement set of postal addresses."),
  websites: z.array(WebsiteInputSchema).max(100).optional().describe("Complete replacement set of websites."),
  bankAccounts: z.array(BankAccountInputSchema).max(100).optional().describe("Complete replacement set of bank accounts."),
};

export const ContactCreateInputSchema = z
  .object({
    bookId: z.uuid().describe("Address-book UUID that will own the contact."),
    ...ContactFieldsShape,
  })
  .strict()
  .refine(
    (value) => Boolean(value.label || value.firstName || value.lastName || value.companyName),
    "Provide a label, person name, or company name.",
  );

export const ContactUpdateInputSchema = z
  .object({
    contactId: z.uuid().describe("Stable contact UUID to update."),
    expectedUpdatedAt: TimestampSchema.describe("updatedAt value returned by the last read; prevents lost updates."),
    ...ContactFieldsShape,
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "contactId" && key !== "expectedUpdatedAt"),
    "Provide at least one contact field to update.",
  );

export const ContactMoveInputSchema = z
  .object({
    contactId: z.uuid().describe("Stable contact UUID to move."),
    targetBookId: z.uuid().describe("Writable destination address-book UUID."),
    expectedUpdatedAt: TimestampSchema.describe("updatedAt value returned by the last read; prevents stale moves."),
  })
  .strict();

export const ContactDeleteInputSchema = z
  .object({
    contactId: z.uuid().describe("Stable contact UUID to delete."),
    expectedUpdatedAt: TimestampSchema.describe("updatedAt value returned by the last read; prevents stale deletion."),
  })
  .strict();

export const FavoriteSetInputSchema = z
  .object({
    contactId: z.uuid().describe("Stable contact UUID."),
    favorite: z.boolean().describe("Desired favorite state for the current user."),
  })
  .strict();

export const ContactTagChangeInputSchema = z
  .object({
    contactId: z.uuid().describe("Stable contact UUID whose tags should change."),
    addTagIds: z.array(z.uuid()).max(100).default([]).describe("Book-scoped tag UUIDs to add."),
    removeTagIds: z.array(z.uuid()).max(100).default([]).describe("Book-scoped tag UUIDs to remove."),
  })
  .strict()
  .refine((value) => value.addTagIds.length > 0 || value.removeTagIds.length > 0, "Choose at least one tag to add or remove.");

export const ContactNoteCreateInputSchema = z
  .object({
    contactId: z.uuid().describe("Stable contact UUID that will own the note."),
    content: z.string().trim().min(1).max(10_000).describe("Plain-text note content."),
  })
  .strict();

export const ContactMutationDataSchema = z.object({ contact: ContactDetailDataSchema }).strict();
export const ContactDeleteDataSchema = z.object({ contactId: z.uuid(), deleted: z.literal(true) }).strict();
export const FavoriteSetDataSchema = z.object({ contactId: z.uuid(), favorite: z.boolean() }).strict();
export const ContactTagChangeDataSchema = z.object({ contactId: z.uuid(), tags: z.array(ContactTagDataSchema).max(100) }).strict();
export const ContactNoteCreateDataSchema = z.object({ note: ContactNoteDataSchema }).strict();
