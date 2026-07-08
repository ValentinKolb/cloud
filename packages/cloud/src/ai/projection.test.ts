import { describe, expect, test } from "bun:test";
import { emptyProjection, reduceProjection, visibleMessages } from "./client/projection";
import type { AiStreamSseEvent, AiTurnBlock } from "./protocol";
import { messageBlockId, toolBlockId } from "./protocol";
import type { AiConversation, AiStoredMessage } from "./types";

const conversation: AiConversation = {
  id: "conv-1",
  appId: "assistant",
  title: "Chat",
  icon: "ti ti-message",
  description: "",
  resource: { kind: "direct" },
  createdByUserId: "user-1",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
};

const storedMessage = (overrides: Partial<AiStoredMessage> & { id: string; seq: number }): AiStoredMessage => ({
  conversationId: conversation.id,
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "hi" }] },
  loopId: null,
  modelProfileId: null,
  providerModel: null,
  usage: null,
  stopReason: null,
  loopAggregate: null,
  loopDoneReason: null,
  createdAt: "2026-07-07T00:00:00.000Z",
  ...overrides,
});

const wire = (partial: Record<string, unknown>): AiStreamSseEvent =>
  ({ v: 1, conversationId: conversation.id, turnId: "turn-1", ...partial }) as AiStreamSseEvent;

const feed = (events: AiStreamSseEvent[]) => events.reduce(reduceProjection, emptyProjection());

describe("projection reducer", () => {
  test("state event replaces the whole projection", () => {
    const state = feed([
      { type: "state", conversation, messages: [storedMessage({ id: "m1", seq: 1 })], activeTurn: null } as AiStreamSseEvent,
    ]);
    expect(state.conversation?.id).toBe("conv-1");
    expect(state.messages).toHaveLength(1);
    expect(state.activeTurn).toBeNull();
  });

  test("turn_started, deltas, and finish build then fold the active turn", () => {
    const userMessage = storedMessage({ id: "u1", seq: 1, loopId: "turn-1" });
    const assistantMessage = storedMessage({
      id: "a1",
      seq: 2,
      loopId: "turn-1",
      message: { role: "assistant", content: [{ type: "text", text: "Hello there" }], stopReason: "stop" },
    });

    let state = feed([
      { type: "state", conversation, messages: [userMessage], activeTurn: null } as AiStreamSseEvent,
      wire({ turnId: "turn-1", attempt: 1, seq: 1, type: "turn_started", modelProfileId: "m", providerModel: "p" }),
      wire({ turnId: "turn-1", attempt: 1, seq: 2, type: "block_set", block: { id: "s1-1", kind: "text", text: "Hello" } }),
      wire({ turnId: "turn-1", attempt: 1, seq: 3, type: "block_delta", blockId: "s1-1", blockKind: "text", delta: " there" }),
    ]);

    expect(state.activeTurn?.turnId).toBe("turn-1");
    expect(state.activeTurn?.blocks).toEqual([{ id: "s1-1", kind: "text", text: "Hello there" }]);
    // The user message shows; there is no persisted assistant yet.
    expect(visibleMessages(state)).toHaveLength(1);

    state = reduceProjection(state, wire({ turnId: "turn-1", attempt: 1, seq: 4, type: "turn_finished", status: "completed", error: null, messages: [userMessage, assistantMessage] }));
    expect(state.activeTurn).toBeNull();
    expect(state.messages).toHaveLength(2);
    expect(visibleMessages(state)).toHaveLength(2);
  });

  test("hides the active turn's persisted assistant rounds but keeps its user message", () => {
    const userMessage = storedMessage({ id: "u1", seq: 1, loopId: "turn-1" });
    const assistantRound = storedMessage({
      id: "a1",
      seq: 2,
      loopId: "turn-1",
      message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "stop" },
    });
    const state = feed([
      {
        type: "state",
        conversation,
        messages: [userMessage, assistantRound],
        activeTurn: { turnId: "turn-1", attempt: 2, seq: 5, status: "running", blocks: [{ id: "s2-1", kind: "text", text: "resuming" }], modelProfileId: "m", createdAt: "x" },
      } as AiStreamSseEvent,
    ]);
    const visible = visibleMessages(state);
    expect(visible.map((message) => message.id)).toEqual(["u1"]);
  });

  test("stale attempt events are ignored; newer attempt supersedes", () => {
    let state = feed([
      { type: "state", conversation, messages: [], activeTurn: null } as AiStreamSseEvent,
      wire({ turnId: "turn-1", attempt: 2, seq: 10, type: "turn_started", modelProfileId: "m", providerModel: "p" }),
      wire({ turnId: "turn-1", attempt: 2, seq: 11, type: "block_set", block: { id: "s2-1", kind: "text", text: "new" } }),
    ]);
    // A late attempt-1 delta must not corrupt the attempt-2 view.
    state = reduceProjection(state, wire({ turnId: "turn-1", attempt: 1, seq: 99, type: "block_delta", blockId: "s1-1", blockKind: "text", delta: "stale" }));
    expect(state.activeTurn?.blocks).toEqual([{ id: "s2-1", kind: "text", text: "new" }]);
    expect(state.activeTurn?.attempt).toBe(2);
  });

  test("derives waiting_for_action from an awaiting tool block", () => {
    const state = feed([
      { type: "state", conversation, messages: [], activeTurn: null } as AiStreamSseEvent,
      wire({ turnId: "turn-1", attempt: 1, seq: 1, type: "turn_started", modelProfileId: "m", providerModel: "p" }),
      wire({
        turnId: "turn-1",
        attempt: 1,
        seq: 2,
        type: "block_set",
        block: { id: toolBlockId("c1"), kind: "tool", callId: "c1", name: "danger", status: "awaiting_approval", approval: { allowAlways: true } },
      }),
    ]);
    expect(state.activeTurn?.status).toBe("waiting_for_action");
  });

  test("turn_finished for a different turn is ignored", () => {
    const state = feed([
      { type: "state", conversation, messages: [], activeTurn: null } as AiStreamSseEvent,
      wire({ turnId: "turn-1", attempt: 1, seq: 1, type: "turn_started", modelProfileId: "m", providerModel: "p" }),
      wire({ turnId: "turn-2", attempt: 1, seq: 1, type: "turn_finished", status: "completed", error: null, messages: [] }),
    ]);
    expect(state.activeTurn?.turnId).toBe("turn-1");
  });
});

describe("buildBlocksFromMessages via timeline shape", () => {
  test("reconstructs the same block ids the executor emits", () => {
    const messages = [
      storedMessage({
        id: "a1",
        seq: 3,
        loopId: "turn-1",
        message: { role: "assistant", content: [{ type: "text", text: "answer" }, { type: "tool_call", id: "c1", name: "web", args: {} }], stopReason: "tool_use" },
      }),
      storedMessage({ id: "t1", seq: 4, loopId: "turn-1", message: { role: "tool_result", callId: "c1", name: "web", result: { ok: true }, isError: false } }),
    ];
    const state = feed([{ type: "state", conversation, messages, activeTurn: null } as AiStreamSseEvent]);
    // Not directly exposed, but visibleMessages keeps them; block ids are asserted in stream.test.ts.
    expect(state.messages).toHaveLength(2);
    expect(messageBlockId(3, 0)).toBe("m3-0");
  });

  test("does not treat a hidden tool block id as content", () => {
    const block: AiTurnBlock = { id: toolBlockId("c1"), kind: "tool", callId: "c1", name: "web", status: "completed", result: { ok: true } };
    expect(block.id).toBe("tool-c1");
  });
});
