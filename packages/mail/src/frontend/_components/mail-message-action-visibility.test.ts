import { describe, expect, test } from "bun:test";
import { resolveMailMessageActionVisibility } from "./mail-message-action-visibility";

const base = {
  hasSender: true,
  hasMailingListUnsubscribe: true,
  hasProviderPlacement: true,
  hasConversation: true,
  hasConversationSourceFolder: true,
  totalMessageCount: 2,
  canWrite: true,
  canAdmin: true,
};

describe("resolveMailMessageActionVisibility", () => {
  test("shows inbound sender actions and hides resend", () => {
    expect(resolveMailMessageActionVisibility({ ...base, outgoing: false })).toEqual({
      findSender: true,
      createSenderRule: true,
      markSenderRead: true,
      blockSender: true,
      manageUnsubscribe: true,
      providerKeywords: true,
      conversationKeyword: true,
      conversationRepair: true,
      editAsNew: true,
      resend: false,
    });
  });

  test("hides every inbound sender action for an own outbound message", () => {
    expect(resolveMailMessageActionVisibility({ ...base, outgoing: true })).toEqual({
      findSender: false,
      createSenderRule: false,
      markSenderRead: false,
      blockSender: false,
      manageUnsubscribe: false,
      providerKeywords: true,
      conversationKeyword: true,
      conversationRepair: true,
      editAsNew: true,
      resend: true,
    });
  });

  test("hides writes from readers while preserving sender search", () => {
    expect(
      resolveMailMessageActionVisibility({
        ...base,
        outgoing: false,
        canWrite: false,
        canAdmin: false,
      }),
    ).toEqual({
      findSender: true,
      createSenderRule: false,
      markSenderRead: false,
      blockSender: false,
      manageUnsubscribe: false,
      providerKeywords: false,
      conversationKeyword: false,
      conversationRepair: false,
      editAsNew: false,
      resend: false,
    });
  });

  test("requires concrete provider and conversation targets", () => {
    const visibility = resolveMailMessageActionVisibility({
      ...base,
      outgoing: false,
      hasProviderPlacement: false,
      hasConversation: false,
      hasConversationSourceFolder: false,
    });
    expect(visibility.providerKeywords).toBe(false);
    expect(visibility.conversationKeyword).toBe(false);
    expect(visibility.conversationRepair).toBe(false);
  });
});
