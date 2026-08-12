import { describe, expect, test } from "bun:test";
import { mailConversationContextSchema } from "./contracts";

const CONVERSATION_ID = "Conv01";

describe("Mail conversation context contracts", () => {
  test("accepts bounded Contacts context", () => {
    expect(
      mailConversationContextSchema.parse({
        conversationId: CONVERSATION_ID,
        participants: [{ email: "ada@example.com", displayName: "Ada Example" }],
        contacts: { status: "ready", items: [], matchedEmails: [], nextCursor: null },
      }),
    ).toEqual({
      conversationId: CONVERSATION_ID,
      participants: [{ email: "ada@example.com", displayName: "Ada Example" }],
      contacts: { status: "ready", items: [], matchedEmails: [], nextCursor: null },
    });
  });

  test("rejects removed cross-app context fields", () => {
    expect(
      mailConversationContextSchema.safeParse({
        conversationId: CONVERSATION_ID,
        participants: [],
        contacts: { status: "ready", items: [], matchedEmails: [], nextCursor: null },
        spaces: { status: "ready", links: [] },
      }).success,
    ).toBe(false);
  });
});
