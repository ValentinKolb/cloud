import { describe, expect, test } from "bun:test";
import {
  initialConversationMessageId,
  isNearConversationStart,
  isOutgoingMessage,
  mergeLatestMessagePages,
  newestFirstMessages,
} from "./mail-conversation-history";

const identities = [{ fromAddress: "me@example.com", status: "verified" }];

describe("mail conversation history", () => {
  test("recognizes outgoing messages only through verified sender identities", () => {
    expect(isOutgoingMessage({ from: [{ address: "ME@example.com" }] }, identities)).toBeTrue();
    expect(isOutgoingMessage({ from: [{ address: "me@example.com" }] }, [{ ...identities[0]!, status: "pending" }])).toBeFalse();
  });

  test("opens the newest message and presents conversation history newest first", () => {
    const messages = [
      { id: "read", from: [{ address: "sender@example.com" }], flags: ["\\Seen"] },
      { id: "outgoing", from: [{ address: "me@example.com" }], flags: [] },
      { id: "unread", from: [{ address: "sender@example.com" }], flags: [] },
      { id: "newest", from: [{ address: "sender@example.com" }], flags: ["\\Seen"] },
    ];

    expect(initialConversationMessageId(messages)).toBe("newest");
    expect(newestFirstMessages(messages).map((message) => message.id)).toEqual(["newest", "unread", "outgoing", "read"]);
    expect(messages.map((message) => message.id)).toEqual(["read", "outgoing", "unread", "newest"]);
    expect(initialConversationMessageId([])).toBeNull();
  });

  test("uses a small top tolerance for live-message following", () => {
    expect(isNearConversationStart({ scrollTop: 40 })).toBeTrue();
    expect(isNearConversationStart({ scrollTop: 120 })).toBeFalse();
  });

  test("merges latest-first pages without duplicating cursor boundary messages", () => {
    const pages = [{ items: [{ id: "older" }, { id: "newest" }] }, { items: [{ id: "oldest" }, { id: "older" }] }];

    expect(mergeLatestMessagePages(pages).map((message) => message.id)).toEqual(["newest", "older", "oldest"]);
  });
});
