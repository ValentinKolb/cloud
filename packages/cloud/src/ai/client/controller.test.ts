import { describe, expect, test } from "bun:test";
import type { AiStreamSseEvent, AiTurnBlock } from "../protocol";
import type { AiConversation } from "../types";
import { __aiControllerTest } from "./controller";
import type { AiChatProjection } from "./projection";

const {
  claimFrontendCall,
  conversationRunError,
  failSteerBlock,
  isCurrentStreamSession,
  projectionForConversationOpen,
  reconcileSteerBlocks,
  runErrorFromEvent,
  settleFrontendCall,
} = __aiControllerTest;

const conversation = (id: string): AiConversation => ({
  id,
  shortId: "cNv234",
  appId: "assistant",
  title: id,
  titleSource: "default",
  icon: "ti ti-message",
  description: "",
  descriptionSource: "default",
  keywords: [],
  pinnedAt: null,
  archivedAt: null,
  runStatus: "idle",
  runError: null,
  unreadCompletion: false,
  projectId: null,
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

describe("AI controller turn failures", () => {
  test("restores the durable latest-turn error from a state snapshot", () => {
    const failed = { ...conversation("failed"), runStatus: "failed" as const, runError: "Provider unavailable" };
    const event: AiStreamSseEvent = { type: "state", conversation: failed, messages: [], activeTurn: null };

    expect(conversationRunError(failed)).toBe("Provider unavailable");
    expect(runErrorFromEvent(event, null)).toBe("Provider unavailable");
  });

  test("uses the current finished turn and ignores stale turn events", () => {
    const failed: AiStreamSseEvent = {
      v: 1,
      type: "turn_finished",
      conversationId: "chat",
      turnId: "turn-1",
      attempt: 1,
      seq: 2,
      status: "failed",
      error: "Unauthorized",
    };

    expect(runErrorFromEvent(failed, "turn-1")).toBe("Unauthorized");
    expect(runErrorFromEvent(failed, "older-turn")).toBeUndefined();
    expect(runErrorFromEvent({ ...failed, status: "completed", error: null }, "turn-1")).toBeNull();
  });

  test("falls back to stable user-facing copy when no error was persisted", () => {
    const failed = { ...conversation("failed"), runStatus: "failed" as const, runError: null };
    expect(conversationRunError(failed)).toBe("Assistant response failed.");
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
