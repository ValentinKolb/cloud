import { describe, expect, test } from "bun:test";
import {
  conversationPresenceHeartbeatSchema,
  createSavedConversationViewSchema,
  savedConversationViewFilterSchema,
  setConversationReminderSchema,
  updateSavedConversationViewSchema,
} from "./contracts";

describe("Mail collaboration contracts", () => {
  test("requires explicit reminder create or update preconditions", () => {
    const dueAt = new Date(Date.now() + 60_000).toISOString();
    expect(setConversationReminderSchema.safeParse({ dueAt, expectedRevision: null }).success).toBe(true);
    expect(setConversationReminderSchema.safeParse({ dueAt, expectedRevision: 2 }).success).toBe(true);
    expect(setConversationReminderSchema.safeParse({ dueAt }).success).toBe(false);
  });

  test("keeps saved view filters bounded and strict", () => {
    expect(
      savedConversationViewFilterSchema.safeParse({
        workStatuses: ["open", "waiting"],
        assignee: { kind: "me" },
        responseNeeded: true,
      }).success,
    ).toBe(true);
    expect(savedConversationViewFilterSchema.safeParse({ workStatuses: ["open", "open"] }).success).toBe(false);
    expect(savedConversationViewFilterSchema.safeParse({ arbitrarySql: "true" }).success).toBe(false);
  });

  test("does not allow changing saved view scope during update", () => {
    expect(createSavedConversationViewSchema.safeParse({ scope: "private", name: "Mine", filter: {} }).success).toBe(true);
    expect(updateSavedConversationViewSchema.safeParse({ expectedRevision: 1, scope: "mailbox" }).success).toBe(false);
    expect(updateSavedConversationViewSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
  });

  test("requires UUID peer ids and known presence modes", () => {
    expect(conversationPresenceHeartbeatSchema.safeParse({ peerId: crypto.randomUUID(), mode: "composing" }).success).toBe(true);
    expect(conversationPresenceHeartbeatSchema.safeParse({ peerId: "tab-1", mode: "editing" }).success).toBe(false);
  });
});
