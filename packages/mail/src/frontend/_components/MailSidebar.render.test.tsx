import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(join(tmpdir(), "mail-sidebar-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: MailSidebar } = await import("./MailSidebar.tsx");

describe("Mail sidebar", () => {
  test("separates follow-up and assignment and links stable tag IDs", () => {
    const html = renderToString(() =>
      createComponent(MailSidebar, {
        mailboxId: "Box001",
        mailboxName: "Support",
        syncEnabled: true,
        folders: [],
        localTags: [
          {
            id: "Tag001",
            mailboxId: "Box001",
            name: "Important",
            color: "#2563eb",
            revision: 1,
            createdAt: "2026-08-15T00:00:00.000Z",
            updatedAt: "2026-08-15T00:00:00.000Z",
          },
        ],
        savedViews: [],
        scheduledMode: false,
        scheduledCount: 0,
        activeFolderId: null,
        activeView: null,
        activeSavedViewId: null,
        activeTagId: "Tag001",
        searchActive: true,
        viewCounts: {
          needs_action: 2,
          mine: 1,
          unassigned: 1,
          waiting: 3,
          done: 4,
          snoozed: 0,
          recently_active: 5,
        },
        canWrite: true,
        canAdmin: true,
        managementOpening: null,
        settingsOpening: false,
        onOpenHealth: () => {},
        onOpenSharedLinks: () => {},
        onOpenRemoteContent: () => {},
        onOpenSubscriptions: () => {},
        onOpenSettings: () => {},
        onMoveConversation: () => {},
        onNavigate: () => {},
      }),
    );

    expect(html).toContain("Follow-up");
    expect(html).toContain("Assignment");
    expect(html).toContain("Tags");
    expect(html).toContain("Important");
    expect(html).toContain("local_tag_id");
    expect(html).toContain("Tag001");
    expect(html).not.toContain('title="Work"');
  });
});
