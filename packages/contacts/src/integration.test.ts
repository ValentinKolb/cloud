import { describe, expect, test } from "bun:test";
import {
  buildContactCreateHref,
  ContactMailMatchSchema,
  parseContactCreateSeed,
  ResolveMailParticipantsInputSchema,
  ResolveMailParticipantsResponseSchema,
} from "./integration";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("Contacts Mail integration contracts", () => {
  test("normalizes, de-duplicates, and bounds participant addresses", () => {
    expect(ResolveMailParticipantsInputSchema.parse({ emails: [" ADA@Example.COM ", "ada@example.com"] }).emails).toEqual([
      "ada@example.com",
    ]);
    expect(
      ResolveMailParticipantsInputSchema.safeParse({ emails: Array.from({ length: 101 }, (_, index) => `u${index}@example.com`) }).success,
    ).toBe(false);
  });

  test("keeps the projection minimal and rejects sensitive fields", () => {
    const value = {
      contactId: UUID,
      bookId: UUID,
      bookName: "Customers",
      displayName: "Ada Example",
      companyName: "Example",
      jobTitle: null,
      matchedEmails: ["ada@example.com"],
      emails: [{ label: "work", value: "ada@example.com" }],
      phones: [],
      contactPointsTruncated: false,
      href: `/app/contacts/${UUID}?contact=${UUID}`,
      updatedAt: "2026-07-21T10:00:00.000Z",
    };
    expect(ContactMailMatchSchema.safeParse(value).success).toBe(true);
    expect(ContactMailMatchSchema.safeParse({ ...value, bankAccounts: [{ iban: "DE00" }] }).success).toBe(false);
  });

  test("builds and parses bounded contact create links", () => {
    const href = buildContactCreateHref({ email: " ADA@Example.COM ", name: " Ada Example " });
    const url = new URL(href, "https://cloud.example");

    expect(url.pathname).toBe("/app/contacts");
    expect(parseContactCreateSeed(url.searchParams)).toEqual({ email: "ada@example.com", name: "Ada Example" });
    expect(parseContactCreateSeed(new URLSearchParams("createContact=1&email=invalid"))).toBeNull();
    expect(parseContactCreateSeed(new URLSearchParams("email=ada@example.com"))).toBeNull();
  });

  test("requires the complete match summary in integration responses", () => {
    expect(
      ResolveMailParticipantsResponseSchema.parse({
        items: [],
        matchedEmails: [" ADA@Example.COM ", "ada@example.com"],
        nextCursor: null,
      }),
    ).toEqual({ items: [], matchedEmails: ["ada@example.com", "ada@example.com"], nextCursor: null });
  });
});
