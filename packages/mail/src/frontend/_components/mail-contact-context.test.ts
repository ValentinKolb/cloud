import { describe, expect, test } from "bun:test";
import type { ContactMailMatch } from "@valentinkolb/cloud-app-contacts/integration";
import { buildMailContactParticipantRows } from "./mail-contact-context";

const contact = (id: string, bookId: string, email: string): ContactMailMatch => ({
  contactId: id,
  bookId,
  bookName: `Book ${bookId}`,
  displayName: `Contact ${id}`,
  companyName: null,
  jobTitle: null,
  matchedEmails: [email],
  emails: [{ label: "Email", value: email }],
  phones: [],
  contactPointsTruncated: false,
  href: `/app/contacts/${bookId}?contact=${id}`,
  updatedAt: "2026-07-21T10:00:00.000Z",
});

describe("Mail contact context", () => {
  test("groups multiple exact contacts under one participant", () => {
    const rows = buildMailContactParticipantRows({
      participants: [{ email: "ada@example.com", displayName: "Ada" }],
      contacts: [
        contact("11111111-1111-4111-8111-111111111111", "book-a", "ada@example.com"),
        contact("22222222-2222-4222-8222-222222222222", "book-b", "ada@example.com"),
      ],
      matchedEmails: ["ada@example.com"],
    });

    expect(rows[0]?.contacts).toHaveLength(2);
    expect(rows[0]?.hasMatch).toBe(true);
  });

  test("does not offer creation for a match on a later page", () => {
    const rows = buildMailContactParticipantRows({
      participants: [{ email: "later@example.com", displayName: null }],
      contacts: [],
      matchedEmails: ["later@example.com"],
    });

    expect(rows).toEqual([{ email: "later@example.com", displayName: null, contacts: [], hasMatch: true }]);
  });

  test("marks an unmatched participant as eligible for creation", () => {
    const rows = buildMailContactParticipantRows({
      participants: [{ email: "new@example.com", displayName: "New Person" }],
      contacts: [],
      matchedEmails: [],
    });

    expect(rows[0]?.hasMatch).toBe(false);
  });
});
