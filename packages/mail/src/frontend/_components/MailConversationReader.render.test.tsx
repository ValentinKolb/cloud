import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { ConversationDraftSummary } from "../../contracts";
import type { MessageDetail } from "../../service/messages";

const root = mkdtempSync(join(tmpdir(), "mail-conversation-reader-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: MailConversationReader } = await import("./MailConversationReader.tsx");

const now = "2026-08-16T12:00:00.000Z";
const message: MessageDetail = {
  id: "Msg001",
  subject: "Quarterly review",
  messageId: "<quarterly-review@example.com>",
  internalDate: now,
  sentAt: now,
  from: [{ name: "Ada Lovelace", address: "ada@example.com" }],
  to: [{ name: "Support", address: "support@example.com" }],
  replyTo: [],
  cc: [],
  flags: [],
  keywords: [],
  hydrationStatus: "complete",
  remoteAvailable: true,
  folderId: "Fold01",
  contentType: "text/plain",
  sizeBytes: 5,
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
  attachments: [],
};

const draft: ConversationDraftSummary = {
  id: "Draft1",
  intent: "reply",
  subject: "Re: Quarterly review",
  bodyPreview: "Thanks for the update.",
  createdByDisplayName: "Valentin Kolb",
  updatedAt: now,
};

const renderReader = (conversationDrafts: ConversationDraftSummary[]) =>
  renderToString(() =>
    createComponent(MailConversationReader, {
      mailboxId: "Box001",
      requestUrl: "https://cloud.example.test/app/mail/Box001?conversation=Conv01",
      canWrite: true,
      canAdmin: false,
      identities: [],
      selectionKey: "Conv01",
      selectedConversationId: "Conv01",
      selectedMessageId: null,
      unread: false,
      flagged: false,
      inJunk: false,
      reference: null,
      subject: message.subject,
      messages: [message],
      conversationSummary: null,
      conversationDrafts,
      totalMessageCount: 1,
      error: null,
      dateConfig: { locale: "en", timeZone: "Europe/Berlin" },
      readingFormat: "automatic",
      theme: "light",
      calendarIntegrationAvailable: false,
      listCollapsed: false,
      detailsOpen: false,
      toolbarActions: ["reply"],
      onRestoreList: () => undefined,
      onToggleDetails: () => undefined,
      onToolbarActionsChange: () => undefined,
      actionPending: false,
      onAction: () => undefined,
      onOpenHref: () => undefined,
      onManageTags: () => undefined,
      onMergeConversation: () => undefined,
      onReassignMessage: () => undefined,
      onSplitMessage: () => undefined,
      onSummarySaved: async () => undefined,
      onReconcile: async () => undefined,
      onReconcileAfterWrite: async () => undefined,
      onClose: () => undefined,
    }),
  );

describe("Mail conversation reader", () => {
  test("marks Reply when the conversation has a draft without rendering a header CTA", () => {
    const html = renderReader([draft]);

    expect(html).toContain('data-mail-toolbar-action="reply"');
    expect(html).toContain('aria-label="Reply, draft available"');
    expect(html).toContain("data-mail-draft-label");
    expect(html).toContain("sm:inline");
    expect(html).toContain("Draft available");
    expect(html).toContain("data-mail-draft-indicator");
    expect(html).toContain("sm:hidden");
    expect(html).not.toContain("Continue draft");
  });

  test("keeps Reply unmarked when the conversation has no draft", () => {
    const html = renderReader([]);

    expect(html).toContain('aria-label="Reply"');
    expect(html).not.toContain("data-mail-draft-label");
    expect(html).not.toContain("data-mail-draft-indicator");
  });
});
