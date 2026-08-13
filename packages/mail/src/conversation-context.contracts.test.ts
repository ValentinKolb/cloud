import { describe, expect, test } from "bun:test";
import { mailConversationContextSchema } from "./contracts";

const CONVERSATION_ID = "Conv01";

describe("Mail conversation context contracts", () => {
  test("accepts bounded Contacts and Spaces context", () => {
    expect(
      mailConversationContextSchema.parse({
        conversationId: CONVERSATION_ID,
        participants: [{ email: "ada@example.com", displayName: "Ada Example" }],
        contacts: { status: "ready", items: [], matchedEmails: [], nextCursor: null },
        spaces: { status: "ready", items: [], truncated: false },
      }),
    ).toEqual({
      conversationId: CONVERSATION_ID,
      participants: [{ email: "ada@example.com", displayName: "Ada Example" }],
      contacts: { status: "ready", items: [], matchedEmails: [], nextCursor: null },
      spaces: { status: "ready", items: [], truncated: false },
    });
  });

  test("rejects the removed legacy Spaces link shape", () => {
    expect(
      mailConversationContextSchema.safeParse({
        conversationId: CONVERSATION_ID,
        participants: [],
        contacts: { status: "ready", items: [], matchedEmails: [], nextCursor: null },
        spaces: { status: "ready", links: [], truncated: false },
      }).success,
    ).toBe(false);
  });
});
