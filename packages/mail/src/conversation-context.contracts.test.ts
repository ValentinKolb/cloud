import { describe, expect, test } from "bun:test";
import { linkConversationSpaceInputSchema, mailConversationContextSchema } from "./contracts";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const LINK_ID = "22222222-2222-4222-8222-222222222222";

describe("Mail conversation context contracts", () => {
  test("accepts redacted targets without exposing Space identifiers", () => {
    const value = mailConversationContextSchema.parse({
      conversationId: CONVERSATION_ID,
      conversationRevision: 2,
      canWrite: true,
      contacts: { status: "ready", items: [], nextCursor: null },
      spaces: { status: "ready", links: [{ linkId: LINK_ID, space: null }] },
    });
    expect(value.spaces.links).toEqual([{ linkId: LINK_ID, space: null }]);
    expect(
      mailConversationContextSchema.safeParse({
        ...value,
        spaces: { status: "ready", links: [{ linkId: LINK_ID, space: null, spaceId: CONVERSATION_ID }] },
      }).success,
    ).toBe(false);
  });

  test("requires revision-checked Space link mutations", () => {
    expect(linkConversationSpaceInputSchema.safeParse({ spaceId: CONVERSATION_ID, expectedRevision: 1 }).success).toBe(true);
    expect(linkConversationSpaceInputSchema.safeParse({ spaceId: CONVERSATION_ID }).success).toBe(false);
  });
});
