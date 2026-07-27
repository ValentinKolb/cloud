import { describe, expect, test } from "bun:test";
import { initialConversationMessageId, isNearConversationEnd, isOutgoingMessage } from "./mail-conversation-history";

const identities = [{ fromAddress: "me@example.com", status: "verified" }];

describe("mail conversation history", () => {
  test("recognizes outgoing messages only through verified sender identities", () => {
    expect(isOutgoingMessage({ from: [{ address: "ME@example.com" }] }, identities)).toBeTrue();
    expect(isOutgoingMessage({ from: [{ address: "me@example.com" }] }, [{ ...identities[0]!, status: "pending" }])).toBeFalse();
  });

  test("opens the first unread incoming message and otherwise the newest message", () => {
    const messages = [
      { id: "read", from: [{ address: "sender@example.com" }], flags: ["\\Seen"] },
      { id: "outgoing", from: [{ address: "me@example.com" }], flags: [] },
      { id: "unread", from: [{ address: "sender@example.com" }], flags: [] },
      { id: "newest", from: [{ address: "sender@example.com" }], flags: ["\\Seen"] },
    ];

    expect(initialConversationMessageId(messages, identities)).toBe("unread");
    expect(
      initialConversationMessageId(
        messages.map((message) => ({ ...message, flags: ["\\Seen"] })),
        identities,
      ),
    ).toBe("newest");
    expect(initialConversationMessageId([], identities)).toBeNull();
  });

  test("uses a small end tolerance for live-message following", () => {
    expect(isNearConversationEnd({ scrollTop: 400, clientHeight: 500, scrollHeight: 980 })).toBeTrue();
    expect(isNearConversationEnd({ scrollTop: 300, clientHeight: 500, scrollHeight: 980 })).toBeFalse();
  });
});
