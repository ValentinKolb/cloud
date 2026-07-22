import { describe, expect, test } from "bun:test";
import type { MailActivityEvent } from "../../service/collaboration";
import { mailActivityLabel, presentMailActivity } from "./mail-activity-presentation";

const event = (metadata: Record<string, unknown> = {}): MailActivityEvent => ({
  id: crypto.randomUUID(),
  conversationId: crypto.randomUUID(),
  actor: { kind: "user", id: "user-1", displayName: "Ada", avatarHash: null },
  action: "conversation.collaboration_updated",
  outcome: "confirmed",
  targetType: "conversation",
  targetId: crypto.randomUUID(),
  metadata,
  createdAt: "2026-07-22T10:00:00.000Z",
});

describe("mail activity presentation", () => {
  test("describes collaboration changes from audit metadata", () => {
    expect(
      mailActivityLabel(
        event({ before: { responseNeeded: false, workStatus: "open" }, after: { responseNeeded: true, workStatus: "waiting" } }),
      ),
    ).toBe("marked it Awaiting reply and marked a response as needed");
  });

  test("collapses consecutive duplicate events", () => {
    expect(presentMailActivity([event(), event()])).toHaveLength(1);
    expect(presentMailActivity([event(), event()])[0]?.count).toBe(2);
  });
});
