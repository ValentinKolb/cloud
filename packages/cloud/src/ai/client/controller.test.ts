import { describe, expect, test } from "bun:test";
import type { AiTurnBlock } from "../protocol";
import type { AiConversation } from "../types";
import { __aiControllerTest } from "./controller";
import type { AiChatProjection } from "./projection";

const {
  claimFrontendCall,
  failSteerBlock,
  isCurrentStreamSession,
  projectionForConversationOpen,
  reconcileSteerBlocks,
  settleFrontendCall,
} = __aiControllerTest;

const conversation = (id: string): AiConversation => ({
  id,
  appId: "assistant",
  title: id,
  titleSource: "default",
  icon: "ti ti-message",
  description: "",
  descriptionSource: "default",
  keywords: [],
  resource: { kind: "direct" },
  createdByUserId: "user-1",
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
});

describe("AI controller conversation transitions", () => {
  test("never carries messages from the previous chat into an uncached target", () => {
    const target = conversation("target");
    expect(projectionForConversationOpen(undefined, target)).toEqual({ conversation: target, messages: [], activeTurn: null });
  });

  test("reuses an exact cached projection without an empty transition", () => {
    const cached: AiChatProjection = { conversation: conversation("cached"), messages: [], activeTurn: null };
    expect(projectionForConversationOpen(cached, cached.conversation)).toBe(cached);
  });
});

describe("AI controller stream sessions", () => {
  test("rejects an earlier session after leaving and reopening the same conversation", () => {
    const firstA = { conversationId: "a", generation: 1 };
    const b = { conversationId: "b", generation: 2 };
    const secondA = { conversationId: "a", generation: 3 };

    expect(isCurrentStreamSession(firstA, firstA)).toBe(true);
    expect(isCurrentStreamSession(b, firstA)).toBe(false);
    expect(isCurrentStreamSession(secondA, firstA)).toBe(false);
    expect(isCurrentStreamSession(secondA, secondA)).toBe(true);
  });
});

describe("AI controller frontend tool deduplication", () => {
  test("does not start the same call twice while it is in flight", () => {
    const handled = new Set<string>();
    const inFlight = new Set<string>();

    expect(claimFrontendCall(handled, inFlight, "turn:call")).toBe(true);
    expect(claimFrontendCall(handled, inFlight, "turn:call")).toBe(false);
  });

  test("keeps submitted calls handled and releases failed submissions for retry", () => {
    const handled = new Set<string>();
    const inFlight = new Set<string>();

    claimFrontendCall(handled, inFlight, "turn:success");
    settleFrontendCall(handled, inFlight, "turn:success", true);
    expect(claimFrontendCall(handled, inFlight, "turn:success")).toBe(false);

    claimFrontendCall(handled, inFlight, "turn:retry");
    settleFrontendCall(handled, inFlight, "turn:retry", false);
    expect(claimFrontendCall(handled, inFlight, "turn:retry")).toBe(true);
  });
});

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
