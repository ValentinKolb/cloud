import { describe, expect, test } from "bun:test";
import type { AiTurnBlock } from "../protocol";
import { __aiControllerTest } from "./controller";

const { failSteerBlock, reconcileSteerBlocks } = __aiControllerTest;

describe("AI controller steering reconciliation", () => {
  test("replaces an optimistic block with the durable steer id", () => {
    const blocks: AiTurnBlock[] = [
      { id: "text", kind: "text", text: "working" },
      { id: "local", kind: "steer_message", steerId: "request-1", text: "change", status: "pending" },
    ];
    expect(
      reconcileSteerBlocks(blocks, "local", {
        id: "steer-1",
        conversationId: "conversation-1",
        turnId: "turn-1",
        seq: 1,
        clientRequestId: "request-1",
        text: "change",
        status: "pending",
        messageId: null,
        createdAt: "2026-07-11T00:00:00.000Z",
        consumedAt: null,
      }),
    ).toEqual([
      { id: "text", kind: "text", text: "working" },
      { id: "steer-message-steer-1", kind: "steer_message", steerId: "steer-1", text: "change", status: "pending" },
    ]);
  });

  test("keeps the bubble and exposes a retry state when the request fails", () => {
    const blocks: AiTurnBlock[] = [{ id: "local", kind: "steer_message", steerId: "request-1", text: "change", status: "pending" }];
    expect(failSteerBlock(blocks, "local")).toEqual([
      { id: "local", kind: "steer_message", steerId: "request-1", text: "change", status: "failed" },
    ]);
  });
});
