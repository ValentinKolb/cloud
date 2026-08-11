import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { SpaceComment, SpaceItem } from "@/contracts";

const root = mkdtempSync(join(tmpdir(), "spaces-detail-render-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: ItemDetailPanel } = await import("./ItemDetailPanel");

const spaceId = "Space1";
const itemId = "Item01";
const userId = "33333333-3333-4333-8333-333333333333";
const now = "2026-08-09T10:00:00.000Z";

const task: SpaceItem = {
  id: itemId,
  spaceId,
  columnId: "Col001",
  title: "Planning review",
  description: null,
  location: null,
  url: null,
  startsAt: null,
  endsAt: null,
  allDay: false,
  deadline: null,
  priority: null,
  recurrence: null,
  recurringEventId: null,
  recurrenceId: null,
  rank: "1024",
  completedAt: null,
  createdBy: userId,
  createdAt: now,
  updatedAt: now,
  assignees: [],
  tags: [],
};

const event: SpaceItem = {
  ...task,
  description: "Bring the **release notes**.",
  location: "Studio",
  url: "https://example.test/meeting",
  startsAt: "2026-08-10T10:00:00.000Z",
  endsAt: "2026-08-10T11:00:00.000Z",
  priority: "high",
  assignees: [{ id: userId, displayName: "Valentin Kolb", avatarHash: null }],
  tags: [{ id: "Tag001", spaceId, name: "Release", color: "#2563eb" }],
};

const comment: SpaceComment = {
  id: "Com001",
  itemId,
  recurrenceId: null,
  userId,
  userName: "Valentin Kolb",
  userAvatarHash: null,
  content: "Ready for review",
  createdAt: now,
  updatedAt: now,
  canDelete: true,
};

const renderPanel = (overrides: Partial<Parameters<typeof ItemDetailPanel>[0]> = {}) =>
  renderToString(() =>
    createComponent(ItemDetailPanel, {
      item: event,
      columns: [],
      tags: event.tags ?? [],
      wormholes: [],
      spaceId,
      baseUrl: `/app/spaces/${spaceId}?view=calendar`,
      currentUserId: userId,
      initialCommentsPage: { items: [comment], page: 1, perPage: 50, total: 1, hasNext: true },
      commentTarget: { itemId, recurrenceId: null },
      recurringContext: null,
      dateConfig: { locale: "en", timeZone: "Europe/Berlin" },
      canWrite: true,
      mailIntegrationAvailable: true,
      scrollPreserveKey: `spaces-detail-${spaceId}-${itemId}-series`,
      ...overrides,
    }),
  );

const legacyDetailClasses = ['class="detail-header', 'class="detail-stack', 'class="detail-section', 'class="detail-facts'];

describe("Spaces item detail panel", () => {
  test("composes event context and comments through the shared detail contracts", () => {
    const html = renderPanel();

    expect(html).toContain('class="k2b-detail-panel"');
    expect(html).toContain("<h2>Planning review</h2>");
    expect(html).toContain('data-scroll-preserve="spaces-detail-Space1-Item01-series"');
    expect(html.match(/k2b-detail-panel__body/g)).toHaveLength(1);
    expect(html).toContain('class="k2b-detail-panel__summary"');
    expect(html).toContain("Event time");
    expect(html).toContain('aria-label="Event context"');
    expect(html).toContain('aria-label="Organization"');
    expect(html).toContain("Invite or update");
    expect(html).toContain('class="k2b-detail-panel__action');
    expect(html).toContain('class="k2b-discussion');
    expect(html).toContain('class="k2b-discussion__item');
    expect(html).toContain('data-visibility="progressive"');
    expect(html).not.toContain('data-visibility="always"');
    expect(html).toContain("Load earlier comments");
    expect(html).toContain('aria-label="Delete comment"');
    expect(html).toContain('aria-label="Close item details"');
    expect(html).toContain('aria-label="More item actions"');
    expect(html).toContain("Mark complete");
    expect(html).toContain("view-transition-name:detail-panel");
    expect(html).toContain("view-transition-name:space-item-detail-header");
    expect(html).toContain("view-transition-name:space-item-detail-description");
    expect(html).toContain("view-transition-name: space-item-detail-comments");
    expect(html).toContain("Item information");
    expect(html).not.toContain('<details class="k2b-detail-panel__section" open');
    expect(html).not.toContain("overflow-y-auto");
    for (const className of legacyDetailClasses) expect(html).not.toContain(className);
  });

  test("keeps a sparse read-only task free of write controls and empty groups", () => {
    const html = renderPanel({
      item: task,
      tags: [],
      initialCommentsPage: { items: [], page: 1, perPage: 50, total: 0, hasNext: false },
      canWrite: false,
      mailIntegrationAvailable: false,
    });

    expect(html).toContain("Read only");
    expect(html).toContain('aria-label="Close item details"');
    expect(html).not.toContain('aria-label="More item actions"');
    expect(html).not.toContain("Mark complete");
    expect(html).not.toContain(">Edit<");
    expect(html).not.toContain('class="k2b-detail-panel__summary"');
    expect(html).not.toContain('aria-label="Organization"');
    expect(html).not.toContain('class="k2b-discussion');
    expect(html).not.toContain("Invitations");
    expect(html.match(/k2b-detail-panel__body/g)).toHaveLength(1);
  });

  test("keeps generated occurrences read-only at item level with occurrence-scoped comments", () => {
    const recurrenceId = "2026-08-10T10:00:00.000Z";
    const html = renderPanel({
      commentTarget: { itemId, recurrenceId },
      recurringContext: {
        seriesItemId: itemId,
        recurrenceId,
        startsAt: event.startsAt!,
        endsAt: event.endsAt!,
        allDay: false,
        isOverride: false,
      },
    });

    expect(html).toContain("This occurrence");
    expect(html).toContain("View series");
    expect(html).toContain("Occurrence comments");
    expect(html).toContain("Add comment");
    expect(html).not.toContain('aria-label="More item actions"');
    expect(html).not.toContain("Mark complete");
    expect(html).not.toContain("Invite or update");
  });
});
