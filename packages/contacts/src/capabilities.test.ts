import { describe, expect, test } from "bun:test";
import { contactsCapabilities, decodeContactCapabilityCursor } from "./capabilities";
import {
  ContactCreateInputSchema,
  ContactResolveDataSchema,
  ContactSuggestDataSchema,
  ContactTagChangeInputSchema,
  ContactUpdateInputSchema,
} from "./capability-contracts";

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
          openHref: "/app/contacts/553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef?contact=553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
          updatedAt: "2026-08-01T10:00:00.000Z",
        },
      ]).success,
    ).toBeTrue();
  });

  test("keeps exact resolution bounded and rejects unrelated contact fields", () => {
    const value = { items: [], matchedEmails: ["ada@example.com"] };
    expect(ContactResolveDataSchema.safeParse(value).success).toBeTrue();
    expect(ContactResolveDataSchema.safeParse({ ...value, bankAccounts: [] }).success).toBeFalse();
  });
});
