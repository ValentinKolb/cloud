import { describe, expect, test } from "bun:test";
import { MAIL_SEARCH_PARAMETER, parseMailSearchState, serializeMailSearchState } from "../../search-state";
import {
  buildExactSenderSearchHref,
  buildMailingListHref,
  buildMailListHref,
  buildMailSelectionHref,
  isMailListItemActive,
  type MailListItem,
  senderDomainFromAddress,
} from "./mail-navigation";

const item: MailListItem = {
  id: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  selectionKind: "conversation",
  primaryReference: null,
  subject: "Subject",
  participantSummary: "Sender",
  participantLabels: ["Sender"],
  latestMessageAt: "2026-07-20T00:00:00.000Z",
  preview: null,
  unread: false,
  activeFolderIds: [],
  flagged: false,
  hasAttachments: false,
  messageCount: 1,
  workStatus: "needs_action",
  assigneeUserId: null,
  snoozedUntil: null,
  sourceFolderId: null,
  unreadFolderIds: [],
  localTags: [],
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
      "https://cloud.example/app/mail/00000000-0000-4000-8000-000000000001?folder=00000000-0000-4000-8000-000000000004&q=x&qFields=from%2Cbody&search=%7B%7D&subject=y&combine=all&cursor=next&conversation=00000000-0000-4000-8000-000000000003",
    );
    const cleared = new URL(buildMailListHref(url, true), url.origin);
    expect(cleared.searchParams.get("folder")).toBe("00000000-0000-4000-8000-000000000004");
    expect(cleared.searchParams.has("q")).toBe(false);
    expect(cleared.searchParams.has("qFields")).toBe(false);
    expect(cleared.searchParams.has(MAIL_SEARCH_PARAMETER)).toBe(false);
    expect(cleared.searchParams.has("subject")).toBe(false);
    expect(cleared.searchParams.has("combine")).toBe(false);
    expect(cleared.searchParams.has("cursor")).toBe(false);
    expect(cleared.searchParams.has("conversation")).toBe(false);
  });

  test("derives the active row from the current conversation or message selection", () => {
    expect(isMailListItemActive(item, item.conversationId, null)).toBe(true);
    expect(isMailListItemActive(item, "00000000-0000-4000-8000-000000000099", null)).toBe(false);
    expect(isMailListItemActive({ ...item, conversationId: null, selectionKind: "message" }, null, item.id)).toBe(true);
  });

  test("keeps conversation context while selecting one row in message view", () => {
    const messageItem = { ...item, selectionKind: "message" as const };
    const href = new URL(buildMailSelectionHref(new URL("https://cloud.example/app/mail/mailbox"), messageItem), "https://cloud.example");
    expect(href.searchParams.get("conversation")).toBe(item.conversationId);
    expect(href.searchParams.get("message")).toBe(item.id);
    expect(isMailListItemActive(messageItem, item.conversationId, item.id)).toBe(true);
  });

  test("builds an exact URL-backed sender search and normalizes a usable domain", () => {
    const url = new URL(
      "https://cloud.example/app/mail/00000000-0000-4000-8000-000000000001?folder=00000000-0000-4000-8000-000000000004&q=old&conversation=00000000-0000-4000-8000-000000000003",
    );
    const href = buildExactSenderSearchHref(url, "Sender+news@Sub.Example.com");
    expect(href).not.toBeNull();
    const next = new URL(href!, url.origin);

    expect(next.searchParams.get("folder")).toBe("00000000-0000-4000-8000-000000000004");
    expect(next.searchParams.has("q")).toBe(false);
    expect(next.searchParams.has("conversation")).toBe(false);
    expect(parseMailSearchState(next)).toEqual({
      state: {
        expression: { type: "text", field: "from", query: "Sender+news@Sub.Example.com", match: "exact" },
        sort: "newest",
      },
      error: null,
    });
    expect(senderDomainFromAddress("Sender+news@Sub.Example.com")).toBe("sub.example.com");
    expect(senderDomainFromAddress("invalid")).toBeNull();
  });
});

test("adds a focused mailing list without dropping the mailbox context", () => {
  const href = buildMailingListHref(
    new URL("https://cloud.example/app/mail/mailbox-1?folder=inbox&conversation=conversation-1"),
    "list one&two",
  );
  expect(href).toBe("/app/mail/mailbox-1?folder=inbox&conversation=conversation-1&mailingList=list+one%26two");
});
