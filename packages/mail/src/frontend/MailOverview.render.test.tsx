import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(join(tmpdir(), "mail-overview-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: MailOverview } = await import("./MailOverview.island.tsx");

const renderOverview = () =>
  renderToString(() =>
    createComponent(MailOverview, {
      mailboxes: [],
      deletedMailboxes: [],
      initialDeletedCursor: null,
      initialView: "mine",
      currentUserEmail: "user@example.com",
      dateConfig: { locale: "en", timeZone: "Europe/Berlin" },
      initialFocus: {
        items: [
          {
            id: "Convo1",
            mailboxId: "Mail01",
            mailboxName: "Support",
            subject: "Release update",
            participantSummary: "Ada",
            latestMessageAt: "2026-08-19T10:00:00.000Z",
            workStatus: "needs_action",
            assigneeUserId: "00000000-0000-4000-8000-000000000001",
            unread: true,
            flagged: true,
            hasAttachments: true,
            preview: "Ready to ship",
          },
        ],
        counts: { mine: 1, unassigned: 2, waiting: 3, all: 6 },
        nextCursor: null,
      },
    }),
  );

describe("Mail overview", () => {
  test("renders the server-provided cross-mailbox focus queue and accessible view controls", () => {
    const html = renderOverview();
    expect(html).toContain("What needs attention across your mailboxes.");
    expect(html).toContain('role="tablist" aria-label="Mail focus view"');
    expect(html).toContain('role="tab" aria-selected="true"');
    expect(html).toContain('For me <span class="mail-focus-tab-count">1</span>');
    expect(html).toContain('Unassigned <span class="mail-focus-tab-count">2</span>');
    expect(html).toContain("1 conversation assigned to you");
    expect(html).toContain("Assigned to you");
    expect(html).toContain("Release update");
    expect(html).toContain('class="mail-focus-avatar"');
    expect(html).toContain("Ada");
    expect(html).toContain("Support");
    expect(html).toContain('href="/app/mail/Mail01?conversation=Convo1"');
    expect(html).toContain("Flagged");
    expect(html).toContain("Attachment");
  });
});
