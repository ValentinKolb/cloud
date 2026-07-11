import { describe, expect, test } from "bun:test";
import {
  captureScrollSnapshot,
  distanceFromBottom,
  isNearBottom,
  isScrollRestoreCurrent,
  keepBottomAligned,
  restoreAfterPrepend,
  type ScrollViewport,
  scrollToBottom,
} from "./message-scroll";

const viewport = (input: Partial<ScrollViewport> = {}): ScrollViewport => ({
  scrollHeight: 1_000,
  scrollTop: 0,
  clientHeight: 300,
  ...input,
});

describe("message scroll geometry", () => {
  test("detects whether the reader is still near the bottom", () => {
    expect(distanceFromBottom(viewport({ scrollTop: 620 }))).toBe(80);
    expect(isNearBottom(viewport({ scrollTop: 620 }), 96)).toBe(true);
    expect(isNearBottom(viewport({ scrollTop: 600 }), 96)).toBe(false);
  });

  test("aligns overflowing and short content to the bottom", () => {
    const overflowing = viewport();
    scrollToBottom(overflowing);
    expect(overflowing.scrollTop).toBe(700);

    const short = viewport({ scrollHeight: 200 });
    scrollToBottom(short);
    expect(short.scrollTop).toBe(0);
  });

  test("preserves the reader's anchor when older content is prepended", () => {
    const target = viewport({ scrollTop: 180 });
    const snapshot = captureScrollSnapshot(target);
    target.scrollHeight = 1_450;
    restoreAfterPrepend(target, snapshot);
    expect(target.scrollTop).toBe(630);
  });

  test("rejects stale history restores after a conversation phase changes", () => {
    const token = { conversationKey: "conversation-a", revision: 4 };

    expect(isScrollRestoreCurrent(token, "conversation-a", 4)).toBe(true);
    expect(isScrollRestoreCurrent(token, "conversation-b", 5)).toBe(false);
    expect(isScrollRestoreCurrent(token, "conversation-a", 6)).toBe(false);
  });

  test("follows dynamic growth only while the reader remains pinned", () => {
    const following = viewport({ scrollTop: 700 });
    following.scrollHeight = 1_500;
    expect(keepBottomAligned(following, { following: true, preservingHistoryPosition: false })).toBe(true);
    expect(following.scrollTop).toBe(1_200);

    const readingHistory = viewport({ scrollTop: 240, scrollHeight: 1_500 });
    expect(keepBottomAligned(readingHistory, { following: false, preservingHistoryPosition: false })).toBe(false);
    expect(readingHistory.scrollTop).toBe(240);

    const prepending = viewport({ scrollTop: 240, scrollHeight: 1_500 });
    expect(keepBottomAligned(prepending, { following: true, preservingHistoryPosition: true })).toBe(false);
    expect(prepending.scrollTop).toBe(240);
  });
});
