import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { compileCapabilityManifest } from "@valentinkolb/cloud/capabilities/testing";
import {
  CAPABILITY_MAX_RESULT_BYTES,
  type CapabilityActionDefinition,
  CapabilityActionReviewSchema,
  type CapabilityExecutionContext,
} from "@valentinkolb/cloud/contracts";
import { mailCapabilities } from "./capabilities";
import {
  ActivityListDataSchema,
  CommentListDataSchema,
  ConversationListDataSchema,
  ConversationMarkInputSchema,
  ConversationMoveInputSchema,
  DraftCreateInputSchema,
  DraftListDataSchema,
  DraftSendInputSchema,
  FolderListDataSchema,
  MessageDataSchema,
  SubscriptionListDataSchema,
  SubscriptionUnsubscribeInputSchema,
} from "./capability-contracts";
import { collaboration, listSubscriptions, mailboxAccess, mailboxes, messages, publicResources, triage } from "./service";

const mailboxId = "MbA123";
const conversationId = "CvB234";
const folderId = "FdC345";
const senderIdentityId = "SiD456";
const deliveryId = "DlE567";
const tagId = "TgF678";
const folderAId = "FaA111";
const folderBId = "FbB222";
const folderCId = "FcC333";
const internalMailboxId = "553cd2c2-6dd8-47c7-bd2d-f731e78bc7ef";
const internalConversationId = "34e29d53-8e6a-4a4d-bd83-4ad8d69957c8";
const internalFolderId = "dc1fe87d-c60b-4f63-a83d-9db6320da31d";
const internalFolderAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const internalFolderBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const internalFolderCId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const internalCommentId = "11111111-1111-4111-8111-111111111111";
const internalDraftId = "22222222-2222-4222-8222-222222222222";
const internalDraftAttachmentId = "33333333-3333-4333-8333-333333333333";
const internalTagId = "44444444-4444-4444-8444-444444444444";
const internalMessageId = "55555555-5555-4555-8555-555555555555";
const missingResourceId = "66666666-6666-4666-8666-666666666666";
const technicalTargetId = "77777777-7777-4777-8777-777777777777";
const commentId = "CmK012";
const draftId = "DrG789";
const draftAttachmentId = "DaL123";
const messageId = "MsH890";
const userId = "dc1fe87d-c60b-4f63-a83d-9db6320da31d";
const publicIdsByTable = {
  mailboxes: new Map([[internalMailboxId, mailboxId]]),
  folders: new Map([
    [internalFolderId, folderId],
    [internalFolderAId, folderAId],
    [internalFolderBId, folderBId],
    [internalFolderCId, folderCId],
  ]),
  conversations: new Map([[internalConversationId, conversationId]]),
  messages: new Map([
    [internalConversationId, messageId],
    [internalMessageId, messageId],
  ]),
  senderIdentities: new Map([[internalConversationId, senderIdentityId]]),
  deliveries: new Map([[internalConversationId, deliveryId]]),
  tags: new Map([
    [internalConversationId, tagId],
    [internalTagId, tagId],
  ]),
  comments: new Map([[internalCommentId, commentId]]),
  drafts: new Map([[internalDraftId, draftId]]),
  draftAttachments: new Map([[internalDraftAttachmentId, draftAttachmentId]]),
} as const;
const internalIdsByTable = {
  mailboxes: new Map([[mailboxId, internalMailboxId]]),
  folders: new Map([[folderId, internalFolderId]]),
  conversations: new Map([[conversationId, internalConversationId]]),
  senderIdentities: new Map([[senderIdentityId, internalConversationId]]),
  deliveries: new Map([[deliveryId, internalConversationId]]),
  tags: new Map([[tagId, internalConversationId]]),
} as const;
const context = {
  actor: { kind: "user", user: { id: userId } },
  accessSubject: { type: "user", userId },
  user: { id: userId },
  signal: new AbortController().signal,
} as CapabilityExecutionContext;

beforeEach(() => {
  spyOn(publicResources, "resolvePublicId").mockImplementation(
    async (table, id) => (internalIdsByTable as Record<string, Map<string, string>>)[table]?.get(id) ?? null,
  );
  spyOn(publicResources, "resolveMailboxPublicId").mockImplementation(
    async (table, _mailboxId, id) => (internalIdsByTable as Record<string, Map<string, string>>)[table]?.get(id) ?? null,
  );
  spyOn(publicResources, "publicIds").mockImplementation(
    async (table) => new Map((publicIdsByTable as Record<string, Map<string, string>>)[table] ?? []),
  );
});

afterEach(() => mock.restore());

describe("mail capabilities", () => {
  test("compiles into a registrable v1 manifest", () => {
    const manifest = compileCapabilityManifest("mail", mailCapabilities);
    expect(manifest.appId).toBe("mail");
    expect(mailCapabilities.types.conversation.icon).toBe("ti ti-mail");
    expect(manifest.queries).toHaveLength(Object.keys(mailCapabilities.queries).length);
    expect(manifest.actions).toHaveLength(Object.keys(mailCapabilities.actions).length);
  });

  test("only exposes remembered approval for reversible internal mail changes", () => {
    const rememberable = (Object.entries(mailCapabilities.actions) as Array<[string, CapabilityActionDefinition]>)
      .filter(([, action]) => action.approval === "rememberable")
      .map(([localId]) => localId)
      .sort();
    expect(rememberable).toEqual([
      "conversation.collaboration.update",
      "conversation.comment.update",
      "conversation.mark",
      "conversation.move",
      "conversation.reminder.set",
      "conversation.tag.update",
      "draft.create",
      "draft.update",
      "mailbox.tag.update",
    ]);
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
      "attachment.read",
      "comment.read",
      "conversation.activity.list",
      "conversation.comment.list",
      "conversation.list",
      "conversation.read",
      "conversation.reminder.get",
      "conversation.search",
      "delivery.list",
      "delivery.read",
      "draft.list",
      "draft.read",
      "draft.send.review",
      "folder.list",
      "mailbox.identity.list",
      "mailbox.list",
      "mailbox.member.list",
      "mailbox.read",
      "mailbox.tag.list",
      "mailing-list.subscription.get",
      "mailing-list.subscription.list",
      "message.list",
      "message.read",
      "reminder.read",
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
      "draft.create",
      "draft.discard",
      "draft.send",
      "draft.update",
      "mailbox.tag.delete",
      "mailbox.tag.update",
      "mailing-list.unsubscribe",
    ]);
  });

  test("uses singular conversation mutations and agent-oriented discovery wording", () => {
    const target = {
      conversationId,
      sourceFolderId: folderId,
    };
    expect(
      ConversationMarkInputSchema.safeParse({
        mailboxId,
        target,
        read: false,
      }).success,
    ).toBeTrue();
    expect(
      ConversationMarkInputSchema.safeParse({
        mailboxId,
        targets: [target, target],
        read: false,
      }).success,
    ).toBeFalse();
    expect(
      ConversationMoveInputSchema.safeParse({
        mailboxId,
        target,
        destination: { kind: "role", role: "archive" },
      }).success,
    ).toBeTrue();
    expect(mailCapabilities.actions["conversation.mark"].description).toContain("read, unread, flagged, or unflagged");
    expect(mailCapabilities.actions["draft.send"].title).toBe("Send draft email");
    expect(mailCapabilities.queries["draft.send.review"].description).toContain("does not send");
  });

  test("rejects UUIDs at the public Mail resource boundary", () => {
    expect(DraftCreateInputSchema.safeParse({ mailboxId, senderIdentityId }).success).toBeTrue();
    expect(DraftCreateInputSchema.safeParse({ mailboxId: internalMailboxId, senderIdentityId }).success).toBeFalse();
    expect(DraftCreateInputSchema.safeParse({ mailboxId, senderIdentityId: internalConversationId }).success).toBeFalse();
    expect(
      ConversationMarkInputSchema.safeParse({
        mailboxId,
        target: { conversationId: internalConversationId, sourceFolderId: folderId },
        read: true,
      }).success,
    ).toBeFalse();
  });

  test("aligns action reviews with their run permissions", async () => {
    const denied = { ok: false as const, error: { code: "FORBIDDEN", message: "Denied", status: 403 as const } };
    const requirePermission = spyOn(mailboxAccess, "requireMailboxPermission").mockResolvedValue(denied);

    await mailCapabilities.actions["draft.create"].review(DraftCreateInputSchema.parse({ mailboxId, senderIdentityId }), context);
    await mailCapabilities.actions["delivery.cancel"].review({ mailboxId, deliveryId, disposition: "draft" }, context);
    await mailCapabilities.actions["mailbox.tag.update"].review({ mailboxId, tagId, expectedRevision: 1, name: "Updated" }, context);
    await mailCapabilities.actions["mailbox.tag.delete"].review({ mailboxId, tagId, expectedRevision: 1 }, context);
    await mailCapabilities.actions["mailing-list.unsubscribe"].review(
      { mailboxId, listKey: "example", href: "https://example.test/unsubscribe" },
      context,
    );
    await mailCapabilities.actions["conversation.reminder.set"].review(
      { mailboxId, conversationId, dueAt: "2026-08-05T10:00:00.000Z", expectedRevision: null },
      context,
    );

    expect(requirePermission.mock.calls.slice(0, 5).map((call) => call[2])).toEqual(["write", "write", "write", "write", "write"]);
    expect(requirePermission.mock.calls[5]?.[2]).toBe("read");
  });

  test("reviews a new draft with its user-visible envelope", async () => {
    spyOn(mailboxAccess, "requireMailboxPermission").mockResolvedValue({ ok: true, data: "write" });
    const review = await mailCapabilities.actions["draft.create"].review(
      DraftCreateInputSchema.parse({
        mailboxId,
        senderIdentityId,
        to: [{ name: "Ada", address: "ada@example.test" }],
        cc: [{ address: "team@example.test" }],
        subject: "Release follow-up",
        attachments: [{ filename: "notes.txt", contentType: "text/plain", base64: "bm90ZXM=" }],
      }),
      context,
    );

    expect(review).toEqual({
      ok: true,
      data: {
        message: "The email will be saved as a draft and will not be sent.",
        details: [
          { label: "Subject", value: "Release follow-up" },
          { label: "Recipients", value: "Ada, team@example.test" },
          { label: "Attachments", value: "1" },
        ],
      },
    });
    if (review.ok) expect(CapabilityActionReviewSchema.safeParse(review.data).success).toBeTrue();
  });

  test("keeps remote conversation subjects inside the review envelope", async () => {
    spyOn(mailboxAccess, "requireMailboxPermission").mockResolvedValue({ ok: true, data: "write" });
    spyOn(messages, "listConversationMessages").mockResolvedValue({
      ok: true,
      data: { items: [{ subject: "s".repeat(998) }], nextCursor: null },
    } as never);
    const review = await mailCapabilities.actions["conversation.mark"].review(
      { mailboxId, target: { conversationId, sourceFolderId: folderId }, read: false },
      context,
    );
    expect(review.ok).toBeTrue();
    if (review.ok) expect(CapabilityActionReviewSchema.safeParse(review.data).success).toBeTrue();
  });

  test("resolves short mailbox IDs and paginates folders with public IDs", async () => {
    const folder = (id: string, name: string) => ({
      id,
      parentId: null,
      name,
      role: "custom",
      providerRole: "custom",
      configuredRole: null,
      selectable: true,
      showInSidebar: true,
      namespaceKinds: ["personal" as const],
      discoveryState: "active" as const,
      missingSince: null,
      syncStatus: "current",
      total: 0,
      unread: 0,
    });
    const listFolders = spyOn(messages, "listFolders").mockResolvedValue({
      ok: true,
      data: [folder(internalFolderCId, "C"), folder(internalFolderAId, "A"), folder(internalFolderBId, "B")],
    });

    const first = await mailCapabilities.queries["folder.list"].run({ mailboxId, limit: 2 }, context);
    expect(listFolders.mock.calls[0]?.[1]).toBe(internalMailboxId);
    expect(first).toMatchObject({
      ok: true,
      data: {
        data: [
          {
            id: folderAId,
            links: [{ rel: "open", href: `/app/mail/${mailboxId}?folder=${folderAId}` }],
          },
          {
            id: folderBId,
            links: [{ rel: "open", href: `/app/mail/${mailboxId}?folder=${folderBId}` }],
          },
        ],
        page: { hasMore: true },
      },
    });
    if (!first.ok || !first.data.page?.hasMore) throw new Error("Expected another folder page");
    expect(FolderListDataSchema.safeParse(first.data.data).success).toBeTrue();
    const second = await mailCapabilities.queries["folder.list"].run({ mailboxId, limit: 2, cursor: first.data.page.nextCursor }, context);
    expect(second).toMatchObject({
      ok: true,
      data: { data: [{ id: folderCId }], page: { hasMore: false } },
    });
  });

  test("keeps navigable conversation links with each rich list item", async () => {
    spyOn(messages, "listConversations").mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: internalConversationId,
            primaryReference: null,
            subject: "Release update",
            participantSummary: "Ada",
            participantLabels: ["Ada"],
            latestMessageAt: "2026-08-04T10:00:00.000Z",
            workStatus: "needs_action",
            assigneeUserId: null,
            snoozedUntil: null,
            revision: 1,
            updatedAt: "2026-08-04T10:00:00.000Z",
            unread: true,
            activeFolderIds: [internalFolderId],
            flagged: false,
            hasAttachments: false,
            messageCount: 1,
            preview: "Ready to ship",
          },
        ],
        nextCursor: null,
      },
    } as never);

    const result = await mailCapabilities.queries["conversation.list"].run({ mailboxId, limit: 25 }, context);
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [
          {
            id: conversationId,
            subject: "Release update",
            links: [{ rel: "open", href: `/app/mail/${mailboxId}?conversation=${conversationId}` }],
          },
        ],
      },
    });
    if (!result.ok) throw new Error("Expected conversation list success");
    expect(ConversationListDataSchema.safeParse(result.data.data).success).toBeTrue();
    expect(ConversationListDataSchema.safeParse(result.data.data.map(({ links: _, ...item }) => item)).success).toBeTrue();
    expect(JSON.stringify(result)).not.toContain(internalConversationId);
    expect(JSON.stringify(result)).not.toContain(internalMailboxId);
  });

  test("returns exact conversation links from reviews and mutation results", async () => {
    spyOn(mailboxAccess, "requireMailboxPermission").mockResolvedValue({ ok: true, data: "write" });
    spyOn(messages, "listConversationMessages").mockResolvedValue({
      ok: true,
      data: { items: [{ subject: "Release update" }], nextCursor: null },
    } as never);
    const createCommands = spyOn(triage, "createConversationTriageCommands").mockResolvedValue({
      ok: true,
      data: { correlationId: "correlation", commands: [{ id: internalMailboxId, state: "pending" }] },
    } as never);
    const input = { mailboxId, target: { conversationId, sourceFolderId: folderId }, read: true };

    const review = await mailCapabilities.actions["conversation.mark"].review(input, context);
    const result = await mailCapabilities.actions["conversation.mark"].run(input, { ...context, idempotencyKey: "mark-read" });

    expect(createCommands.mock.calls[0]?.[0]).toMatchObject({
      mailboxId: internalMailboxId,
      conversationId: internalConversationId,
      input: { sourceFolderId: internalFolderId },
    });
    expect(review).toMatchObject({
      ok: true,
      data: { links: [{ rel: "open", href: `/app/mail/${mailboxId}?conversation=${conversationId}` }] },
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        refs: [{ type: "mail.conversation", id: conversationId }],
        links: [{ rel: "open", href: `/app/mail/${mailboxId}?conversation=${conversationId}` }],
      },
    });
  });

  test("encodes subscription links and omits links that exceed the platform bound", async () => {
    const subscription = (listKey: string) => ({
      listKey,
      name: "Example list",
      address: "list@example.test",
      status: "active" as const,
      unsubscribe: null,
      postHref: null,
      helpHref: null,
      archiveHref: null,
      messageCount: 2,
      recentMessageCount: 1,
      conversationCount: 1,
      lastMessageAt: "2026-08-04T10:00:00.000Z",
      lastSubject: "Update",
      lastSender: "Example",
      lastMessageId: internalConversationId,
      lastConversationId: internalConversationId,
      unsubscribeRequestedAt: null,
      unsubscribeErrorCode: null,
    });
    spyOn(listSubscriptions, "listSubscriptions").mockResolvedValue({
      ok: true,
      data: { items: [subscription("list one&two"), subscription("x".repeat(4096))], nextCursor: null },
    });

    const result = await mailCapabilities.queries["mailing-list.subscription.list"].run({ mailboxId, limit: 25 }, context);
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [{ links: [{ rel: "open", href: `/app/mail/${mailboxId}?mailingList=list%20one%26two` }] }, { listKey: "x".repeat(4096) }],
      },
    });
    if (!result.ok) throw new Error("Expected subscription list success");
    expect(SubscriptionListDataSchema.safeParse(result.data.data).success).toBeTrue();
    expect("links" in result.data.data[1]!).toBeFalse();
  });

  test("projects activity resource targets and resource metadata without leaking UUIDs", async () => {
    const activity = (id: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) => ({
      id,
      conversationId: internalConversationId,
      actor: { kind: "system" as const, id: null, displayName: "System", avatarHash: null },
      action: `test.${targetType}`,
      outcome: "confirmed" as const,
      targetType,
      targetId,
      metadata,
      createdAt: "2026-08-04T10:00:00.000Z",
    });
    const listActivity = spyOn(collaboration, "listActivity").mockResolvedValue({
      ok: true,
      data: {
        items: [
          activity("1", "conversation", internalConversationId, {
            messageId: internalMessageId,
            addedTagIds: [internalTagId, missingResourceId],
          }),
          activity("2", "draft_attachment", internalDraftAttachmentId),
          activity("3", "comment", missingResourceId, { messageId: missingResourceId }),
          activity("4", "command", technicalTargetId),
          activity("5", "unknown_resource", missingResourceId),
        ],
        nextCursor: null,
      },
    } as never);

    const result = await mailCapabilities.queries["conversation.activity.list"].run({ mailboxId, limit: 25 }, context);

    expect(listActivity.mock.calls[0]?.[0]).toMatchObject({ mailboxId: internalMailboxId, conversationId: null });
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [
          {
            conversationId,
            targetType: "conversation",
            targetId: conversationId,
            metadata: { messageId, addedTagIds: [tagId, null] },
          },
          { conversationId, targetType: "draft_attachment", targetId: draftAttachmentId },
          { conversationId, targetType: "comment", targetId: null, metadata: { messageId: null } },
          { conversationId, targetType: "command", targetId: technicalTargetId },
          { conversationId, targetType: "unknown_resource", targetId: null },
        ],
        refs: [{ type: "mail.mailbox", id: mailboxId }],
        links: [{ rel: "open", href: `/app/mail/${mailboxId}` }],
      },
    });
    if (!result.ok) throw new Error("Expected activity list success");
    expect(ActivityListDataSchema.safeParse(result.data.data).success).toBeTrue();
    const projectedResourceActivities = JSON.stringify(result.data.data.slice(0, 3));
    for (const id of [internalConversationId, internalDraftAttachmentId, internalMessageId, internalTagId, missingResourceId]) {
      expect(projectedResourceActivities).not.toContain(id);
    }
  });

  test("propagates Mail search discovery failures instead of returning empty success", async () => {
    spyOn(mailboxes, "listMailboxes").mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "Mailbox lookup failed", status: 500 },
    });
    const result = await mailCapabilities.queries.search.run({ query: "invoice", tags: [], limit: 10 }, context);
    expect(result).toEqual({ ok: false, error: { code: "INTERNAL", message: "Mailbox lookup failed", status: 500 } });
  });

  test("keeps draft creation bounded and closed", () => {
    const base = {
      mailboxId,
      senderIdentityId,
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
      mailboxId,
      draftId: "DrG789",
      expectedRevision: 2,
      senderIdentityId,
      safetyApproval: { revision: 2, fingerprint: "a".repeat(64), warningIds: ["missing_attachment"] },
    };
    expect(DraftSendInputSchema.safeParse(input).success).toBeTrue();
    expect(DraftSendInputSchema.safeParse({ ...input, safetyApproval: { warningIds: [] } }).success).toBeFalse();
  });

  test("does not expose raw source or sanitized html from message.read", () => {
    const value = {
      id: "MsH890",
      mailboxId,
      conversationId: null,
      subject: "Hello",
      subjectTruncated: false,
      messageId: null,
      internalDate: "2026-08-02T10:00:00.000Z",
      sentAt: null,
      from: [],
      to: [],
      addressesTruncated: false,
      flags: [],
      flagsTruncated: false,
      keywords: [],
      keywordsTruncated: false,
      hydrationStatus: "ready",
      remoteAvailable: true,
      contentType: "text/html",
      sizeBytes: 10,
      replyTo: [],
      cc: [],
      detailAddressesTruncated: false,
      headers: [{ name: "message-id", value: "<example@example.com>" }],
      headersTruncated: false,
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
      mailboxId,
      listKey: "example.list",
      href: "https://example.com/unsubscribe",
    };
    expect(SubscriptionUnsubscribeInputSchema.safeParse(valid).success).toBeTrue();
    expect(SubscriptionUnsubscribeInputSchema.safeParse({ ...valid, allLists: true }).success).toBeFalse();
  });

  test("keeps compact high-cardinality results below the capability transport limit", () => {
    const id = "RsA123";
    const timestamp = "2026-08-02T10:00:00.000Z";
    const drafts = Array.from({ length: 100 }, () => ({
      id,
      mailboxId: id,
      conversationId: id,
      intent: "forward" as const,
      senderIdentityId: id,
      subject: "s".repeat(500),
      subjectTruncated: true,
      bodyPreview: "b".repeat(1000),
      bodyTruncated: true,
      format: "markdown" as const,
      priority: "normal" as const,
      attachmentCount: 1000,
      revision: 1,
      state: "draft" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const comments = Array.from({ length: 100 }, () => ({
      id,
      conversationId: id,
      body: "c".repeat(1000),
      bodyTruncated: true,
      author: { kind: "user" as const, id: userId, displayName: "Agent", avatarHash: null },
      referencedMessageId: null,
      revision: 1,
      editedAt: null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const parsedDrafts = DraftListDataSchema.parse(drafts);
    const parsedComments = CommentListDataSchema.parse(comments);
    expect(Buffer.byteLength(JSON.stringify({ data: parsedDrafts }), "utf8")).toBeLessThan(CAPABILITY_MAX_RESULT_BYTES);
    expect(Buffer.byteLength(JSON.stringify({ data: parsedComments }), "utf8")).toBeLessThan(CAPABILITY_MAX_RESULT_BYTES);

    const address = { name: "n".repeat(200), address: `${"a".repeat(64)}@example.test` };
    const attachmentId = "AtJ901";
    const message = MessageDataSchema.parse({
      id,
      mailboxId: id,
      conversationId: id,
      subject: "s".repeat(998),
      subjectTruncated: true,
      messageId: "m".repeat(998),
      internalDate: timestamp,
      sentAt: timestamp,
      from: Array.from({ length: 20 }, () => address),
      to: Array.from({ length: 20 }, () => address),
      addressesTruncated: true,
      flags: Array.from({ length: 10 }, () => "f".repeat(128)),
      flagsTruncated: true,
      keywords: Array.from({ length: 10 }, () => "k".repeat(128)),
      keywordsTruncated: true,
      hydrationStatus: "h".repeat(100),
      remoteAvailable: true,
      contentType: "c".repeat(255),
      sizeBytes: 1,
      replyTo: Array.from({ length: 20 }, () => address),
      cc: Array.from({ length: 20 }, () => address),
      detailAddressesTruncated: true,
      headers: Array.from({ length: 25 }, () => ({ name: "h".repeat(128), value: "v".repeat(2048) })),
      headersTruncated: true,
      text: "b".repeat(96 * 1024),
      bodyTruncated: true,
      attachments: Array.from({ length: 50 }, () => ({
        id: attachmentId,
        filename: "f".repeat(255),
        contentType: "c".repeat(255),
        sizeBytes: 1,
        downloadHref: `/api/mail/mailboxes/${id}/messages/${id}/attachments/${attachmentId}`,
      })),
      attachmentsTruncated: true,
      delivery: {
        id,
        state: "scheduled",
        scheduledAt: timestamp,
        undoUntil: timestamp,
        acceptedAt: null,
        errorCode: "e".repeat(200),
        errorMessage: "e".repeat(1000),
      },
    });
    const messageEnvelope = {
      data: message,
      refs: Array.from({ length: 50 }, () => ({ type: "mail.attachment", id: attachmentId })),
      links: Array.from({ length: 20 }, () => ({ rel: "download", href: `/api/mail/attachments/${attachmentId}` })),
    };
    expect(Buffer.byteLength(JSON.stringify(messageEnvelope), "utf8")).toBeLessThan(CAPABILITY_MAX_RESULT_BYTES);
  });
});
