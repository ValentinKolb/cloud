import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MAIL_CONVERSATION_TOOLBAR_ACTIONS,
  MAIL_CONVERSATION_TOOLBAR_ACTION_IDS,
  MAIL_CONVERSATION_TOOLBAR_ACTION_OPTIONS,
  MAIL_CONVERSATION_TOOLBAR_SECTIONS,
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

  test("keeps every action in one semantic section", () => {
    expect(MAIL_CONVERSATION_TOOLBAR_ACTION_OPTIONS.map((option) => option.id)).toEqual([...MAIL_CONVERSATION_TOOLBAR_ACTION_IDS]);
    expect(new Set(MAIL_CONVERSATION_TOOLBAR_ACTION_OPTIONS.map((option) => option.sectionId)).size).toBe(
      MAIL_CONVERSATION_TOOLBAR_SECTIONS.length,
    );
  });

  test("uses the stable display order while removing unknown, duplicate, and excess actions", () => {
    const value = ["tags", "reply", "tags", "unknown", "archive", "spam", "trash", "read", "flag", "move", "print"];
    expect(normalizeMailConversationToolbarActions(value)).toEqual(["reply", "archive", "spam", "trash", "move", "read", "flag", "tags"]);
    expect(normalizeMailConversationToolbarActions(value)).toHaveLength(MAX_MAIL_CONVERSATION_TOOLBAR_ACTIONS);
  });
});
