import { describe, expect, test } from "bun:test";
import { ContactMailMatchSchema, ResolveMailParticipantsInputSchema } from "./integration";

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
});
