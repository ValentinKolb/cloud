import { describe, expect, test } from "bun:test";
import { CreateEventInvitationDraftInputSchema, MailEventInvitationDraftInputSchema, MailInvitationMailboxSchema } from "./integration";

const mailboxId = "11111111-1111-4111-8111-111111111111";
const identityId = "22222222-2222-4222-8222-222222222222";

describe("Mail invitation integration contracts", () => {
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
          id: "33333333-3333-4333-8333-333333333333",
          label: "Billing",
          from: { name: "Billing", address: "billing@example.com" },
          isDefault: false,
        },
      ],
    });
    expect(mailbox.identities).toHaveLength(2);
    expect(mailbox.identities[0]?.isDefault).toBe(true);
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
