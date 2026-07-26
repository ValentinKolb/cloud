import { describe, expect, test } from "bun:test";
import { withMailWorkflowCollaborationEvent } from "./workflow-collaboration-events";

describe("Mail workflow collaboration events", () => {
  test("persists post-commit publication data with the action outcome", () => {
    expect(
      withMailWorkflowCollaborationEvent(
        { applied: true },
        {
          mailboxId: "d8efcc85-92d8-46bd-bc46-ce9fc035e414",
          conversationId: "6b079e76-8b12-4348-91a8-1ba5d7030c5b",
          reason: "comment",
          targetId: "5fd9b4b2-e8d8-445b-9dc9-3cafaf714273",
          activityId: "activity",
        },
      ),
    ).toMatchObject({
      applied: true,
      __mailCollaborationEvent: {
        reason: "comment",
        activityId: "activity",
      },
    });
  });
});
