import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAIL_CONVERSATION_TOOLBAR_ACTIONS,
  MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS,
  normalizeMailConversationToolbarActions,
} from "./mail-conversation-toolbar";

describe("Mail conversation toolbar preferences", () => {
  test("uses the stable default for absent or malformed values", () => {
    expect(normalizeMailConversationToolbarActions(undefined)).toEqual(DEFAULT_MAIL_CONVERSATION_TOOLBAR_ACTIONS);
    expect(normalizeMailConversationToolbarActions("reply")).toEqual(DEFAULT_MAIL_CONVERSATION_TOOLBAR_ACTIONS);
  });

  test("accepts an intentionally empty toolbar", () => {
    expect(normalizeMailConversationToolbarActions([])).toEqual([]);
  });

  test("uses the stable display order while removing unknown, duplicate, and excess actions", () => {
    const value = ["tags", "reply", "tags", "unknown", "archive", "spam", "trash", "read", "flag", "move", "print"];
    expect(normalizeMailConversationToolbarActions(value)).toEqual(["reply", "archive", "spam", "trash", "read", "flag", "move", "tags"]);
    expect(normalizeMailConversationToolbarActions(value)).toHaveLength(MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS);
  });
});
