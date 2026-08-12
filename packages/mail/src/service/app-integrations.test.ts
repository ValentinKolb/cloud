import { describe, expect, test } from "bun:test";
import {
  calendarEventSchema,
  calendarInvitationImportResultSchema,
  contactBookSchema,
  contactResolveMatchSchema,
  contactSuggestionSchema,
  eventInvitationCommitDataSchema,
  spacesMailDestinationContextSchema,
} from "../app-integration-contracts";
import { projectAppCapabilityError } from "./app-integrations";

const legacyUuid = "11111111-1111-4111-8111-111111111111";

describe("Mail Contacts integration resource IDs", () => {
  const suggestion = {
    contactId: "Cont01",
    bookId: "Book01",
    displayName: "Ada Example",
    companyName: null,
    jobTitle: null,
    emails: [{ label: "work", email: "ada@example.test" }],
    phones: [],
    contactPointsTruncated: false,
    updatedAt: "2026-08-11T08:00:00.000Z",
  };

  test("accepts only short Contact resource IDs", () => {
    expect(contactSuggestionSchema.safeParse(suggestion).success).toBeTrue();
    expect(contactSuggestionSchema.safeParse({ ...suggestion, contactId: legacyUuid }).success).toBeFalse();
    expect(
      contactBookSchema.safeParse({
        id: "Book01",
        name: "Customers",
        description: null,
        permission: "read",
        createdAt: "2026-08-11T08:00:00.000Z",
        updatedAt: "2026-08-11T08:00:00.000Z",
      }).success,
    ).toBeTrue();
  });

  test("requires the canonical short-ID Contact link", () => {
    const match = {
      ...suggestion,
      bookName: "Customers",
      matchedEmails: ["ada@example.test"],
      openHref: "/app/contacts/Book01?contact=Cont01&contactBook=Book01",
    };
    expect(contactResolveMatchSchema.safeParse(match).success).toBeTrue();
    expect(
      contactResolveMatchSchema.safeParse({ ...match, openHref: `/app/contacts/${legacyUuid}?contact=${legacyUuid}` }).success,
    ).toBeFalse();
  });
});

describe("Mail Spaces integration resource IDs", () => {
  test("accepts short Space resource IDs and rejects UUIDs", () => {
    expect(
      spacesMailDestinationContextSchema.safeParse({
        selectedSpaceId: "space1",
        items: [{ id: "space1", name: "Roadmap", color: "#3b82f6" }],
      }).success,
    ).toBeTrue();
    expect(spacesMailDestinationContextSchema.safeParse({ selectedSpaceId: legacyUuid, items: [] }).success).toBeFalse();

    const event = {
      kind: "event",
      id: "event1",
      spaceId: "space1",
      columnId: "todo01",
      title: "Planning",
      location: null,
      startsAt: "2026-08-11T08:00:00.000Z",
      endsAt: "2026-08-11T09:00:00.000Z",
      allDay: false,
    };
    expect(calendarEventSchema.safeParse(event).success).toBeTrue();
    expect(calendarEventSchema.safeParse({ ...event, id: legacyUuid }).success).toBeFalse();
  });

  test("keeps only the technical delivery ID UUID-backed", () => {
    expect(
      calendarInvitationImportResultSchema.safeParse({
        itemId: "event1",
        spaceId: "space1",
        href: "/app/spaces/space1?item=event1",
        outcome: "created",
      }).success,
    ).toBeTrue();
    expect(
      calendarInvitationImportResultSchema.safeParse({
        itemId: "event1",
        spaceId: "space1",
        href: `/app/spaces/${legacyUuid}?item=${legacyUuid}`,
        outcome: "created",
      }).success,
    ).toBeFalse();
    expect(
      eventInvitationCommitDataSchema.safeParse({
        deliveryId: legacyUuid,
        itemId: "event1",
        draftId: "draft1",
        state: "drafted",
      }).success,
    ).toBeTrue();
    expect(
      eventInvitationCommitDataSchema.safeParse({
        deliveryId: "short1",
        itemId: legacyUuid,
        draftId: legacyUuid,
        state: "drafted",
      }).success,
    ).toBeFalse();
  });
});

describe("Mail app capability integration errors", () => {
  test("preserves an unknown action outcome without retrying or relabeling it", () => {
    expect(projectAppCapabilityError({ code: "ACTION_OUTCOME_UNKNOWN", message: "Outcome unknown", status: 502 })).toEqual({
      ok: false,
      code: "ACTION_OUTCOME_UNKNOWN",
      message: "Outcome unknown",
      status: 502,
    });
  });

  test("normalizes unavailable discovery status while preserving its exact code", () => {
    expect(projectAppCapabilityError({ code: "CAPABILITY_NOT_FOUND", message: "Missing", status: 404 })).toEqual({
      ok: false,
      code: "CAPABILITY_NOT_FOUND",
      message: "Missing",
      status: 503,
    });
  });
});
