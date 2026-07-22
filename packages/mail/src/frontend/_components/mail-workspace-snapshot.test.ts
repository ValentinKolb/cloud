import { describe, expect, test } from "bun:test";
import type { MailboxPageData, MailListItem } from "../../service/workspace";
import { mergeMailLiveSnapshot } from "./mail-workspace-snapshot";

const item = (id: string, subject: string): MailListItem => ({
  id,
  conversationId: id,
  primaryReference: null,
  subject,
  participantSummary: "Sender",
  latestMessageAt: "2026-07-22T00:00:00.000Z",
  preview: null,
  unread: false,
  activeFolderIds: [],
  flagged: false,
  hasAttachments: false,
  messageCount: 1,
  workStatus: "open",
  assigneeUserId: null,
  responseNeeded: false,
  snoozedUntil: null,
  sourceFolderId: null,
  unreadFolderIds: [],
  revision: 1,
});

describe("mergeMailLiveSnapshot", () => {
  test("keeps loaded pages while fresh rows win", () => {
    const current = {
      listItems: [item("same", "Old"), ...Array.from({ length: 50 }, (_, index) => item(`tail-${index}`, `Tail ${index}`))],
      listCursor: null,
      nextListCursor: "after-loaded-page",
    } as MailboxPageData;
    const fresh = {
      ...current,
      listItems: [item("new", "New"), item("same", "Updated")],
      nextListCursor: "after-first-page",
    } as MailboxPageData;

    const merged = mergeMailLiveSnapshot(
      current,
      fresh,
      new Set(current.listItems.filter((entry) => entry.id.startsWith("tail-")).map((entry) => entry.id)),
    );
    expect(merged.listItems[0]?.id).toBe("new");
    expect(merged.listItems.find((entry) => entry.id === "same")?.subject).toBe("Updated");
    expect(merged.listItems.filter((entry) => entry.id === "same")).toHaveLength(1);
    expect(merged.listItems.some((entry) => entry.id === "tail-49")).toBe(true);
    expect(merged.nextListCursor).toBe("after-loaded-page");
  });

  test("drops rows removed from an unpaginated first page", () => {
    const current = {
      listItems: [item("removed", "Removed"), item("kept", "Kept")],
      listCursor: null,
      nextListCursor: null,
    } as MailboxPageData;
    const fresh = {
      ...current,
      listItems: [item("kept", "Updated")],
    } as MailboxPageData;

    const merged = mergeMailLiveSnapshot(current, fresh, new Set());
    expect(merged.listItems.map((entry) => entry.id)).toEqual(["kept"]);
    expect(merged.listItems[0]?.subject).toBe("Updated");
  });
});
