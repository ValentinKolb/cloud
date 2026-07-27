import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { MessageDeliveryState, MessageDetail } from "../../service/messages";

const root = mkdtempSync(resolve(tmpdir(), "mail-message-card-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: MailMessageCard } = await import("./MailMessageCard");

const message = (state: MessageDeliveryState): MessageDetail =>
  ({
    id: "message-1",
    from: [{ name: "Sender", address: "sender@example.com" }],
    to: [{ name: null, address: "recipient@example.com" }],
    internalDate: "2026-07-27T12:00:00.000Z",
    delivery: {
      submissionId: "submission-1",
      state,
      scheduledAt: "2026-07-27T12:01:00.000Z",
      undoUntil: state === "undo_window" ? "2026-07-27T12:00:10.000Z" : null,
      acceptedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  }) as MessageDetail;

const renderCard = (state: MessageDeliveryState, canWrite = true) =>
  renderToString(() =>
    createComponent(MailMessageCard, {
      message: message(state),
      expanded: false,
      context: {
        mailboxId: "mailbox-1",
        requestUrl: "/app/mail/mailbox-1?conversation=conversation-1",
        canWrite,
        canAdmin: false,
        selectionKey: null,
        selectedConversationId: "conversation-1",
        sourceFolderId: null,
        totalMessageCount: 1,
        identities: [],
        dateConfig: { locale: "en", timeZone: "UTC" },
        composerBusy: false,
      },
      actions: {
        toggle: () => undefined,
        selectionChange: () => undefined,
        compose: () => undefined,
        quoteReply: () => undefined,
        derive: () => undefined,
        reconcile: async () => undefined,
        reassign: () => undefined,
        split: () => undefined,
      },
    }),
  );

describe("MailMessageCard delivery controls", () => {
  test("offers undo only while a queued delivery can still be cancelled", () => {
    expect(renderCard("undo_window")).toContain("Undo send");
    expect(renderCard("sending")).not.toContain("Undo send");
    expect(renderCard("undo_window", false)).not.toContain("Undo send");
  });

  test("offers cancellation for explicitly scheduled delivery", () => {
    expect(renderCard("scheduled")).toContain("Cancel send");
  });
});
