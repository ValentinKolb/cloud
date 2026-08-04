import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { CapabilityExecutionContext, User } from "@valentinkolb/cloud/contracts";
import { contactsCapabilities, decodeContactCapabilityCursor } from "./capabilities";
import {
  CONTACT_COLLECTION_LIMIT,
  CONTACT_TAG_LIMIT,
  ContactCreateInputSchema,
  ContactDetailDataSchema,
  ContactListInputSchema,
  ContactResolveDataSchema,
  ContactSuggestDataSchema,
  ContactTagChangeInputSchema,
  ContactUpdateInputSchema,
} from "./capability-contracts";
import { type Contact, contactsService } from "./service";

const userId = "11111111-1111-4111-8111-111111111111";
const bookId = "22222222-2222-4222-8222-222222222222";
const contactId = "33333333-3333-4333-8333-333333333333";
const timestamp = "2026-08-02T08:00:00.000Z";

const user = {
  id: userId,
  uid: "contacts-admin",
  roles: ["admin"],
  provider: "local",
  profile: "user",
  givenname: "Contacts",
  sn: "Admin",
  displayName: "Contacts Admin",
  mail: "contacts@example.test",
  avatarHash: null,
  ipa: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
} satisfies User;

const context = {
  actor: { kind: "user", user },
  accessSubject: { type: "user", userId },
  user,
  signal: new AbortController().signal,
} satisfies CapabilityExecutionContext;

const contact: Contact = {
  id: contactId,
  bookId,
  label: null,
  firstName: "Ada",
  lastName: "Example",
  companyName: null,
  department: null,
  jobTitle: null,
  vatId: null,
  birthday: null,
  salutation: null,
  pronouns: null,
  preferredLanguage: null,
  source: "manual",
  createdAt: timestamp,
  updatedAt: timestamp,
  emails: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      contactId,
      label: "work",
      email: "ada@example.test",
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  phones: [],
  addresses: [],
  websites: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      contactId,
      label: "legacy import",
      url: "Example GmbH",
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  bankAccounts: [],
  parentContactId: null,
  parent: null,
  members: [],
  tags: [],
};

const book = { id: bookId, name: "Test", description: null, isSystem: false, createdAt: timestamp, updatedAt: timestamp };

afterEach(() => mock.restore());

describe("contacts capabilities", () => {
  test("declares the complete local v1 surface", () => {
    expect(Object.keys(contactsCapabilities.types).sort()).toEqual(["book", "contact", "note", "tag"]);
    expect(Object.keys(contactsCapabilities.queries).sort()).toEqual([
      "book.list",
      "contact.get",
      "contact.list",
      "contact.resolve",
      "contact.search",
      "contact.suggest",
      "note.list",
      "tag.list",
    ]);
    expect(Object.keys(contactsCapabilities.actions).sort()).toEqual([
      "contact.create",
      "contact.delete",
      "contact.move",
      "contact.update",
      "favorite.set",
      "note.create",
      "tag.change",
    ]);
    expect(
      Object.entries(contactsCapabilities.actions)
        .filter(([, action]) => "review" in action && action.review)
        .map(([id]) => id)
        .sort(),
    ).toEqual(["contact.delete", "contact.move", "contact.update", "favorite.set", "tag.change"]);
  });

  test("separates general contact discovery from mail-specific lookup", () => {
    expect(contactsCapabilities.queries["contact.search"].description).toContain("Find, show, or open");
    expect(contactsCapabilities.queries["contact.search"].description).toContain("navigable contact cards");
    expect(contactsCapabilities.queries["contact.suggest"].description).toContain("composing mail");
    expect(contactsCapabilities.queries["contact.resolve"].description).toContain("known exact email addresses");
    expect(contactsCapabilities.queries["contact.list"].description).toContain("navigable contact cards");
    expect(contactsCapabilities.queries["contact.list"].description).toContain("opaque pagination");
    expect(contactsCapabilities.queries["book.list"].title).toBe("List manual address books");
  });

  test("reviews a destructive contact action without mutating it", async () => {
    spyOn(contactsService.contact, "findBookId").mockResolvedValue(bookId);
    spyOn(contactsService.book, "get").mockResolvedValue(book);
    spyOn(contactsService.contact, "get").mockResolvedValue(contact);
    const remove = spyOn(contactsService.contact, "remove");
    const review = contactsCapabilities.actions["contact.delete"].review;
    if (!review) throw new Error("Contact delete review missing");

    const result = await review({ contactId, expectedUpdatedAt: timestamp }, context);

    expect(result).toMatchObject({ ok: true, data: { message: "Permanently delete Ada Example." } });
    expect(remove).not.toHaveBeenCalled();
  });

  test("returns one semantic Cloud link with each listed contact", async () => {
    spyOn(contactsService.book, "get").mockResolvedValue(book);
    spyOn(contactsService.contact, "list").mockResolvedValue({
      items: [contact],
      page: 1,
      perPage: 25,
      total: 1,
      hasNext: false,
    });

    const result = await contactsCapabilities.queries["contact.list"].run(
      { bookId, sort: "name", email: "all", phone: "all", favoritesOnly: false, limit: 25 },
      context,
    );

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.data.data).toEqual([
      {
        ref: { type: "contacts.contact", id: contactId },
        title: "Ada Example",
        preview: "ada@example.test",
        icon: "ti ti-address-book",
        priority: 7,
        metadata: [
          { label: "Type", value: "Contact" },
          { label: "Book", value: bookId },
        ],
        links: [{ rel: "open", href: `/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}` }],
      },
    ]);
  });

  test("keeps legacy website text from invalidating an otherwise readable contact", async () => {
    spyOn(contactsService.contact, "findBookId").mockResolvedValue(bookId);
    spyOn(contactsService.book, "get").mockResolvedValue(book);
    spyOn(contactsService.contact, "get").mockResolvedValue(contact);

    const definition = contactsCapabilities.queries["contact.get"];
    const result = await definition.run({ contactId }, context);

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(definition.data.safeParse(result.data.data).success).toBeTrue();
    expect(result.data.data.websites).toEqual([]);
    expect(result.data.data.truncatedFields).toEqual([]);
    expect(result.data.links).toEqual([{ rel: "open", href: `/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}` }]);
  });

  test("rejects ambiguous or empty contact writes", () => {
    expect(ContactCreateInputSchema.safeParse({ bookId: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef" }).success).toBeFalse();
    expect(
      ContactUpdateInputSchema.safeParse({
        contactId: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
        expectedUpdatedAt: "2026-08-01T10:00:00.000Z",
      }).success,
    ).toBeFalse();
  });

  test("keeps advertised contact writes below the capability transport envelope", () => {
    const text = (length: number) => "x".repeat(length);
    const input = {
      bookId,
      label: "A",
      emails: Array.from({ length: CONTACT_COLLECTION_LIMIT }, () => ({ label: text(100), email: `${text(50)}@example.com` })),
      phones: Array.from({ length: CONTACT_COLLECTION_LIMIT }, () => ({ label: text(100), phone: text(100) })),
      addresses: Array.from({ length: CONTACT_COLLECTION_LIMIT }, () => ({
        label: text(100),
        recipientName: text(200),
        companyName: text(200),
        line1: text(300),
        line2: text(300),
        postalCode: text(50),
        city: text(200),
        stateRegion: text(200),
        countryCode: "DE",
      })),
      websites: Array.from({ length: CONTACT_COLLECTION_LIMIT }, (_, index) => ({
        label: text(100),
        url: `https://example.com/${text(1900)}${index}`,
      })),
      bankAccounts: Array.from({ length: CONTACT_COLLECTION_LIMIT }, () => ({
        label: text(100),
        accountHolderName: text(200),
        iban: text(80),
        bic: text(40),
        bankName: text(200),
        note: text(1000),
      })),
    };
    expect(ContactCreateInputSchema.safeParse(input).success).toBeTrue();
    expect(Buffer.byteLength(JSON.stringify({ input }))).toBeLessThan(200_000);
    expect(
      ContactCreateInputSchema.safeParse({
        bookId,
        firstName: "Ada",
        emails: Array(CONTACT_COLLECTION_LIMIT + 1).fill({ email: "a@b.co" }),
      }).success,
    ).toBeFalse();
  });

  test("bounds legacy contact collections and reports every truncated field", async () => {
    const tag = {
      id: "66666666-6666-4666-8666-666666666666",
      bookId,
      name: "Test",
      color: "#112233",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const oversized = {
      ...contact,
      tags: Array(CONTACT_TAG_LIMIT + 1).fill(tag),
      emails: Array(CONTACT_COLLECTION_LIMIT + 1).fill(contact.emails[0]!),
      phones: Array(CONTACT_COLLECTION_LIMIT + 1).fill({
        id: "77777777-7777-4777-8777-777777777777",
        contactId,
        label: "work",
        phone: "+49 123",
        position: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      addresses: [],
      websites: [],
      bankAccounts: [],
    } satisfies Contact;
    spyOn(contactsService.contact, "findBookId").mockResolvedValue(bookId);
    spyOn(contactsService.book, "get").mockResolvedValue(book);
    spyOn(contactsService.contact, "get").mockResolvedValue(oversized);

    const result = await contactsCapabilities.queries["contact.get"].run({ contactId }, context);
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(ContactDetailDataSchema.safeParse(result.data.data).success).toBeTrue();
    expect(result.data.data.tags).toHaveLength(CONTACT_TAG_LIMIT);
    expect(result.data.data.emails).toHaveLength(CONTACT_COLLECTION_LIMIT);
    expect(result.data.data.phones).toHaveLength(CONTACT_COLLECTION_LIMIT);
    expect(result.data.data.truncatedFields).toEqual(["tags", "emails", "phones"]);
  });

  test("shows bounded before and after values when reviewing contact updates", async () => {
    spyOn(contactsService.contact, "findBookId").mockResolvedValue(bookId);
    spyOn(contactsService.book, "get").mockResolvedValue(book);
    spyOn(contactsService.contact, "get").mockResolvedValue(contact);
    const review = contactsCapabilities.actions["contact.update"].review;
    if (!review) throw new Error("Contact update review missing");

    const result = await review(
      { contactId, expectedUpdatedAt: timestamp, firstName: "Grace", emails: [{ label: "work", email: "grace@example.test" }] },
      context,
    );
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.data.details).toContainEqual({ label: "First name", value: "Ada → Grace" });
    expect(result.data.details).toContainEqual({
      label: "Email addresses",
      value: "1 item: ada@example.test → 1 item: grace@example.test",
    });
  });

  test("rejects system-contact writes before an admin review resolves the contact", async () => {
    spyOn(contactsService.contact, "findBookId").mockResolvedValue(null);
    spyOn(contactsService.book, "get").mockResolvedValue({ ...book, id: "system", isSystem: true });
    const get = spyOn(contactsService.contact, "get");
    const review = contactsCapabilities.actions["contact.delete"].review;
    if (!review) throw new Error("Contact delete review missing");

    const result = await review({ contactId, expectedUpdatedAt: timestamp }, context);
    expect(result).toMatchObject({ ok: false, error: { message: "System contacts are read-only" } });
    expect(get).not.toHaveBeenCalled();
  });

  test("keeps tag changes explicit and closed", () => {
    expect(
      ContactTagChangeInputSchema.safeParse({
        contactId: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
        unexpected: true,
      }).success,
    ).toBeFalse();
    expect(
      ContactTagChangeInputSchema.safeParse({
        contactId: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
        addTagIds: [],
        removeTagIds: [],
      }).success,
    ).toBeFalse();
  });

  test("accepts only opaque v1 page cursors", () => {
    const cursor = Buffer.from(JSON.stringify({ v: 1, page: 4 }), "utf8").toString("base64url");
    expect(decodeContactCapabilityCursor(cursor)).toEqual({ ok: true, data: 4 });
    expect(decodeContactCapabilityCursor("not-a-cursor").ok).toBeFalse();
    const unsafe = Buffer.from(JSON.stringify({ v: 1, page: 1e308 }), "utf8").toString("base64url");
    expect(decodeContactCapabilityCursor(unsafe).ok).toBeFalse();
  });

  test("can list the readable virtual system address book without allowing writes to it", () => {
    expect(ContactListInputSchema.safeParse({ bookId: "system" }).success).toBeTrue();
    expect(ContactCreateInputSchema.safeParse({ bookId: "system", firstName: "Ada" }).success).toBeFalse();
  });

  test("keeps contact suggestions useful for phone searches without exposing full records", () => {
    expect(
      ContactSuggestDataSchema.safeParse([
        {
          contactId: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
          bookId: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
          displayName: "Ada Example",
          companyName: "Example GmbH",
          jobTitle: null,
          emails: [{ label: "work", email: "ada@example.com" }],
          phones: [{ label: "mobile", phone: "+49 170 1234567" }],
          contactPointsTruncated: false,
          links: [
            {
              rel: "open",
              href: "/app/contacts/553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef?contact=553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
            },
          ],
          updatedAt: "2026-08-01T10:00:00.000Z",
        },
      ]).success,
    ).toBeTrue();
  });

  test("emits semantic contact links without the legacy openHref field", async () => {
    spyOn(contactsService.contact, "search").mockResolvedValue({
      items: [contact],
      page: 1,
      perPage: 8,
      total: 1,
      totalPages: 1,
      hasNext: false,
    });
    const suggested = await contactsCapabilities.queries["contact.suggest"].run({ query: "Ada", limit: 8 }, context);
    expect(suggested.ok).toBeTrue();
    if (!suggested.ok) return;
    expect(suggested.data.data[0]).toMatchObject({
      links: [{ rel: "open", href: `/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}` }],
    });
    expect("openHref" in suggested.data.data[0]!).toBeFalse();

    spyOn(contactsService.lookup, "resolveContactsByEmail").mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            contactId,
            bookId,
            bookName: "Contacts",
            displayName: "Ada Example",
            companyName: null,
            jobTitle: null,
            matchedEmails: ["ada@example.test"],
            emails: [{ label: "work", email: "ada@example.test" }],
            phones: [],
            contactPointsTruncated: false,
            updatedAt: timestamp,
          },
        ],
        matchedEmails: ["ada@example.test"],
        nextCursor: null,
      },
    });
    const resolved = await contactsCapabilities.queries["contact.resolve"].run({ emails: ["ada@example.test"], limit: 25 }, context);
    expect(resolved.ok).toBeTrue();
    if (!resolved.ok) return;
    expect(resolved.data.data.items[0]).toMatchObject({
      links: [{ rel: "open", href: `/app/contacts/${bookId}?contact=${contactId}&contactBook=${bookId}` }],
    });
    expect("openHref" in resolved.data.data.items[0]!).toBeFalse();
  });

  test("keeps exact resolution bounded and rejects unrelated contact fields", () => {
    const value = { items: [], matchedEmails: ["ada@example.com"] };
    expect(ContactResolveDataSchema.safeParse(value).success).toBeTrue();
    expect(ContactResolveDataSchema.safeParse({ ...value, bankAccounts: [] }).success).toBeFalse();
  });
});
