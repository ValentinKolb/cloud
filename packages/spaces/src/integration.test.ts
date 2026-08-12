import { describe, expect, test } from "bun:test";
import {
  CalendarInvitationImportResultSchema,
  CalendarInvitationPreviewSchema,
  CreateEventInvitationDraftInputSchema,
  MailEventInvitationDraftInputSchema,
  MailInvitationMailboxSchema,
  SpacesMailDestinationContextSchema,
} from "./integration";

const mailboxId = "mail01";
const identityId = "ident1";
const legacyUuid = "11111111-1111-4111-8111-111111111111";

describe("Mail invitation integration contracts", () => {
  test("uses short IDs for Spaces and Mail resources", () => {
    const existing = {
      invitation: {
        method: "request",
        uid: "planning@example.com",
        sequence: 1,
        status: "confirmed",
        title: "Planning",
        description: null,
        location: null,
        url: null,
        startsAt: "2026-08-11T08:00:00.000Z",
        endsAt: "2026-08-11T09:00:00.000Z",
        allDay: false,
        recurrenceRule: null,
        organizer: null,
        attendees: [],
      },
      response: null,
      existing: {
        itemId: "event1",
        spaceId: "space1",
        href: "/app/spaces/space1?item=event1",
        sequence: 1,
        method: "request",
      },
    };
    expect(CalendarInvitationPreviewSchema.safeParse(existing).success).toBeTrue();
    expect(
      CalendarInvitationPreviewSchema.safeParse({ ...existing, existing: { ...existing.existing, itemId: legacyUuid } }).success,
    ).toBeFalse();
    expect(
      CalendarInvitationPreviewSchema.safeParse({
        ...existing,
        existing: { ...existing.existing, href: `/app/spaces/${legacyUuid}?item=${legacyUuid}` },
      }).success,
    ).toBeFalse();
    expect(
      CalendarInvitationImportResultSchema.safeParse({
        itemId: "event1",
        spaceId: "space1",
        href: "/app/spaces/space1?item=event1",
        outcome: "created",
      }).success,
    ).toBeTrue();
    expect(
      CalendarInvitationImportResultSchema.safeParse({
        itemId: "event1",
        spaceId: "space1",
        href: "/app/spaces/space1?item=other1",
        outcome: "created",
      }).success,
    ).toBeFalse();
    expect(
      SpacesMailDestinationContextSchema.safeParse({
        selectedSpaceId: "space1",
        items: [{ id: "space1", name: "Planning", color: "#3b82f6" }],
      }).success,
    ).toBeTrue();
    expect(SpacesMailDestinationContextSchema.safeParse({ selectedSpaceId: legacyUuid, items: [] }).success).toBeFalse();
  });

  test("exposes every verified sender choice explicitly", () => {
    const mailbox = MailInvitationMailboxSchema.parse({
      id: mailboxId,
      name: "Support",
      identities: [
        {
          id: identityId,
          label: "Support team",
          from: { name: "Support", address: "support@example.com" },
          isDefault: true,
        },
        {
          id: "ident2",
          label: "Billing",
          from: { name: "Billing", address: "billing@example.com" },
          isDefault: false,
        },
      ],
    });
    expect(mailbox.identities).toHaveLength(2);
    expect(mailbox.identities[0]?.isDefault).toBe(true);
    expect(MailInvitationMailboxSchema.safeParse({ ...mailbox, id: legacyUuid }).success).toBeFalse();
  });

  test("requires a concrete sender identity for user and provider draft requests", () => {
    const eventInput = {
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      mailboxId,
      senderIdentityId: identityId,
      attendees: [{ name: null, address: "guest@example.com" }],
      method: "request",
    };
    expect(CreateEventInvitationDraftInputSchema.safeParse(eventInput).success).toBe(true);
    expect(CreateEventInvitationDraftInputSchema.safeParse({ ...eventInput, senderIdentityId: undefined }).success).toBe(false);

    const providerInput = {
      idempotencyKey: eventInput.idempotencyKey,
      mailboxId,
      senderIdentityId: identityId,
      to: eventInput.attendees,
      subject: "Invitation",
      body: "Please join.",
      calendar: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    };
    expect(MailEventInvitationDraftInputSchema.safeParse(providerInput).success).toBe(true);
    expect(MailEventInvitationDraftInputSchema.safeParse({ ...providerInput, senderIdentityId: undefined }).success).toBe(false);
  });
});
