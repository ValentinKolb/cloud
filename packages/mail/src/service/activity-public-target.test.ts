import { describe, expect, test } from "bun:test";
import { ActivityDataSchema } from "../capability-contracts";
import { type PublicActivityItem, projectActivityItems } from "./activity-public";

const activity = (targetType: string, targetId: string | null) => ({
  conversationId: null,
  targetType,
  targetId,
  metadata: {},
});

describe("Mail public activity targets", () => {
  test("uses the conversation reference domain value without an internal UUID fallback", async () => {
    const [found, missing] = await projectActivityItems(
      [activity("conversation_reference", "SUP-2026-0042"), activity("conversation_reference", null)],
      async () => new Map(),
    );
    expect(found?.targetId).toBe("SUP-2026-0042");
    expect(missing?.targetId).toBeNull();
  });

  test("uses the public mailbox ID for reference configuration activity", async () => {
    const [projected] = await projectActivityItems([activity("reference_configuration", "box123")], async () => new Map());
    expect(projected?.targetId).toBe("box123");
  });

  test("documents nullable public targets for missing references", () => {
    expect(
      ActivityDataSchema.safeParse({
        id: "42",
        conversationId: null,
        actor: { kind: "system", id: null, displayName: "System", avatarHash: null },
        action: "conversation.reference_missing",
        outcome: "confirmed",
        targetType: "conversation_reference",
        targetId: null,
        metadata: {},
        createdAt: "2026-08-12T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  test("projects explicit resource targets and metadata without UUID fallbacks", async () => {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    const attachmentId = "22222222-2222-4222-8222-222222222222";
    const messageId = "33333333-3333-4333-8333-333333333333";
    const foundTagId = "44444444-4444-4444-8444-444444444444";
    const missingTagId = "55555555-5555-4555-8555-555555555555";
    const maps = {
      conversations: new Map([[conversationId, "Conv01"]]),
      attachments: new Map([[attachmentId, "Atta01"]]),
      messages: new Map([[messageId, "Mess01"]]),
      tags: new Map([[foundTagId, "Tag001"]]),
    } as const;
    const items: PublicActivityItem[] = [
      {
        conversationId,
        targetType: "attachment",
        targetId: attachmentId,
        metadata: { messageId, addedTagIds: [foundTagId, missingTagId] },
      },
    ];
    const [projected] = await projectActivityItems(items, async (table) => maps[table as keyof typeof maps] ?? new Map());
    expect(projected).toEqual({
      conversationId: "Conv01",
      targetType: "attachment",
      targetId: "Atta01",
      metadata: { messageId: "Mess01", addedTagIds: ["Tag001", null] },
    });
  });

  test("preserves explicit technical targets and removes unknown UUID targets", async () => {
    const technicalId = "66666666-6666-4666-8666-666666666666";
    const [command, unknown] = await projectActivityItems(
      [activity("command", technicalId), activity("future_internal_row", technicalId)],
      async () => new Map(),
    );
    expect(command?.targetId).toBe(technicalId);
    expect(unknown?.targetId).toBeNull();
  });
});
