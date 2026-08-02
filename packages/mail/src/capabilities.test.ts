import { describe, expect, test } from "bun:test";
import { compileCapabilities } from "../../cloud/src/_internal/capabilities";
import { mailCapabilities } from "./capabilities";
import {
  DraftCreateInputSchema,
  DraftSendInputSchema,
  MessageDataSchema,
  SubscriptionUnsubscribeInputSchema,
} from "./capability-contracts";

describe("mail capabilities", () => {
  test("compiles into a registrable v1 manifest", () => {
    const compiled = compileCapabilities("mail", mailCapabilities);
    expect(compiled.manifest.appId).toBe("mail");
    expect(compiled.manifest.queries).toHaveLength(Object.keys(mailCapabilities.queries).length);
    expect(compiled.manifest.actions).toHaveLength(Object.keys(mailCapabilities.actions).length);
  });

  test("declares the complete daily-work v1 surface", () => {
    expect(Object.keys(mailCapabilities.types).sort()).toEqual([
      "attachment",
      "comment",
      "conversation",
      "delivery",
      "draft",
      "folder",
      "mailbox",
      "mailing-list",
      "message",
      "reminder",
      "sender-identity",
      "tag",
    ]);
    expect(Object.keys(mailCapabilities.queries).sort()).toEqual([
      "conversation.activity.list",
      "conversation.comment.list",
      "conversation.get",
      "conversation.list",
      "conversation.reminder.get",
      "conversation.search",
      "delivery.get",
      "delivery.list",
      "draft.get",
      "draft.list",
      "draft.send.review",
      "folder.list",
      "mailbox.get",
      "mailbox.identity.list",
      "mailbox.list",
      "mailbox.member.list",
      "mailbox.tag.list",
      "mailing-list.subscription.get",
      "mailing-list.subscription.list",
      "message.get",
      "message.list",
      "search",
    ]);
    expect(Object.keys(mailCapabilities.actions).sort()).toEqual([
      "conversation.collaboration.update",
      "conversation.comment.create",
      "conversation.comment.delete",
      "conversation.comment.update",
      "conversation.mark",
      "conversation.move",
      "conversation.reminder.cancel",
      "conversation.reminder.set",
      "conversation.tag.update",
      "delivery.cancel",
      "draft.attachment.add",
      "draft.attachment.remove",
      "draft.create",
      "draft.discard",
      "draft.send",
      "draft.update",
      "mailbox.tag.create",
      "mailbox.tag.delete",
      "mailbox.tag.update",
      "mailing-list.unsubscribe",
    ]);
    expect(
      Object.entries(mailCapabilities.actions)
        .filter(([, action]) => "review" in action && action.review)
        .map(([id]) => id)
        .sort(),
    ).toEqual([
      "conversation.collaboration.update",
      "conversation.comment.delete",
      "conversation.comment.update",
      "conversation.mark",
      "conversation.move",
      "conversation.reminder.cancel",
      "conversation.reminder.set",
      "conversation.tag.update",
      "delivery.cancel",
      "draft.attachment.remove",
      "draft.discard",
      "draft.send",
      "draft.update",
      "mailbox.tag.delete",
      "mailbox.tag.update",
      "mailing-list.unsubscribe",
    ]);
  });

  test("keeps draft creation bounded and closed", () => {
    const base = {
      mailboxId: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
      senderIdentityId: "34e29d53-8e6a-4a4d-bd83-4ad8d69957c8",
    };
    expect(DraftCreateInputSchema.safeParse(base).success).toBeTrue();
    expect(DraftCreateInputSchema.safeParse({ ...base, connectorPassword: "secret" }).success).toBeFalse();
    expect(
      DraftCreateInputSchema.safeParse({
        ...base,
        attachments: Array.from({ length: 11 }, (_, index) => ({ filename: `${index}.txt`, base64: "YQ==" })),
      }).success,
    ).toBeFalse();
  });

  test("requires the exact safety approval shape for sending", () => {
    const input = {
      mailboxId: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
      draftId: "34e29d53-8e6a-4a4d-bd83-4ad8d69957c8",
      expectedRevision: 2,
      senderIdentityId: "dc1fe87d-c60b-4f63-a83d-9db6320da31d",
      safetyApproval: { revision: 2, fingerprint: "a".repeat(64), warningIds: ["missing_attachment"] },
    };
    expect(DraftSendInputSchema.safeParse(input).success).toBeTrue();
    expect(DraftSendInputSchema.safeParse({ ...input, safetyApproval: { warningIds: [] } }).success).toBeFalse();
  });

  test("does not expose raw source or sanitized html from message.get", () => {
    const value = {
      id: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
      mailboxId: "34e29d53-8e6a-4a4d-bd83-4ad8d69957c8",
      conversationId: null,
      subject: "Hello",
      messageId: null,
      internalDate: "2026-08-02T10:00:00.000Z",
      sentAt: null,
      from: [],
      to: [],
      flags: [],
      keywords: [],
      hydrationStatus: "ready",
      remoteAvailable: true,
      contentType: "text/html",
      sizeBytes: 10,
      replyTo: [],
      cc: [],
      headers: [{ name: "message-id", value: "<example@example.com>" }],
      text: "Hello",
      bodyTruncated: false,
      attachments: [],
      attachmentsTruncated: false,
      delivery: null,
    };
    expect(MessageDataSchema.safeParse(value).success).toBeTrue();
    expect(MessageDataSchema.safeParse({ ...value, sanitizedHtml: "<b>Hello</b>" }).success).toBeFalse();
  });

  test("accepts only explicit unsubscribe targets", () => {
    const valid = {
      mailboxId: "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef",
      listKey: "example.list",
      href: "https://example.com/unsubscribe",
    };
    expect(SubscriptionUnsubscribeInputSchema.safeParse(valid).success).toBeTrue();
    expect(SubscriptionUnsubscribeInputSchema.safeParse({ ...valid, allLists: true }).success).toBeFalse();
  });
});
