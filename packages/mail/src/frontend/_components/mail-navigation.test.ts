import { describe, expect, test } from "bun:test";
import { MAIL_SEARCH_PARAMETER, serializeMailSearchState } from "../../search-state";
import { buildMailListHref, buildMailSelectionHref, isMailListItemActive, type MailListItem } from "./mail-navigation";

const item: MailListItem = {
  id: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  primaryReference: null,
  subject: "Subject",
  participantSummary: "Sender",
  latestMessageAt: "2026-07-20T00:00:00.000Z",
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
};

describe("Mail search navigation", () => {
  test("preserves structured search while selecting a conversation", () => {
    const serialized = serializeMailSearchState({
      expression: {
        type: "text",
        field: "subject",
        query: "invoice",
        match: "words",
      },
      sort: "newest",
    });
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const url = new URL("https://cloud.example/app/mail/00000000-0000-4000-8000-000000000001");
    url.searchParams.set(MAIL_SEARCH_PARAMETER, serialized.value);

    const selected = new URL(buildMailSelectionHref(url, item), url.origin);
    expect(selected.searchParams.get(MAIL_SEARCH_PARAMETER)).toBe(serialized.value);
    expect(selected.searchParams.get("conversation")).toBe(item.conversationId);
  });

  test("clears all current and legacy search state without changing the active mailbox view", () => {
    const url = new URL(
      "https://cloud.example/app/mail/00000000-0000-4000-8000-000000000001?folder=00000000-0000-4000-8000-000000000004&q=x&search=%7B%7D&subject=y&combine=all&cursor=next&conversation=00000000-0000-4000-8000-000000000003",
    );
    const cleared = new URL(buildMailListHref(url, true), url.origin);
    expect(cleared.searchParams.get("folder")).toBe("00000000-0000-4000-8000-000000000004");
    expect(cleared.searchParams.has("q")).toBe(false);
    expect(cleared.searchParams.has(MAIL_SEARCH_PARAMETER)).toBe(false);
    expect(cleared.searchParams.has("subject")).toBe(false);
    expect(cleared.searchParams.has("combine")).toBe(false);
    expect(cleared.searchParams.has("cursor")).toBe(false);
    expect(cleared.searchParams.has("conversation")).toBe(false);
  });

  test("derives the active row from the current conversation or message selection", () => {
    expect(isMailListItemActive(item, item.conversationId, null)).toBe(true);
    expect(isMailListItemActive(item, "00000000-0000-4000-8000-000000000099", null)).toBe(false);
    expect(isMailListItemActive({ ...item, conversationId: null }, null, item.id)).toBe(true);
  });
});
