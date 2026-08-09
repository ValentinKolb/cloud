import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { ConversationCollaboration, ConversationComment, MailActivityEvent } from "../../service/collaboration";
import type { ConversationLocalTags, LocalTag } from "../../service/local-tags";
import type { MessageDetail } from "../../service/messages";
import type { ConversationPresenceParticipant } from "../../service/presence";
import type { MailDetailErrors } from "../../service/workspace";

const root = mkdtempSync(join(tmpdir(), "mail-detail-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: MailDetailsPanel } = await import("./MailDetailsPanel.tsx");

const now = "2026-08-09T10:00:00.000Z";
const mailboxId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";

const tag: LocalTag = {
  id: "00000000-0000-4000-8000-000000000003",
  mailboxId,
  name: "Important",
  color: "#2563eb",
  revision: 1,
  createdAt: now,
  updatedAt: now,
};

const collaboration: ConversationCollaboration = {
  conversationId,
  assignee: {
    id: "user-1",
    uid: "valentin",
    displayName: "Valentin Kolb",
    avatarHash: null,
  },
  workStatus: "needs_action",
  snoozedUntil: null,
  revision: 4,
};

const conversationTags: ConversationLocalTags = {
  conversationId,
  conversationRevision: collaboration.revision,
  tags: [tag],
};

const comment: ConversationComment = {
  id: "00000000-0000-4000-8000-000000000004",
  conversationId,
  body: "**Check** the customer reply.",
  author: {
    kind: "user",
    id: "user-1",
    displayName: "Valentin Kolb",
    avatarHash: null,
  },
  parentCommentId: null,
  referencedMessageId: null,
  revision: 1,
  editedAt: null,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
};

const activity: MailActivityEvent = {
  id: "00000000-0000-4000-8000-000000000005",
  conversationId,
  actor: {
    kind: "user",
    id: "user-1",
    displayName: "Valentin Kolb",
    avatarHash: null,
  },
  action: "conversation.status.changed",
  outcome: "confirmed",
  targetType: "conversation",
  targetId: conversationId,
  metadata: {},
  createdAt: now,
};

const presence: ConversationPresenceParticipant = {
  userId: "user-2",
  displayName: "Mara Klein",
  avatarHash: null,
  mode: "viewing",
  peerCount: 1,
  joinedAt: now,
};

const message: MessageDetail = {
  id: "00000000-0000-4000-8000-000000000006",
  subject: "Quarterly review",
  messageId: "<quarterly-review@example.com>",
  internalDate: now,
  sentAt: now,
  from: [{ name: "Ada Lovelace", address: "ada@example.com" }],
  to: [{ name: "Support", address: "support@example.com" }],
  flags: [],
  keywords: [],
  hydrationStatus: "complete",
  remoteAvailable: true,
  remoteMessageRefId: null,
  folderId: "00000000-0000-4000-8000-000000000007",
  contentType: "text/plain",
  sizeBytes: 4096,
  replyTo: [],
  cc: [],
  plainText: "Hello",
  sanitizedHtml: null,
  forwardText: "Hello",
  selectedHeaders: {},
  sourceAvailable: true,
  mailingList: null,
  remoteContent: {
    imageIds: [],
    allowedByRule: false,
    sender: "ada@example.com",
    domain: "example.com",
  },
  delivery: null,
  attachments: [
    {
      id: "00000000-0000-4000-8000-000000000008",
      filename: "review.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
      contentId: null,
    },
  ],
};

const noDetailErrors: MailDetailErrors = {
  collaboration: null,
  tags: null,
  comments: null,
  assignableUsers: null,
  activity: null,
  reminder: null,
  reference: null,
  summary: null,
  drafts: null,
};

const renderPanel = (overrides: Partial<Parameters<typeof MailDetailsPanel>[0]> = {}) =>
  renderToString(() =>
    createComponent(MailDetailsPanel, {
      mailboxId,
      conversationId,
      active: false,
      currentUserId: "user-1",
      canWrite: true,
      canAdmin: false,
      initialState: collaboration,
      initialLocalTags: [tag],
      initialConversationLocalTags: conversationTags,
      initialComments: [comment],
      assignableUsers: [{ ...collaboration.assignee!, permission: "admin", description: "Mailbox admin" }],
      presence: [presence],
      activity: [activity],
      initialReminder: null,
      detailErrors: noDetailErrors,
      messages: [message],
      subject: message.subject,
      dateConfig: { locale: "en", timeZone: "Europe/Berlin" },
      onCollaborationChange: () => {},
      onConversationTagsChange: () => {},
      onOpenHref: () => {},
      onReconcile: () => {},
      ...overrides,
    }),
  );

describe("Mail conversation detail panel", () => {
  test("composes the inspector from the shared grouped panel contract", () => {
    const html = renderPanel();
    const header = html.slice(0, html.indexOf('class="k2b-detail-panel__body"'));

    expect(html).toContain('class="k2b-detail-panel"');
    expect(html).toContain("<h2>Quarterly review</h2>");
    expect(header).toContain("Ada Lovelace");
    expect(header).not.toContain("message");
    expect(header).not.toContain("attachment");
    expect(header).not.toContain("k2b-detail-panel__meta");
    expect(html).toContain('class="k2b-detail-panel__summary"');
    expect(html).toContain(">Active collaborators<");
    expect(html).not.toContain("Here now");
    expect(html).toContain(">Tags<");
    expect(html).toContain('data-scroll-preserve="mail-conversation-detail"');
    expect(html.match(/k2b-detail-panel__body/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Conversation context"');
    expect(html).toContain('aria-label="Conversation history"');
    expect(html.indexOf("Active collaborators")).toBeGreaterThan(html.indexOf('aria-label="Conversation context"'));
    expect(html.indexOf("Active collaborators")).toBeLessThan(html.indexOf(">Contacts<"));
    expect(html).toContain('class="k2b-detail-panel__section-icon" data-tone="accent"');
    expect(html).toContain('class="k2b-discussion');
    expect(html).toContain('class="k2b-discussion__item');
    expect(html).toContain('class="k2b-content-markdown');
    expect(html).toContain(
      'href="/api/mail/mailboxes/00000000-0000-4000-8000-000000000001/messages/00000000-0000-4000-8000-000000000006/attachments/00000000-0000-4000-8000-000000000008"',
    );
    expect(html).toContain('download="review.pdf"');
    expect(html).toContain("Recent activity");
    expect(html).toContain("Mail details");
    expect(html.match(/<details class="k2b-detail-panel__section"/g)).toHaveLength(2);
    expect(html).toContain('data-visibility="progressive"');
    expect(html).not.toContain('data-visibility="always"');
    expect(html.indexOf('aria-label="Edit comment"')).toBeLessThan(html.indexOf('aria-label="Delete comment"'));
    expect(html.indexOf('aria-label="Delete comment"')).toBeLessThan(html.indexOf('aria-label="Reply to Valentin Kolb"'));
    expect(html.slice(html.indexOf('aria-label="Edit comment"'), html.indexOf('aria-label="Edit comment"') + 220)).toContain(
      'data-size="xs"',
    );
    expect(html).not.toContain('class="detail-stack');
    expect(html).not.toContain('class="detail-section');
    expect(html).not.toContain("overflow-y-auto");
  });

  test("keeps comment action order and read-only workflow permissions", () => {
    const html = renderPanel({ canWrite: false, canAdmin: false, currentUserId: "user-2" });
    const editIndex = html.indexOf('aria-label="Edit comment"');
    const deleteIndex = html.indexOf('aria-label="Delete comment"');
    const replyIndex = html.indexOf('aria-label="Reply to Valentin Kolb"');

    expect(editIndex).toBe(-1);
    expect(deleteIndex).toBe(-1);
    expect(replyIndex).toBeGreaterThan(-1);
    expect(html).toContain('aria-label="Create tag"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Internal comment"');
  });

  test("preserves partial-error and empty states without empty attachment shells", () => {
    const html = renderPanel({
      initialComments: [],
      presence: [],
      messages: [{ ...message, attachments: [] }],
      detailErrors: { ...noDetailErrors, tags: "Tags unavailable", activity: "Activity unavailable" },
    });

    expect(html).toContain("Some conversation details are temporarily unavailable");
    expect(html).toContain("Retry");
    expect(html).toContain("No team notes yet.");
    expect(html).toContain("Loading contacts...");
    expect(html).not.toContain(">Attachments<");
    expect(html).not.toContain(">Here now<");
  });
});
