import { describe, expect, test } from "bun:test";
import {
  ANNOUNCEMENTS_COOKIE,
  mergeAnnouncementCookieState,
  parseAnnouncementCookieHeader,
  parseAnnouncementCookieValue,
  serializeAnnouncementCookieState,
} from "./announcements";

describe("announcement cookie state", () => {
  test("returns defaults for empty or malformed cookies", () => {
    expect(parseAnnouncementCookieValue(null)).toEqual({ seenAnnouncementVersion: 0, dismissedBannerVersions: [] });
    expect(parseAnnouncementCookieValue("%7Bbad")).toEqual({ seenAnnouncementVersion: 0, dismissedBannerVersions: [] });
    expect(parseAnnouncementCookieHeader("theme=dark")).toEqual({ seenAnnouncementVersion: 0, dismissedBannerVersions: [] });
  });

  test("parses state from a cookie header", () => {
    const value = serializeAnnouncementCookieState({
      seenAnnouncementVersion: 12,
      dismissedBannerVersions: [3, 2, 3],
    });

    expect(parseAnnouncementCookieHeader(`theme=dark; ${ANNOUNCEMENTS_COOKIE}=${value}; other=1`)).toEqual({
      seenAnnouncementVersion: 12,
      dismissedBannerVersions: [3, 2],
    });
  });

  test("merges state monotonically", () => {
    expect(
      mergeAnnouncementCookieState(
        { seenAnnouncementVersion: 10, dismissedBannerVersions: [4] },
        { seenAnnouncementVersion: 8, dismissedBannerVersions: [5, 4] },
      ),
    ).toEqual({ seenAnnouncementVersion: 10, dismissedBannerVersions: [5, 4] });
  });
});
