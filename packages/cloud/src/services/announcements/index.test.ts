import { describe, expect, test } from "bun:test";
import type { AnnouncementEntry } from "../../contracts/announcements";
import { selectVisibleForState } from "./index";

const entry = (version: number, kind: AnnouncementEntry["kind"]): AnnouncementEntry => ({
  id: crypto.randomUUID(),
  version,
  kind,
  title: `${kind} ${version}`,
  body: `**Body ${version}**`,
  tone: "info",
  publishedAt: new Date("2026-06-09T12:00:00.000Z").toISOString(),
  expiresAt: null,
  createdAt: new Date("2026-06-09T12:00:00.000Z").toISOString(),
  updatedAt: new Date("2026-06-09T12:00:00.000Z").toISOString(),
  createdBy: null,
  updatedBy: null,
});

describe("selectVisibleForState", () => {
  test("returns unseen announcements and undismissed banners", () => {
    const result = selectVisibleForState([entry(4, "announcement"), entry(3, "announcement"), entry(2, "banner"), entry(1, "banner")], {
      seenAnnouncementVersion: 3,
      dismissedBannerVersions: [1],
    });

    expect(result.announcements.map((item) => item.version)).toEqual([4]);
    expect(result.banners.map((item) => item.version)).toEqual([2]);
    expect(result.latestAnnouncementVersion).toBe(4);
    expect(result.announcements[0]?.bodyHtml).toContain("<strong>Body 4</strong>");
  });
});
